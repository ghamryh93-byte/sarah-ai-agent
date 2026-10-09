import fs from "fs"
import path from "path"
import crypto from "crypto"
import { put, list } from "@vercel/blob"

const DATA_DIR = process.env.VERCEL
  ? path.join("/tmp", "data")
  : (process.env.DATA_DIR || path.join(__dirname, "..", "data"))
const CONVERSATIONS_DIR = path.join(DATA_DIR, "conversations")
const USERS_FILE = path.join(DATA_DIR, "users.json")
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json")

// Admins list is always read from the repo's /data folder, not /tmp
const ADMINS_FILE = path.join(__dirname, "..", "data", "admins.json")

export type UserRecord = {
  id: string
  fullName: string
  email: string
  passwordHash: string
  createdAt: string
  resetCodeHash?: string
  resetCodeExpiresAt?: number
  resetCodeAttempts?: number
}

export type SessionRecord = {
  id: string
  userId: string
  createdAt: string
  expiresAt: number
  lastSeenAt: number
  revokedAt: number | null
}

export type ConversationMessage = {
  role: "user" | "assistant"
  content: string
  ts: string
}

export type ConversationRecord = {
  id: string
  userId: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ConversationMessage[]
}

let users: UserRecord[] = []
let sessions: SessionRecord[] = []
let initialized = false

const CONVERSATION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
const SESSION_KEEP_AFTER_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function atomicWriteFile(file: string, content: string): void {
  const tmpFile = `${file}.tmp`
  fs.writeFileSync(tmpFile, content, "utf8")
  fs.renameSync(tmpFile, file)
}

function getBlobToken(): string | undefined {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return process.env.BLOB_READ_WRITE_TOKEN.trim()
  }
  // Detect any token with custom prefix or standard Vercel format
  for (const [key, val] of Object.entries(process.env)) {
    if (typeof val === "string" && val.trim().startsWith("vercel_blob_rw_")) {
      return val.trim()
    }
    if (key.includes("BLOB") && (key.includes("TOKEN") || key.endsWith("_READ_WRITE_TOKEN"))) {
      if (typeof val === "string" && val.trim().length > 10) {
        return val.trim()
      }
    }
  }
  return undefined
}

function getBlobStoreId(): string | undefined {
  return process.env.BLOB_STORE_ID?.trim() || undefined
}

function hasBlobConfigured(): boolean {
  return Boolean(getBlobToken() || getBlobStoreId())
}

function getKvUrl(): string | undefined {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
}

function getKvToken(): string | undefined {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
}

function hasCloudConfigured(): boolean {
  return Boolean(hasBlobConfigured() || (getKvUrl() && getKvToken()))
}

function blobOptions(): Record<string, any> {
  const token = getBlobToken()
  const storeId = getBlobStoreId()
  if (token) return { token }
  if (storeId) return { storeId }
  return {}
}

async function blobGet<T>(pathname: string): Promise<T | null> {
  if (!hasBlobConfigured()) return null
  try {
    const opts = blobOptions()
    const { blobs } = await list({ prefix: pathname, ...opts })
    if (!blobs || blobs.length === 0) return null
    const matching = blobs.filter((b: any) => b.pathname === pathname)
    const exact = matching.length > 0
      ? matching.sort((a: any, b: any) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0]
      : blobs[0]
    const targetUrl = exact.downloadUrl || exact.url
    const fetchFn = typeof fetch !== "undefined" ? fetch : require("node-fetch")
    const res = await fetchFn(`${targetUrl}?t=${Date.now()}`, {
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache"
      }
    })
    if (!res.ok) {
      console.warn(`Blob fetch returned HTTP ${res.status} for ${pathname}`)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.error(`Blob read error for ${pathname}:`, (err as Error).message)
    return null
  }
}

async function blobSet(pathname: string, data: any): Promise<void> {
  if (!hasBlobConfigured()) {
    console.warn(`blobSet skipped: no Blob credentials (BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID) found`)
    return
  }
  try {
    const opts = blobOptions()
    const result = await put(pathname, JSON.stringify(data), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      ...opts
    })
    console.log(`Blob successfully saved for ${pathname}: ${result.url}`)
  } catch (err) {
    console.error(`Blob write error for ${pathname}:`, (err as Error).message)
  }
}

export function getStorageEngineInfo(): { engine: string; connected: boolean; persistent: boolean } {
  if (getBlobToken()) {
    return { engine: "Vercel Blob (token auth)", connected: true, persistent: true }
  }
  if (getBlobStoreId()) {
    return { engine: "Vercel Blob (store ID / OIDC)", connected: true, persistent: true }
  }
  if (getKvUrl() && getKvToken()) {
    return { engine: "Vercel KV / Upstash Redis", connected: true, persistent: true }
  }
  if (!process.env.VERCEL) {
    return { engine: "Local Filesystem (/data)", connected: true, persistent: true }
  }
  return { engine: "Local Ephemeral (/tmp, No Persistent Database Connected)", connected: false, persistent: false }
}

