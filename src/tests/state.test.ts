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

    const deleted = state.pruneExpiredMessages(now)
    const messages = state.getMessages('gc-session')

    assert.equal(deleted, 1)
    assert.deepEqual(messages.map((message) => message.id), ['fresh'])
  } finally {
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
