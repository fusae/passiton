import test from 'node:test'
import assert from 'node:assert/strict'
import { checkSessionTimeout } from '../policy.js'
import type { Session } from '../types.js'

test('session timeout uses last update time so approval waits can resume', () => {
  const now = Date.now()
  const session = {
    createdAt: now - 24 * 60 * 60 * 1000,
    updatedAt: now,
  } as Session

  assert.deepEqual(checkSessionTimeout(session, {
    maxRounds: 20,
    messageTimeout: 1000,
    messageRetentionMs: 1000,
    sessionTimeout: 2 * 60 * 60 * 1000,
    retries: 0,
  }), { allowed: true })
})
