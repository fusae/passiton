import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import WebSocket from 'ws'
import { Router } from '../router.js'
import { createServer, registerPersistedUserAgents } from '../server.js'
import * as state from '../state.js'
import type { Adapter, AdapterSendOpts, Session } from '../types.js'
import { encryptSecret } from '../keyvault.js'

class StubAgentCatalog {
  constructor(private readonly agents?: unknown[]) {}

  setLocalCliAgentsEnabled(): void {}

  setConfiguredAgents(): void {}

  async discover(): Promise<unknown[]> {
    return []
  }

  configuredAgentConfigs(): Record<string, never> {
    return {}
  }

  async listAgents(): Promise<unknown[]> {
    return this.agents ?? [
      {
        name: 'codex',
        adapter: 'codex',
        source: 'configured',
        healthy: true,
        verified: true,
        availableForSessions: true,
        command: 'codex',
      },
      {
        name: 'gemini-cli',
        adapter: 'gemini-cli',
        source: 'configured',
        healthy: true,
        verified: false,
        availableForSessions: false,
        command: 'gemini',
      },
    ]
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
  options: { allowRegistration?: boolean; configureRouter?: (router: Router) => void; agentCatalog?: StubAgentCatalog } = { allowRegistration: true }
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'turing-server-'))
  const originalEnv = {
    PASSITON_JWT_SECRET: process.env.PASSITON_JWT_SECRET,
    PASSITON_ALLOW_REGISTRATION: process.env.PASSITON_ALLOW_REGISTRATION,
    PASSITON_ALLOWED_WORKSPACES: process.env.PASSITON_ALLOWED_WORKSPACES,
    PASSITON_ALLOWED_ORIGINS: process.env.PASSITON_ALLOWED_ORIGINS,
    PASSITON_HOME: process.env.PASSITON_HOME,
    TURING_HOME: process.env.TURING_HOME,
  }
  process.env.PASSITON_HOME = dir
  delete process.env.TURING_HOME
  process.env.PASSITON_JWT_SECRET = 'server-test-jwt-secret'
  if (options.allowRegistration !== false) {
    process.env.PASSITON_ALLOW_REGISTRATION = '1'
  }
  process.env.PASSITON_ALLOWED_WORKSPACES ??= tmpdir()
  state.initDb(join(dir, 'turing.db'))
  const router = new Router()
  options.configureRouter?.(router)
  const server = createServer(router, 0, (options.agentCatalog ?? new StubAgentCatalog()) as never)
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
    restoreEnv(originalEnv)
  }
}

function restoreEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
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

test('ops endpoints report task failures and targeted diagnostics', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'ops@example.com')
    state.createTask({
      id: 'ops-task-1',
      userId: auth.userId,
      agent: { adapter: 'opencode' },
      prompt: 'inspect',
    })
    state.updateTask('ops-task-1', {
      status: 'error',
      errorMessage: '[opencode] idle timed out after 600000ms',
      finishedAt: Date.now(),
    }, auth.userId)

    const statusResponse = await fetch(`${baseUrl}/api/ops/status`, { headers: authHeaders(auth.token) })
    assert.equal(statusResponse.status, 200)
    const status = await statusResponse.json() as {
      ok: boolean
      counts: { critical: number }
      issues: Array<{ target?: { kind: string; id: string }; recommendation: string }>
    }
    assert.equal(status.ok, false)
    assert.equal(status.counts.critical, 1)
    assert.equal(status.issues[0]?.target?.id, 'ops-task-1')
    assert.match(status.issues[0]?.recommendation || '', /Timeout issue/)

    const fakeApi = http.createServer((_, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        choices: [{ message: { content: 'LLM answer: idle timeout' }, finish_reason: 'stop' }],
      }))
    })
    await new Promise<void>((resolve) => fakeApi.listen(0, resolve))
    const fakeAddress = fakeApi.address()
    if (!fakeAddress || typeof fakeAddress === 'string') throw new Error('fake API did not start')
    try {
      state.createUserAgent({
        id: 'ops-assistant',
        userId: auth.userId,
        name: 'ops-deepseek',
        adapter: 'custom-api',
        model: 'deepseek-chat',
        baseUrl: `http://127.0.0.1:${fakeAddress.port}/chat/completions`,
        ...encryptSecret(auth.userId, 'sk-test'),
      })
      const diagnoseResponse = await fetch(`${baseUrl}/api/ops/diagnose`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'why failed', target: { kind: 'task', id: 'ops-task-1' } }),
      })
      assert.equal(diagnoseResponse.status, 200)
      const diagnose = await diagnoseResponse.json() as { issues: Array<{ target?: { id: string } }> }
      assert.equal(diagnose.issues.length, 1)
      assert.equal(diagnose.issues[0]?.target?.id, 'ops-task-1')

      const modelDiagnoseResponse = await fetch(`${baseUrl}/api/ops/diagnose`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({ question: '为什么失败', target: { kind: 'task', id: 'ops-task-1' } }),
      })
      assert.equal(modelDiagnoseResponse.status, 200)
      const modelDiagnose = await modelDiagnoseResponse.json() as { answer?: string; answerSource?: string }
      assert.equal(modelDiagnose.answerSource, 'ops-deepseek')
      assert.match(modelDiagnose.answer || '', /LLM answer/)
    } finally {
      await new Promise<void>((resolve) => fakeApi.close(() => resolve()))
    }

    const unconfirmed = await fetch(`${baseUrl}/api/ops/action`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({ actionId: 'create_repair_task', target: { kind: 'task', id: 'ops-task-1' } }),
    })
    assert.equal(unconfirmed.status, 400)

    const actionResponse = await fetch(`${baseUrl}/api/ops/action`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({ actionId: 'create_repair_task', target: { kind: 'task', id: 'ops-task-1' }, confirmed: true }),
    })
    assert.equal(actionResponse.status, 200)
    const action = await actionResponse.json() as { task: { id: string; prompt: string } }
    assert.ok(action.task.id)
    assert.match(action.task.prompt, /Passiton Ops/)
  }, {
    configureRouter(router) {
      router.registerAdapter(new StubAdapter('opencode', async () => '[DONE] repaired'))
    },
  })
})

