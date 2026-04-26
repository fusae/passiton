import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
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
  }
}

test('GET /api/stats returns aggregated stats payload', async () => {
  await withServer(async (baseUrl) => {
    state.createSession({
      id: 'server-stats-1',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
    })
    state.updateSession('server-stats-1', { status: 'done', currentRound: 2 })

    const response = await fetch(`${baseUrl}/api/stats`)
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
    state.createSession({
      id: 'server-pipeline-session',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
    })
    state.createPipeline({
      id: 'server-pipeline',
      name: 'Server Pipeline',
      sessions: [
        { sessionId: 'server-pipeline-session', status: 'active' },
      ],
    })

    const response = await fetch(`${baseUrl}/api/pipelines/server-pipeline`)
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
