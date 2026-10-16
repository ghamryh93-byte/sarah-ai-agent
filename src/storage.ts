import fs from "fs"
import path from "path"
import crypto from "crypto"
import { createClient, SupabaseClient } from "@supabase/supabase-js"

// ---------------------------------------------------------------------------
// Supabase client (server-side — uses service role key, bypasses RLS)
// ---------------------------------------------------------------------------
function getSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables. " +
      "Please add them in your Vercel project settings."
    )
  }
  return createClient(url, key, {
    auth: { persistSession: false }
  })
}

// Lazy singleton — created once per process (cold-start safe on Vercel)
let _supabase: SupabaseClient | null = null
function supabase(): SupabaseClient {
  if (!_supabase) _supabase = getSupabaseClient()
  return _supabase
}

// ---------------------------------------------------------------------------
// Types (unchanged public surface — auth.ts and index.ts depend on these)
// ---------------------------------------------------------------------------
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
  attachments?: MessageAttachment[]
}

export type MessageAttachment = {
  name: string
  mime: string
  url: string
  size: number
  type: "image" | "file"
}

export type ConversationRecord = {
  id: string
  userId: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ConversationMessage[]
}

// ---------------------------------------------------------------------------
// In-memory caches (populated lazily; kept in sync via write-through)
// ---------------------------------------------------------------------------
let usersCache: UserRecord[] = []
let sessionsCache: SessionRecord[] = []
let usersLoaded = false
let sessionsLoaded = false

const CONVERSATION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
const SESSION_KEEP_AFTER_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Row mappers (snake_case DB <-> camelCase TS)
// ---------------------------------------------------------------------------
function rowToUser(row: any): UserRecord {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    resetCodeHash: row.reset_code_hash ?? undefined,
    resetCodeExpiresAt: row.reset_code_expires_at ?? undefined,
    resetCodeAttempts: row.reset_code_attempts ?? undefined
  }
}

function userToRow(user: UserRecord): Record<string, any> {
  return {
    id: user.id,
    full_name: user.fullName,
    email: user.email,
    password_hash: user.passwordHash,
    created_at: user.createdAt,
    reset_code_hash: user.resetCodeHash ?? null,
    reset_code_expires_at: user.resetCodeExpiresAt ?? null,
    reset_code_attempts: user.resetCodeAttempts ?? null
  }
}

function rowToSession(row: any): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: Number(row.expires_at),
    lastSeenAt: Number(row.last_seen_at),
    revokedAt: row.revoked_at !== null ? Number(row.revoked_at) : null
  }
}

function sessionToRow(s: SessionRecord): Record<string, any> {
  return {
    id: s.id,
    user_id: s.userId,
    created_at: s.createdAt,
    expires_at: s.expiresAt,
    last_seen_at: s.lastSeenAt,
    revoked_at: s.revokedAt
  }
}