test('GET /health returns unauthenticated liveness payload', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
  })
})

test('CORS allows local origins and requests without an Origin header', async () => {
  await withServer(async (baseUrl) => {
    const local = await fetch(`${baseUrl}/health`, { headers: { origin: 'http://localhost:5173' } })
    assert.equal(local.status, 200)
    assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:5173')
    assert.equal(local.headers.get('access-control-allow-credentials'), null)

    const noOrigin = await fetch(`${baseUrl}/health`)
    assert.equal(noOrigin.status, 200)
    assert.equal(noOrigin.headers.get('access-control-allow-origin'), null)
  })
})

test('CORS rejects unknown origins and supports configured origins', async () => {
  await withServer(async (baseUrl) => {
    const rejected = await fetch(`${baseUrl}/health`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
      },
    })
    assert.equal(rejected.status, 403)
    assert.equal(rejected.headers.get('access-control-allow-origin'), null)
  })

  const previousOrigins = process.env.PASSITON_ALLOWED_ORIGINS
  try {
    process.env.PASSITON_ALLOWED_ORIGINS = 'https://app.example'
    await withServer(async (baseUrl) => {
      const allowed = await fetch(`${baseUrl}/health`, {
        method: 'OPTIONS',
        headers: {
          origin: 'https://app.example',
          'access-control-request-method': 'POST',
        },
      })
      assert.equal(allowed.status, 204)
      assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.example')
    })
  } finally {
    if (previousOrigins === undefined) {
      delete process.env.PASSITON_ALLOWED_ORIGINS
    } else {
      process.env.PASSITON_ALLOWED_ORIGINS = previousOrigins
    }
  }
})

test('auth cookies are Secure when request is HTTPS behind a proxy', async () => {
  await withServer(async (baseUrl) => {
    const local = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'cookie-local@example.com', password: 'password123' }),
    })
    assert.equal(local.status, 201)
    assert.match(local.headers.get('set-cookie') ?? '', /HttpOnly/)
    assert.doesNotMatch(local.headers.get('set-cookie') ?? '', /;\s*Secure\b/)

    const proxied = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ email: 'cookie-https@example.com', password: 'password123' }),
    })
    assert.equal(proxied.status, 201)
    assert.match(proxied.headers.get('set-cookie') ?? '', /;\s*Secure\b/)
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
    const payload = await response.json() as { createSession: { path: string }; handoffTask: { path: string }; agentManagement: { createApiAgent: { path: string }; createCliAgent: { path: string; body: { adapter: string } } } }
    assert.equal(payload.createSession.path, '/api/sessions')
    assert.equal(payload.handoffTask.path, '/api/tasks/:id/handoff')
    assert.ok(payload.agentManagement, 'docs include agentManagement section')
    assert.equal(payload.agentManagement.createApiAgent.path, '/api/agents')
    assert.equal(payload.agentManagement.createCliAgent.path, '/api/config/agents')
    assert.equal(payload.agentManagement.createCliAgent.body.adapter, 'custom-cli')
  })
})

test('POST /api/config/agents accepts custom CLI agent config', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'custom-cli@example.com')
    const name = `custom-cli-test-${Date.now()}`
    const response = await fetch(`${baseUrl}/api/config/agents`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        adapter: 'custom-cli',
        command: process.execPath,
        args: ['-e', 'process.stdout.write(process.argv[1])', '{prompt}'],
        env: { PASSITON_CUSTOM_TEST: '1' },
        timeout: 10_000,
        priority: 2,
      }),
    })

    assert.equal(response.status, 201)
    const payload = await response.json() as Record<string, any>
    assert.equal(payload.agents[name].adapter, 'custom-cli')
    assert.deepEqual(payload.agents[name].args, ['-e', 'process.stdout.write(process.argv[1])', '{prompt}'])
    assert.equal(payload.agents[name].priority, 2)
  })
})

test('POST /api/config/agents rejects invalid custom CLI config', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'custom-cli-invalid@example.com')
    const missingPrompt = await fetch(`${baseUrl}/api/config/agents`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'missing-prompt',
        adapter: 'custom-cli',
        command: process.execPath,
        args: ['-e', 'process.stdout.write("no prompt")'],
      }),
    })
    assert.equal(missingPrompt.status, 400)
    assert.match(await missingPrompt.text(), /\{prompt\}/)

    const emptyCommand = await fetch(`${baseUrl}/api/config/agents`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'empty-command',
        adapter: 'custom-cli',
        command: '',
        args: ['{prompt}'],
      }),
    })
    assert.equal(emptyCommand.status, 400)
    assert.match(await emptyCommand.text(), /command/)

    const invalidPriority = await fetch(`${baseUrl}/api/config/agents`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'invalid-priority',
        adapter: 'custom-cli',
        command: process.execPath,
        args: ['{prompt}'],
        priority: 0,
      }),
    })
    assert.equal(invalidPriority.status, 400)
    assert.match(await invalidPriority.text(), /priority.*positive integer.*lower = higher priority/i)
  })
})

test('PUT /api/config rejects all unsafe allowedWorkspaces entries', async () => {
  await withServer(async (baseUrl) => {
    delete process.env.PASSITON_ALLOWED_WORKSPACES
    const auth = await register(baseUrl, 'config-all-unsafe@example.com')
    const response = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        defaults: { maxRounds: 20, mode: 'collaborate' },
        policy: { allowedWorkspaces: [tmpdir()] },
      }),
    })

    assert.equal(response.status, 400)
    const payload = await response.json() as { error: string }
    assert.match(payload.error, /rejected .*temp directory is not a safe workspace/)
  })
})

