// State module — SQLite persistence via better-sqlite3

import Database from 'better-sqlite3'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import { join } from 'path'
import type { Session, Message, SessionLog, AgentRef, SessionStatus, SessionMode } from './types.js'

const DB_DIR = join(homedir(), '.turing')
const DB_PATH = join(DB_DIR, 'turing.db')
const DEFAULT_MESSAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const MESSAGE_GC_INTERVAL_MS = 60 * 60 * 1000

let db: Database.Database
let messageRetentionMs = DEFAULT_MESSAGE_RETENTION_MS
let lastMessageGcAt = 0

export function initDb(
  dbPath = DB_PATH,
  options?: { messageRetentionMs?: number }
): void {
  mkdirSync(join(homedir(), '.turing'), { recursive: true })
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  messageRetentionMs = options?.messageRetentionMs ?? DEFAULT_MESSAGE_RETENTION_MS
  lastMessageGcAt = 0
  createTables()
  pruneExpiredMessages()
}

export function closeDb(): void {
  if (db?.open) {
    db.close()
  }
}

function createTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      from_adapter TEXT NOT NULL,
      from_label   TEXT,
      to_adapter   TEXT NOT NULL,
      to_label     TEXT,
      status       TEXT NOT NULL DEFAULT 'active',
      mode         TEXT NOT NULL DEFAULT 'freeform',
      next_turn    TEXT NOT NULL DEFAULT 'to',
      max_rounds   INTEGER NOT NULL DEFAULT 20,
      current_round INTEGER NOT NULL DEFAULT 0,
      approve_mode INTEGER NOT NULL DEFAULT 0,
      cwd          TEXT,
      context      TEXT,
      system_prompts TEXT,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES sessions(id),
      from_agent  TEXT NOT NULL,
      content     TEXT NOT NULL,
      timestamp   INTEGER NOT NULL,
      round       INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_logs (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES sessions(id),
      timestamp   INTEGER NOT NULL,
      level       TEXT NOT NULL,
      message     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_session_logs_session ON session_logs(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  `)

  // Migrate: add new columns if they don't exist (for existing DBs)
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'freeform'`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN context TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN system_prompts TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN next_turn TEXT NOT NULL DEFAULT 'to'`)
  } catch { /* column already exists */ }
}

// ── Sessions ──────────────────────────────────────────────────────────────────

function rowToSession(row: Record<string, unknown>): Session {
  let systemPrompts: { from: string; to: string } | undefined
  if (row.system_prompts) {
    try { systemPrompts = JSON.parse(row.system_prompts as string) } catch { /* ignore */ }
  }
  return {
    id: row.id as string,
    from: { adapter: row.from_adapter as string, label: row.from_label as string | undefined },
    to: { adapter: row.to_adapter as string, label: row.to_label as string | undefined },
    status: row.status as SessionStatus,
    mode: (row.mode as SessionMode) || 'freeform',
    nextTurn: (row.next_turn as 'from' | 'to') || 'to',
    maxRounds: row.max_rounds as number,
    currentRound: row.current_round as number,
    approveMode: Boolean(row.approve_mode),
    cwd: row.cwd as string | undefined,
    context: row.context as string | undefined,
    systemPrompts,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export function createSession(params: {
  id: string
  from: AgentRef
  to: AgentRef
  mode?: SessionMode
  context?: string
  systemPrompts?: { from: string; to: string }
  nextTurn?: 'from' | 'to'
  maxRounds?: number
  approveMode?: boolean
  cwd?: string
}): Session {
  const now = Date.now()
  const stmt = db.prepare(`
    INSERT INTO sessions (id, from_adapter, from_label, to_adapter, to_label,
      status, mode, next_turn, max_rounds, current_round, approve_mode, cwd, context, system_prompts,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    params.id,
    params.from.adapter,
    params.from.label ?? null,
    params.to.adapter,
    params.to.label ?? null,
    params.mode ?? 'freeform',
    params.nextTurn ?? 'to',
    params.maxRounds ?? 20,
    params.approveMode ? 1 : 0,
    params.cwd ?? null,
    params.context ?? null,
    params.systemPrompts ? JSON.stringify(params.systemPrompts) : null,
    now,
    now
  )
  return getSession(params.id)!
}

export function getSession(id: string): Session | undefined {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToSession(row) : undefined
}

export function updateSession(id: string, updates: Partial<Pick<Session, 'status' | 'currentRound' | 'maxRounds' | 'approveMode' | 'nextTurn'>>): Session {
  const fields: string[] = ['updated_at = ?']
  const values: unknown[] = [Date.now()]

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
  if (updates.nextTurn !== undefined) { fields.push('next_turn = ?'); values.push(updates.nextTurn) }
  if (updates.currentRound !== undefined) { fields.push('current_round = ?'); values.push(updates.currentRound) }
  if (updates.maxRounds !== undefined) { fields.push('max_rounds = ?'); values.push(updates.maxRounds) }
  if (updates.approveMode !== undefined) { fields.push('approve_mode = ?'); values.push(updates.approveMode ? 1 : 0) }

  values.push(id)
  db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getSession(id)!
}

export function reopenSession(id: string): Session {
  const now = Date.now()
  db.prepare(`UPDATE sessions SET status = 'active', current_round = 0, updated_at = ? WHERE id = ?`).run(now, id)
  return getSession(id)!
}

export function listSessions(filter?: { status?: SessionStatus }): Session[] {
  if (filter?.status) {
    const rows = db.prepare('SELECT * FROM sessions WHERE status = ? ORDER BY created_at DESC').all(filter.status) as Record<string, unknown>[]
    return rows.map(rowToSession)
  }
  const rows = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all() as Record<string, unknown>[]
  return rows.map(rowToSession)
}

export function deleteSession(id: string): void {
  const tx = db.transaction((sessionId: string) => {
    db.prepare('DELETE FROM session_logs WHERE session_id = ?').run(sessionId)
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
  })
  tx(id)
}

// ── Messages ──────────────────────────────────────────────────────────────────

function rowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    from: row.from_agent as string,
    content: row.content as string,
    timestamp: row.timestamp as number,
    round: row.round as number,
  }
}

