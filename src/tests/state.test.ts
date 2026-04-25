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
