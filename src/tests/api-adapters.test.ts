import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AnthropicApiAdapter } from '../adapters/api/anthropic.js'
import { OpenAIApiAdapter } from '../adapters/api/openai.js'
import { ZhipuApiAdapter } from '../adapters/api/zhipu.js'
import { createAdapter } from '../adapters/factory.js'
import { Router } from '../router.js'
import * as state from '../state.js'
import type { Adapter, AdapterResponse, AdapterSendOpts, Session } from '../types.js'

const session = { id: 'api-test', cwd: process.cwd() } as Session
const originalFetch = globalThis.fetch

test.afterEach(() => {
  globalThis.fetch = originalFetch
})

test('Anthropic API adapter formats streaming requests', async () => {
  let capturedUrl = ''
  let capturedHeaders = new Headers()
  let capturedBody: Record<string, unknown> = {}

  mockFetch(async (input, init) => {
    capturedUrl = String(input)
    capturedHeaders = new Headers(init?.headers)
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return streamResponse([
      { type: 'content_block_delta', delta: { text: 'Hello ' } },
      { type: 'content_block_delta', delta: { text: 'world' } },
      { type: 'message_delta', usage: { input_tokens: 3, output_tokens: 4 } },
    ])
  })

  const adapter = new AnthropicApiAdapter({
    apiKey: 'sk-ant-test',
    model: 'claude-sonnet-4-20250514',
  })
  const result = await adapter.send(session, 'Current', {
    systemPrompt: 'System prompt',
    history: [
      { role: 'user', content: 'Previous user' },
      { role: 'assistant', content: 'Previous assistant' },
    ],
  })

  assert.equal(capturedUrl, 'https://api.anthropic.com/v1/messages')
  assert.equal(capturedHeaders.get('x-api-key'), 'sk-ant-test')
  assert.equal(capturedHeaders.get('anthropic-version'), '2023-06-01')
  assert.equal(capturedBody.model, 'claude-sonnet-4-20250514')
  assert.equal(capturedBody.system, 'System prompt')
  assert.equal(capturedBody.stream, true)
  assert.deepEqual(capturedBody.messages, [
    { role: 'user', content: 'Previous user' },
    { role: 'assistant', content: 'Previous assistant' },
    { role: 'user', content: 'Current' },
  ])
  assert.equal(result.content, 'Hello world')
  assert.equal(result.metadata?.tokenEstimate, 7)
})

test('API adapters call onOutput for streaming deltas', async () => {
  const chunks: string[] = []

  mockFetch(async () => streamResponse([
    { choices: [{ delta: { content: 'Hel' } }] },
    { choices: [{ delta: { content: 'lo' } }] },
    { choices: [], usage: { total_tokens: 3 } },
  ]))

  const adapter = new OpenAIApiAdapter({ apiKey: 'sk-openai-test' })
  const result = await adapter.send(session, 'Current', {
    onOutput: (line) => chunks.push(line),
  })

  assert.deepEqual(chunks, ['Hel', 'lo'])
  assert.equal(result.content, 'Hello')
  assert.equal(result.metadata?.tokenEstimate, 3)
})

test('OpenAI API adapter formats chat completion requests', async () => {
  let capturedHeaders = new Headers()
  let capturedBody: Record<string, unknown> = {}

  mockFetch(async (_input, init) => {
    capturedHeaders = new Headers(init?.headers)
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return streamResponse([
      { choices: [{ delta: { content: 'Done' } }] },
      { choices: [], usage: { prompt_tokens: 2, completion_tokens: 5, total_tokens: 7 } },
    ])
  })

  const adapter = new OpenAIApiAdapter({ apiKey: 'sk-openai-test', model: 'gpt-4o-mini' })
  const result = await adapter.send(session, 'Current', {
    apiKey: 'sk-openai-request',
    systemPrompt: 'System prompt',
    history: [{ role: 'assistant', content: 'Previous assistant' }],
  })

  assert.equal(capturedHeaders.get('authorization'), 'Bearer sk-openai-request')
  assert.equal(capturedBody.model, 'gpt-4o-mini')
  assert.equal(capturedBody.stream, true)
  assert.deepEqual(capturedBody.messages, [
    { role: 'system', content: 'System prompt' },
    { role: 'assistant', content: 'Previous assistant' },
    { role: 'user', content: 'Current' },
  ])
  assert.equal(result.content, 'Done')
  assert.equal(result.metadata?.tokenEstimate, 7)
})

test('API adapter surfaces non-retryable HTTP errors', async () => {
  mockFetch(async () => new Response('bad request', { status: 400 }))

  const adapter = new OpenAIApiAdapter({ apiKey: 'sk-openai-test' })
  await assert.rejects(
    adapter.send(session, 'Current'),
    /status 400: bad request/
  )
})

test('API adapter retries rate limits with exponential backoff', async () => {
  let calls = 0
  mockFetch(async () => {
    calls += 1
    if (calls < 3) {
      return new Response('rate limited', { status: 429 })
    }
    return streamResponse([
      { choices: [{ delta: { content: 'Recovered' } }] },
      { choices: [], usage: { total_tokens: 9 } },
    ])
  })

  const adapter = new OpenAIApiAdapter({ apiKey: 'sk-openai-test' })
  Object.assign(adapter as unknown as { retryDelayMs: number }, { retryDelayMs: 1 })
  const result = await adapter.send(session, 'Current')

  assert.equal(calls, 3)
  assert.equal(result.content, 'Recovered')
  assert.equal(result.metadata?.tokenEstimate, 9)
})

