// State module — SQLite persistence via better-sqlite3
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { mkdirSync } from 'fs';
import { join } from 'path';
const DB_DIR = join(homedir(), '.turing');
const DB_PATH = join(DB_DIR, 'turing.db');
let db;
export function initDb(dbPath = DB_PATH) {
    mkdirSync(join(homedir(), '.turing'), { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    createTables();
}
function createTables() {
    db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      from_adapter TEXT NOT NULL,
      from_label   TEXT,
      to_adapter   TEXT NOT NULL,
      to_label     TEXT,
      status       TEXT NOT NULL DEFAULT 'active',
      mode         TEXT NOT NULL DEFAULT 'freeform',
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

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  `);
    // Migrate: add new columns if they don't exist (for existing DBs)
    try {
        db.exec(`ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'freeform'`);
    }
    catch { /* column already exists */ }
    try {
        db.exec(`ALTER TABLE sessions ADD COLUMN context TEXT`);
    }
    catch { /* column already exists */ }
    try {
        db.exec(`ALTER TABLE sessions ADD COLUMN system_prompts TEXT`);
    }
    catch { /* column already exists */ }
}
// ── Sessions ──────────────────────────────────────────────────────────────────
function rowToSession(row) {
    let systemPrompts;
    if (row.system_prompts) {
        try {
            systemPrompts = JSON.parse(row.system_prompts);
        }
        catch { /* ignore */ }
    }
    return {
        id: row.id,
        from: { adapter: row.from_adapter, label: row.from_label },
        to: { adapter: row.to_adapter, label: row.to_label },
        status: row.status,
        mode: row.mode || 'freeform',
        maxRounds: row.max_rounds,
        currentRound: row.current_round,
        approveMode: Boolean(row.approve_mode),
        cwd: row.cwd,
        context: row.context,
        systemPrompts,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
export function createSession(params) {
    const now = Date.now();
    const stmt = db.prepare(`
    INSERT INTO sessions (id, from_adapter, from_label, to_adapter, to_label,
      status, mode, max_rounds, current_round, approve_mode, cwd, context, system_prompts,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 0, ?, ?, ?, ?, ?, ?)
  `);
    stmt.run(params.id, params.from.adapter, params.from.label ?? null, params.to.adapter, params.to.label ?? null, params.mode ?? 'freeform', params.maxRounds ?? 20, params.approveMode ? 1 : 0, params.cwd ?? null, params.context ?? null, params.systemPrompts ? JSON.stringify(params.systemPrompts) : null, now, now);
    return getSession(params.id);
}
export function getSession(id) {
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    return row ? rowToSession(row) : undefined;
}
export function updateSession(id, updates) {
    const fields = ['updated_at = ?'];
    const values = [Date.now()];
    if (updates.status !== undefined) {
        fields.push('status = ?');
        values.push(updates.status);
    }
    if (updates.currentRound !== undefined) {
        fields.push('current_round = ?');
        values.push(updates.currentRound);
    }
    if (updates.maxRounds !== undefined) {
        fields.push('max_rounds = ?');
        values.push(updates.maxRounds);
    }
    if (updates.approveMode !== undefined) {
        fields.push('approve_mode = ?');
        values.push(updates.approveMode ? 1 : 0);
    }
    values.push(id);
    db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return getSession(id);
}
export function listSessions(filter) {
    if (filter?.status) {
        const rows = db.prepare('SELECT * FROM sessions WHERE status = ? ORDER BY created_at DESC').all(filter.status);
        return rows.map(rowToSession);
    }
    const rows = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all();
    return rows.map(rowToSession);
}
// ── Messages ──────────────────────────────────────────────────────────────────
function rowToMessage(row) {
    return {
        id: row.id,
        sessionId: row.session_id,
        from: row.from_agent,
        content: row.content,
        timestamp: row.timestamp,
        round: row.round,
    };
}
export function addMessage(msg) {
    db.prepare(`
    INSERT INTO messages (id, session_id, from_agent, content, timestamp, round)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(msg.id, msg.sessionId, msg.from, msg.content, msg.timestamp, msg.round);
    return msg;
}
export function getMessages(sessionId) {
    const rows = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId);
    return rows.map(rowToMessage);
}
//# sourceMappingURL=state.js.map