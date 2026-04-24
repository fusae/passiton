import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Router } from '../router.js'
import * as state from '../state.js'
import type { Adapter, AdapterSendOpts, Session } from '../types.js'

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
  const dir = mkdtempSync(join(tmpdir(), 'turing-test-'))
  state.initDb(join(dir, 'turing.db'))
  return fn().finally(() => {
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
  })
}

test('resume sends the paused reply to the pending side', async () => {
  await withTempDb(async () => {
    const fromCalls: string[] = []
    const toCalls: string[] = []
    const router = new Router()

    router.registerAdapter(new StubAdapter('codex', async (_session, message) => {
      fromCalls.push(message)
      return '[DONE]'
    }))
    router.registerAdapter(new StubAdapter('claude-code', async (_session, message) => {
      toCalls.push(message)
      return 'unexpected'
    }))

    const session = state.createSession({
      id: 'resume-route',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
      nextTurn: 'from',
      maxRounds: 2,
    })

    state.updateSession(session.id, {
      status: 'paused',
      currentRound: 1,
      nextTurn: 'from',
    })

    state.addMessage({
      id: 'm1',
      sessionId: session.id,
      from: 'human',
      content: 'seed',
      timestamp: 1,
      round: 0,
    })
    state.addMessage({
      id: 'm2',
      sessionId: session.id,
      from: 'claude-code',
      content: 'reply-to-from',
      timestamp: 2,
      round: 1,
    })

    await router.resumeSession(session.id)
    await waitFor(() => state.getSession(session.id)?.status === 'done')

    assert.deepEqual(fromCalls, ['reply-to-from'])
    assert.deepEqual(toCalls, [])
  })
})

test('history passed to adapters is capped at 20 messages', async () => {
  await withTempDb(async () => {
    let historyLength = -1
    const router = new Router()

    router.registerAdapter(new StubAdapter('codex', async (_session, _message, opts) => {
      historyLength = opts?.history?.length ?? 0
      return '[DONE]'
    }))
    router.registerAdapter(new StubAdapter('claude-code', async () => {
      throw new Error('to adapter should not run')
    }))

    const session = state.createSession({
      id: 'history-cap',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
      nextTurn: 'from',
      maxRounds: 2,
    })

    state.updateSession(session.id, {
      status: 'paused',
      currentRound: 1,
      nextTurn: 'from',
    })

    for (let i = 0; i < 25; i += 1) {
      state.addMessage({
        id: `h${i}`,
        sessionId: session.id,
        from: i % 2 === 0 ? 'human' : 'claude-code',
        content: `message-${i}`,
        timestamp: i + 1,
        round: i < 2 ? i : 1,
      })
    }

    await router.resumeSession(session.id)
    await waitFor(() => state.getSession(session.id)?.status === 'done')

    assert.equal(historyLength, 20)
  })
})
