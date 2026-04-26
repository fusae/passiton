import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import type http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  authenticateRequest,
  createUserToken,
  listUserTokens,
  loginUser,
  registerUser,
  verifyJwt,
} from '../auth.js'
import * as state from '../state.js'

function withTempDb(fn: () => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'turing-auth-'))
  process.env.TURING_JWT_SECRET = 'test-jwt-secret'
  state.initDb(join(dir, 'turing.db'))
  return Promise.resolve(fn()).finally(() => {
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
    delete process.env.TURING_JWT_SECRET
  })
}

function reqWithAuth(value: string): http.IncomingMessage {
  return { headers: { authorization: value } } as http.IncomingMessage
}

test('register creates user and returns verifiable JWT', async () => {
  await withTempDb(() => {
    const result = registerUser('USER@example.com', 'password123')

    assert.equal(result.user.email, 'user@example.com')
    assert.equal(state.getUserByEmail('user@example.com')?.id, result.user.userId)
    assert.deepEqual(verifyJwt(result.token), result.user)
  })
})

test('login verifies password and returns JWT', async () => {
  await withTempDb(() => {
    const registered = registerUser('login@example.com', 'password123')
    const loggedIn = loginUser('login@example.com', 'password123')

    assert.equal(loggedIn.user.userId, registered.user.userId)
    assert.deepEqual(verifyJwt(loggedIn.token), loggedIn.user)
    assert.throws(() => loginUser('login@example.com', 'wrongpass'), /Invalid email or password/)
  })
})

test('authenticateRequest accepts JWT bearer token', async () => {
  await withTempDb(() => {
    const registered = registerUser('jwt@example.com', 'password123')

    assert.deepEqual(
      authenticateRequest(reqWithAuth(`Bearer ${registered.token}`)),
      registered.user
    )
  })
})

test('authenticateRequest accepts API token and masks listed tokens', async () => {
  await withTempDb(() => {
    const registered = registerUser('token@example.com', 'password123')
    const created = createUserToken(registered.user.userId, 'CI')

    assert.match(created.token, /^turing_[0-9a-f]{64}$/)
    assert.deepEqual(
      authenticateRequest(reqWithAuth(`Bearer ${created.token}`)),
      registered.user
    )
    assert.deepEqual(listUserTokens(registered.user.userId).map((token) => ({
      id: token.id,
      name: token.name,
      token: token.token,
    })), [{
      id: created.id,
      name: 'CI',
      token: `****${created.token.slice(-4)}`,
    }])
  })
})
