import http from "http"

// ---------------------------------------------------------------------------
// Simple fixed-window rate limiter.
//
// Counters live in memory, so each Vercel instance keeps its own count. That
// still stops a single client hammering the API (requests from one client are
// usually routed to a warm instance), but it is not a hard global limit. For a
// strict global limit, move the counters to a shared store (e.g. Upstash Redis
// or a Supabase table).
// ---------------------------------------------------------------------------

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 50_000

export type RateLimitRule = {
  name: string
  limit: number
  windowMs: number
}

export const RATE_LIMITS = {
  login: { name: "login", limit: 10, windowMs: 15 * 60 * 1000 },
  register: { name: "register", limit: 5, windowMs: 60 * 60 * 1000 },
  forgotPassword: { name: "forgot", limit: 5, windowMs: 60 * 60 * 1000 },
  resetPassword: { name: "reset", limit: 10, windowMs: 15 * 60 * 1000 },
  chatPerMinute: { name: "chat-min", limit: 15, windowMs: 60 * 1000 },
  chatPerDay: { name: "chat-day", limit: 300, windowMs: 24 * 60 * 60 * 1000 },
  upload: { name: "upload", limit: 30, windowMs: 60 * 60 * 1000 },
  voice: { name: "voice", limit: 40, windowMs: 60 * 60 * 1000 }
} satisfies Record<string, RateLimitRule>

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

/**
 * Counts one hit for `key` under `rule`.
 * Returns 0 when allowed, otherwise the number of seconds until the window resets.
 */
export function hit(rule: RateLimitRule, key: string): number {
  const now = Date.now()
  if (buckets.size > MAX_BUCKETS) sweep(now)

  const fullKey = `${rule.name}:${key}`
  let bucket = buckets.get(fullKey)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + rule.windowMs }
    buckets.set(fullKey, bucket)
  }

  bucket.count++
  if (bucket.count > rule.limit) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  }
  return 0
}

/** Clears a key, e.g. after a successful login. */
export function reset(rule: RateLimitRule, key: string): void {
  buckets.delete(`${rule.name}:${key}`)
}

export function clientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"]
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded || "").split(",")[0].trim()
  const realIp = req.headers["x-real-ip"]
  return first || (Array.isArray(realIp) ? realIp[0] : realIp) || req.socket.remoteAddress || "unknown"
}

export function tooManyRequests(res: http.ServerResponse, retryAfterSeconds: number, message?: string): void {
  res.writeHead(429, {
    "Content-Type": "application/json; charset=utf-8",
    "Retry-After": String(retryAfterSeconds)
  })
  const minutes = Math.ceil(retryAfterSeconds / 60)
  res.end(
    JSON.stringify({
      error: message || `طلبات كتير في وقت قصير. جرب تاني بعد ${minutes} دقيقة.`,
      retryAfter: retryAfterSeconds
    })
  )
}
