import fs from "fs"
import path from "path"
import crypto from "crypto"

const DATA_DIR = path.join(__dirname, "..", "data")
const CONVERSATIONS_DIR = path.join(DATA_DIR, "conversations")
const USERS_FILE = path.join(DATA_DIR, "users.json")
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json")

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

function persistUsers(): void {
  atomicWriteFile(USERS_FILE, JSON.stringify({ users }, null, 2))
}

function purgeSessions(): void {
  const cutoff = Date.now() - SESSION_KEEP_AFTER_EXPIRY_MS
  sessions = sessions.filter(s => s.revokedAt === null && s.expiresAt > cutoff)
}

export function persistSessions(): void {
  purgeSessions()
  atomicWriteFile(SESSIONS_FILE, JSON.stringify({ sessions }, null, 2))
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
    persistUsers()
  }

  if (fs.existsSync(SESSIONS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8")) as { sessions?: SessionRecord[] }
      sessions = Array.isArray(parsed.sessions) ? parsed.sessions : []
    } catch {
      sessions = []
    }
  }

  persistSessions()
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

initStorage()