// ---------------------------------------------------------------------------
// Storage engine info
// ---------------------------------------------------------------------------
export function getStorageEngineInfo(): { engine: string; connected: boolean; persistent: boolean } {
  const hasUrl = Boolean(process.env.SUPABASE_URL)
  const hasKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  if (hasUrl && hasKey) {
    return { engine: "Supabase PostgreSQL", connected: true, persistent: true }
  }
  return { engine: "Supabase (not configured — missing env vars)", connected: false, persistent: false }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

// ---------------------------------------------------------------------------
// No-op stubs kept for backward-compat with callers in index.ts / auth.ts
// ---------------------------------------------------------------------------
export async function syncStorageWithCloud(_force = false): Promise<void> {
  // With Supabase we read/write directly — no batch sync needed
}

export async function persistUsersAsync(): Promise<void> {
  // Write-through on every mutation — nothing to flush
}

export async function persistSessionsAsync(): Promise<void> {
  // Write-through on every mutation — nothing to flush
}

export function persistSessions(): void {
  // Write-through on every mutation — nothing to flush
}

// ---------------------------------------------------------------------------
// User operations
// ---------------------------------------------------------------------------
async function loadUsers(): Promise<void> {
  if (usersLoaded) return
  const { data, error } = await supabase().from("users").select("*")
  if (error) throw new Error(`Supabase loadUsers error: ${error.message}`)
  usersCache = (data ?? []).map(rowToUser)
  usersLoaded = true
}

export function findUserByEmail(email: string): UserRecord | undefined {
  const normalized = normalizeEmail(email)
  return usersCache.find(u => u.email === normalized)
}

export function findUserById(id: string): UserRecord | undefined {
  return usersCache.find(u => u.id === id)
}

export async function addUser(user: UserRecord): Promise<void> {
  const { error } = await supabase().from("users").insert(userToRow(user))
  if (error) throw new Error(`Supabase addUser error: ${error.message}`)
  usersCache.push(user)
}

export async function updateUser(user: UserRecord): Promise<void> {
  const { error } = await supabase()
    .from("users")
    .upsert(userToRow(user), { onConflict: "id" })
  if (error) throw new Error(`Supabase updateUser error: ${error.message}`)
  const idx = usersCache.findIndex(u => u.id === user.id)
  if (idx !== -1) usersCache[idx] = user
  else usersCache.push(user)
}

export function getAllUsers(): Omit<UserRecord, "passwordHash" | "resetCodeHash" | "resetCodeExpiresAt" | "resetCodeAttempts">[] {
  return usersCache.map(({ id, fullName, email, createdAt }) => ({ id, fullName, email, createdAt }))
}

// ---------------------------------------------------------------------------
// Session operations
// ---------------------------------------------------------------------------
async function loadSessions(): Promise<void> {
  if (sessionsLoaded) return
  const cutoff = Date.now() - SESSION_KEEP_AFTER_EXPIRY_MS
  const { data, error } = await supabase()
    .from("sessions")
    .select("*")
    .or(`revoked_at.is.null,expires_at.gt.${cutoff}`)
  if (error) throw new Error(`Supabase loadSessions error: ${error.message}`)
  sessionsCache = (data ?? []).map(rowToSession)
  sessionsLoaded = true
}

export function findSessionById(id: string): SessionRecord | undefined {
  return sessionsCache.find(s => s.id === id)
}

export async function addSession(session: SessionRecord): Promise<void> {
  const { error } = await supabase().from("sessions").insert(sessionToRow(session))
  if (error) throw new Error(`Supabase addSession error: ${error.message}`)
  sessionsCache.push(session)
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  const now = Date.now()
  const { error } = await supabase()
    .from("sessions")
    .update({ revoked_at: now })
    .eq("user_id", userId)
    .is("revoked_at", null)
  if (error) throw new Error(`Supabase revokeAllSessions error: ${error.message}`)
  for (const s of sessionsCache) {
    if (s.userId === userId && s.revokedAt === null) {
      s.revokedAt = now
    }
  }
}

export async function flushSession(session: SessionRecord): Promise<void> {
  const { error } = await supabase()
    .from("sessions")
    .update({ last_seen_at: session.lastSeenAt, expires_at: session.expiresAt })
    .eq("id", session.id)
  if (error) console.error(`Supabase flushSession error: ${error.message}`)
}

export async function revokeSession(session: SessionRecord): Promise<void> {
  const { error } = await supabase()
    .from("sessions")
    .update({ revoked_at: session.revokedAt })
    .eq("id", session.id)
  if (error) console.error(`Supabase revokeSession error: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Conversation operations
// ---------------------------------------------------------------------------
export async function listConversationsForUser(userId: string): Promise<ConversationRecord[]> {
  const { data, error } = await supabase()
    .from("conversations")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
  if (error) throw new Error(`Supabase listConversations error: ${error.message}`)
  return (data ?? []).map(rowToConversation)
}

export async function readConversation(id: string): Promise<ConversationRecord | null> {
  if (!CONVERSATION_ID_PATTERN.test(id)) return null
  const { data, error } = await supabase()
    .from("conversations")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(`Supabase readConversation error: ${error.message}`)
  return data ? rowToConversation(data) : null
}

export async function writeConversation(conversation: ConversationRecord): Promise<void> {
  if (!CONVERSATION_ID_PATTERN.test(conversation.id)) {
    throw new Error("Invalid conversation id")
  }
  const { error } = await supabase()
    .from("conversations")
    .upsert(conversationToRow(conversation), { onConflict: "id" })
  if (error) throw new Error(`Supabase writeConversation error: ${error.message}`)
}

export async function deleteConversation(id: string): Promise<boolean> {
  if (!CONVERSATION_ID_PATTERN.test(id)) return false
  const { data, error } = await supabase()
    .from("conversations")
    .delete()
    .eq("id", id)
    .select("id")
  if (error) throw new Error(`Supabase deleteConversation error: ${error.message}`)
  return (data ?? []).length > 0
}

export async function listAllConversations(): Promise<ConversationRecord[]> {
  const { data, error } = await supabase()
    .from("conversations")
    .select("*")
    .order("updated_at", { ascending: false })
  if (error) throw new Error(`Supabase listAllConversations error: ${error.message}`)
  return (data ?? []).map(rowToConversation)
}

function rowToConversation(row: any): ConversationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: Array.isArray(row.messages) ? row.messages : []
  }
}

function conversationToRow(c: ConversationRecord): Record<string, any> {
  return {
    id: c.id,
    user_id: c.userId,
    title: c.title,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    messages: c.messages
  }
}

// ---------------------------------------------------------------------------
// Attachments (Supabase Storage — public bucket, auto-provisioned)
// ---------------------------------------------------------------------------
const ATTACHMENT_BUCKET = "sarah-attachments"
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024

let attachmentBucketReady = false

function attachmentType(mime: string): "image" | "file" {
  return mime.startsWith("image/") ? "image" : "file"
}

function safeAttachmentName(name: string): string {
  const trimmed = (name || "file").slice(0, 120)
  return trimmed.replace(/[\/\\?#%&=:*"'<>|]+/g, "_") || "file"
}

export class AttachmentValidationError extends Error {}

export async function saveMessageAttachment(
  conversationId: string,
  file: { name: string; mime: string; data: string }
): Promise<MessageAttachment> {
  if (!attachmentBucketReady) {
    try {
      const { data: buckets } = await supabase().storage.listBuckets()
      if (!buckets || !buckets.find(b => b.name === ATTACHMENT_BUCKET)) {
        const { error: createErr } = await supabase().storage.createBucket(ATTACHMENT_BUCKET, {
          public: true,
          fileSizeLimit: MAX_ATTACHMENT_BYTES
        })
        if (createErr && !/exists|duplicate/i.test(createErr.message)) {
          throw new Error(createErr.message)
        }
      }
      attachmentBucketReady = true
    } catch (err) {
      throw new Error(`Attachment storage unavailable: ${(err as Error).message}`)
    }
  }

  const buffer = Buffer.from(file.data, "base64")
  if (buffer.length === 0) {
    throw new AttachmentValidationError("Attachment file is empty.")
  }
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentValidationError("Attachment file is too large (max 3MB).")
  }

  const objectPath = `${conversationId}/${Date.now()}-${safeAttachmentName(file.name)}`
  const { error } = await supabase().storage
    .from(ATTACHMENT_BUCKET)
    .upload(objectPath, buffer, {
      contentType: file.mime,
      upsert: false
    })
  if (error) throw new Error(`Attachment upload failed: ${error.message}`)

  const { data: publicUrl } = supabase().storage.from(ATTACHMENT_BUCKET).getPublicUrl(objectPath)
  if (!publicUrl || !publicUrl.publicUrl) {
    throw new Error("Attachment upload failed: could not resolve public URL.")
  }

  return {
    name: file.name || "file",
    mime: file.mime,
    url: publicUrl.publicUrl,
    size: buffer.length,
    type: attachmentType(file.mime)
  }
}

// ---------------------------------------------------------------------------
// Admin check (unchanged — env var + data/admins.json + built-in fallback)
// ---------------------------------------------------------------------------
const ADMINS_FILE = path.join(__dirname, "..", "data", "admins.json")

export function isAdminEmail(email: string): boolean {
  if (!email) return false
  const normalized = email.trim().toLowerCase()

  // 1. ADMIN_EMAILS env var (comma-separated)
  if (process.env.ADMIN_EMAILS) {
    const envAdmins = process.env.ADMIN_EMAILS.split(",").map(e => e.trim().toLowerCase()).filter(Boolean)
    if (envAdmins.includes(normalized)) return true
  }

  // 2. data/admins.json file
  try {
    if (fs.existsSync(ADMINS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ADMINS_FILE, "utf8")) as { admins?: string[] }
      const fileAdmins = Array.isArray(parsed.admins) ? parsed.admins.map((e: string) => e.trim().toLowerCase()) : []
      if (fileAdmins.includes(normalized)) return true
    }
  } catch {
    // fall through
  }

  // 3. Built-in default admins
  const defaultAdmins = ["ghmaryh93@gmail.com", "ghamryh93@gmail.com", "gumballsir3@gmail.com"]
  return defaultAdmins.includes(normalized)
}

// ---------------------------------------------------------------------------
// Boot: warm up caches on first import (non-blocking)
// ---------------------------------------------------------------------------
export function initStorage(): void {
  Promise.all([loadUsers(), loadSessions()]).catch(err => {
    console.error("Supabase warm-up error:", (err as Error).message)
  })
}

initStorage()
