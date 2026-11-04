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

const CONVERSATION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

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
// User operations
//
// Users and sessions are always read from Supabase. Vercel runs several
// server instances at once, so an in-memory copy loaded at startup goes stale
// as soon as another instance registers a user, creates a session, or revokes
// one.
// ---------------------------------------------------------------------------
export async function findUserByEmail(email: string): Promise<UserRecord | undefined> {
  const normalized = normalizeEmail(email)
  if (!normalized) return undefined
  const { data, error } = await supabase()
    .from("users")
    .select("*")
    .eq("email", normalized)
    .limit(1)
  if (error) throw new Error(`Supabase findUserByEmail error: ${error.message}`)
  return data && data.length ? rowToUser(data[0]) : undefined
}

export async function findUserById(id: string): Promise<UserRecord | undefined> {
  if (!id) return undefined
  const { data, error } = await supabase()
    .from("users")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(`Supabase findUserById error: ${error.message}`)
  return data ? rowToUser(data) : undefined
}

export class DuplicateEmailError extends Error {}

export async function addUser(user: UserRecord): Promise<void> {
  const { error } = await supabase().from("users").insert(userToRow(user))
  if (error) {
    // 23505 = unique_violation (only raised if the email column is UNIQUE)
    if (error.code === "23505") throw new DuplicateEmailError("Email already registered")
    throw new Error(`Supabase addUser error: ${error.message}`)
  }
}

export async function updateUser(user: UserRecord): Promise<void> {
  const { error } = await supabase()
    .from("users")
    .upsert(userToRow(user), { onConflict: "id" })
  if (error) throw new Error(`Supabase updateUser error: ${error.message}`)
}

export async function getAllUsers(): Promise<Omit<UserRecord, "passwordHash" | "resetCodeHash" | "resetCodeExpiresAt" | "resetCodeAttempts">[]> {
  const { data, error } = await supabase()
    .from("users")
    .select("id, full_name, email, created_at")
    .order("created_at", { ascending: false })
  if (error) throw new Error(`Supabase getAllUsers error: ${error.message}`)
  return (data ?? []).map((row: any) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    createdAt: row.created_at
  }))
}

// ---------------------------------------------------------------------------
// Session operations
// ---------------------------------------------------------------------------
export async function findSessionById(id: string): Promise<SessionRecord | undefined> {
  if (!id) return undefined
  const { data, error } = await supabase()
    .from("sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(`Supabase findSessionById error: ${error.message}`)
  return data ? rowToSession(data) : undefined
}

export async function addSession(session: SessionRecord): Promise<void> {
  const { error } = await supabase().from("sessions").insert(sessionToRow(session))
  if (error) throw new Error(`Supabase addSession error: ${error.message}`)
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  const { error } = await supabase()
    .from("sessions")
    .update({ revoked_at: Date.now() })
    .eq("user_id", userId)
    .is("revoked_at", null)
  if (error) throw new Error(`Supabase revokeAllSessions error: ${error.message}`)
}

export async function flushSession(session: SessionRecord): Promise<void> {
  const { error } = await supabase()
    .from("sessions")
    .update({ last_seen_at: session.lastSeenAt, expires_at: session.expiresAt })
    .eq("id", session.id)
  if (error) console.error(`Supabase flushSession error: ${error.message}`)
}

export async function revokeSession(sessionId: string): Promise<void> {
  const { error } = await supabase()
    .from("sessions")
    .update({ revoked_at: Date.now() })
    .eq("id", sessionId)
  if (error) throw new Error(`Supabase revokeSession error: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Applications (collected by Sarah in chat)
// ---------------------------------------------------------------------------
export type StoredApplication = {
  id: string
  userId: string | null
  conversationId: string | null
  fullName: string
  phone: string
  email: string
  university: string
  faculty: string
  academicYear: string
  request: string
  role: string
  skills: string
  notes: string
  status: string
  createdAt: string
}

export async function saveApplication(app: StoredApplication): Promise<void> {
  const { error } = await supabase().from("applications").insert({
    id: app.id,
    user_id: app.userId,
    conversation_id: app.conversationId,
    full_name: app.fullName,
    phone: app.phone,
    email: app.email,
    university: app.university,
    faculty: app.faculty,
    academic_year: app.academicYear,
    request: app.request,
    role: app.role,
    skills: app.skills,
    notes: app.notes,
    status: app.status,
    created_at: app.createdAt
  })
  if (error) throw new Error(`Supabase saveApplication error: ${error.message}`)
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