async function kvGet<T>(key: string): Promise<T | null> {
  const kvUrl = getKvUrl()
  const kvToken = getKvToken()
  if (!kvUrl || !kvToken) return null
  try {
    const fetchFn = typeof fetch !== "undefined" ? fetch : require("node-fetch")
    const res = await fetchFn(`${kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    })
    if (!res.ok) return null
    const json = (await res.json()) as { result?: any }
    if (!json.result) return null
    return typeof json.result === "string" ? JSON.parse(json.result) : json.result
  } catch (err) {
    console.error(`KV get error for ${key}:`, (err as Error).message)
    return null
  }
}

async function kvSet(key: string, value: any): Promise<void> {
  const kvUrl = getKvUrl()
  const kvToken = getKvToken()
  if (!kvUrl || !kvToken) return
  try {
    const fetchFn = typeof fetch !== "undefined" ? fetch : require("node-fetch")
    await fetchFn(`${kvUrl}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${kvToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(typeof value === "string" ? value : JSON.stringify(value))
    })
  } catch (err) {
    console.error(`KV set error for ${key}:`, (err as Error).message)
  }
}

export async function persistUsersAsync(): Promise<void> {
  atomicWriteFile(USERS_FILE, JSON.stringify({ users }, null, 2))
  const kvUrl = getKvUrl()
  const kvToken = getKvToken()
  if (kvUrl && kvToken) {
    await kvSet("sarah:users", users).catch(() => {})
  }
  if (getBlobToken()) {
    await blobSet("data/users.json", users).catch(() => {})
  }
}

function persistUsers(): void {
  atomicWriteFile(USERS_FILE, JSON.stringify({ users }, null, 2))
  persistUsersAsync().catch(() => {})
}

function purgeSessions(): void {
  const cutoff = Date.now() - SESSION_KEEP_AFTER_EXPIRY_MS
  sessions = sessions.filter(s => s.revokedAt === null && s.expiresAt > cutoff)
}

export async function persistSessionsAsync(): Promise<void> {
  purgeSessions()
  atomicWriteFile(SESSIONS_FILE, JSON.stringify({ sessions }, null, 2))
  const kvUrl = getKvUrl()
  const kvToken = getKvToken()
  if (kvUrl && kvToken) {
    await kvSet("sarah:sessions", sessions).catch(() => {})
  }
  if (getBlobToken()) {
    await blobSet("data/sessions.json", sessions).catch(() => {})
  }
}

export function persistSessions(): void {
  purgeSessions()
  atomicWriteFile(SESSIONS_FILE, JSON.stringify({ sessions }, null, 2))
  persistSessionsAsync().catch(() => {})
}

let lastSyncTime = 0
const SYNC_INTERVAL_MS = 2000

export async function syncStorageWithCloud(force = false): Promise<void> {
  if (!hasCloudConfigured()) return
  const now = Date.now()
  if (!force && now - lastSyncTime < SYNC_INTERVAL_MS) return
  lastSyncTime = now

  try {
    let cloudUsers: UserRecord[] | null = null
    if (getBlobToken()) {
      cloudUsers = await blobGet<UserRecord[]>("data/users.json")
    } else if (getKvUrl() && getKvToken()) {
      cloudUsers = await kvGet<UserRecord[]>("sarah:users")
    }

    if (cloudUsers && Array.isArray(cloudUsers)) {
      const userMap = new Map<string, UserRecord>()
      for (const u of cloudUsers) {
        if (u && u.id && u.email) userMap.set(u.id, u)
      }
      for (const u of users) {
        if (u && u.id && u.email && !userMap.has(u.id)) {
          userMap.set(u.id, u)
        }
      }
      users = Array.from(userMap.values())
      atomicWriteFile(USERS_FILE, JSON.stringify({ users }, null, 2))
    }

    let cloudSessions: SessionRecord[] | null = null
    if (getBlobToken()) {
      cloudSessions = await blobGet<SessionRecord[]>("data/sessions.json")
    } else if (getKvUrl() && getKvToken()) {
      cloudSessions = await kvGet<SessionRecord[]>("sarah:sessions")
    }

    if (cloudSessions && Array.isArray(cloudSessions)) {
      const idMap = new Map<string, SessionRecord>()
      for (const s of cloudSessions) {
        if (s && s.id) idMap.set(s.id, s)
      }
      for (const s of sessions) {
        if (s && s.id && !idMap.has(s.id)) {
          idMap.set(s.id, s)
        }
      }
      sessions = Array.from(idMap.values())
      purgeSessions()
      atomicWriteFile(SESSIONS_FILE, JSON.stringify({ sessions }, null, 2))
    }
  } catch (err) {
    console.error("Cloud storage sync error:", (err as Error).message)
  }
}