test('PUT /api/config keeps valid allowedWorkspaces entries and warns about dropped entries', async () => {
  await withServer(async (baseUrl) => {
    delete process.env.PASSITON_ALLOWED_WORKSPACES
    const auth = await register(baseUrl, 'config-mixed-workspaces@example.com')
    const project = join(process.cwd(), 'example-project')
    const response = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        defaults: { maxRounds: 20, mode: 'collaborate' },
        policy: { allowedWorkspaces: [tmpdir(), project] },
      }),
    })

    assert.equal(response.status, 200)
    const payload = await response.json() as { policy: { allowedWorkspaces: string[] }; warning?: string }
    assert.deepEqual(payload.policy.allowedWorkspaces, [project])
    assert.match(payload.warning ?? '', /Dropped unsafe allowedWorkspaces entries/)
    assert.match(payload.warning ?? '', /temp directory is not a safe workspace/)
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
    assert.equal(payload.user.email, 'local@passiton.local')

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
        PASSITON_BASE_URL: baseUrl,
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
  process.env.PASSITON_ALLOWED_WORKSPACES = allowed
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
    delete process.env.PASSITON_ALLOWED_WORKSPACES
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
        assert.match(opts?.systemPrompt ?? '', /lead agent for a task inside Passiton/)
        assert.match(opts?.systemPrompt ?? '', /requires delegation/)
        assert.match(opts?.systemPrompt ?? '', /markdown only/)
        return '[RESULT]article ready[/RESULT]'
      }))
    },
  })
})

test('POST /api/tasks without agent picks the highest-priority ready agent', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'tasks-default-ready@example.com')
    for (const item of [
      { name: 'slow-agent', priority: 5 },
      { name: 'fast-agent', priority: 1 },
    ]) {
      const response = await fetch(`${baseUrl}/api/config/agents`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({
          name: item.name,
          adapter: 'custom-cli',
          command: process.execPath,
          args: ['{prompt}'],
          priority: item.priority,
        }),
      })
      assert.equal(response.status, 201)
    }

    const create = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'default agent' }),
    })
    assert.equal(create.status, 201)
    const task = await create.json() as { agent: { adapter: string } }
    assert.equal(task.agent.adapter, 'fast-agent')
  }, {
    configureRouter: (router) => {
      router.registerAdapter(new StubAdapter('fast-agent', async () => '[RESULT]fast[/RESULT]'))
      router.registerAdapter(new StubAdapter('slow-agent', async () => '[RESULT]slow[/RESULT]'))
    },
    agentCatalog: new StubAgentCatalog([
      { name: 'slow-agent', adapter: 'custom-cli', source: 'configured', healthy: true, verified: true, availableForSessions: true, command: process.execPath },
      { name: 'fast-agent', adapter: 'custom-cli', source: 'configured', healthy: true, verified: true, availableForSessions: true, command: process.execPath },
    ]),
  })
})

test('POST /api/tasks without agent falls back to unverified when no ready agent', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'tasks-default-unverified@example.com')
    for (const item of [
      { name: 'unverified-b', priority: 4 },
      { name: 'unverified-a', priority: 2 },
    ]) {
      const response = await fetch(`${baseUrl}/api/config/agents`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({
          name: item.name,
          adapter: 'custom-cli',
          command: process.execPath,
          args: ['{prompt}'],
          priority: item.priority,
        }),
      })
      assert.equal(response.status, 201)
    }

    const create = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'default unverified' }),
    })
    assert.equal(create.status, 201)
    const task = await create.json() as { agent: { adapter: string } }
    assert.equal(task.agent.adapter, 'unverified-a')
  }, {
    configureRouter: (router) => {
      router.registerAdapter(new StubAdapter('unverified-a', async () => '[RESULT]a[/RESULT]'))
      router.registerAdapter(new StubAdapter('unverified-b', async () => '[RESULT]b[/RESULT]'))
    },
    agentCatalog: new StubAgentCatalog([
      { name: 'unverified-b', adapter: 'custom-cli', source: 'configured', healthy: true, verified: false, availableForSessions: true, command: process.execPath },
      { name: 'unverified-a', adapter: 'custom-cli', source: 'configured', healthy: true, verified: false, availableForSessions: true, command: process.execPath },
    ]),
  })
})

test('POST /api/tasks without agent returns 400 when none usable', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'tasks-default-none@example.com')
    const response = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'no agent' }),
    })
    assert.equal(response.status, 400)
    assert.match(await response.text(), /No agent specified and no usable agent found/)
  }, {
    agentCatalog: new StubAgentCatalog([
      { name: 'broken-agent', adapter: 'custom-cli', source: 'configured', healthy: false, verified: false, availableForSessions: false, command: process.execPath },
    ]),
  })
})

