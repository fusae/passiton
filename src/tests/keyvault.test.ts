import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decryptKey, listKeys, storeKey } from '../keyvault.js'
import * as state from '../state.js'

function withTempDb(fn: (userId: string) => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'turing-keyvault-'))
  process.env.TURING_ENCRYPTION_KEY = 'test-encryption-secret'
  state.initDb(join(dir, 'turing.db'))
  const user = state.createUser({
    id: 'user-1',
    email: 'keys@example.com',
    passwordHash: 'hash',
    salt: 'salt',
  })
  return Promise.resolve(fn(user.id)).finally(() => {
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
    delete process.env.TURING_ENCRYPTION_KEY
  })
}

test('key vault encrypts and decrypts API keys', async () => {
  await withTempDb((userId) => {
    const stored = storeKey({
      userId,
      provider: 'openai',
      key: 'sk-test-1234567890',
      name: 'OpenAI test',
    })

    assert.equal(stored.maskedKey, '****7890')
    assert.notEqual(state.getStoredApiKey(stored.id, userId)?.encryptedKey, 'sk-test-1234567890')
    assert.deepEqual(decryptKey(userId, stored.id), {
      provider: 'openai',
      key: 'sk-test-1234567890',
      envVar: 'OPENAI_API_KEY',
    })
  })
})

test('key vault listing never returns full key', async () => {
  await withTempDb((userId) => {
    const stored = storeKey({
      userId,
      provider: 'anthropic',
      key: 'sk-ant-secret-abcd',
      name: 'Anthropic',
    })

    assert.deepEqual(listKeys(userId), [{
      id: stored.id,
      provider: 'anthropic',
      name: 'Anthropic',
      maskedKey: '****abcd',
      createdAt: stored.createdAt,
    }])
  })
})