export function initStorage(): void {
  if (initialized) return
  initialized = true

  ensureDir(DATA_DIR)
  ensureDir(CONVERSATIONS_DIR)

  if (fs.existsSync(USERS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(USERS_FILE, "utf8")) as { users?: UserRecord[] }
      users = Array.isArray(parsed.users) ? parsed.users : []
    } catch {
      users = []
    }
  } else {
    // Write empty local file only; DO NOT call persistUsers() which would overwrite cloud DB with empty array
    atomicWriteFile(USERS_FILE, JSON.stringify({ users: [] }, null, 2))
  }

  if (fs.existsSync(SESSIONS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8")) as { sessions?: SessionRecord[] }
      sessions = Array.isArray(parsed.sessions) ? parsed.sessions : []
    } catch {
      sessions = []
    }
  } else {
    // Write empty local file only; DO NOT call persistSessions() which would overwrite cloud DB with empty array
    atomicWriteFile(SESSIONS_FILE, JSON.stringify({ sessions: [] }, null, 2))
  }
}

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function findUserByEmail(email: string): UserRecord | undefined {
  const normalized = normalizeEmail(email)
  return users.find(u => u.email === normalized)
}

export function findUserById(id: string): UserRecord | undefined {
  return users.find(u => u.id === id)
}

export function addUser(user: UserRecord): void {
  users.push(user)
  persistUsers()
}

export function updateUser(user: UserRecord): void {
  const index = users.findIndex(u => u.id === user.id)
  if (index === -1) return
  users[index] = user
  persistUsers()
}

export function revokeAllSessionsForUser(userId: string): void {
  const now = Date.now()
  for (const session of sessions) {
    if (session.userId === userId && session.revokedAt === null) {
      session.revokedAt = now
    }
  }
  persistSessions()
}

export function findSessionById(id: string): SessionRecord | undefined {
  return sessions.find(s => s.id === id)
}

export function addSession(session: SessionRecord): void {
  sessions.push(session)
  persistSessions()
}

export function listConversationIds(): string[] {
  return fs
    .readdirSync(CONVERSATIONS_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => f.slice(0, -".json".length))
}

export function readConversation(id: string): ConversationRecord | null {
  if (!CONVERSATION_ID_PATTERN.test(id)) return null
  const file = path.join(CONVERSATIONS_DIR, `${id}.json`)
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ConversationRecord
  } catch {
    return null
  }
}

export function listConversationsForUser(userId: string): ConversationRecord[] {
  const result: ConversationRecord[] = []
  for (const id of listConversationIds()) {
    const conversation = readConversation(id)
    if (conversation && conversation.userId === userId) {
      result.push(conversation)
    }
  }
  return result.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export function writeConversation(conversation: ConversationRecord): void {
  if (!CONVERSATION_ID_PATTERN.test(conversation.id)) {
    throw new Error("Invalid conversation id")
  }
  atomicWriteFile(
    path.join(CONVERSATIONS_DIR, `${conversation.id}.json`),
    JSON.stringify(conversation, null, 2)
  )
}

export function deleteConversation(id: string): boolean {
  if (!CONVERSATION_ID_PATTERN.test(id)) return false
  const file = path.join(CONVERSATIONS_DIR, `${id}.json`)
  if (!fs.existsSync(file)) return false
  fs.unlinkSync(file)
  return true
}

export function getAllUsers(): Omit<UserRecord, "passwordHash" | "resetCodeHash" | "resetCodeExpiresAt" | "resetCodeAttempts">[] {
  return users.map(({ id, fullName, email, createdAt }) => ({ id, fullName, email, createdAt }))
}

export function listAllConversations(): ConversationRecord[] {
  const result: ConversationRecord[] = []
  for (const id of listConversationIds()) {
    const conv = readConversation(id)
    if (conv) result.push(conv)
  }
  return result.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export function isAdminEmail(email: string): boolean {
  if (!email) return false
  const normalized = email.trim().toLowerCase()

  // 1. Check environment variable ADMIN_EMAILS (e.g. from Vercel: "email1,email2")
  if (process.env.ADMIN_EMAILS) {
    const envAdmins = process.env.ADMIN_EMAILS.split(",").map(e => e.trim().toLowerCase()).filter(Boolean)
    if (envAdmins.includes(normalized)) return true
  }

  // 2. Check data/admins.json file
  try {
    if (fs.existsSync(ADMINS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ADMINS_FILE, "utf8")) as { admins?: string[] }
      const fileAdmins = Array.isArray(parsed.admins) ? parsed.admins.map((e: string) => e.trim().toLowerCase()) : []
      if (fileAdmins.includes(normalized)) return true
    }
  } catch {
    // continue to fallback
  }

  // 3. Built-in default admins fallback
  const defaultAdmins = ["ghmaryh93@gmail.com", "ghamryh93@gmail.com", "gumballsir3@gmail.com"]
  return defaultAdmins.includes(normalized)
}

initStorage()