test('POST /api/tasks without agent skips non-filesystem candidates for cwd tasks', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'turing-default-cwd-'))
  try {
    await withServer(async (baseUrl) => {
      const auth = await register(baseUrl, 'tasks-default-cwd@example.com')
      const local = await fetch(`${baseUrl}/api/config/agents`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'zzz-local',
          adapter: 'custom-cli',
          command: process.execPath,
          args: ['{prompt}'],
          priority: 10,
        }),
      })
      assert.equal(local.status, 201)
      state.createUserAgent({
        id: 'default-cwd-api-agent',
        userId: auth.userId,
        name: 'aaa-api',
        adapter: 'openai-api',
        model: 'gpt-test',
        ...encryptSecret(auth.userId, 'sk-test'),
      })

      const create = await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'cwd default', cwd }),
      })
      assert.equal(create.status, 201)
      const task = await create.json() as { agent: { adapter: string } }
      assert.equal(task.agent.adapter, 'zzz-local')
    }, {
      configureRouter: (router) => {
        router.registerAdapter(new StubAdapter('zzz-local', async () => '[RESULT]local[/RESULT]'))
      },
      agentCatalog: new StubAgentCatalog([
        { name: 'zzz-local', adapter: 'custom-cli', source: 'configured', healthy: true, verified: false, availableForSessions: true, command: process.execPath },
      ]),
    })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('POST /api/tasks/:id/handoff creates a continuation task from an errored cwd task', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'task-handoff@example.com')
    const cwd = mkdtempSync(join(tmpdir(), 'turing-handoff-'))
    try {
      state.createTask({
        id: 'handoff-source',
        userId: auth.userId,
        agent: { adapter: 'opencode' },
        prompt: 'Finish the feature',
        cwd,
      })
      state.updateTask('handoff-source', {
        status: 'error',
        errorMessage: 'provider quota exhausted',
        lastAgentOutput: 'implemented server path\nleft frontend pending',
        workspaceState: {
          dirty: true,
          changedFileCount: 2,
          files: ['M src/server.ts', 'M src/web/app.js'],
          preexistingFileCount: 1,
          preexistingFiles: ['M README.md'],
        },
      }, auth.userId)

      const response = await fetch(`${baseUrl}/api/tasks/handoff-source/handoff`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({ agent: { adapter: 'codex' } }),
      })
      assert.equal(response.status, 201)
      const created = await response.json() as { status: string; agent: { adapter: string }; prompt: string; cwd: string; metadata?: { continuedFromTaskId?: string } }
      assert.equal(created.status, 'queued')
      assert.equal(created.agent.adapter, 'codex')
      assert.equal(created.cwd, cwd)
      assert.equal(created.metadata?.continuedFromTaskId, 'handoff-source')
      assert.match(created.prompt, /Finish the feature/)
      assert.match(created.prompt, /provider quota exhausted/)
      assert.match(created.prompt, /implemented server path/)
      assert.match(created.prompt, /M src\/server\.ts/)
      assert.match(created.prompt, /Pre-existing files count: 1/)
      assert.match(created.prompt, /Verify the current state first/)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

test('POST /api/tasks/:id/handoff accepts unverified agents and rejects nonexistent agents', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'task-handoff-unverified@example.com')
    state.createTask({
      id: 'handoff-unverified-source',
      userId: auth.userId,
      agent: { adapter: 'opencode' },
      prompt: 'finish without cwd',
    })
    state.updateTask('handoff-unverified-source', { status: 'error', errorMessage: 'failed' }, auth.userId)

    const accepted = await fetch(`${baseUrl}/api/tasks/handoff-unverified-source/handoff`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({ agent: { adapter: 'gemini-cli' } }),
    })
    assert.equal(accepted.status, 201)
    const created = await accepted.json() as { agent: { adapter: string }; metadata?: { continuedFromTaskId?: string } }
    assert.equal(created.agent.adapter, 'gemini-cli')
    assert.equal(created.metadata?.continuedFromTaskId, 'handoff-unverified-source')

    const rejected = await fetch(`${baseUrl}/api/tasks/handoff-unverified-source/handoff`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({ agent: { adapter: 'missing-agent' } }),
    })
    assert.equal(rejected.status, 400)
    const payload = await rejected.json() as { error: string }
    assert.match(payload.error, /Agent not found: missing-agent/)
  })
})

test('POST /api/tasks/:id/handoff rejects running source tasks', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'task-handoff-running@example.com')
    state.createTask({
      id: 'handoff-running',
      userId: auth.userId,
      agent: { adapter: 'opencode' },
      prompt: 'still running',
    })
    state.updateTask('handoff-running', { status: 'running' }, auth.userId)

    const response = await fetch(`${baseUrl}/api/tasks/handoff-running/handoff`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({ agent: { adapter: 'codex' } }),
    })
    assert.equal(response.status, 400)
  })
})

test('POST /api/tasks/:id/handoff enforces filesystem-capable agents for cwd tasks', async () => {
  const fakeApi = http.createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }))
  })
  await new Promise<void>((resolve) => fakeApi.listen(0, resolve))
  const fakeAddress = fakeApi.address()
  if (!fakeAddress || typeof fakeAddress === 'string') throw new Error('fake API did not start')

  try {
    await withServer(async (baseUrl) => {
      const auth = await register(baseUrl, 'task-handoff-capability@example.com')
      const cwd = mkdtempSync(join(tmpdir(), 'turing-handoff-cap-'))
      try {
        state.createUserAgent({
          id: 'api-handoff-agent',
          userId: auth.userId,
          name: 'api-helper',
          adapter: 'custom-api',
          model: 'gpt-test',
          baseUrl: `http://127.0.0.1:${fakeAddress.port}/chat/completions`,
          ...encryptSecret(auth.userId, 'sk-test1234'),
        })
        state.createTask({
          id: 'handoff-cwd-source',
          userId: auth.userId,
          agent: { adapter: 'opencode' },
          prompt: 'finish cwd work',
          cwd,
        })
        state.updateTask('handoff-cwd-source', { status: 'error', errorMessage: 'failed' }, auth.userId)

        const agents = await fetch(`${baseUrl}/api/agents?refresh=1`, { headers: authHeaders(auth.token) })
        assert.equal(agents.status, 200)

        const response = await fetch(`${baseUrl}/api/tasks/handoff-cwd-source/handoff`, {
          method: 'POST',
          headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
          body: JSON.stringify({ agent: { adapter: 'api-helper' } }),
        })
        assert.equal(response.status, 400)
        const payload = await response.json() as { error: string }
        assert.match(payload.error, /filesystem-capable/)
      } finally {
        rmSync(cwd, { recursive: true, force: true })
      }
    })
  } finally {
    await new Promise<void>((resolve) => fakeApi.close(() => resolve()))
  }
})

