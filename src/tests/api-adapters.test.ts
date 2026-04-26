import test from 'node:test'
import assert from 'node:assert/strict'
import { AnthropicApiAdapter } from '../adapters/api/anthropic.js'
import { OpenAIApiAdapter } from '../adapters/api/openai.js'
import { ZhipuApiAdapter } from '../adapters/api/zhipu.js'
import { createAdapter } from '../adapters/factory.js'
import type { Session } from '../types.js'

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
    systemPrompt: 'System prompt',
    history: [{ role: 'assistant', content: 'Previous assistant' }],
  })

  assert.equal(capturedHeaders.get('authorization'), 'Bearer sk-openai-test')
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

test('factory requires apiKey for API adapters', () => {
  assert.throws(
    () => createAdapter({ adapter: 'openai-api' }),
    /apiKey is required/
  )
  assert.equal(createAdapter({ adapter: 'zhipu-api', apiKey: 'zhipu-test' })?.name, 'zhipu-api')
})

function mockFetch(handler: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>): void {
  globalThis.fetch = handler as typeof fetch
}

function streamResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}
