// State module — SQLite persistence via better-sqlite3

import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { resolveDataHome } from './paths.js'
import { clampSessionContext } from './prompts.js'
import type {
  Session,
  Message,
  SessionLog,
  AgentRef,
  SessionStatus,
  SessionMode,
  SessionScenario,
  SessionParticipant,
  SessionContext,
  SessionArtifacts,
  RoundMetadata,
  DiffSnapshot,
  SessionVersion,
  Pipeline,
  PipelineStep,
  PipelineTemplateRecord,
  PipelineWithSessions,
  PassitonStats,
  AgentUsageStats,
  AgentConfig,
  Task,
  TaskStatus,
  WorkspaceDirtyState,
  ExternalJob,
  OpsIncident,
  OpsIncidentClassification,
  OpsIncidentStatus,
} from './types.js'

const DB_DIR = resolveDataHome()
const DB_PATH = join(DB_DIR, 'turing.db')
const DEFAULT_MESSAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const MESSAGE_GC_INTERVAL_MS = 60 * 60 * 1000

let db: Database.Database
let messageRetentionMs = DEFAULT_MESSAGE_RETENTION_MS
let lastMessageGcAt = 0
export const DEFAULT_USER_ID = 'local'

export interface UserRecord {
  id: string
  email: string
  passwordHash: string
  salt: string
  createdAt: number
}

export interface ApiTokenRecord {
  id: string
  userId: string
  tokenHash: string
  tokenLast4: string
  name: string
  createdAt: number
  lastUsedAt?: number
}

export interface StoredApiKeyRecord {
  id: string
  userId: string
  provider: 'anthropic' | 'openai' | 'deepseek' | 'zhipu' | 'qwen' | 'moonshot'
  encryptedKey: string
  iv: string
  authTag: string
  name: string
  createdAt: number
}

export interface UserAgentRecord {
  id: string
  userId: string
  name: string
  adapter: string
  encryptedKey?: string
  iv?: string
  authTag?: string
  model?: string
  baseUrl?: string
  timeout: number
  createdAt: number
}

export function initDb(
  dbPath = DB_PATH,
  options?: { messageRetentionMs?: number }
): void {
  mkdirSync(resolveDataHome(), { recursive: true })
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  messageRetentionMs = options?.messageRetentionMs ?? DEFAULT_MESSAGE_RETENTION_MS
  lastMessageGcAt = 0
  createTables()
  runOneTimeBloatMigration()
  pruneExpiredMessages()
}

/**
 * One-time migration (user_version 0 → 1) that cleans up legacy DB bloat:
 *
 * - system_prompts: any row whose stored JSON exceeds 1 MB is set to NULL.
 *   These are always generated prompts (now reconstructed at runtime via
 *   resolveSystemPrompts).  User-provided prompts are tiny (< 10 KB) and
 *   are never touched.
 *
 * - context: left AS-IS.  Context is user-supplied structured data (file
 *   contents, rules, text).  Setting it to NULL would silently break session
 *   reconstruction — the agent would lose all background context for that
 *   session, with no way to recover.  Going forward, new writes are clamped
 *   by clampSessionContext(), so the problem won't grow.  Existing oversized
 *   context rows are a one-time cost that decreases as old sessions age out.
 *
 * After cleanup, VACUUM reclaims the freed pages.
 */
function runOneTimeBloatMigration(): void {
  const version = (db.pragma('user_version', { simple: true }) as number) ?? 0
  if (version >= 1) return

  console.log('[passiton] Running one-time DB bloat cleanup migration (user_version 0 → 1)…')

  // ── system_prompts: NULL out anything over 1 MB ──
  const promptResult = db.prepare(
    `UPDATE sessions SET system_prompts = NULL WHERE LENGTH(system_prompts) > 1048576`
  ).run()
  if (promptResult.changes > 0) {
    console.log(`[passiton] Bloat cleanup: nulled ${promptResult.changes} oversized system_prompts row(s)`)
  }

  // context: intentionally NOT touched (see function doc above).

  // ── VACUUM to reclaim disk space ──
  console.log('[passiton] Bloat cleanup: running VACUUM to reclaim freed space (may take a few seconds)…')
  db.exec('VACUUM')

  db.pragma('user_version = 1')
  console.log('[passiton] Bloat cleanup migration complete (user_version set to 1)')
}

export function closeDb(): void {
  if (db?.open) {
    db.close()
  }
}

function createTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt          TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_tokens (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash   TEXT NOT NULL UNIQUE,
      token_last4  TEXT NOT NULL DEFAULT '',
      name         TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      last_used_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider      TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      iv            TEXT NOT NULL,
      auth_tag      TEXT NOT NULL,
      name          TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_agents (
      id                TEXT PRIMARY KEY,
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name              TEXT NOT NULL,
      adapter           TEXT NOT NULL,
      api_key_encrypted TEXT,
      iv                TEXT,
      auth_tag          TEXT,
      model             TEXT,
      base_url          TEXT,
      timeout           INTEGER DEFAULT 120000,
      created_at        TEXT NOT NULL,
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL DEFAULT 'local',
      idempotency_key TEXT,
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
      permission_mode TEXT NOT NULL DEFAULT 'safe',
      cwd          TEXT,
      context      TEXT,
      system_prompts TEXT,
      scenario      TEXT,
      participants  TEXT,
      next_participant_index INTEGER NOT NULL DEFAULT 0,
      template_id  TEXT,
      git_snapshot TEXT,
      artifacts    TEXT,
      error_type   TEXT,
      error_round  INTEGER,
      error_message TEXT,
      last_agent_output TEXT,
      resume_count INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id                TEXT PRIMARY KEY,
      user_id           TEXT NOT NULL DEFAULT 'local',
      idempotency_key   TEXT,
      agent_adapter     TEXT NOT NULL,
      agent_label       TEXT,
      prompt            TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'queued',
      permission_mode   TEXT NOT NULL DEFAULT 'safe',
      cwd               TEXT,
      context           TEXT,
      system_prompt     TEXT,
      output            TEXT,
      result            TEXT,
      error_message     TEXT,
      last_agent_output TEXT,
      git_commits       TEXT,
      metadata          TEXT,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      started_at        INTEGER,
      finished_at       INTEGER
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

    CREATE TABLE IF NOT EXISTS session_versions (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES sessions(id),
      timestamp   INTEGER NOT NULL,
      round       INTEGER NOT NULL,
      reason      TEXT NOT NULL,
      output      TEXT,
      artifacts   TEXT
    );

    CREATE TABLE IF NOT EXISTS pipelines (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL DEFAULT 'local',
      name        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'active',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pipeline_steps (
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
      session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      position    INTEGER NOT NULL,
      title       TEXT,
      node_type   TEXT,
      contract    TEXT,
      depends_on  TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      PRIMARY KEY (pipeline_id, session_id)
    );

    CREATE TABLE IF NOT EXISTS pipeline_templates (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL DEFAULT 'local',
      name        TEXT NOT NULL,
      description TEXT,
      steps       TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS external_jobs (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      provider      TEXT NOT NULL,
      external_id   TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'querying',
      download_dir  TEXT NOT NULL,
      result_paths  TEXT,
      error_message TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      UNIQUE(provider, external_id)
    );

    CREATE TABLE IF NOT EXISTS ops_incidents (
      id              TEXT PRIMARY KEY,
      user_id         TEXT,
      target_kind     TEXT NOT NULL DEFAULT 'task',
      target_id       TEXT NOT NULL,
      target_agent    TEXT NOT NULL,
      classification  TEXT NOT NULL,
      severity        TEXT NOT NULL DEFAULT 'critical',
      evidence        TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'detected',
      detected_at     INTEGER NOT NULL,
      remediated_at   INTEGER,
      acknowledged_at INTEGER,
      action          TEXT,
      action_outcome  TEXT,
      excluded_agent  TEXT,
      handoff_task_id TEXT,
      handoff_agent   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_session_logs_session ON session_logs(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_snapshots_session ON snapshots(session_id, round, timestamp);
    CREATE INDEX IF NOT EXISTS idx_session_versions_session ON session_versions(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_pipeline_steps_session ON pipeline_steps(session_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_steps_pipeline ON pipeline_steps(pipeline_id, position);
    CREATE INDEX IF NOT EXISTS idx_pipeline_templates_user ON pipeline_templates(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_external_jobs_status ON external_jobs(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_external_jobs_session ON external_jobs(session_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_ops_incidents_status ON ops_incidents(status, detected_at);
    CREATE INDEX IF NOT EXISTS idx_ops_incidents_target ON ops_incidents(target_id, classification);
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
    db.exec(`ALTER TABLE sessions ADD COLUMN scenario TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN participants TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN next_participant_index INTEGER NOT NULL DEFAULT 0`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN template_id TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN git_snapshot TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN artifacts TEXT`)
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
    db.exec(`ALTER TABLE sessions ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'safe'`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local'`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN idempotency_key TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN idempotency_key TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'safe'`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN workspace_state TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN git_commits TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN metadata TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_user_idempotency ON sessions(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`)
  } catch { /* index already exists */ }
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_user_idempotency ON tasks(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`)
  } catch { /* index already exists */ }
  try {
    db.exec(`ALTER TABLE pipelines ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local'`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE pipeline_steps ADD COLUMN title TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE pipeline_steps ADD COLUMN node_type TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE pipeline_steps ADD COLUMN contract TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN metadata TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE api_tokens ADD COLUMN token_last4 TEXT NOT NULL DEFAULT ''`)
  } catch { /* column already exists */ }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_pipelines_user ON pipelines(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_agents_user ON user_agents(user_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_templates_user ON pipeline_templates(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_session_versions_session ON session_versions(session_id, timestamp);
  `)
}

// ── Users / Tokens / Keys ────────────────────────────────────────────────────

function rowToUser(row: Record<string, unknown>): UserRecord {
  return {
    id: row.id as string,
    email: row.email as string,
    passwordHash: row.password_hash as string,
    salt: row.salt as string,
    createdAt: row.created_at as number,
  }
}

function rowToApiToken(row: Record<string, unknown>): ApiTokenRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    tokenHash: row.token_hash as string,
    tokenLast4: row.token_last4 as string,
    name: row.name as string,
    createdAt: row.created_at as number,
    lastUsedAt: row.last_used_at as number | undefined,
  }
}

function rowToStoredApiKey(row: Record<string, unknown>): StoredApiKeyRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    provider: row.provider as StoredApiKeyRecord['provider'],
    encryptedKey: row.encrypted_key as string,
    iv: row.iv as string,
    authTag: row.auth_tag as string,
    name: row.name as string,
    createdAt: row.created_at as number,
  }
}

function rowToUserAgent(row: Record<string, unknown>): UserAgentRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    adapter: row.adapter as string,
    encryptedKey: row.api_key_encrypted as string | undefined,
    iv: row.iv as string | undefined,
    authTag: row.auth_tag as string | undefined,
    model: row.model as string | undefined,
    baseUrl: row.base_url as string | undefined,
    timeout: (row.timeout as number | undefined) ?? 120_000,
    createdAt: Number(row.created_at),
  }
}

export function createUser(params: { id: string; email: string; passwordHash: string; salt: string }): UserRecord {
  const now = Date.now()
  db.prepare(`
    INSERT INTO users (id, email, password_hash, salt, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(params.id, params.email, params.passwordHash, params.salt, now)
  return getUserById(params.id)!
}

export function getUserById(id: string): UserRecord | undefined {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToUser(row) : undefined
}

export function getUserByEmail(email: string): UserRecord | undefined {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as Record<string, unknown> | undefined
  return row ? rowToUser(row) : undefined
}

export function getPrimaryUser(): UserRecord | undefined {
  const row = db.prepare(`
    SELECT users.*
    FROM users
    LEFT JOIN sessions ON sessions.user_id = users.id
    GROUP BY users.id
    ORDER BY COUNT(sessions.id) DESC, users.created_at ASC
    LIMIT 1
  `).get() as Record<string, unknown> | undefined
  return row ? rowToUser(row) : undefined
}

export function createApiToken(params: { id: string; userId: string; tokenHash: string; tokenLast4: string; name: string }): ApiTokenRecord {
  const now = Date.now()
  db.prepare(`
    INSERT INTO api_tokens (id, user_id, token_hash, token_last4, name, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(params.id, params.userId, params.tokenHash, params.tokenLast4, params.name, now)
  return getApiToken(params.id, params.userId)!
}

export function getApiToken(id: string, userId: string): ApiTokenRecord | undefined {
  const row = db.prepare('SELECT * FROM api_tokens WHERE id = ? AND user_id = ?').get(id, userId) as Record<string, unknown> | undefined
  return row ? rowToApiToken(row) : undefined
}

export function getApiTokenByHash(tokenHash: string): ApiTokenRecord | undefined {
  const row = db.prepare('SELECT * FROM api_tokens WHERE token_hash = ?').get(tokenHash) as Record<string, unknown> | undefined
  return row ? rowToApiToken(row) : undefined
}

export function touchApiToken(id: string): void {
  db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(Date.now(), id)
}

export function listApiTokens(userId: string): ApiTokenRecord[] {
  const rows = db.prepare('SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC').all(userId) as Record<string, unknown>[]
  return rows.map(rowToApiToken)
}

export function deleteApiToken(id: string, userId: string): boolean {
  return db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(id, userId).changes > 0
}

export function createStoredApiKey(params: Omit<StoredApiKeyRecord, 'createdAt'>): StoredApiKeyRecord {
  const now = Date.now()
  db.prepare(`
    INSERT INTO api_keys (id, user_id, provider, encrypted_key, iv, auth_tag, name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(params.id, params.userId, params.provider, params.encryptedKey, params.iv, params.authTag, params.name, now)
  return getStoredApiKey(params.id, params.userId)!
}

export function getStoredApiKey(id: string, userId: string): StoredApiKeyRecord | undefined {
  const row = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?').get(id, userId) as Record<string, unknown> | undefined
  return row ? rowToStoredApiKey(row) : undefined
}

export function listStoredApiKeys(userId: string): StoredApiKeyRecord[] {
  const rows = db.prepare('SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId) as Record<string, unknown>[]
  return rows.map(rowToStoredApiKey)
}

export function deleteStoredApiKey(id: string, userId: string): boolean {
  return db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(id, userId).changes > 0
}

export function createUserAgent(params: {
  id: string
  userId: string
  name: string
  adapter: string
  encryptedKey?: string
  iv?: string
  authTag?: string
  model?: string
  baseUrl?: string
  timeout?: number
}): UserAgentRecord {
  const now = Date.now()
  db.prepare(`
    INSERT INTO user_agents (id, user_id, name, adapter, api_key_encrypted, iv, auth_tag, model, base_url, timeout, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.id,
    params.userId,
    params.name,
    params.adapter,
    params.encryptedKey ?? null,
    params.iv ?? null,
    params.authTag ?? null,
    params.model ?? null,
    params.baseUrl ?? null,
    params.timeout ?? 120_000,
    String(now)
  )
  return getUserAgent(params.userId, params.name)!
}

export function updateUserAgent(userId: string, name: string, updates: {
  name?: string
  adapter?: string
  encryptedKey?: string | null
  iv?: string | null
  authTag?: string | null
  model?: string
  baseUrl?: string
  timeout?: number
}): UserAgentRecord | undefined {
  const fields: string[] = []
  const values: unknown[] = []
  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
  if (updates.adapter !== undefined) { fields.push('adapter = ?'); values.push(updates.adapter) }
  if (updates.encryptedKey !== undefined) { fields.push('api_key_encrypted = ?'); values.push(updates.encryptedKey) }
  if (updates.iv !== undefined) { fields.push('iv = ?'); values.push(updates.iv) }
  if (updates.authTag !== undefined) { fields.push('auth_tag = ?'); values.push(updates.authTag) }
  if (updates.model !== undefined) { fields.push('model = ?'); values.push(updates.model) }
  if (updates.baseUrl !== undefined) { fields.push('base_url = ?'); values.push(updates.baseUrl || null) }
  if (updates.timeout !== undefined) { fields.push('timeout = ?'); values.push(updates.timeout) }
  if (!fields.length) return getUserAgent(userId, name)
  values.push(userId, name)
  db.prepare(`UPDATE user_agents SET ${fields.join(', ')} WHERE user_id = ? AND name = ?`).run(...values)
  return getUserAgent(userId, updates.name ?? name)
}

export function getUserAgent(userId: string, name: string): UserAgentRecord | undefined {
  const row = db.prepare('SELECT * FROM user_agents WHERE user_id = ? AND name = ?').get(userId, name) as Record<string, unknown> | undefined
  return row ? rowToUserAgent(row) : undefined
}

export function listUserAgents(userId: string): UserAgentRecord[] {
  const rows = db.prepare('SELECT * FROM user_agents WHERE user_id = ? ORDER BY created_at DESC').all(userId) as Record<string, unknown>[]
  return rows.map(rowToUserAgent)
}

export function listAllUserAgents(): UserAgentRecord[] {
  const rows = db.prepare('SELECT * FROM user_agents ORDER BY created_at DESC').all() as Record<string, unknown>[]
  return rows.map(rowToUserAgent)
}

export function deleteUserAgent(userId: string, name: string): boolean {
  return db.prepare('DELETE FROM user_agents WHERE user_id = ? AND name = ?').run(userId, name).changes > 0
}

export function userAgentRecordToConfig(record: UserAgentRecord, apiKey?: string): AgentConfig {
  return {
    adapter: record.adapter,
    model: record.model,
    baseUrl: record.baseUrl,
    timeout: record.timeout,
    ...(apiKey ? { apiKey } : {}),
  }
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

function rowToTask(row: Record<string, unknown>): Task {
  let context: SessionContext | undefined
  if (row.context) {
    try { context = JSON.parse(row.context as string) } catch { /* ignore */ }
  }
  let workspaceState: WorkspaceDirtyState | undefined
  if (row.workspace_state) {
    try { workspaceState = JSON.parse(row.workspace_state as string) } catch { /* ignore */ }
  }
  let metadata: Task['metadata'] | undefined
  if (row.metadata) {
    try { metadata = JSON.parse(row.metadata as string) } catch { /* ignore */ }
  }
  let gitCommits: Task['gitCommits'] | undefined
  if (row.git_commits) {
    try { gitCommits = JSON.parse(row.git_commits as string) } catch { /* ignore */ }
  }
  return {
    id: row.id as string,
    userId: (row.user_id as string | null) ?? undefined,
    idempotencyKey: (row.idempotency_key as string | null) ?? undefined,
    agent: {
      adapter: row.agent_adapter as string,
      label: (row.agent_label as string | null) ?? undefined,
    },
    prompt: row.prompt as string,
    status: row.status as TaskStatus,
    permissionMode: (row.permission_mode as Task['permissionMode'] | undefined) ?? 'safe',
    cwd: (row.cwd as string | null) ?? undefined,
    context,
    systemPrompt: (row.system_prompt as string | null) ?? undefined,
    output: (row.output as string | null) ?? undefined,
    result: (row.result as string | null) ?? undefined,
    errorMessage: (row.error_message as string | null) ?? undefined,
    lastAgentOutput: (row.last_agent_output as string | null) ?? undefined,
    ...(workspaceState ? { workspaceState } : {}),
    ...(gitCommits && gitCommits.length > 0 ? { gitCommits } : {}),
    ...(metadata ? { metadata } : {}),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    startedAt: (row.started_at as number | null) ?? undefined,
    finishedAt: (row.finished_at as number | null) ?? undefined,
  }
}

export function createTask(params: {
  id: string
  userId?: string
  idempotencyKey?: string
  agent: AgentRef
  prompt: string
  permissionMode?: Task['permissionMode']
  cwd?: string
  context?: SessionContext
  systemPrompt?: string
  metadata?: Task['metadata']
}): Task {
  const now = Date.now()
  db.prepare(`
    INSERT INTO tasks (
      id, user_id, idempotency_key, agent_adapter, agent_label, prompt, status, permission_mode, cwd, context, system_prompt, metadata, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.id,
    params.userId ?? DEFAULT_USER_ID,
    params.idempotencyKey ?? null,
    params.agent.adapter,
    params.agent.label ?? null,
    params.prompt,
    params.permissionMode ?? 'safe',
    params.cwd ?? null,
    params.context ? JSON.stringify(clampSessionContext(params.context) ?? params.context) : null,
    params.systemPrompt ?? null,
    params.metadata ? JSON.stringify(params.metadata) : null,
    now,
    now
  )
  return getTask(params.id, params.userId)!
}

export function getTask(id: string, userId?: string): Task | undefined {
  const row = userId
    ? db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, userId) as Record<string, unknown> | undefined
    : db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToTask(row) : undefined
}

export function getTaskByIdempotencyKey(userId: string, idempotencyKey: string): Task | undefined {
  const row = db.prepare('SELECT * FROM tasks WHERE user_id = ? AND idempotency_key = ?').get(userId, idempotencyKey) as Record<string, unknown> | undefined
  return row ? rowToTask(row) : undefined
}

export function listTasks(filter?: { status?: TaskStatus; userId?: string; limit?: number; offset?: number }): Task[] {
  const limit = filter?.limit
  const offset = filter?.offset
  const useLimit = limit != null && Number.isInteger(limit) && limit > 0
  const useOffset = offset != null && Number.isInteger(offset) && offset >= 0
  const conditions: string[] = []
  const params: (string | number)[] = []
  if (filter?.status) {
    conditions.push('status = ?')
    params.push(filter.status)
  }
  if (filter?.userId) {
    conditions.push('user_id = ?')
    params.push(filter.userId)
  }
  let sql = 'SELECT * FROM tasks'
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ')
  sql += ' ORDER BY created_at DESC'
  if (useLimit) {
    sql += ' LIMIT ?'
    params.push(limit as number)
  }
  if (useOffset) {
    sql += ' OFFSET ?'
    params.push(offset as number)
  }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
  return rows.map(rowToTask)
}

export function updateTask(id: string, updates: Omit<Partial<Pick<Task,
  'status' |
  'output' |
  'result' |
  'errorMessage' |
  'lastAgentOutput' |
  'gitCommits' |
  'startedAt' |
  'finishedAt'
>>, 'workspaceState'> & { workspaceState?: WorkspaceDirtyState | null }, userId?: string): Task {
  const fields: string[] = ['updated_at = ?']
  const values: unknown[] = [Date.now()]

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
  if (updates.output !== undefined) { fields.push('output = ?'); values.push(updates.output) }
  if (updates.result !== undefined) { fields.push('result = ?'); values.push(updates.result) }
  if (updates.errorMessage !== undefined) { fields.push('error_message = ?'); values.push(updates.errorMessage) }
  if (updates.lastAgentOutput !== undefined) { fields.push('last_agent_output = ?'); values.push(updates.lastAgentOutput) }
  if (updates.gitCommits !== undefined) { fields.push('git_commits = ?'); values.push(JSON.stringify(updates.gitCommits)) }
  if (updates.workspaceState !== undefined) {
    if (updates.workspaceState === null) {
      fields.push('workspace_state = NULL')
    } else {
      fields.push('workspace_state = ?')
      values.push(JSON.stringify(updates.workspaceState))
    }
  }
  if (updates.startedAt !== undefined) { fields.push('started_at = ?'); values.push(updates.startedAt) }
  if (updates.finishedAt !== undefined) { fields.push('finished_at = ?'); values.push(updates.finishedAt) }

  values.push(id)
  if (userId) {
    values.push(userId)
    db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values)
  } else {
    db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }
  return getTask(id, userId)!
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
  let artifacts: SessionArtifacts | undefined
  if (row.artifacts) {
    try { artifacts = JSON.parse(row.artifacts as string) } catch { /* ignore */ }
  }
  let participants: SessionParticipant[] | undefined
  if (row.participants) {
    try { participants = JSON.parse(row.participants as string) } catch { /* ignore */ }
  }
  return {
    id: row.id as string,
    userId: row.user_id as string | undefined,
    idempotencyKey: row.idempotency_key as string | undefined,
    from: { adapter: row.from_adapter as string, label: row.from_label as string | undefined },
    to: { adapter: row.to_adapter as string, label: row.to_label as string | undefined },
    status: row.status as SessionStatus,
    mode: (row.mode as SessionMode) || 'freeform',
    nextTurn: (row.next_turn as 'from' | 'to') || 'to',
    maxRounds: row.max_rounds as number,
    currentRound: row.current_round as number,
    approveMode: Boolean(row.approve_mode),
    permissionMode: (row.permission_mode as Session['permissionMode'] | undefined) ?? 'safe',
    cwd: row.cwd as string | undefined,
    context,
    systemPrompts,
    scenario: row.scenario as SessionScenario | undefined,
    participants,
    nextParticipantIndex: (row.next_participant_index as number | undefined) ?? 0,
    templateId: row.template_id as string | undefined,
    gitSnapshot: row.git_snapshot as string | undefined,
    artifacts,
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
  userId?: string
  idempotencyKey?: string
  from: AgentRef
  to: AgentRef
  mode?: SessionMode
  context?: SessionContext
  systemPrompts?: { from: string; to: string }
  scenario?: SessionScenario
  participants?: SessionParticipant[]
  nextParticipantIndex?: number
  templateId?: string
  gitSnapshot?: string
  artifacts?: SessionArtifacts
  nextTurn?: 'from' | 'to'
  maxRounds?: number
  approveMode?: boolean
  permissionMode?: Session['permissionMode']
  cwd?: string
}): Session {
  const now = Date.now()
  const stmt = db.prepare(`
    INSERT INTO sessions (id, user_id, idempotency_key, from_adapter, from_label, to_adapter, to_label,
      status, mode, next_turn, max_rounds, current_round, approve_mode, permission_mode, cwd, context, system_prompts,
      scenario, participants, next_participant_index, template_id,
      git_snapshot, artifacts, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    params.id,
    params.userId ?? DEFAULT_USER_ID,
    params.idempotencyKey ?? null,
    params.from.adapter,
    params.from.label ?? null,
    params.to.adapter,
    params.to.label ?? null,
    params.mode ?? 'freeform',
    params.nextTurn ?? 'to',
    params.maxRounds ?? 20,
    params.approveMode ? 1 : 0,
    params.permissionMode ?? 'safe',
    params.cwd ?? null,
    params.context ? JSON.stringify(clampSessionContext(params.context) ?? params.context) : null,
    params.systemPrompts ? JSON.stringify(params.systemPrompts) : null,
    params.scenario ?? null,
    params.participants ? JSON.stringify(params.participants) : null,
    params.nextParticipantIndex ?? 0,
    params.templateId ?? null,
    params.gitSnapshot ?? null,
    params.artifacts ? JSON.stringify(params.artifacts) : null,
    now,
    now
  )
  return getSession(params.id, params.userId)!
}

export function getSession(id: string, userId?: string): Session | undefined {
  const row = userId
    ? db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(id, userId) as Record<string, unknown> | undefined
    : db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToSession(row) : undefined
}

export function getSessionByIdempotencyKey(userId: string, idempotencyKey: string): Session | undefined {
  const row = db.prepare('SELECT * FROM sessions WHERE user_id = ? AND idempotency_key = ?').get(userId, idempotencyKey) as Record<string, unknown> | undefined
  return row ? rowToSession(row) : undefined
}

export function updateSession(id: string, updates: Partial<Pick<Session, 'status' | 'from' | 'to' | 'currentRound' | 'maxRounds' | 'approveMode' | 'permissionMode' | 'nextTurn' | 'scenario' | 'participants' | 'nextParticipantIndex' | 'errorType' | 'errorRound' | 'errorMessage' | 'lastAgentOutput' | 'resumeCount' | 'context' | 'systemPrompts' | 'gitSnapshot' | 'artifacts'>>, userId?: string): Session {
  const fields: string[] = ['updated_at = ?']
  const values: unknown[] = [Date.now()]

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
  if (updates.from !== undefined) {
    fields.push('from_adapter = ?', 'from_label = ?')
    values.push(updates.from.adapter, updates.from.label ?? null)
  }
  if (updates.to !== undefined) {
    fields.push('to_adapter = ?', 'to_label = ?')
    values.push(updates.to.adapter, updates.to.label ?? null)
  }
  if (updates.nextTurn !== undefined) { fields.push('next_turn = ?'); values.push(updates.nextTurn) }
  if (updates.scenario !== undefined) { fields.push('scenario = ?'); values.push(updates.scenario) }
  if (updates.participants !== undefined) { fields.push('participants = ?'); values.push(JSON.stringify(updates.participants)) }
  if (updates.nextParticipantIndex !== undefined) { fields.push('next_participant_index = ?'); values.push(updates.nextParticipantIndex) }
  if (updates.currentRound !== undefined) { fields.push('current_round = ?'); values.push(updates.currentRound) }
  if (updates.maxRounds !== undefined) { fields.push('max_rounds = ?'); values.push(updates.maxRounds) }
  if (updates.approveMode !== undefined) { fields.push('approve_mode = ?'); values.push(updates.approveMode ? 1 : 0) }
  if (updates.permissionMode !== undefined) { fields.push('permission_mode = ?'); values.push(updates.permissionMode) }
  if (updates.errorType !== undefined) { fields.push('error_type = ?'); values.push(updates.errorType) }
  if (updates.errorRound !== undefined) { fields.push('error_round = ?'); values.push(updates.errorRound) }
  if (updates.errorMessage !== undefined) { fields.push('error_message = ?'); values.push(updates.errorMessage) }
  if (updates.lastAgentOutput !== undefined) { fields.push('last_agent_output = ?'); values.push(updates.lastAgentOutput) }
  if (updates.resumeCount !== undefined) { fields.push('resume_count = ?'); values.push(updates.resumeCount) }
  if (updates.context !== undefined) { fields.push('context = ?'); values.push(JSON.stringify(clampSessionContext(updates.context) ?? updates.context)) }
  if (updates.systemPrompts !== undefined) { fields.push('system_prompts = ?'); values.push(JSON.stringify(updates.systemPrompts)) }
  if (updates.gitSnapshot !== undefined) { fields.push('git_snapshot = ?'); values.push(updates.gitSnapshot) }
  if (updates.artifacts !== undefined) { fields.push('artifacts = ?'); values.push(JSON.stringify(updates.artifacts)) }

  values.push(id)
  if (userId) {
    values.push(userId)
    db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values)
  } else {
    db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }
  return getSession(id, userId)!
}

export function clearSessionError(id: string): Session {
  db.prepare(`
    UPDATE sessions
    SET error_type = NULL, error_round = NULL, error_message = NULL, last_agent_output = NULL, updated_at = ?
    WHERE id = ?
  `).run(Date.now(), id)
  return getSession(id)!
}

export function reopenSession(id: string, userId?: string): Session {
  const now = Date.now()
  if (userId) {
    db.prepare(`
      UPDATE sessions
      SET status = 'active',
          error_type = NULL,
          error_round = NULL,
          error_message = NULL,
          last_agent_output = NULL,
          updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(now, id, userId)
    return getSession(id, userId)!
  }
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

export function resetSessionForPipelineRerun(id: string): Session {
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE sessions
      SET status = 'paused',
          next_turn = 'to',
          current_round = 0,
          resume_count = 0,
          error_type = NULL,
          error_round = NULL,
          error_message = NULL,
          last_agent_output = NULL,
          git_snapshot = NULL,
          artifacts = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(Date.now(), id)
    db.prepare(`DELETE FROM messages WHERE session_id = ? AND NOT (from_agent = 'human' AND round = 0)`).run(id)
    db.prepare('DELETE FROM snapshots WHERE session_id = ?').run(id)
    db.prepare('DELETE FROM session_logs WHERE session_id = ?').run(id)
  })
  tx()
  return getSession(id)!
}

const SESSION_SLIM_COLUMNS = [
  'id', 'user_id', 'idempotency_key',
  'from_adapter', 'from_label', 'to_adapter', 'to_label',
  'status', 'mode', 'next_turn', 'max_rounds', 'current_round',
  'scenario', 'participants', 'next_participant_index',
  'approve_mode', 'permission_mode', 'cwd', 'template_id',
  'error_type', 'error_round', 'error_message', 'last_agent_output',
  'resume_count', 'created_at', 'updated_at',
].join(', ')

export function listSessions(filter?: { status?: SessionStatus; userId?: string; limit?: number }): Session[] {
  const limit = filter?.limit && Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : undefined
  const applyLimit = (rows: Record<string, unknown>[]) => limit ? rows.slice(0, limit) : rows
  const cols = SESSION_SLIM_COLUMNS
  if (filter?.status && filter.userId) {
    const rows = db.prepare(`SELECT ${cols} FROM sessions WHERE status = ? AND user_id = ? ORDER BY created_at DESC`).all(filter.status, filter.userId) as Record<string, unknown>[]
    return applyLimit(rows).map(rowToSession)
  }
  if (filter?.status) {
    const rows = db.prepare(`SELECT ${cols} FROM sessions WHERE status = ? ORDER BY created_at DESC`).all(filter.status) as Record<string, unknown>[]
    return applyLimit(rows).map(rowToSession)
  }
  if (filter?.userId) {
    const rows = db.prepare(`SELECT ${cols} FROM sessions WHERE user_id = ? ORDER BY created_at DESC`).all(filter.userId) as Record<string, unknown>[]
    return applyLimit(rows).map(rowToSession)
  }
  const rows = db.prepare(`SELECT ${cols} FROM sessions ORDER BY created_at DESC`).all() as Record<string, unknown>[]
  return applyLimit(rows).map(rowToSession)
}

export function deleteSession(id: string, userId?: string): void {
  const tx = db.transaction((sessionId: string) => {
    if (userId && !getSession(sessionId, userId)) return
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
    userId: row.user_id as string | undefined,
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
    ...(typeof row.title === 'string' && row.title ? { title: row.title } : {}),
    ...(typeof row.node_type === 'string' && row.node_type ? { nodeType: row.node_type as PipelineStep['nodeType'] } : {}),
    ...(typeof row.contract === 'string' && row.contract ? { contract: JSON.parse(row.contract) as PipelineStep['contract'] } : {}),
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
    INSERT INTO pipeline_steps (pipeline_id, session_id, position, title, node_type, contract, depends_on, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  steps.forEach((step, index) => {
    stmt.run(
      pipelineId,
      step.sessionId,
      index,
      step.title ?? null,
      step.nodeType ?? null,
      step.contract ? JSON.stringify(step.contract) : null,
      step.dependsOn && step.dependsOn.length > 0 ? JSON.stringify(step.dependsOn) : null,
      step.status
    )
  })
}

export function createPipeline(params: {
  id: string
  userId?: string
  name: string
  status?: Pipeline['status']
  sessions: PipelineStep[]
}): Pipeline {
  const now = Date.now()
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO pipelines (id, user_id, name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(params.id, params.userId ?? DEFAULT_USER_ID, params.name, params.status ?? 'active', now, now)
    insertPipelineSteps(params.id, params.sessions)
  })
  tx()
  return getPipeline(params.id, params.userId)!
}

export function getPipeline(id: string, userId?: string): Pipeline | undefined {
  const row = userId
    ? db.prepare('SELECT * FROM pipelines WHERE id = ? AND user_id = ?').get(id, userId) as Record<string, unknown> | undefined
    : db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToPipeline(row) : undefined
}

export function listPipelines(userId?: string, options?: { limit?: number; offset?: number }): Pipeline[] {
  const limit = options?.limit
  const offset = options?.offset
  const useLimit = limit != null && Number.isInteger(limit) && limit > 0
  const useOffset = offset != null && Number.isInteger(offset) && offset >= 0
  let sql = userId
    ? 'SELECT * FROM pipelines WHERE user_id = ? ORDER BY created_at DESC'
    : 'SELECT * FROM pipelines ORDER BY created_at DESC'
  const params: (string | number)[] = userId ? [userId] : []
  if (useLimit) {
    sql += ' LIMIT ?'
    params.push(limit as number)
  }
  if (useOffset) {
    sql += ' OFFSET ?'
    params.push(offset as number)
  }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
  return rows.map(rowToPipeline)
}

function rowToPipelineTemplate(row: Record<string, unknown>): PipelineTemplateRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    description: row.description as string | undefined,
    steps: JSON.parse(row.steps as string) as PipelineTemplateRecord['steps'],
    source: 'user',
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export function createPipelineTemplate(params: {
  id: string
  userId?: string
  name: string
  description?: string
  steps: PipelineTemplateRecord['steps']
}): PipelineTemplateRecord {
  const now = Date.now()
  db.prepare(`
    INSERT INTO pipeline_templates (id, user_id, name, description, steps, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.id,
    params.userId ?? DEFAULT_USER_ID,
    params.name,
    params.description ?? null,
    JSON.stringify(params.steps),
    now,
    now
  )
  return getPipelineTemplate(params.id, params.userId)!
}

export function getPipelineTemplate(id: string, userId?: string): PipelineTemplateRecord | undefined {
  const row = userId
    ? db.prepare('SELECT * FROM pipeline_templates WHERE id = ? AND user_id = ?').get(id, userId) as Record<string, unknown> | undefined
    : db.prepare('SELECT * FROM pipeline_templates WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToPipelineTemplate(row) : undefined
}

export function listPipelineTemplates(userId?: string): PipelineTemplateRecord[] {
  const rows = userId
    ? db.prepare('SELECT * FROM pipeline_templates WHERE user_id = ? ORDER BY created_at DESC').all(userId) as Record<string, unknown>[]
    : db.prepare('SELECT * FROM pipeline_templates ORDER BY created_at DESC').all() as Record<string, unknown>[]
  return rows.map(rowToPipelineTemplate)
}

export function deletePipelineTemplate(id: string, userId?: string): boolean {
  return userId
    ? db.prepare('DELETE FROM pipeline_templates WHERE id = ? AND user_id = ?').run(id, userId).changes > 0
    : db.prepare('DELETE FROM pipeline_templates WHERE id = ?').run(id).changes > 0
}

export function updatePipeline(id: string, updates: Partial<Pick<Pipeline, 'name' | 'status' | 'sessions'>>, userId?: string): Pipeline {
  const tx = db.transaction(() => {
    const fields: string[] = ['updated_at = ?']
    const values: unknown[] = [Date.now()]

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }

    values.push(id)
    if (userId) {
      values.push(userId)
      db.prepare(`UPDATE pipelines SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values)
    } else {
      db.prepare(`UPDATE pipelines SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    }

    if (updates.sessions !== undefined) {
      db.prepare('DELETE FROM pipeline_steps WHERE pipeline_id = ?').run(id)
      insertPipelineSteps(id, updates.sessions)
    }
  })
  tx()
  return getPipeline(id, userId)!
}

export function deletePipeline(id: string, userId?: string): void {
  if (userId) {
    db.prepare('DELETE FROM pipelines WHERE id = ? AND user_id = ?').run(id, userId)
  } else {
    db.prepare('DELETE FROM pipelines WHERE id = ?').run(id)
  }
}

export function getPipelineWithSessions(id: string, userId?: string): PipelineWithSessions | undefined {
  const pipeline = getPipeline(id, userId)
  if (!pipeline) return undefined
  const sessionDetails = pipeline.sessions
    .map((step) => getSession(step.sessionId, userId))
    .filter((session): session is Session => Boolean(session))
    .map((session) => ({ ...session, messages: getMessages(session.id), versions: getSessionVersions(session.id) }))
  return { ...pipeline, sessionDetails }
}

export function getPipelineBySession(sessionId: string, userId?: string): Pipeline | undefined {
  const row = userId
    ? db.prepare(`
    SELECT p.*
    FROM pipelines p
    JOIN pipeline_steps ps ON ps.pipeline_id = p.id
    WHERE ps.session_id = ? AND p.user_id = ?
    LIMIT 1
  `).get(sessionId, userId) as Record<string, unknown> | undefined
    : db.prepare(`
    SELECT p.*
    FROM pipelines p
    JOIN pipeline_steps ps ON ps.pipeline_id = p.id
    WHERE ps.session_id = ?
    LIMIT 1
  `).get(sessionId) as Record<string, unknown> | undefined
  return row ? rowToPipeline(row) : undefined
}

// Maximum number of IDs per IN-clause to avoid SQLite variable limits and
// oversized query plans.
const IN_CHUNK_SIZE = 500

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

export function getPipelineStepTitles(sessionIds: string[]): Map<string, string> {
  const result = new Map<string, string>()
  if (sessionIds.length === 0) return result
  for (const chunk of chunkArray(sessionIds, IN_CHUNK_SIZE)) {
    const placeholders = chunk.map(() => '?').join(',')
    const rows = db.prepare(
      `SELECT session_id, title FROM pipeline_steps WHERE session_id IN (${placeholders}) AND title IS NOT NULL AND title != ''`
    ).all(...chunk) as Record<string, unknown>[]
    for (const row of rows) {
      result.set(row.session_id as string, row.title as string)
    }
  }
  return result
}

export function getFirstHumanMessages(sessionIds: string[]): Map<string, string> {
  const result = new Map<string, string>()
  if (sessionIds.length === 0) return result
  for (const chunk of chunkArray(sessionIds, IN_CHUNK_SIZE)) {
    const placeholders = chunk.map(() => '?').join(',')
    const rows = db.prepare(
      `SELECT session_id, content FROM messages WHERE from_agent = 'human' AND round = 0 AND session_id IN (${placeholders}) ORDER BY session_id, timestamp ASC`
    ).all(...chunk) as Record<string, unknown>[]
    for (const row of rows) {
      const sid = row.session_id as string
      if (!result.has(sid)) result.set(sid, row.content as string)
    }
  }
  return result
}

export function getTotalTokenEstimate(sessionIds: string[]): number {
  if (sessionIds.length === 0) return 0
  let total = 0
  for (const chunk of chunkArray(sessionIds, IN_CHUNK_SIZE)) {
    const placeholders = chunk.map(() => '?').join(',')
    const row = db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN json_valid(metadata) THEN COALESCE(json_extract(metadata, '$.tokenEstimate'), 0) ELSE 0 END), 0) AS subtotal FROM messages WHERE session_id IN (${placeholders})`
    ).get(...chunk) as Record<string, unknown>
    total += Number(row.subtotal) || 0
  }
  return total
}

export function countPipelinesByStatus(userId?: string): { total: number; active: number; paused: number; done: number; error: number } {
  if (userId) {
    const rows = db.prepare(
      `SELECT status, COUNT(*) AS cnt FROM pipelines WHERE user_id = ? GROUP BY status`
    ).all(userId) as Record<string, unknown>[]
    return tallyPipelineStatuses(rows)
  }
  const rows = db.prepare(
    `SELECT status, COUNT(*) AS cnt FROM pipelines GROUP BY status`
  ).all() as Record<string, unknown>[]
  return tallyPipelineStatuses(rows)
}

function tallyPipelineStatuses(rows: Record<string, unknown>[]): { total: number; active: number; paused: number; done: number; error: number } {
  const result = { total: 0, active: 0, paused: 0, done: 0, error: 0 }
  for (const row of rows) {
    const status = row.status as Pipeline['status']
    const count = Number(row.cnt) || 0
    result.total += count
    if (status in result) result[status] += count
  }
  return result
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

function rowToSessionVersion(row: Record<string, unknown>): SessionVersion {
  let artifacts: SessionArtifacts | undefined
  if (row.artifacts) {
    try { artifacts = JSON.parse(row.artifacts as string) } catch { /* ignore */ }
  }
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    timestamp: row.timestamp as number,
    round: row.round as number,
    reason: row.reason as string,
    ...(typeof row.output === 'string' && row.output ? { output: row.output } : {}),
    ...(artifacts ? { artifacts } : {}),
  }
}

export function addSessionVersion(version: SessionVersion): SessionVersion {
  db.prepare(`
    INSERT INTO session_versions (id, session_id, timestamp, round, reason, output, artifacts)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    version.id,
    version.sessionId,
    version.timestamp,
    version.round,
    version.reason,
    version.output ?? null,
    version.artifacts ? JSON.stringify(version.artifacts) : null
  )
  return version
}

export function getSessionVersions(sessionId: string): SessionVersion[] {
  const rows = db.prepare(
    'SELECT * FROM session_versions WHERE session_id = ? ORDER BY timestamp DESC'
  ).all(sessionId) as Record<string, unknown>[]
  return rows.map(rowToSessionVersion)
}

export function upsertExternalJob(job: ExternalJob): ExternalJob {
  db.prepare(`
    INSERT INTO external_jobs (
      id, session_id, provider, external_id, status, download_dir, result_paths, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, external_id) DO UPDATE SET
      session_id = excluded.session_id,
      status = excluded.status,
      download_dir = excluded.download_dir,
      result_paths = excluded.result_paths,
      error_message = excluded.error_message,
      updated_at = excluded.updated_at
  `).run(
    job.id,
    job.sessionId,
    job.provider,
    job.externalId,
    job.status,
    job.downloadDir,
    job.resultPaths ? JSON.stringify(job.resultPaths) : null,
    job.errorMessage ?? null,
    job.createdAt,
    job.updatedAt
  )
  return getExternalJob(job.provider, job.externalId)!
}

export function getExternalJob(provider: ExternalJob['provider'], externalId: string): ExternalJob | undefined {
  const row = db.prepare(
    'SELECT * FROM external_jobs WHERE provider = ? AND external_id = ?'
  ).get(provider, externalId) as Record<string, unknown> | undefined
  return row ? rowToExternalJob(row) : undefined
}

export function listExternalJobs(status?: ExternalJob['status']): ExternalJob[] {
  const rows = status
    ? db.prepare('SELECT * FROM external_jobs WHERE status = ? ORDER BY updated_at ASC').all(status)
    : db.prepare('SELECT * FROM external_jobs ORDER BY updated_at ASC').all()
  return (rows as Record<string, unknown>[]).map(rowToExternalJob)
}

export function updateExternalJob(
  provider: ExternalJob['provider'],
  externalId: string,
  updates: Partial<Pick<ExternalJob, 'status' | 'resultPaths' | 'errorMessage'>>
): ExternalJob {
  const fields: string[] = []
  const values: unknown[] = []
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
  if (updates.resultPaths !== undefined) { fields.push('result_paths = ?'); values.push(JSON.stringify(updates.resultPaths)) }
  if (updates.errorMessage !== undefined) { fields.push('error_message = ?'); values.push(updates.errorMessage) }
  fields.push('updated_at = ?')
  values.push(Date.now(), provider, externalId)
  db.prepare(`UPDATE external_jobs SET ${fields.join(', ')} WHERE provider = ? AND external_id = ?`).run(...values)
  return getExternalJob(provider, externalId)!
}

export function stopExternalJobsForSession(sessionId: string): void {
  db.prepare(`
    UPDATE external_jobs
    SET status = 'stopped', updated_at = ?
    WHERE session_id = ? AND status = 'querying'
  `).run(Date.now(), sessionId)
}

export function clearExternalJobsForSession(sessionId: string): void {
  db.prepare('DELETE FROM external_jobs WHERE session_id = ?').run(sessionId)
}

function rowToExternalJob(row: Record<string, unknown>): ExternalJob {
  let resultPaths: string[] | undefined
  if (typeof row.result_paths === 'string') {
    try { resultPaths = JSON.parse(row.result_paths) as string[] } catch { /* ignore */ }
  }
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    provider: row.provider as ExternalJob['provider'],
    externalId: row.external_id as string,
    status: row.status as ExternalJob['status'],
    downloadDir: row.download_dir as string,
    ...(resultPaths ? { resultPaths } : {}),
    ...(typeof row.error_message === 'string' ? { errorMessage: row.error_message } : {}),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export function getStats(userId?: string): PassitonStats {
  const sessions = listSessions(userId ? { userId } : undefined)
  const pipelineCounts = countPipelinesByStatus(userId)
  const counts = {
    active: 0,
    paused: 0,
    done: 0,
    error: 0,
    stopped: 0,
  }
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayStartMs = todayStart.getTime()
  let completedToday = 0
  let totalRounds = 0
  let totalDuration = 0
  const agentUsage = new Map<string, AgentUsageStats>()

  for (const session of sessions) {
    counts[session.status] += 1
    if (session.status === 'done' && session.updatedAt >= todayStartMs) completedToday += 1
    totalRounds += session.currentRound
    totalDuration += Math.max(0, session.updatedAt - session.createdAt)

    for (const agentName of [session.from.adapter, session.to.adapter]) {
      const current = agentUsage.get(agentName) ?? {
        name: agentName,
        sessions: 0,
        active: 0,
        done: 0,
        error: 0,
        avgRounds: 0,
      }
      current.sessions += 1
      if (session.status === 'active') current.active += 1
      if (session.status === 'done') current.done += 1
      if (session.status === 'error') current.error += 1
      current.avgRounds += session.currentRound
      agentUsage.set(agentName, current)
    }
  }

  const tokenEstimate = getTotalTokenEstimate(sessions.map((s) => s.id))

  const agentRows = Array.from(agentUsage.values())
    .map((entry) => ({
      ...entry,
      avgRounds: entry.sessions > 0 ? entry.avgRounds / entry.sessions : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name))

  return {
    sessions: {
      total: sessions.length,
      active: counts.active,
      paused: counts.paused,
      done: counts.done,
      completedToday,
      error: counts.error,
      stopped: counts.stopped,
      successRate: sessions.length > 0 ? counts.done / sessions.length : 0,
      avgRounds: sessions.length > 0 ? totalRounds / sessions.length : 0,
      avgDurationMs: sessions.length > 0 ? totalDuration / sessions.length : 0,
      tokenEstimate,
    },
    pipelines: {
      total: pipelineCounts.total,
      active: pipelineCounts.active,
      paused: pipelineCounts.paused,
      done: pipelineCounts.done,
      error: pipelineCounts.error,
    },
    agents: agentRows,
  }
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

// ── Ops Incidents ────────────────────────────────────────────────────────────

function rowToOpsIncident(row: Record<string, unknown>): OpsIncident {
  return {
    id: row.id as string,
    userId: (row.user_id as string | null) ?? undefined,
    targetKind: (row.target_kind as 'task') ?? 'task',
    targetId: row.target_id as string,
    targetAgent: row.target_agent as string,
    classification: row.classification as OpsIncidentClassification,
    severity: (row.severity as 'critical' | 'warning') ?? 'critical',
    evidence: row.evidence as string,
    status: row.status as OpsIncidentStatus,
    detectedAt: row.detected_at as number,
    remediatedAt: (row.remediated_at as number | null) ?? undefined,
    acknowledgedAt: (row.acknowledged_at as number | null) ?? undefined,
    action: (row.action as string | null) ?? undefined,
    actionOutcome: (row.action_outcome as string | null) ?? undefined,
    excludedAgent: (row.excluded_agent as string | null) ?? undefined,
    handoffTaskId: (row.handoff_task_id as string | null) ?? undefined,
    handoffAgent: (row.handoff_agent as string | null) ?? undefined,
  }
}

export function createOpsIncident(params: {
  id: string
  userId?: string
  targetKind?: 'task'
  targetId: string
  targetAgent: string
  classification: OpsIncidentClassification
  severity?: 'critical' | 'warning'
  evidence: string
  status?: OpsIncidentStatus
  detectedAt?: number
}): OpsIncident {
  const now = params.detectedAt ?? Date.now()
  db.prepare(`
    INSERT INTO ops_incidents (id, user_id, target_kind, target_id, target_agent, classification, severity, evidence, status, detected_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.id,
    params.userId ?? null,
    params.targetKind ?? 'task',
    params.targetId,
    params.targetAgent,
    params.classification,
    params.severity ?? 'critical',
    params.evidence,
    params.status ?? 'detected',
    now
  )
  return getOpsIncident(params.id)!
}

export function getOpsIncident(id: string): OpsIncident | undefined {
  const row = db.prepare('SELECT * FROM ops_incidents WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToOpsIncident(row) : undefined
}

export function listOpsIncidents(filter?: { status?: OpsIncidentStatus; userId?: string; targetId?: string; limit?: number }): OpsIncident[] {
  const conditions: string[] = []
  const params: (string | number)[] = []
  if (filter?.status) { conditions.push('status = ?'); params.push(filter.status) }
  if (filter?.userId) { conditions.push('user_id = ?'); params.push(filter.userId) }
  if (filter?.targetId) { conditions.push('target_id = ?'); params.push(filter.targetId) }
  let sql = 'SELECT * FROM ops_incidents'
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ')
  sql += ' ORDER BY detected_at DESC'
  if (filter?.limit && Number.isInteger(filter.limit) && filter.limit > 0) {
    sql += ' LIMIT ?'
    params.push(filter.limit)
  }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
  return rows.map(rowToOpsIncident)
}

export function findOpsIncident(targetId: string, classification: OpsIncidentClassification): OpsIncident | undefined {
  const row = db.prepare(
    'SELECT * FROM ops_incidents WHERE target_id = ? AND classification = ? AND status = ? ORDER BY detected_at DESC LIMIT 1'
  ).get(targetId, classification, 'detected') as Record<string, unknown> | undefined
  return row ? rowToOpsIncident(row) : undefined
}

export function updateOpsIncident(id: string, updates: Partial<Pick<OpsIncident,
  'status' | 'remediatedAt' | 'acknowledgedAt' | 'action' | 'actionOutcome' | 'excludedAgent' | 'handoffTaskId' | 'handoffAgent'
>>): OpsIncident | undefined {
  const fields: string[] = []
  const values: unknown[] = []
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
  if (updates.remediatedAt !== undefined) { fields.push('remediated_at = ?'); values.push(updates.remediatedAt) }
  if (updates.acknowledgedAt !== undefined) { fields.push('acknowledged_at = ?'); values.push(updates.acknowledgedAt) }
  if (updates.action !== undefined) { fields.push('action = ?'); values.push(updates.action) }
  if (updates.actionOutcome !== undefined) { fields.push('action_outcome = ?'); values.push(updates.actionOutcome) }
  if (updates.excludedAgent !== undefined) { fields.push('excluded_agent = ?'); values.push(updates.excludedAgent) }
  if (updates.handoffTaskId !== undefined) { fields.push('handoff_task_id = ?'); values.push(updates.handoffTaskId) }
  if (updates.handoffAgent !== undefined) { fields.push('handoff_agent = ?'); values.push(updates.handoffAgent) }
  if (fields.length === 0) return getOpsIncident(id)
  values.push(id)
  db.prepare(`UPDATE ops_incidents SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getOpsIncident(id)
}

export function pruneOpsIncidents(maxKeep: number): number {
  if (maxKeep <= 0) return 0
  const count = (db.prepare('SELECT COUNT(*) as n FROM ops_incidents').get() as { n: number }).n
  if (count <= maxKeep) return 0
  const toDelete = count - maxKeep
  db.prepare(`
    DELETE FROM ops_incidents WHERE id IN (
      SELECT id FROM ops_incidents ORDER BY detected_at ASC LIMIT ?
    )
  `).run(toDelete)
  return toDelete
}