test('Zhipu API adapter uses OpenAI-compatible request format', async () => {
  let capturedUrl = ''
  let capturedBody: Record<string, unknown> = {}

  mockFetch(async (input, init) => {
    capturedUrl = String(input)
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return streamResponse([{ choices: [{ delta: { content: 'GLM' } }] }])
  })

  const adapter = new ZhipuApiAdapter({ apiKey: 'zhipu-test', model: 'glm-4' })
  const result = await adapter.send(session, 'Current')

  assert.equal(capturedUrl, 'https://open.bigmodel.cn/api/paas/v4/chat/completions')
  assert.equal(capturedBody.model, 'glm-4')
  assert.deepEqual(capturedBody.messages, [{ role: 'user', content: 'Current' }])
  assert.equal(result.content, 'GLM')
})

test('Zhipu API adapter retries only retryable Zhipu error codes', async () => {
  let retryableCalls = 0
  mockFetch(async () => {
    retryableCalls += 1
    if (retryableCalls === 1) {
      return new Response(JSON.stringify({ error: { code: 1001, message: 'rate limit' } }), { status: 429 })
    }
    return streamResponse([{ choices: [{ delta: { content: 'Recovered' } }] }])
  })

  const retryable = new ZhipuApiAdapter({ apiKey: 'zhipu-test' })
  Object.assign(retryable as unknown as { retryDelayMs: number }, { retryDelayMs: 1 })
  const result = await retryable.send(session, 'Current')

  assert.equal(retryableCalls, 2)
  assert.equal(result.content, 'Recovered')

  let badRequestCalls = 0
  mockFetch(async () => {
    badRequestCalls += 1
    return new Response(JSON.stringify({ error: { code: 1002, message: 'bad request' } }), { status: 500 })
  })

  const nonRetryable = new ZhipuApiAdapter({ apiKey: 'zhipu-test' })
  Object.assign(nonRetryable as unknown as { retryDelayMs: number }, { retryDelayMs: 1 })
  await assert.rejects(nonRetryable.send(session, 'Current'), /1002/)
  assert.equal(badRequestCalls, 1)
})

test('Router stores adapter tokenEstimate in round metadata', async () => {
  await withTempDb(async () => {
    const router = new Router()
    router.registerAdapter(new StubAdapter('planner', async () => '[DONE]'))
    router.registerAdapter(new StubAdapter('executor', async () => ({
      content: 'executor response',
      metadata: { tokenEstimate: 42 },
    })))

    const active = router.startSession({
      from: { adapter: 'planner' },
      to: { adapter: 'executor' },
      initialPrompt: 'run',
      maxRounds: 1,
    })

    await waitFor(() => state.getMessages(active.id).some((msg) => msg.from === 'executor'))
    const executorMessage = state.getMessages(active.id).find((msg) => msg.from === 'executor')

    assert.equal(executorMessage?.metadata?.tokenEstimate, 42)
    assert.equal(typeof executorMessage?.metadata?.duration, 'number')
  })
})

test('factory requires apiKey for API adapters', () => {
  assert.throws(
    () => createAdapter({ adapter: 'openai-api' }),
    /apiKey is required/
  )
  assert.equal(createAdapter({ adapter: 'zhipu-api', apiKey: 'zhipu-test' })?.name, 'zhipu-api')
})

test('factory creates domestic OpenAI-compatible API adapters', () => {
  // All three subclass OpenAIApiAdapter; only name + defaults differ.
  assert.equal(createAdapter({ adapter: 'deepseek-api', apiKey: 'k' })?.name, 'deepseek-api')
  assert.equal(createAdapter({ adapter: 'qwen-api', apiKey: 'k' })?.name, 'qwen-api')
  assert.equal(createAdapter({ adapter: 'moonshot-api', apiKey: 'k' })?.name, 'moonshot-api')

  // API adapters must be marked as filesystem-less.
  for (const adapterType of ['deepseek-api', 'qwen-api', 'moonshot-api']) {
    const adapter = createAdapter({ adapter: adapterType, apiKey: 'k' })!
    assert.equal(adapter.capabilities?.fileSystem, false, `${adapterType} should not have filesystem`)
    assert.equal(adapter.capabilities?.shell, false, `${adapterType} should not have shell`)
  }
})

test('factory creates Gemini CLI adapter', () => {
  const adapter = createAdapter({
    adapter: 'gemini-cli',
    command: 'gemini',
    args: ['-p', '{prompt}'],
  })

  assert.equal(adapter?.name, 'gemini-cli')
  assert.deepEqual(adapter?.config.args, ['-p', '{prompt}'])
})

function mockFetch(handler: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>): void {
  globalThis.fetch = handler as typeof fetch
}

function streamResponse(events: unknown[]): Response {
  const encoder = new TextEncoder()
  const chunks = events.map((event) => `data: ${JSON.stringify(event)}\n\n`)
  chunks.push('data: [DONE]\n\n')
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

class StubAdapter implements Adapter {
  readonly config: Record<string, unknown> = {}

  constructor(
    readonly name: string,
    private readonly handler: (session: Session, message: string, opts?: AdapterSendOpts) => Promise<string | AdapterResponse>
  ) {}

  send(session: Session, message: string, opts?: AdapterSendOpts): Promise<string | AdapterResponse> {
    return this.handler(session, message, opts)
  }

  async healthCheck(): Promise<boolean> {
    return true
  }
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now()
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function withTempDb(fn: () => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'turing-api-test-'))
  state.initDb(join(dir, 'turing.db'))
  return fn().finally(() => {
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
  })
}