test('POST /mcp exposes tools and can create a task', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'mcp@example.com')
    const projectDir = mkdtempSync(join(tmpdir(), 'turing-mcp-task-'))

    try {
      const initialize = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      })
      assert.equal(initialize.status, 200)
      assert.equal((await initialize.json() as { result: { serverInfo: { name: string } } }).result.serverInfo.name, 'passiton')

      const tools = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      })
      assert.equal(tools.status, 200)
      const toolsPayload = await tools.json() as { result: { resultType: string; tools: Array<{ name: string }> } }
      assert.equal(toolsPayload.result.resultType, 'complete')
      assert.ok(toolsPayload.result.tools.some((tool) => tool.name === 'passiton_create_task'))

      const created = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'passiton_create_task',
            arguments: {
              agent: 'opencode',
              prompt: 'write mcp article',
              cwd: projectDir,
              permissionMode: 'trusted',
              idempotencyKey: 'mcp-task-key',
            },
          },
        }),
      })
      assert.equal(created.status, 200)
      const createPayload = await created.json() as { result: { resultType: string; content: Array<{ type: string; text: string }>; isError: boolean } }
      assert.equal(createPayload.result.resultType, 'complete')
      assert.equal(createPayload.result.isError, false)
      const createdData = JSON.parse(createPayload.result.content[0]!.text) as { task: { id: string; status: string; permissionMode: string }; reused: boolean }
      const taskId = createdData.task.id
      assert.equal(createdData.task.status, 'queued')
      assert.equal(createdData.task.permissionMode, 'trusted')
      assert.equal(createdData.reused, false)

      const duplicate = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'passiton_create_task',
            arguments: {
              agent: 'opencode',
              prompt: 'write mcp article',
              cwd: projectDir,
              permissionMode: 'trusted',
              idempotencyKey: 'mcp-task-key',
            },
          },
        }),
      })
      const duplicatePayload = await duplicate.json() as { result: { content: Array<{ text: string }> } }
      const duplicateData = JSON.parse(duplicatePayload.result.content[0]!.text) as { task: { id: string }; reused: boolean }
      assert.equal(duplicateData.task.id, taskId)
      assert.equal(duplicateData.reused, true)

      await waitFor(async () => {
        const response = await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 5,
            method: 'tools/call',
            params: { name: 'passiton_get_task_result', arguments: { id: taskId } },
          }),
        })
        const payload = await response.json() as { result: { content: Array<{ text: string }> } }
        const data = JSON.parse(payload.result.content[0]!.text) as { task: { status: string; result?: string; summary?: string; hasResult?: boolean } }
        if (data.task.status === 'done') {
          assert.equal(data.task.summary, 'mcp ready')
          assert.equal(data.task.hasResult, true)
          assert.equal(data.task.result, undefined)
        }
        return data.task.status === 'done'
      })

      const fullResult = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: { name: 'passiton_get_task_result', arguments: { id: taskId, includeOutput: true, maxChars: 1000 } },
        }),
      })
      const fullPayload = await fullResult.json() as { result: { content: Array<{ text: string }> } }
      const fullData = JSON.parse(fullPayload.result.content[0]!.text) as { task: { result?: string } }
      assert.equal(fullData.task.result, 'mcp ready')
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  }, {
    allowRegistration: true,
    configureRouter: (router) => {
      router.registerAdapter(new StubAdapter('opencode', async (session, message) => {
        assert.equal(message, 'write mcp article')
        assert.equal(session.permissionMode, 'trusted')
        return '[RESULT]mcp ready[/RESULT]'
      }))
    },
  })
})

test('POST /mcp reuses duplicate session idempotency keys', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'mcp-session-idempotency@example.com')

    const create = async (id: number) => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: {
            name: 'passiton_create_session',
            arguments: {
              from: 'opencode',
              to: 'codex',
              initialPrompt: 'build once',
              mode: 'review',
              maxRounds: 2,
              idempotencyKey: 'mcp-session-key',
            },
          },
        }),
      })
      assert.equal(response.status, 200)
      const payload = await response.json() as { result: { content: Array<{ text: string }> } }
      return JSON.parse(payload.result.content[0]!.text) as { session: { id: string }; reused: boolean }
    }

    const first = await create(1)
    const second = await create(2)
    assert.equal(second.session.id, first.session.id)
    assert.equal(first.reused, false)
    assert.equal(second.reused, true)
  }, {
    allowRegistration: true,
    configureRouter: (router) => {
      router.registerAdapter(new StubAdapter('opencode', async () => '[DONE]'))
      router.registerAdapter(new StubAdapter('codex', async () => '[DONE]'))
    },
  })
})

