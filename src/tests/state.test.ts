import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import * as state from '../state.js'
import {
  clampSessionContext,
  CONTEXT_FILE_MAX_BYTES,
  CONTEXT_TOTAL_MAX_BYTES,
} from '../prompts.js'

test('message GC removes expired rows by retention window', () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-state-'))
  const now = 1_000_000

  try {
    state.initDb(join(dir, 'turing.db'), { messageRetentionMs: 1_000 })
    state.createSession({
      id: 'gc-session',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
    })

    state.addMessage({
      id: 'old',
      sessionId: 'gc-session',
      from: 'human',
      content: 'old',
      timestamp: now - 2_000,
      round: 0,
    })
    state.addMessage({
      id: 'fresh',
      sessionId: 'gc-session',
      from: 'human',
      content: 'fresh',
      timestamp: now,
      round: 0,
    })
    state.addLog({
      id: 'old-log',
      sessionId: 'gc-session',
      timestamp: now - 2_000,
      level: 'info',
      message: 'old log',
    })
    state.addLog({
      id: 'fresh-log',
      sessionId: 'gc-session',
      timestamp: now,
      level: 'info',
      message: 'fresh log',
    })

    const deleted = state.pruneExpiredMessages(now)
    const messages = state.getMessages('gc-session')
    const logs = state.getLogs('gc-session')

    assert.equal(deleted, 2)
    assert.deepEqual(messages.map((message) => message.id), ['fresh'])
    assert.deepEqual(logs.map((log) => log.id), ['fresh-log'])
  } finally {
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('session logs are deleted with their session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-state-'))

  try {
    state.initDb(join(dir, 'turing.db'))
    state.createSession({
      id: 'logs-session',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
    })

    state.addLog({
      id: 'log-1',
      sessionId: 'logs-session',
      timestamp: 1,
      level: 'warn',
      message: 'persist me',
    })

    assert.equal(state.getLogs('logs-session').length, 1)

    state.deleteSession('logs-session')

    assert.deepEqual(state.getLogs('logs-session'), [])
  } finally {
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('task CRUD persists prompt, context, and result', () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-state-'))

  try {
    state.initDb(join(dir, 'turing.db'))
    const task = state.createTask({
      id: 'task-1',
      agent: { adapter: 'opencode', label: 'OpenCode' },
      prompt: 'write article',
      cwd: '/tmp/project',
      context: {
        text: 'background',
        rules: 'markdown only',
      },
      systemPrompt: 'single task',
    })

    assert.equal(task.status, 'queued')
    assert.equal(task.agent.adapter, 'opencode')
    assert.equal(task.context?.rules, 'markdown only')

    const updated = state.updateTask('task-1', {
      status: 'done',
      output: '[RESULT]finished[/RESULT]',
      result: 'finished',
      startedAt: 10,
      finishedAt: 20,
    })

    assert.equal(updated.status, 'done')
    assert.equal(updated.result, 'finished')
    assert.deepEqual(state.listTasks().map((item) => item.id), ['task-1'])
  } finally {
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('task persists permission mode and idempotency key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-state-'))

  try {
    state.initDb(join(dir, 'turing.db'))
    const task = state.createTask({
      id: 'trusted-task',
      userId: 'local',
      idempotencyKey: 'task-key-1',
      agent: { adapter: 'codex' },
      prompt: 'write files',
      permissionMode: 'trusted',
      cwd: '/tmp/project',
    })

    assert.equal(task.permissionMode, 'trusted')
    assert.equal(task.idempotencyKey, 'task-key-1')
    assert.equal(state.getTaskByIdempotencyKey('local', 'task-key-1')?.id, 'trusted-task')
  } finally {
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('session persists meeting scenario, participants, and idempotency key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-state-'))

  try {
    state.initDb(join(dir, 'turing.db'))
    const session = state.createSession({
      id: 'idem-session',
      userId: 'local',
      idempotencyKey: 'session-key-1',
      from: { adapter: 'opencode' },
      to: { adapter: 'codex' },
      scenario: 'panel_review',
      participants: [
        { agent: { adapter: 'opencode' }, role: 'reviewer' },
        { agent: { adapter: 'codex' }, role: 'moderator', moderator: true },
      ],
      nextParticipantIndex: 1,
    })

    assert.equal(session.idempotencyKey, 'session-key-1')
    const persisted = state.getSessionByIdempotencyKey('local', 'session-key-1')
    assert.equal(persisted?.id, 'idem-session')
    assert.equal(persisted?.scenario, 'panel_review')
    assert.equal(persisted?.nextParticipantIndex, 1)
    assert.deepEqual(persisted?.participants?.map((item) => item.agent.adapter), ['opencode', 'codex'])
  } finally {
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pipeline template CRUD persists reusable workflow steps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-state-'))

  try {
    state.initDb(join(dir, 'turing.db'))
    const template = state.createPipelineTemplate({
      id: 'template-1',
      name: 'Video workflow',
      steps: [{
        from: { adapter: 'opencode' },
        to: { adapter: 'claude-code' },
        initialPrompt: 'write script',
        mode: 'collaborate',
      }],
    })

    assert.equal(template.source, 'user')
    assert.equal(state.listPipelineTemplates().length, 1)
    assert.equal(state.getPipelineTemplate('template-1')?.steps[0]?.initialPrompt, 'write script')
    assert.equal(state.deletePipelineTemplate('template-1'), true)
    assert.equal(state.listPipelineTemplates().length, 0)
  } finally {
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reopen keeps the existing round count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-state-'))

  try {
    state.initDb(join(dir, 'turing.db'))
    state.createSession({
      id: 'reopen-session',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
      maxRounds: 5,
    })

    state.updateSession('reopen-session', {
      status: 'done',
      currentRound: 3,
      nextTurn: 'to',
    })

    const reopened = state.reopenSession('reopen-session')

    assert.equal(reopened.status, 'active')
    assert.equal(reopened.currentRound, 3)
  } finally {
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pipeline CRUD persists ordered steps and dependencies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-state-'))

  try {
    state.initDb(join(dir, 'turing.db'))
    state.createSession({
      id: 'pipeline-session-1',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
    })
    state.createSession({
      id: 'pipeline-session-2',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
    })

    const pipeline = state.createPipeline({
      id: 'pipeline-1',
      name: 'Pipeline Test',
      sessions: [
        {
          sessionId: 'pipeline-session-1',
          nodeType: 'copy_adapt',
          contract: { inputs: ['reference.md'], outputs: [{ fileName: 'script-adapted.md', requiredSections: ['改编文案'] }] },
          status: 'active',
        },
        { sessionId: 'pipeline-session-2', dependsOn: ['pipeline-session-1'], status: 'pending' },
      ],
    })

    assert.equal(pipeline.name, 'Pipeline Test')
    assert.equal(pipeline.status, 'active')
    assert.deepEqual(pipeline.sessions, [
      {
        sessionId: 'pipeline-session-1',
        nodeType: 'copy_adapt',
        contract: { inputs: ['reference.md'], outputs: [{ fileName: 'script-adapted.md', requiredSections: ['改编文案'] }] },
        status: 'active',
      },
      { sessionId: 'pipeline-session-2', dependsOn: ['pipeline-session-1'], status: 'pending' },
    ])

    const updated = state.updatePipeline('pipeline-1', {
      status: 'paused',
      sessions: [
        { sessionId: 'pipeline-session-1', status: 'done' },
        { sessionId: 'pipeline-session-2', dependsOn: ['pipeline-session-1'], status: 'active' },
      ],
    })

    assert.equal(updated.status, 'paused')
    assert.deepEqual(state.listPipelines().map((item) => item.id), ['pipeline-1'])
    assert.deepEqual(updated.sessions.map((step) => step.status), ['done', 'active'])
    assert.equal(state.getPipelineBySession('pipeline-session-2')?.id, 'pipeline-1')
    assert.deepEqual(state.getPipelineWithSessions('pipeline-1')?.sessionDetails.map((session) => session.id), [
      'pipeline-session-1',
      'pipeline-session-2',
    ])

    state.deletePipeline('pipeline-1')
    assert.equal(state.getPipeline('pipeline-1'), undefined)
  } finally {
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stats aggregate sessions, pipelines, and agent usage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-state-'))

  try {
    state.initDb(join(dir, 'turing.db'))
    state.createSession({
      id: 'stats-session-1',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
      maxRounds: 6,
    })
    state.createSession({
      id: 'stats-session-2',
      from: { adapter: 'codex' },
      to: { adapter: 'opencode' },
      maxRounds: 6,
    })
    state.updateSession('stats-session-1', { status: 'done', currentRound: 3 })
    state.updateSession('stats-session-2', { status: 'error', currentRound: 2 })
    state.createPipeline({
      id: 'stats-pipeline',
      name: 'Stats Pipeline',
      status: 'error',
      sessions: [
        { sessionId: 'stats-session-1', status: 'done' },
        { sessionId: 'stats-session-2', status: 'error' },
      ],
    })

    const stats = state.getStats()

    assert.equal(stats.sessions.total, 2)
    assert.equal(stats.sessions.done, 1)
    assert.equal(stats.sessions.error, 1)
    assert.equal(stats.pipelines.total, 1)
    assert.equal(stats.pipelines.error, 1)
    assert.equal(stats.agents[0].name, 'codex')
    assert.equal(stats.agents[0].sessions, 2)
  } finally {
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('listSessions returns slim rows without context/system_prompts/artifacts/gitSnapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-state-'))

  try {
    state.initDb(join(dir, 'turing.db'))
    state.createSession({
      id: 'slim-session-1',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
      context: { text: 'large context blob', rules: 'do things' },
      systemPrompts: { from: 'you are agent A', to: 'you are agent B' },
      artifacts: { generatedFiles: ['output.md'] },
      gitSnapshot: 'abc123',
    })
    state.createSession({
      id: 'slim-session-2',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
    })

    const sessions = state.listSessions()

    assert.equal(sessions.length, 2)
    const s1 = sessions.find((s) => s.id === 'slim-session-1')!
    assert.ok(s1, 'slim-session-1 should be in list')
    assert.equal(s1.context, undefined, 'listSessions should not include context')
    assert.equal(s1.systemPrompts, undefined, 'listSessions should not include systemPrompts')
    assert.equal(s1.artifacts, undefined, 'listSessions should not include artifacts')
    assert.equal(s1.gitSnapshot, undefined, 'listSessions should not include gitSnapshot')
    assert.equal(s1.status, 'active', 'listSessions should still include status')
    assert.equal(s1.from.adapter, 'codex', 'listSessions should still include from')

    const sessionsByStatus = state.listSessions({ status: 'active' })
    assert.equal(sessionsByStatus.length, 2)
    assert.equal(sessionsByStatus[0].context, undefined)
    assert.equal(sessionsByStatus[0].systemPrompts, undefined)
  } finally {
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getSession returns full rows with context/system_prompts/artifacts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-state-'))

  try {
    state.initDb(join(dir, 'turing.db'))
    state.createSession({
      id: 'full-session',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
      context: { text: 'large context blob', rules: 'do things' },
      systemPrompts: { from: 'you are agent A', to: 'you are agent B' },
      artifacts: { generatedFiles: ['output.md'] },
      gitSnapshot: 'abc123',
    })

    const session = state.getSession('full-session')!
    assert.ok(session, 'getSession should return the session')
    assert.deepEqual(session.context, { text: 'large context blob', rules: 'do things' })
    assert.deepEqual(session.systemPrompts, { from: 'you are agent A', to: 'you are agent B' })
    assert.deepEqual(session.artifacts, { generatedFiles: ['output.md'] })
    assert.equal(session.gitSnapshot, 'abc123')
  } finally {
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── clampSessionContext tests ─────────────────────────────────────────────────

test('clampSessionContext: single file over 256KB is truncated with marker', () => {
  const bigContent = 'x'.repeat(CONTEXT_FILE_MAX_BYTES + 50_000)
  const ctx = {
    files: [{ path: 'big.txt', content: bigContent }],
    rules: 'keep me',
  }
  const clamped = clampSessionContext(ctx)!
  assert.ok(clamped.files![0].content.length < bigContent.length)
  assert.ok(clamped.files![0].content.includes('[Passiton: file truncated'))
  assert.equal(clamped.rules, 'keep me')
  assert.ok(
    Buffer.byteLength(clamped.files![0].content, 'utf8') <= CONTEXT_FILE_MAX_BYTES,
    'truncated file should be within 256KB',
  )
})

test('clampSessionContext: total over 2MB is reduced starting from largest file', () => {
  // Two files: 1.5 MB + 1.5 MB = 3 MB total (> 2 MB limit)
  const halfContent = 'y'.repeat(Math.floor(CONTEXT_TOTAL_MAX_BYTES * 0.75))
  const ctx = {
    files: [
      { path: 'a.txt', content: halfContent },
      { path: 'b.txt', content: halfContent },
    ],
  }
  const clamped = clampSessionContext(ctx)!
  let total = 0
  for (const f of clamped.files ?? []) {
    total += Buffer.byteLength(f.content, 'utf8')
  }
  assert.ok(total <= CONTEXT_TOTAL_MAX_BYTES, `total ${total} should be <= 2MB`)
  // At least one file should have a truncation marker
  const hasMarker = (clamped.files ?? []).some((f) => f.content.includes('[Passiton:'))
  assert.ok(hasMarker, 'at least one file should have truncation marker')
})

test('clampSessionContext: small context passes through unchanged', () => {
  const ctx = {
    files: [{ path: 'small.txt', content: 'hello world' }],
    rules: 'be nice',
    text: 'some background',
  }
  const clamped = clampSessionContext(ctx)!
  assert.deepEqual(clamped, ctx)
})

test('clampSessionContext: undefined returns undefined', () => {
  assert.equal(clampSessionContext(undefined), undefined)
})

// ── Bloat migration tests ─────────────────────────────────────────────────────

test('bloat migration: nulls oversized system_prompts and sets user_version=1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-migration-'))

  try {
    const dbPath = join(dir, 'turing.db')

    // Create a DB, insert an oversized system_prompts row, close it.
    state.initDb(dbPath)
    state.createSession({
      id: 'bloat-session',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
    })

    // Directly write an oversized system_prompts JSON (> 1 MB)
    const hugePrompt = 'a'.repeat(1_200_000) // 1.2 MB
    state.updateSession('bloat-session', {
      systemPrompts: { from: hugePrompt, to: hugePrompt },
    })

    // Verify it's stored
    const before = state.getSession('bloat-session')!
    assert.ok(before.systemPrompts, 'system_prompts should be set before migration')

    // Reset user_version to 0 so migration runs on next initDb
    const rawDb = new Database(dbPath)
    rawDb.pragma('user_version = 0')
    rawDb.close()

    state.closeDb()

    // Re-init — migration should fire
    state.initDb(dbPath)

    // system_prompts should now be NULL
    const after = state.getSession('bloat-session')!
    assert.equal(after.systemPrompts, undefined, 'oversized system_prompts should be nulled')

    // user_version should be 1
    const checkDb = new Database(dbPath)
    const version = checkDb.pragma('user_version', { simple: true })
    checkDb.close()
    assert.equal(version, 1, 'user_version should be 1 after migration')

    state.closeDb()

    // Re-init again — migration should NOT run again (idempotent)
    state.initDb(dbPath)
    const checkDb2 = new Database(dbPath)
    const version2 = checkDb2.pragma('user_version', { simple: true })
    checkDb2.close()
    assert.equal(version2, 1, 'user_version should still be 1 on second init')

    state.closeDb()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('bloat migration: small user-provided system_prompts are preserved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-migration-small-'))

  try {
    const dbPath = join(dir, 'turing.db')

    state.initDb(dbPath)
    state.createSession({
      id: 'small-prompt-session',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
      systemPrompts: { from: 'You are a helpful assistant.', to: 'You are a coder.' },
    })

    // Reset version and re-init
    state.closeDb()
    const rawDb = new Database(dbPath)
    rawDb.pragma('user_version = 0')
    rawDb.close()

    state.initDb(dbPath)

    const after = state.getSession('small-prompt-session')!
    assert.deepEqual(after.systemPrompts, {
      from: 'You are a helpful assistant.',
      to: 'You are a coder.',
    })

    state.closeDb()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
