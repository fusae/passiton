import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import WebSocket from 'ws'
import { Router } from '../router.js'
import { createServer } from '../server.js'
import * as state from '../state.js'
import type { Adapter, AdapterSendOpts, Session } from '../types.js'

class StubAgentCatalog {
  async listAgents(): Promise<unknown[]> {
    return []
  }

  async diagnoseAgent(name: string): Promise<unknown> {
    return name === 'codex' ? { name, healthy: true } : undefined
  }
}

const execFileAsync = promisify(execFile)

class StubAdapter implements Adapter {
  readonly config: Record<string, unknown> = {}

  constructor(
    readonly name: string,
    private readonly handler: (session: Session, message: string, opts?: AdapterSendOpts) => Promise<string>
  ) {}

  send(session: Session, message: string, opts?: AdapterSendOpts): Promise<string> {
    return this.handler(session, message, opts)
  }

  async healthCheck(): Promise<boolean> {
    return true
  }
}

async function withServer(
  fn: (baseUrl: string) => Promise<void>,
  options: { allowRegistration?: boolean; configureRouter?: (router: Router) => void } = { allowRegistration: true }
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'turing-server-'))
  process.env.TURING_JWT_SECRET = 'server-test-jwt-secret'
  if (options.allowRegistration !== false) {
    process.env.TURING_ALLOW_REGISTRATION = '1'
  }
  process.env.TURING_ALLOWED_WORKSPACES ??= tmpdir()
  state.initDb(join(dir, 'turing.db'))
  const router = new Router()
  options.configureRouter?.(router)
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

test('video preview returns stream metadata and supports range requests', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'video-preview@example.com')
    const dir = mkdtempSync(join(tmpdir(), 'turing-video-preview-'))
    try {
      const filePath = join(dir, 'clip.mp4')
      writeFileSync(filePath, Buffer.from('0123456789'))
      const preview = await fetch(`${baseUrl}/api/files/preview`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
      })
      assert.equal(preview.status, 200)
      const payload = await preview.json() as { encoding: string; mimeType: string; streamUrl: string; content?: string }
      assert.equal(payload.encoding, 'stream')
      assert.equal(payload.mimeType, 'video/mp4')
      assert.equal(payload.content, undefined)

      const streamed = await fetch(`${baseUrl}${payload.streamUrl}`, {
        headers: { ...authHeaders(auth.token), range: 'bytes=2-5' },
      })
      assert.equal(streamed.status, 206)
      assert.equal(streamed.headers.get('content-type'), 'video/mp4')
      assert.equal(streamed.headers.get('content-range'), 'bytes 2-5/10')
      assert.equal(await streamed.text(), '2345')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('file resolver handles cwd, base file, unique basename, and missing paths', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'file-resolver@example.com')
    const dir = mkdtempSync(join(tmpdir(), 'turing-file-resolver-'))
    try {
      const outputDir = join(dir, 'output', 'episode')
      mkdirSync(outputDir, { recursive: true })
      const referencePath = join(outputDir, 'reference.md')
      const videoPath = join(outputDir, 'video.mp4')
      writeFileSync(referencePath, 'video: `video.mp4`')
      writeFileSync(videoPath, 'video')

      const response = await fetch(`${baseUrl}/api/files/resolve`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd: dir,
          baseFile: 'output/episode/reference.md',
          paths: ['output/episode/reference.md', 'video.mp4', 'reference.md', 'missing.mp4'],
        }),
      })
      assert.equal(response.status, 200)
      const payload = await response.json() as Array<{ source: string; exists: boolean; path?: string }>
      assert.deepEqual(payload, [
        { source: 'output/episode/reference.md', exists: true, path: realpathSync.native(referencePath) },
        { source: 'video.mp4', exists: true, path: realpathSync.native(videoPath) },
        { source: 'reference.md', exists: true, path: realpathSync.native(referencePath) },
        { source: 'missing.mp4', exists: false },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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

test('GET /api/pipeline-templates returns reusable workflow templates', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'pipeline-templates@example.com')
    const response = await fetch(`${baseUrl}/api/pipeline-templates`, { headers: authHeaders(auth.token) })
    assert.equal(response.status, 200)
    const payload = await response.json() as Array<{ id: string; name: string; steps: unknown[] }>
    // Built-in templates are shipped (content/creative/code/docs). Each has a
    // unique id and at least one step.
    assert.ok(payload.length >= 4, 'expected several built-in pipeline templates')
    const ids = payload.map((template) => template.id)
    for (const id of ids) {
      assert.ok(id, 'template has an id')
    }
    for (const template of payload) {
      assert.ok(template.steps.length >= 1, `${template.id} has steps`)
    }
  })
})