test('POST /mcp reuses duplicate sessions without explicit idempotency keys', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'mcp-session-dedupe@example.com')

    const create = async (id: number) => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: {
            name: 'passiton_create_session',
            arguments: {
              from: 'opencode',
              to: 'codex',
              initialPrompt: 'build once without key',
              mode: 'review',
              maxRounds: 2,
            },
          },
        }),
      })
      assert.equal(response.status, 200)
      const payload = await response.json() as { result: { content: Array<{ text: string }> } }
      return JSON.parse(payload.result.content[0]!.text) as { session: { id: string }; reused: boolean }
    }

    const first = await create(1)
    await waitFor(async () => {
      const response = await fetch(`${baseUrl}/api/sessions/${first.session.id}`, { headers: authHeaders(auth.token) })
      const session = await response.json() as { status: string }
      return session.status === 'paused'
    })
    const second = await create(2)
    assert.equal(second.session.id, first.session.id)
    assert.equal(first.reused, false)
    assert.equal(second.reused, true)
  }, {
    allowRegistration: true,
    configureRouter: (router) => {
      router.registerAdapter(new StubAdapter('opencode', async () => '[DONE]'))
      router.registerAdapter(new StubAdapter('codex', async () => {
        throw new Error('quota exceeded')
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
    assert.ok(payload.tools.includes('passiton_create_task'))
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

test('dedicated ops model is encrypted, selected, and delete reverts to fallback', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'ops-model@example.com')
    const fakeApi = http.createServer((_, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        choices: [{ message: { content: 'Ops LLM answer' }, finish_reason: 'stop' }],
      }))
    })
    await new Promise<void>((resolve) => fakeApi.listen(0, resolve))
    const fakeAddress = fakeApi.address()
    if (!fakeAddress || typeof fakeAddress === 'string') throw new Error('fake API did not start')
    const baseUrlApi = `http://127.0.0.1:${fakeAddress.port}/chat/completions`
    try {
      const create = await fetch(`${baseUrl}/api/ops/model`, {
        method: 'PUT',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({
          adapter: 'custom-api',
          model: 'ops-test',
          baseUrl: baseUrlApi,
          apiKey: 'sk-ops-secret',
        }),
      })
      assert.equal(create.status, 200)
      const created = await create.json() as { configured: boolean; effective?: string; keyMasked?: string }
      assert.equal(created.configured, true)
      assert.equal(created.effective, 'dedicated')
      assert.equal(created.keyMasked, 'sk-...cret')
      assert.notEqual(state.getUserAgent(auth.userId, '__ops__')?.encryptedKey, 'sk-ops-secret')

      const agents = await fetch(`${baseUrl}/api/agents`, { headers: authHeaders(auth.token) })
      assert.equal(agents.status, 200)
      const agentPayload = await agents.json() as Array<{ name: string }>
      assert.ok(!agentPayload.some((agent) => agent.name === '__ops__'))

      const diagnose = await fetch(`${baseUrl}/api/ops/diagnose`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({ question: '为什么失败' }),
      })
      assert.equal(diagnose.status, 200)
      const dedicatedAnswer = await diagnose.json() as { answerSource?: string; answer?: string; answerError?: string }
      assert.equal(dedicatedAnswer.answerSource, 'Ops model')
      assert.match(dedicatedAnswer.answer || '', /Ops LLM answer/)

      state.createUserAgent({
        id: 'ops-fallback',
        userId: auth.userId,
        name: 'ops-fallback',
        adapter: 'custom-api',
        model: 'fallback-test',
        baseUrl: baseUrlApi,
        ...encryptSecret(auth.userId, 'sk-fallback-secret'),
      })

      const remove = await fetch(`${baseUrl}/api/ops/model`, {
        method: 'DELETE',
        headers: authHeaders(auth.token),
      })
      assert.equal(remove.status, 200)
      assert.equal(state.getUserAgent(auth.userId, '__ops__'), undefined)

      const fallbackDiagnose = await fetch(`${baseUrl}/api/ops/diagnose`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({ question: '为什么失败' }),
      })
      assert.equal(fallbackDiagnose.status, 200)
      const fallbackAnswer = await fallbackDiagnose.json() as { answerSource?: string; answer?: string }
      assert.equal(fallbackAnswer.answerSource, 'ops-fallback')
      assert.match(fallbackAnswer.answer || '', /Ops LLM answer/)
    } finally {
      await new Promise<void>((resolve) => fakeApi.close(() => resolve()))
    }
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
    const fakeApi = http.createServer((_, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }))
    })
    await new Promise<void>((resolve) => fakeApi.listen(0, resolve))
    const fakeAddress = fakeApi.address()
    if (!fakeAddress || typeof fakeAddress === 'string') throw new Error('fake API did not start')
    const keyCreate = await fetch(`${baseUrl}/api/keys`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        name: 'OpenAI Vault',
        key: 'sk-test1234',
      }),
    })
    try {
      assert.equal(keyCreate.status, 201)
      const key = await keyCreate.json() as { id: string }
      const create = await fetch(`${baseUrl}/api/agents`, {
        method: 'POST',
        headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'ops-openai',
          adapter: 'custom-api',
          keyId: key.id,
          model: 'gpt-test',
          baseUrl: `http://127.0.0.1:${fakeAddress.port}/chat/completions`,
        }),
      })
      assert.equal(create.status, 201)
      const created = await create.json() as Array<{ name: string; status: string; keyMasked: string }>
      const createdAgent = created.find((agent) => agent.name === 'ops-openai')
      assert.ok(createdAgent)
      assert.equal(createdAgent.status, 'ready')
      assert.equal(createdAgent.keyMasked, 'sk-...1234')
      assert.notEqual(state.getUserAgent(auth.userId, 'ops-openai')?.encryptedKey, 'sk-test1234')

      const remove = await fetch(`${baseUrl}/api/agents/ops-openai`, {
        method: 'DELETE',
        headers: authHeaders(auth.token),
      })
      assert.equal(remove.status, 200)
      assert.equal(state.getUserAgent(auth.userId, 'ops-openai'), undefined)
    } finally {
      await new Promise<void>((resolve) => fakeApi.close(() => resolve()))
    }
  })
})

test('provider keys include vault keys and assistant-linked keys', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'provider-keys@example.com')
    const fakeApi = http.createServer((_, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }))
    })
    await new Promise<void>((resolve) => fakeApi.listen(0, resolve))
    const fakeAddress = fakeApi.address()
    if (!fakeAddress || typeof fakeAddress === 'string') throw new Error('fake API did not start')
    const keyCreate = await fetch(`${baseUrl}/api/keys`, {
      method: 'POST',
      headers: { ...authHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        name: 'OpenAI Vault',
        key: 'sk-vault1234',
      }),
    })
    try {
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
          name: 'ops-openai',
          adapter: 'custom-api',
          keyId: vaultKey.id,
          model: 'gpt-test',
          baseUrl: `http://127.0.0.1:${fakeAddress.port}/chat/completions`,
        }),
      })
      assert.equal(createAgent.status, 201)

      const listed = await fetch(`${baseUrl}/api/keys`, { headers: authHeaders(auth.token) })
      assert.equal(listed.status, 200)
      const payload = await listed.json() as Array<{ source: string; name: string; maskedKey: string; readOnly?: boolean; usedBy?: string[] }>
      assert.ok(payload.some((key) => key.source === 'vault' && key.name === 'OpenAI Vault' && key.maskedKey === '****1234'))
      assert.ok(payload.some((key) => key.source === 'assistant' && key.name === 'ops-openai key' && key.readOnly && key.usedBy?.includes('ops-openai')))
      assert.ok(!JSON.stringify(payload).includes('sk-vault1234'))
    } finally {
      await new Promise<void>((resolve) => fakeApi.close(() => resolve()))
    }
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