export function addMessage(msg: Message): Message {
  db.prepare(`
    INSERT INTO messages (id, session_id, from_agent, content, timestamp, round)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(msg.id, msg.sessionId, msg.from, msg.content, msg.timestamp, msg.round)
  maybeRunMessageGc(msg.timestamp)
  return msg
}

export function getMessages(sessionId: string): Message[] {
  const rows = db.prepare(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC'
  ).all(sessionId) as Record<string, unknown>[]
  return rows.map(rowToMessage)
}

function rowToSessionLog(row: Record<string, unknown>): SessionLog {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    timestamp: row.timestamp as number,
    level: row.level as SessionLog['level'],
    message: row.message as string,
  }
}

export function addLog(log: SessionLog): SessionLog {
  db.prepare(`
    INSERT INTO session_logs (id, session_id, timestamp, level, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(log.id, log.sessionId, log.timestamp, log.level, log.message)
  maybeRunMessageGc(log.timestamp)
  return log
}

export function getLogs(sessionId: string): SessionLog[] {
  const rows = db.prepare(
    'SELECT * FROM session_logs WHERE session_id = ? ORDER BY timestamp ASC'
  ).all(sessionId) as Record<string, unknown>[]
  return rows.map(rowToSessionLog)
}

export function pruneExpiredMessages(now = Date.now()): number {
  if (messageRetentionMs <= 0) return 0
  const cutoff = now - messageRetentionMs
  const deletedMessages = db.prepare('DELETE FROM messages WHERE timestamp < ?').run(cutoff).changes
  const deletedLogs = db.prepare('DELETE FROM session_logs WHERE timestamp < ?').run(cutoff).changes
  lastMessageGcAt = now
  return deletedMessages + deletedLogs
}

function maybeRunMessageGc(now: number): void {
  if (messageRetentionMs <= 0) return
  if (now - lastMessageGcAt < MESSAGE_GC_INTERVAL_MS) return
  pruneExpiredMessages(now)
}