test('pipeline template API creates, lists, and deletes user templates', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'user-pipeline-templates@example.com')
    const created = await fetch(`${baseUrl}/api/pipeline-templates`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'My workflow',
        steps: [{
          from: { adapter: 'opencode' },
          to: { adapter: 'claude-code' },
          initialPrompt: 'write script',
          mode: 'collaborate',
        }],
      }),
    })
    assert.equal(created.status, 201)
    const template = await created.json() as { id: string; source: string }
    assert.equal(template.source, 'user')

    const listed = await fetch(`${baseUrl}/api/pipeline-templates`, { headers: authHeaders(auth.token) })
    const payload = await listed.json() as Array<{ id: string; source: string }>
    assert.ok(payload.some((item) => item.id === template.id && item.source === 'user'))

    const deleted = await fetch(`${baseUrl}/api/pipeline-templates/${template.id}`, {
      method: 'DELETE',
      headers: authHeaders(auth.token),
    })
    assert.equal(deleted.status, 200)
  })
})

test('POST /api/pipelines can start from a later step with manual completed predecessors', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'pipeline-start-at@example.com')
    const created = await fetch(`${baseUrl}/api/pipelines`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Start from storyboard',
        startAtStep: 3,
        manualOutput: 'reference and script were already discussed',
        steps: [
          {
            from: { adapter: 'codex' },
            to: { adapter: 'codex' },
            title: '解析对标视频',
            initialPrompt: 'parse',
            mode: 'freeform',
          },
          {
            from: { adapter: 'codex' },
            to: { adapter: 'codex' },
            title: '改编文案',
            initialPrompt: 'adapt',
            mode: 'freeform',
            dependsOn: [0],
          },
          {
            from: { adapter: 'codex' },
            to: { adapter: 'codex' },
            title: '生成分镜与 Prompt',
            initialPrompt: 'storyboard',
            mode: 'freeform',
            dependsOn: [1],
            approveMode: true,
          },
        ],
      }),
    })
    assert.equal(created.status, 201)
    const pipeline = await created.json() as { id: string; sessions: Array<{ sessionId: string; status: string }> }
    assert.deepEqual(pipeline.sessions.slice(0, 2).map((step) => step.status), ['done', 'done'])

    await waitFor(async () => {
      const response = await fetch(`${baseUrl}/api/pipelines/${pipeline.id}`, { headers: authHeaders(auth.token) })
      const refreshed = await response.json() as { sessions: Array<{ status: string }> }
      return refreshed.sessions[2]?.status === 'active'
    })

    const firstSession = await fetch(`${baseUrl}/api/sessions/${pipeline.sessions[0]!.sessionId}`, { headers: authHeaders(auth.token) })
    const payload = await firstSession.json() as { status: string; messages: Array<{ from: string; content: string }> }
    assert.equal(payload.status, 'done')
    assert.equal(payload.messages.some((message) => message.from === 'workflow' && message.content.includes('reference and script were already discussed')), true)
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

test('CLI task create authenticates locally and creates a task', async () => {
  await withServer(async (baseUrl) => {
    const cliPath = fileURLToPath(new URL('../cli.js', import.meta.url))
    const result = await execFileAsync(process.execPath, [cliPath, 'task', 'create', '--agent', 'opencode', 'write', 'article'], {
      env: {
        ...process.env,
        TURING_BASE_URL: baseUrl,
      },
    })

    assert.match(result.stdout, /Task/)
    assert.equal(state.listTasks().length, 1)
    assert.equal(state.listTasks()[0]?.prompt, 'write article')
  }, {
    configureRouter: (router) => {
      router.registerAdapter(new StubAdapter('opencode', async () => '[RESULT]done[/RESULT]'))
    },
  })
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

test('POST /api/sessions rejects trusted permission mode without cwd', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'trusted-cwd@example.com')
    const response = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        from: { adapter: 'codex' },
        to: { adapter: 'claude-code' },
        initialPrompt: 'test',
        permissionMode: 'trusted',
      }),
    })
    assert.equal(response.status, 400)
  })
})

test('POST /api/tasks runs a lead-agent task and exposes its result', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'tasks@example.com')
    const create = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        agent: { adapter: 'opencode' },
        prompt: 'write article',
        context: { rules: 'markdown only' },
      }),
    })
    assert.equal(create.status, 201)
    const task = await create.json() as { id: string; status: string }
    assert.equal(task.status, 'queued')

    await waitFor(async () => {
      const response = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
        headers: authHeaders(auth.token),
      })
      const payload = await response.json() as { status: string }
      return payload.status === 'done'
    })

    const response = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
      headers: authHeaders(auth.token),
    })
    assert.equal(response.status, 200)
    const completed = await response.json() as { status: string; result: string; output: string }
    assert.equal(completed.status, 'done')
    assert.equal(completed.result, 'article ready')
    assert.match(completed.output, /\[RESULT\]article ready\[\/RESULT\]/)
  }, {
    allowRegistration: true,
    configureRouter: (router) => {
      router.registerAdapter(new StubAdapter('opencode', async (_session, message, opts) => {
        assert.equal(message, 'write article')
        assert.match(opts?.systemPrompt ?? '', /lead agent for a task inside Turing/)
        assert.match(opts?.systemPrompt ?? '', /requires delegation/)
        assert.match(opts?.systemPrompt ?? '', /markdown only/)
        return '[RESULT]article ready[/RESULT]'
      }))
    },
  })
})