test('GET /api/pipelines supports limit and offset pagination', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'pipelines-pagination@example.com')
    // Create 5 pipelines; insertion order means the last-created sorts first
    // (ORDER BY created_at DESC).
    for (let i = 0; i < 5; i++) {
      state.createPipeline({
        id: `page-pipeline-${i}`,
        userId: auth.userId,
        name: `Page Pipeline ${i}`,
        sessions: [],
      })
    }

    // No limit → all returned (backward-compatible default).
    const all = await fetch(`${baseUrl}/api/pipelines`, { headers: authHeaders(auth.token) })
    assert.equal(all.status, 200)
    const allPayload = await all.json() as Array<{ id: string }>
    assert.equal(allPayload.length, 5)

    // limit=2 → only the two newest.
    const limited = await fetch(`${baseUrl}/api/pipelines?limit=2`, { headers: authHeaders(auth.token) })
    const limitedPayload = await limited.json() as Array<{ id: string }>
    assert.equal(limitedPayload.length, 2)
    assert.deepEqual(limitedPayload.map((p) => p.id), ['page-pipeline-4', 'page-pipeline-3'])

    // offset=2 skips the two newest, returns the next two.
    const offset = await fetch(`${baseUrl}/api/pipelines?limit=2&offset=2`, { headers: authHeaders(auth.token) })
    const offsetPayload = await offset.json() as Array<{ id: string }>
    assert.equal(offsetPayload.length, 2)
    assert.deepEqual(offsetPayload.map((p) => p.id), ['page-pipeline-2', 'page-pipeline-1'])

    // offset beyond the set returns an empty array (not an error).
    const over = await fetch(`${baseUrl}/api/pipelines?limit=2&offset=10`, { headers: authHeaders(auth.token) })
    const overPayload = await over.json() as Array<{ id: string }>
    assert.equal(overPayload.length, 0)
  })
})

test('GET /api/pipelines limit only returns the requesting user pipelines', async () => {
  await withServer(async (baseUrl) => {
    const owner = await register(baseUrl, 'pipelines-owner@example.com')
    const other = await register(baseUrl, 'pipelines-other@example.com')
    for (let i = 0; i < 3; i++) {
      state.createPipeline({ id: `owner-pipe-${i}`, userId: owner.userId, name: `Owner ${i}`, sessions: [] })
    }
    state.createPipeline({ id: `other-pipe-0`, userId: other.userId, name: 'Other', sessions: [] })

    const res = await fetch(`${baseUrl}/api/pipelines?limit=2`, { headers: authHeaders(owner.token) })
    const payload = await res.json() as Array<{ id: string }>
    assert.equal(payload.length, 2)
    assert.ok(payload.every((p) => p.id.startsWith('owner-pipe-')), 'no cross-user leakage')
  })
})

test('GET /api/tasks supports limit and offset pagination', async () => {
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'tasks-pagination@example.com')
    // Create 5 tasks; insertion order means the last-created sorts first
    // (ORDER BY created_at DESC).
    for (let i = 0; i < 5; i++) {
      state.createTask({
        id: `page-task-${i}`,
        userId: auth.userId,
        agent: { adapter: 'stub' },
        prompt: `Page Task ${i}`,
        cwd: '/tmp',
      })
    }

    // No limit → all returned (backward-compatible default).
    const all = await fetch(`${baseUrl}/api/tasks`, { headers: authHeaders(auth.token) })
    assert.equal(all.status, 200)
    const allPayload = await all.json() as Array<{ id: string }>
    assert.equal(allPayload.length, 5)

    // limit=2 → only the two newest.
    const limited = await fetch(`${baseUrl}/api/tasks?limit=2`, { headers: authHeaders(auth.token) })
    const limitedPayload = await limited.json() as Array<{ id: string }>
    assert.equal(limitedPayload.length, 2)
    assert.deepEqual(limitedPayload.map((t) => t.id), ['page-task-4', 'page-task-3'])

    // offset=2 skips the two newest, returns the next two.
    const offset = await fetch(`${baseUrl}/api/tasks?limit=2&offset=2`, { headers: authHeaders(auth.token) })
    const offsetPayload = await offset.json() as Array<{ id: string }>
    assert.equal(offsetPayload.length, 2)
    assert.deepEqual(offsetPayload.map((t) => t.id), ['page-task-2', 'page-task-1'])

    // No overlap between the first page and the second page.
    const firstPage = new Set(limitedPayload.map((t) => t.id))
    assert.ok(offsetPayload.every((t) => !firstPage.has(t.id)), 'no overlap between pages')

    // offset beyond the set returns an empty array (not an error).
    const over = await fetch(`${baseUrl}/api/tasks?limit=2&offset=10`, { headers: authHeaders(auth.token) })
    const overPayload = await over.json() as Array<{ id: string }>
    assert.equal(overPayload.length, 0)
  })
})

test('GET /api/tasks limit+offset only returns the requesting user tasks', async () => {
  await withServer(async (baseUrl) => {
    const owner = await register(baseUrl, 'tasks-owner@example.com')
    const other = await register(baseUrl, 'tasks-other@example.com')
    for (let i = 0; i < 3; i++) {
      state.createTask({ id: `owner-task-${i}`, userId: owner.userId, agent: { adapter: 'stub' }, prompt: `Owner ${i}`, cwd: '/tmp' })
    }
    state.createTask({ id: `other-task-0`, userId: other.userId, agent: { adapter: 'stub' }, prompt: 'Other', cwd: '/tmp' })

    const res = await fetch(`${baseUrl}/api/tasks?limit=2`, { headers: authHeaders(owner.token) })
    const payload = await res.json() as Array<{ id: string }>
    assert.equal(payload.length, 2)
    assert.ok(payload.every((t) => t.id.startsWith('owner-task-')), 'no cross-user leakage')
  })
})

