import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as state from '../state.js'

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
        { sessionId: 'pipeline-session-1', status: 'active' },
        { sessionId: 'pipeline-session-2', dependsOn: ['pipeline-session-1'], status: 'pending' },
      ],
    })

    assert.equal(pipeline.name, 'Pipeline Test')
    assert.equal(pipeline.status, 'active')
    assert.deepEqual(pipeline.sessions, [
      { sessionId: 'pipeline-session-1', status: 'active' },
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
