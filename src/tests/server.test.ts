import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import WebSocket from 'ws'
import { Router } from '../router.js'
import { createServer } from '../server.js'
import * as state from '../state.js'

class StubAgentCatalog {
  async listAgents(): Promise<unknown[]> {
    return []
  }
}

async function withServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'turing-server-'))
  process.env.TURING_JWT_SECRET = 'server-test-jwt-secret'
  state.initDb(join(dir, 'turing.db'))
  const router = new Router()
  const server = createServer(router, 0, new StubAgentCatalog() as never)
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve server address')
  }

  try {
    await fn(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
    delete process.env.TURING_JWT_SECRET
  }
}

async function register(baseUrl: string, email: string): Promise<{ token: string; userId: string }> {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  })
  assert.equal(response.status, 201)
  const payload = await response.json() as { token: string; user: { userId: string } }
  return { token: payload.token, userId: payload.user.userId }
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}

test('GET /api/stats returns aggregated stats payload', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'stats@example.com')
    state.createSession({
      id: 'server-stats-1',
      userId: auth.userId,
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
    })
    state.updateSession('server-stats-1', { status: 'done', currentRound: 2 }, auth.userId)

    const response = await fetch(`${baseUrl}/api/stats`, { headers: authHeaders(auth.token) })
    assert.equal(response.status, 200)
    const payload = await response.json() as {
      sessions: { total: number; done: number }
      agents: unknown[]
    }
    assert.equal(payload.sessions.total, 1)
    assert.equal(payload.sessions.done, 1)
    assert.ok(Array.isArray(payload.agents))
  })
})

test('GET /api/pipelines/:id returns pipeline with session details', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'pipelines@example.com')
    state.createSession({
      id: 'server-pipeline-session',
      userId: auth.userId,
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
    })
    state.createPipeline({
      id: 'server-pipeline',
      userId: auth.userId,
      name: 'Server Pipeline',
      sessions: [
        { sessionId: 'server-pipeline-session', status: 'active' },
      ],
    })

    const response = await fetch(`${baseUrl}/api/pipelines/server-pipeline`, { headers: authHeaders(auth.token) })
    assert.equal(response.status, 200)
    const payload = await response.json() as {
      id: string
      sessionDetails: Array<{ id: string }>
    }
    assert.equal(payload.id, 'server-pipeline')
    assert.equal(payload.sessionDetails.length, 1)
    assert.equal(payload.sessionDetails[0].id, 'server-pipeline-session')
  })
})

test('WebSocket init only returns sessions for the authenticated user', async () => {
  await withServer(async (baseUrl) => {
    const userA = await register(baseUrl, 'ws-a@example.com')
    const userB = await register(baseUrl, 'ws-b@example.com')
    state.createSession({
      id: 'ws-session-a',
      userId: userA.userId,
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
    })
    state.createSession({
      id: 'ws-session-b',
      userId: userB.userId,
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
    })

    const ws = new WebSocket(baseUrl.replace('http:', 'ws:') + '/ws', {
      headers: authHeaders(userA.token),
    })
    const [raw] = await once(ws, 'message') as [Buffer]
    ws.close()

    const message = JSON.parse(raw.toString()) as { type: string; payload: Array<{ id: string }> }
    assert.equal(message.type, 'init')
    assert.deepEqual(message.payload.map((session) => session.id), ['ws-session-a'])
  })
})
