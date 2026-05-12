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

  async diagnoseAgent(name: string): Promise<unknown> {
    return name === 'codex' ? { name, healthy: true } : undefined
  }
}

async function withServer(fn: (baseUrl: string) => Promise<void>, options: { allowRegistration?: boolean } = { allowRegistration: true }): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'turing-server-'))
  process.env.TURING_JWT_SECRET = 'server-test-jwt-secret'
  if (options.allowRegistration !== false) {
    process.env.TURING_ALLOW_REGISTRATION = '1'
  }
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
    delete process.env.TURING_ALLOW_REGISTRATION
    delete process.env.TURING_ALLOWED_WORKSPACES
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

test('GET /health returns unauthenticated liveness payload', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
  })
})

test('GET /api/docs returns unauthenticated API reference', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/docs`)
    assert.equal(response.status, 200)
    const payload = await response.json() as { createSession: { path: string } }
    assert.equal(payload.createSession.path, '/api/sessions')
  })
})

test('GET /api/deploy/check returns authenticated deployment status', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'deploy-check@example.com')
    const response = await fetch(`${baseUrl}/api/deploy/check`, { headers: authHeaders(auth.token) })
    assert.equal(response.status, 200)
    const payload = await response.json() as { ok: boolean; pid: number }
    assert.equal(payload.ok, true)
    assert.equal(typeof payload.pid, 'number')
  })
})

test('GET /api/agents/:name/diagnostics returns agent details', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'agent-diag@example.com')
    const response = await fetch(`${baseUrl}/api/agents/codex/diagnostics`, { headers: authHeaders(auth.token) })
    assert.equal(response.status, 200)
    const payload = await response.json() as { name: string; healthy: boolean }
    assert.equal(payload.name, 'codex')
    assert.equal(payload.healthy, true)
  })
})

test('POST /api/auth/register is disabled by default', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'disabled@example.com', password: 'password123' }),
    })
    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), { error: 'Registration is disabled' })
  }, { allowRegistration: false })
})

test('POST /api/auth/local returns a local user token', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/local`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(response.status, 200)
    const payload = await response.json() as { token: string; user: { userId: string; email: string } }
    assert.equal(payload.user.email, 'local@turing.local')

    const stats = await fetch(`${baseUrl}/api/stats`, { headers: authHeaders(payload.token) })
    assert.equal(stats.status, 200)
  }, { allowRegistration: false })
})

test('POST /api/sessions rejects cwd outside allowed workspaces', async () => {
  const allowed = mkdtempSync(join(tmpdir(), 'turing-allowed-workspace-'))
  const denied = mkdtempSync(join(tmpdir(), 'turing-denied-workspace-'))
  process.env.TURING_ALLOWED_WORKSPACES = allowed
  try {
    await withServer(async (baseUrl) => {
      const auth = await register(baseUrl, 'workspace@example.com')
      const response = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({
          from: { adapter: 'codex' },
          to: { adapter: 'claude-code' },
          initialPrompt: 'test',
          cwd: denied,
        }),
      })
      assert.equal(response.status, 403)
    })
  } finally {
    rmSync(allowed, { recursive: true, force: true })
    rmSync(denied, { recursive: true, force: true })
    delete process.env.TURING_ALLOWED_WORKSPACES
  }
})

test('agent CRUD stores user API model configs', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'agents@example.com')
    const keyCreate = await fetch(`${baseUrl}/api/keys`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'anthropic',
        name: 'Claude Vault',
        key: 'sk-ant-test1234',
      }),
    })
    assert.equal(keyCreate.status, 201)
    const key = await keyCreate.json() as { id: string }
    const create = await fetch(`${baseUrl}/api/agents`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'claude-api',
        adapter: 'anthropic-api',
        keyId: key.id,
        model: 'claude-sonnet-4-20250514',
      }),
    })
    assert.equal(create.status, 201)
    const created = await create.json() as Array<{ name: string; status: string; keyMasked: string }>
    assert.equal(created[0].name, 'claude-api')
    assert.equal(created[0].status, 'ready')
    assert.equal(created[0].keyMasked, 'sk-...1234')
    assert.notEqual(state.getUserAgent(auth.userId, 'claude-api')?.encryptedKey, 'sk-ant-test1234')

    const remove = await fetch(`${baseUrl}/api/agents/claude-api`, {
      method: 'DELETE',
      headers: authHeaders(auth.token),
    })
    assert.equal(remove.status, 200)
    assert.equal(state.getUserAgent(auth.userId, 'claude-api'), undefined)
  })
})

test('provider keys include vault keys and assistant-linked keys', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'provider-keys@example.com')
    const keyCreate = await fetch(`${baseUrl}/api/keys`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'anthropic',
        name: 'Claude Vault',
        key: 'sk-ant-vault1234',
      }),
    })
    assert.equal(keyCreate.status, 201)
    const storedKey = await keyCreate.json() as { id: string }
    const keysResponse = await fetch(`${baseUrl}/api/keys`, { headers: authHeaders(auth.token) })
    assert.equal(keysResponse.status, 200)
    const keys = await keysResponse.json() as Array<{ id: string; source: string; maskedKey: string }>
    const vaultKey = keys.find((key) => key.id === storedKey.id && key.source === 'vault')
    assert.ok(vaultKey)

    const createAgent = await fetch(`${baseUrl}/api/agents`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'claude-api',
        adapter: 'anthropic-api',
        keyId: vaultKey.id,
        model: 'claude-sonnet-4-20250514',
      }),
    })
    assert.equal(createAgent.status, 201)

    const listed = await fetch(`${baseUrl}/api/keys`, { headers: authHeaders(auth.token) })
    assert.equal(listed.status, 200)
    const payload = await listed.json() as Array<{ source: string; name: string; maskedKey: string; readOnly?: boolean; usedBy?: string[] }>
    assert.ok(payload.some((key) => key.source === 'vault' && key.name === 'Claude Vault' && key.maskedKey === '****1234'))
    assert.ok(payload.some((key) => key.source === 'assistant' && key.name === 'claude-api key' && key.readOnly && key.usedBy?.includes('claude-api')))
    assert.ok(!JSON.stringify(payload).includes('sk-ant-vault1234'))
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

test('WebSocket accepts browser token query authentication', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'ws-query@example.com')
    state.createSession({
      id: 'ws-query-session',
      userId: auth.userId,
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
    })

    const wsUrl = `${baseUrl.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(auth.token)}`
    const ws = new WebSocket(wsUrl)
    const [raw] = await once(ws, 'message') as [Buffer]
    ws.close()

    const message = JSON.parse(raw.toString()) as { type: string; payload: Array<{ id: string }> }
    assert.equal(message.type, 'init')
    assert.deepEqual(message.payload.map((session) => session.id), ['ws-query-session'])
  })
})
