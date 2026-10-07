import crypto from "crypto"
import {
  UserRecord,
  SessionRecord,
  findUserByEmail,
  findUserById,
  findSessionById,
  addUser,
  addSession,
  updateUser,
  normalizeEmail,
  generateId,
  persistSessions,
  revokeAllSessionsForUser
} from "./storage"

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEY_LENGTH = 64
const SALT_LENGTH = 16

export const SESSION_COOKIE_NAME = "sarah_session"
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_RENEW_PERSIST_INTERVAL_MS = 60 * 60 * 1000

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const lastRenewPersistAt = new Map<string, number>()

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH)
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  })
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("hex")}:${hash.toString("hex")}`
}

const DUMMY_HASH = hashPassword("timing-equalizer-dummy-password")

export function verifyPassword(password: string, storedHash: string): boolean {
  let expectedHash: Buffer | null = null
  let salt = Buffer.alloc(SALT_LENGTH)
  let params = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }

  const parts = storedHash.split(":")
  if (parts.length === 6 && parts[0] === "scrypt") {
    const N = Number(parts[1])
    const r = Number(parts[2])
    const p = Number(parts[3])
    const saltBuffer = Buffer.from(parts[4], "hex")
    const hashBuffer = Buffer.from(parts[5], "hex")
    if (
      Number.isInteger(N) && N > 0 &&
      Number.isInteger(r) && r > 0 &&
      Number.isInteger(p) && p > 0 &&
      saltBuffer.length === SALT_LENGTH &&
      hashBuffer.length === SCRYPT_KEY_LENGTH
    ) {
      expectedHash = hashBuffer
      salt = saltBuffer
      params = { N, r, p }
    }
  }

  const actualHash = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH, params)

  if (!expectedHash) return false

  return actualHash.length === expectedHash.length && crypto.timingSafeEqual(actualHash, expectedHash)
}

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex")
}

export function createSession(userId: string): { token: string; session: SessionRecord } {
  const token = crypto.randomBytes(32).toString("hex")
  const now = Date.now()
  const session: SessionRecord = {
    id: hashSessionToken(token),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + SESSION_LIFETIME_MS,
    lastSeenAt: now,
    revokedAt: null
  }
  addSession(session)
  return { token, session }
}

function parseSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    if (trimmed.slice(0, eq) === SESSION_COOKIE_NAME) {
      const value = trimmed.slice(eq + 1)
      return value ? value : null
    }
  }
  return null
}

export function getSessionUser(cookieHeader: string | undefined): UserRecord | null {
  const token = parseSessionCookie(cookieHeader)
  if (!token) return null

  const session = findSessionById(hashSessionToken(token))
  if (!session || session.revokedAt !== null || session.expiresAt <= Date.now()) return null

  const user = findUserById(session.userId)
  if (!user) return null

  const now = Date.now()
  session.lastSeenAt = now
  session.expiresAt = now + SESSION_LIFETIME_MS

  const lastPersist = lastRenewPersistAt.get(session.id) || 0
  if (now - lastPersist >= SESSION_RENEW_PERSIST_INTERVAL_MS) {
    lastRenewPersistAt.set(session.id, now)
    persistSessions()
  }

  return user
}

export function revokeSessionByCookie(cookieHeader: string | undefined): boolean {
  const token = parseSessionCookie(cookieHeader)
  if (!token) return false

  const session = findSessionById(hashSessionToken(token))
  if (!session) return false

  session.revokedAt = Date.now()
  persistSessions()
  return true
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_LIFETIME_MS / 1000)}`
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
}

export type PublicUser = {
  id: string
  fullName: string
  email: string
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email
  }
}

export type RegistrationInput = {
  fullName: string
  email: string
  password: string
  confirmPassword: string
}

export function validateRegistrationInput(input: RegistrationInput): string | null {
  const fullName = input.fullName.trim()

  if (fullName.length < 2 || fullName.length > 80) {
    return "Full name must be between 2 and 80 characters."
  }
  if (/[\r\n\t]/.test(fullName)) {
    return "Full name contains invalid characters."
  }

  const email = normalizeEmail(input.email)
  if (email.length < 6 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return "A valid email address is required."
  }

  if (input.password.length < 8) {
    return "Password must be at least 8 characters."
  }
  if (input.password.length > 128) {
    return "Password must be at most 128 characters."
  }
  if (input.password !== input.confirmPassword) {
    return "Passwords do not match."
  }

  return null
}

export type RegisterResult =
  | { ok: true; user: UserRecord }
  | { ok: false; error: "DUPLICATE_EMAIL" }

export function registerUser(input: RegistrationInput): RegisterResult {
  const email = normalizeEmail(input.email)

  if (findUserByEmail(email)) {
    return { ok: false, error: "DUPLICATE_EMAIL" }
  }

  const user: UserRecord = {
    id: generateId("u"),
    fullName: input.fullName.trim(),
    email,
    passwordHash: hashPassword(input.password),
    createdAt: new Date().toISOString()
  }

  addUser(user)
  return { ok: true, user }
}

export function authenticate(email: string, password: string): UserRecord | null {
  const user = findUserByEmail(email)

  if (!user) {
    verifyPassword(password, DUMMY_HASH)
    return null
  }

  if (!verifyPassword(password, user.passwordHash)) return null

  return user
}

const RESET_CODE_TTL_MS = 15 * 60 * 1000
const MAX_RESET_CODE_ATTEMPTS = 5

function safeEqualHex(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "hex")
  const bufferB = Buffer.from(b, "hex")
  return bufferA.length === bufferB.length && crypto.timingSafeEqual(bufferA, bufferB)
}

export function issuePasswordReset(email: string): { code: string; user: UserRecord } | null {
  const user = findUserByEmail(email)
  if (!user) return null

  const code = String(crypto.randomInt(100000, 1000000))
  user.resetCodeHash = hashSessionToken(code)
  user.resetCodeExpiresAt = Date.now() + RESET_CODE_TTL_MS
  user.resetCodeAttempts = 0
  updateUser(user)

  return { code, user }
}

export type ConsumeResetResult = "OK" | "INVALID" | "EXPIRED" | "TOO_MANY_ATTEMPTS"

export function consumePasswordReset(email: string, code: string, newPassword: string): ConsumeResetResult {
  const user = findUserByEmail(email)
  if (!user) return "INVALID"
  if (!user.resetCodeHash || !user.resetCodeExpiresAt) return "INVALID"
  if (Date.now() > user.resetCodeExpiresAt) return "EXPIRED"

  const attempts = user.resetCodeAttempts || 0
  if (attempts >= MAX_RESET_CODE_ATTEMPTS) return "TOO_MANY_ATTEMPTS"

  if (!safeEqualHex(hashSessionToken(code), user.resetCodeHash)) {
    user.resetCodeAttempts = attempts + 1
    updateUser(user)
    return "INVALID"
  }

  user.passwordHash = hashPassword(newPassword)
  user.resetCodeHash = undefined
  user.resetCodeExpiresAt = undefined
  user.resetCodeAttempts = undefined
  updateUser(user)
  revokeAllSessionsForUser(user.id)

  return "OK"
}
