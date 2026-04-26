// State module — SQLite persistence via better-sqlite3

import Database from 'better-sqlite3'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import { join } from 'path'
import type { Session, Message, SessionLog, AgentRef, SessionStatus, SessionMode, SessionContext, RoundMetadata, DiffSnapshot, Pipeline, PipelineStep, PipelineWithSessions } from './types.js'

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
      error_type   TEXT,
      error_round  INTEGER,
      error_message TEXT,
      last_agent_output TEXT,
      resume_count INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES sessions(id),
      from_agent  TEXT NOT NULL,
      content     TEXT NOT NULL,
      timestamp   INTEGER NOT NULL,
      round       INTEGER NOT NULL,
      metadata    TEXT
    );

    CREATE TABLE IF NOT EXISTS session_logs (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES sessions(id),
      timestamp   INTEGER NOT NULL,
      level       TEXT NOT NULL,
      message     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES sessions(id),
      round       INTEGER NOT NULL,
      timestamp   INTEGER NOT NULL,
      diff_stat   TEXT NOT NULL,
      diff_full   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pipelines (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'active',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pipeline_steps (
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
      session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      position    INTEGER NOT NULL,
      depends_on  TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      PRIMARY KEY (pipeline_id, session_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_session_logs_session ON session_logs(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_snapshots_session ON snapshots(session_id, round, timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_pipeline_steps_session ON pipeline_steps(session_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_steps_pipeline ON pipeline_steps(pipeline_id, position);
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
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN error_type TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN error_round INTEGER`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN error_message TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN last_agent_output TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN resume_count INTEGER NOT NULL DEFAULT 0`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN metadata TEXT`)
  } catch { /* column already exists */ }
}

// ── Sessions ──────────────────────────────────────────────────────────────────

function rowToSession(row: Record<string, unknown>): Session {
  let systemPrompts: { from: string; to: string } | undefined
  if (row.system_prompts) {
    try { systemPrompts = JSON.parse(row.system_prompts as string) } catch { /* ignore */ }
  }
  let context: SessionContext | undefined
  if (row.context) {
    try { context = JSON.parse(row.context as string) } catch { /* ignore */ }
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
    context,
    systemPrompts,
    errorType: row.error_type as Session['errorType'] | undefined,
    errorRound: row.error_round as number | undefined,
    errorMessage: row.error_message as string | undefined,
    lastAgentOutput: row.last_agent_output as string | undefined,
    resumeCount: (row.resume_count as number | undefined) ?? 0,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export function createSession(params: {
  id: string
  from: AgentRef
  to: AgentRef
  mode?: SessionMode
  context?: SessionContext
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
    params.context ? JSON.stringify(params.context) : null,
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

export function updateSession(id: string, updates: Partial<Pick<Session, 'status' | 'currentRound' | 'maxRounds' | 'approveMode' | 'nextTurn' | 'errorType' | 'errorRound' | 'errorMessage' | 'lastAgentOutput' | 'resumeCount'>>): Session {
  const fields: string[] = ['updated_at = ?']
  const values: unknown[] = [Date.now()]

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
  if (updates.nextTurn !== undefined) { fields.push('next_turn = ?'); values.push(updates.nextTurn) }
  if (updates.currentRound !== undefined) { fields.push('current_round = ?'); values.push(updates.currentRound) }
  if (updates.maxRounds !== undefined) { fields.push('max_rounds = ?'); values.push(updates.maxRounds) }
  if (updates.approveMode !== undefined) { fields.push('approve_mode = ?'); values.push(updates.approveMode ? 1 : 0) }
  if (updates.errorType !== undefined) { fields.push('error_type = ?'); values.push(updates.errorType) }
  if (updates.errorRound !== undefined) { fields.push('error_round = ?'); values.push(updates.errorRound) }
  if (updates.errorMessage !== undefined) { fields.push('error_message = ?'); values.push(updates.errorMessage) }
  if (updates.lastAgentOutput !== undefined) { fields.push('last_agent_output = ?'); values.push(updates.lastAgentOutput) }
  if (updates.resumeCount !== undefined) { fields.push('resume_count = ?'); values.push(updates.resumeCount) }

  values.push(id)
  db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getSession(id)!
}

export function reopenSession(id: string): Session {
  const now = Date.now()
  db.prepare(`
    UPDATE sessions
    SET status = 'active',
        error_type = NULL,
        error_round = NULL,
        error_message = NULL,
        last_agent_output = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(now, id)
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
    db.prepare('DELETE FROM snapshots WHERE session_id = ?').run(sessionId)
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
  })
  tx(id)
}

// ── Pipelines ────────────────────────────────────────────────────────────────

function rowToPipeline(row: Record<string, unknown>): Pipeline {
  return {
    id: row.id as string,
    name: row.name as string,
    status: row.status as Pipeline['status'],
    sessions: getPipelineSteps(row.id as string),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

function rowToPipelineStep(row: Record<string, unknown>): PipelineStep {
  let dependsOn: string[] | undefined
  if (row.depends_on) {
    try { dependsOn = JSON.parse(row.depends_on as string) } catch { /* ignore */ }
  }
  return {
    sessionId: row.session_id as string,
    ...(dependsOn && dependsOn.length > 0 ? { dependsOn } : {}),
    status: row.status as PipelineStep['status'],
  }
}

function getPipelineSteps(pipelineId: string): PipelineStep[] {
  const rows = db.prepare(
    'SELECT * FROM pipeline_steps WHERE pipeline_id = ? ORDER BY position ASC'
  ).all(pipelineId) as Record<string, unknown>[]
  return rows.map(rowToPipelineStep)
}

function insertPipelineSteps(pipelineId: string, steps: PipelineStep[]): void {
  const stmt = db.prepare(`
    INSERT INTO pipeline_steps (pipeline_id, session_id, position, depends_on, status)
    VALUES (?, ?, ?, ?, ?)
  `)
  steps.forEach((step, index) => {
    stmt.run(
      pipelineId,
      step.sessionId,
      index,
      step.dependsOn && step.dependsOn.length > 0 ? JSON.stringify(step.dependsOn) : null,
      step.status
    )
  })
}

export function createPipeline(params: {
  id: string
  name: string
  status?: Pipeline['status']
  sessions: PipelineStep[]
}): Pipeline {
  const now = Date.now()
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO pipelines (id, name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(params.id, params.name, params.status ?? 'active', now, now)
    insertPipelineSteps(params.id, params.sessions)
  })
  tx()
  return getPipeline(params.id)!
}

export function getPipeline(id: string): Pipeline | undefined {
  const row = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToPipeline(row) : undefined
}

export function listPipelines(): Pipeline[] {
  const rows = db.prepare('SELECT * FROM pipelines ORDER BY created_at DESC').all() as Record<string, unknown>[]
  return rows.map(rowToPipeline)
}

export function updatePipeline(id: string, updates: Partial<Pick<Pipeline, 'name' | 'status' | 'sessions'>>): Pipeline {
  const tx = db.transaction(() => {
    const fields: string[] = ['updated_at = ?']
    const values: unknown[] = [Date.now()]

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }

    values.push(id)
    db.prepare(`UPDATE pipelines SET ${fields.join(', ')} WHERE id = ?`).run(...values)

    if (updates.sessions !== undefined) {
      db.prepare('DELETE FROM pipeline_steps WHERE pipeline_id = ?').run(id)
      insertPipelineSteps(id, updates.sessions)
    }
  })
  tx()
  return getPipeline(id)!
}

export function deletePipeline(id: string): void {
  db.prepare('DELETE FROM pipelines WHERE id = ?').run(id)
}

export function getPipelineWithSessions(id: string): PipelineWithSessions | undefined {
  const pipeline = getPipeline(id)
  if (!pipeline) return undefined
  const sessionDetails = pipeline.sessions
    .map((step) => getSession(step.sessionId))
    .filter((session): session is Session => Boolean(session))
  return { ...pipeline, sessionDetails }
}

export function getPipelineBySession(sessionId: string): Pipeline | undefined {
  const row = db.prepare(`
    SELECT p.*
    FROM pipelines p
    JOIN pipeline_steps ps ON ps.pipeline_id = p.id
    WHERE ps.session_id = ?
    LIMIT 1
  `).get(sessionId) as Record<string, unknown> | undefined
  return row ? rowToPipeline(row) : undefined
}

// ── Messages ──────────────────────────────────────────────────────────────────

function rowToMessage(row: Record<string, unknown>): Message {
  let metadata: RoundMetadata | undefined
  if (row.metadata) {
    try { metadata = JSON.parse(row.metadata as string) } catch { /* ignore */ }
  }
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    from: row.from_agent as string,
    content: row.content as string,
    timestamp: row.timestamp as number,
    round: row.round as number,
    metadata,
  }
}

export function addMessage(msg: Message): Message {
  db.prepare(`
    INSERT INTO messages (id, session_id, from_agent, content, timestamp, round, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    msg.id,
    msg.sessionId,
    msg.from,
    msg.content,
    msg.timestamp,
    msg.round,
    msg.metadata ? JSON.stringify(msg.metadata) : null
  )
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

function rowToSnapshot(row: Record<string, unknown>): DiffSnapshot {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    round: row.round as number,
    timestamp: row.timestamp as number,
    diffStat: row.diff_stat as string,
    diffFull: row.diff_full as string,
  }
}

export function addSnapshot(snapshot: DiffSnapshot): DiffSnapshot {
  db.prepare(`
    INSERT INTO snapshots (id, session_id, round, timestamp, diff_stat, diff_full)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    snapshot.id,
    snapshot.sessionId,
    snapshot.round,
    snapshot.timestamp,
    snapshot.diffStat,
    snapshot.diffFull
  )
  return snapshot
}

export function getSnapshots(sessionId: string): DiffSnapshot[] {
  const rows = db.prepare(
    'SELECT * FROM snapshots WHERE session_id = ? ORDER BY round ASC, timestamp ASC'
  ).all(sessionId) as Record<string, unknown>[]
  return rows.map(rowToSnapshot)
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