test('POST /mcp exposes tools and can create a task', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'mcp@example.com')

    const initialize = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    })
    assert.equal(initialize.status, 200)
    assert.equal((await initialize.json() as { result: { serverInfo: { name: string } } }).result.serverInfo.name, 'turing')

    const tools = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    })
    assert.equal(tools.status, 200)
    const toolsPayload = await tools.json() as { result: { resultType: string; tools: Array<{ name: string }> } }
    assert.equal(toolsPayload.result.resultType, 'complete')
    assert.ok(toolsPayload.result.tools.some((tool) => tool.name === 'turing_create_task'))

    const created = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'turing_create_task',
          arguments: {
            agent: 'opencode',
            prompt: 'write mcp article',
          },
        },
      }),
    })
    assert.equal(created.status, 200)
    const createPayload = await created.json() as { result: { resultType: string; content: Array<{ type: string; text: string }>; isError: boolean } }
    assert.equal(createPayload.result.resultType, 'complete')
    assert.equal(createPayload.result.isError, false)
    const createdData = JSON.parse(createPayload.result.content[0]!.text) as { task: { id: string; status: string } }
    const taskId = createdData.task.id
    assert.equal(createdData.task.status, 'queued')

    await waitFor(async () => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'turing_get_task', arguments: { id: taskId } },
        }),
      })
      const payload = await response.json() as { result: { content: Array<{ text: string }> } }
      const data = JSON.parse(payload.result.content[0]!.text) as { task: { status: string; result?: string } }
      return data.task.status === 'done'
    })
  }, {
    allowRegistration: true,
    configureRouter: (router) => {
      router.registerAdapter(new StubAdapter('opencode', async (_session, message) => {
        assert.equal(message, 'write mcp article')
        return '[RESULT]mcp ready[/RESULT]'
      }))
    },
  })
})

test('MCP accepts token query authentication for custom app setup', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'mcp-query-token@example.com')
    const response = await fetch(`${baseUrl}/mcp?token=${encodeURIComponent(auth.token)}`)
    assert.equal(response.status, 200)
    const payload = await response.json() as { endpoint: string; tools: string[] }
    assert.equal(payload.endpoint, '/mcp')
    assert.ok(payload.tools.includes('turing_create_task'))
  })
})

test('POST /api/tasks/:id/stop stops a running task', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'task-stop@example.com')
    const create = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        agent: { adapter: 'opencode' },
        prompt: 'slow task',
      }),
    })
    const task = await create.json() as { id: string }

    await waitFor(async () => {
      const response = await fetch(`${baseUrl}/api/tasks/${task.id}`, { headers: authHeaders(auth.token) })
      const payload = await response.json() as { status: string }
      return payload.status === 'running'
    })

    const stop = await fetch(`${baseUrl}/api/tasks/${task.id}/stop`, {
      method: 'POST',
      headers: authHeaders(auth.token),
    })
    assert.equal(stop.status, 200)
    assert.equal((await stop.json() as { status: string }).status, 'stopped')
    release()
  }, {
    allowRegistration: true,
    configureRouter: (router) => {
      router.registerAdapter(new StubAdapter('opencode', async () => {
        await gate
        return '[RESULT]late[/RESULT]'
      }))
    },
  })
})

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for condition')
}

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
    state.addMessage({
      id: 'server-pipeline-message',
      sessionId: 'server-pipeline-session',
      from: 'human',
      content: 'Pipeline input',
      timestamp: Date.now(),
      round: 0,
    })

    const response = await fetch(`${baseUrl}/api/pipelines/server-pipeline`, { headers: authHeaders(auth.token) })
    assert.equal(response.status, 200)
    const payload = await response.json() as {
      id: string
      sessionDetails: Array<{ id: string; messages: Array<{ content: string }> }>
    }
    assert.equal(payload.id, 'server-pipeline')
    assert.equal(payload.sessionDetails.length, 1)
    assert.equal(payload.sessionDetails[0].id, 'server-pipeline-session')
    assert.equal(payload.sessionDetails[0].messages[0].content, 'Pipeline input')
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