test('EADDRINUSE prints a friendly message and exits with code 1', async () => {
  const blocker = http.createServer()
  await new Promise<void>((resolve) => blocker.listen(0, resolve))
  const blockerAddr = blocker.address()
  if (!blockerAddr || typeof blockerAddr === 'string') throw new Error('blocker did not start')
  const occupiedPort = blockerAddr.port

  const dir = mkdtempSync(join(tmpdir(), 'turing-eaddrinuse-'))
  state.initDb(join(dir, 'turing.db'))

  const originalExit = process.exit
  const originalStderrWrite = process.stderr.write.bind(process.stderr)
  let exitCode: number | null = null
  let stderrOutput = ''
  process.exit = ((code?: number) => { exitCode = code ?? 0; return undefined as never }) as typeof process.exit
  process.stderr.write = ((chunk: string | Uint8Array) => { stderrOutput += chunk.toString(); return true }) as typeof process.stderr.write

  let server: http.Server | undefined
  try {
    const router = new Router()
    server = createServer(router, occupiedPort, new StubAgentCatalog() as never)
    await new Promise<void>((resolve) => {
      server!.on('error', () => resolve())
      setTimeout(resolve, 2000)
    })
    assert.equal(exitCode, 1)
    assert.match(stderrOutput, /Port .* is already in use/)
  } finally {
    process.exit = originalExit
    process.stderr.write = originalStderrWrite
    await new Promise<void>((resolve) => { server?.close(() => resolve()); setTimeout(resolve, 500) })
    await new Promise<void>((resolve) => blocker.close(() => resolve()))
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('registerPersistedUserAgents tolerates agents with undecryptable keys', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-decrypt-'))
  const originalKey = process.env.PASSITON_ENCRYPTION_KEY
  process.env.PASSITON_ENCRYPTION_KEY = 'decrypt-test-key-A'
  state.initDb(join(dir, 'turing.db'))
  const userId = 'user-decrypt'
  state.createUser({ id: userId, email: 'decrypt@example.com', passwordHash: 'hash', salt: 'salt' })

  // Valid agent — encrypted with the current key
  const validEnc = encryptSecret(userId, 'sk-valid-api-key-9999')
  state.createUserAgent({
    id: 'agent-valid',
    userId,
    name: 'good-agent',
    adapter: 'openai-api',
    encryptedKey: validEnc.encryptedKey,
    iv: validEnc.iv,
    authTag: validEnc.authTag,
    model: 'gpt-4',
  })

  // Corrupt agent — garbage ciphertext that cannot be decrypted
  state.createUserAgent({
    id: 'agent-corrupt',
    userId,
    name: 'corrupt-agent',
    adapter: 'anthropic-api',
    encryptedKey: 'garbage-data-not-valid-ciphertext',
    iv: 'AAAAAAAAAAAAAAAA',
    authTag: 'BBBBBBBBBBBBBBBB',
    model: 'claude-3',
  })

  // Must not throw despite the corrupt record
  const router = new Router()
  assert.doesNotThrow(() => registerPersistedUserAgents(router))

  state.closeDb()
  rmSync(dir, { recursive: true, force: true })
  if (originalKey === undefined) delete process.env.PASSITON_ENCRYPTION_KEY
  else process.env.PASSITON_ENCRYPTION_KEY = originalKey
})

test('GET /api/agents shows decrypt-failed agent as invalid with error', async () => {
  const originalKey = process.env.PASSITON_ENCRYPTION_KEY
  process.env.PASSITON_ENCRYPTION_KEY = 'server-test-encryption-key-B'
  await withServer(async (baseUrl) => {
    const auth = await register(baseUrl, 'agentlist@example.com')

    // Valid agent
    const validEnc = encryptSecret(auth.userId, 'sk-valid-list-key-0000')
    state.createUserAgent({
      id: 'list-agent-valid',
      userId: auth.userId,
      name: 'list-good',
      adapter: 'openai-api',
      encryptedKey: validEnc.encryptedKey,
      iv: validEnc.iv,
      authTag: validEnc.authTag,
      model: 'gpt-4',
    })

    // Corrupt agent
    state.createUserAgent({
      id: 'list-agent-corrupt',
      userId: auth.userId,
      name: 'list-corrupt',
      adapter: 'anthropic-api',
      encryptedKey: 'totally-bogus-ciphertext',
      iv: 'CCCCCCCCCCCCCCCC',
      authTag: 'DDDDDDDDDDDDDDDD',
      model: 'claude-3',
    })

    const res = await fetch(`${baseUrl}/api/agents`, { headers: authHeaders(auth.token) })
    assert.equal(res.status, 200)
    const agents = await res.json() as Array<{ name: string; status: string; error?: string; hasKey: boolean }>

    const corrupt = agents.find((a) => a.name === 'list-corrupt')
    assert.ok(corrupt, 'corrupt agent should appear in the list')
    assert.equal(corrupt!.status, 'invalid')
    assert.equal(corrupt!.hasKey, false)
    assert.ok(corrupt!.error, 'corrupt agent should have an error message')

    const good = agents.find((a) => a.name === 'list-good')
    assert.ok(good, 'valid agent should also appear in the list')
    assert.notEqual(good!.status, 'invalid')
  })
  if (originalKey === undefined) delete process.env.PASSITON_ENCRYPTION_KEY
  else process.env.PASSITON_ENCRYPTION_KEY = originalKey
})
