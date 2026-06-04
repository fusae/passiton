import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Router, detectDreaminaSubmittedJob, detectHumanInputWait } from '../router.js'
import * as state from '../state.js'
import type { Adapter, AdapterCapabilities, AdapterSendOpts, Session } from '../types.js'

class StubAdapter implements Adapter {
  readonly config: Record<string, unknown>
  readonly capabilities?: AdapterCapabilities

  constructor(
    readonly name: string,
    private readonly handler: (session: Session, message: string, opts?: AdapterSendOpts) => Promise<string>,
    config: Record<string, unknown> = {},
    capabilities?: AdapterCapabilities
  ) {
    this.config = config
    this.capabilities = capabilities
  }

  send(session: Session, message: string, opts?: AdapterSendOpts): Promise<string> {
    return this.handler(session, message, opts)
  }

  async healthCheck(): Promise<boolean> {
    return true
  }
}

test('API planner tool warning uses adapter capabilities instead of agent name', async () => {
  await withTempDb(async () => {
    const router = new Router()
    let plannerSystemPrompt = ''

    router.registerAdapter(new StubAdapter('executor', async () => 'implemented'))
    router.registerUserAdapter('user-api-planner', new StubAdapter(
      'writer',
      async (_session, _message, opts) => {
        plannerSystemPrompt = opts?.systemPrompt ?? ''
        return '[DONE]'
      },
      { adapter: 'anthropic-api' },
      { tools: false, fileSystem: false, shell: false }
    ))

    const session = router.startSession({
      userId: 'user-api-planner',
      from: { adapter: 'writer' },
      to: { adapter: 'executor' },
      initialPrompt: 'change a file',
      mode: 'collaborate',
      maxRounds: 2,
    })

    await waitFor(() => state.getSession(session.id)?.status === 'done')

    assert.match(plannerSystemPrompt, /CANNOT execute tools/)
    assert.match(plannerSystemPrompt, /Do NOT output XML tool tags/)
  })
})

test('local planner with API-looking name does not get API-only warning', async () => {
  await withTempDb(async () => {
    const router = new Router()
    let plannerSystemPrompt = ''

    router.registerAdapter(new StubAdapter('executor', async () => 'implemented'))
    router.registerAdapter(new StubAdapter(
      'claude-api',
      async (_session, _message, opts) => {
        plannerSystemPrompt = opts?.systemPrompt ?? ''
        return '[DONE]'
      },
      { adapter: 'claude-code' },
      { tools: true, fileSystem: true, shell: true }
    ))

    const session = router.startSession({
      from: { adapter: 'claude-api' },
      to: { adapter: 'executor' },
      initialPrompt: 'change a file',
      mode: 'collaborate',
      maxRounds: 2,
    })

    await waitFor(() => state.getSession(session.id)?.status === 'done')

    assert.doesNotMatch(plannerSystemPrompt, /CANNOT execute tools/)
    assert.doesNotMatch(plannerSystemPrompt, /Do NOT output XML tool tags/)
  })
})

test('approve mode resumes after explicit approval', async () => {
  await withTempDb(async () => {
    const router = new Router()
    router.registerAdapter(new StubAdapter('codex', async () => '[DONE]'))
    router.registerAdapter(new StubAdapter('claude-code', async () => 'approved work'))

    const session = router.startSession({
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
      initialPrompt: 'review gate',
      mode: 'collaborate',
      maxRounds: 2,
      approveMode: true,
    })

    await waitFor(() => state.getSession(session.id)?.status === 'paused')
    assert.equal(state.getMessages(session.id).length, 1)

    await router.resumeSession(session.id)
    await waitFor(() => state.getSession(session.id)?.status === 'done')

    const completed = state.getSession(session.id)
    assert.equal(completed?.resumeCount, 1)
    assert.equal(completed?.currentRound, 1)
    assert.equal(state.getMessages(session.id).length, 3)
  })
})

test('stopped session resumes after explicit approval', async () => {
  await withTempDb(async () => {
    const router = new Router()
    router.registerAdapter(new StubAdapter('codex', async () => '[DONE]'))
    router.registerAdapter(new StubAdapter('claude-code', async () => 'approved work'))

    const session = state.createSession({
      id: 'resume-stopped',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
      maxRounds: 2,
    })
    state.updateSession(session.id, { status: 'stopped' })
    state.addMessage({
      id: 'resume-stopped-message',
      sessionId: session.id,
      from: 'human',
      content: 'resume stopped work',
      timestamp: Date.now(),
      round: 0,
    })

    await router.resumeSession(session.id)
    await waitFor(() => state.getSession(session.id)?.status === 'done')
    assert.equal(state.getSession(session.id)?.resumeCount, 1)
  })
})

test('human message interrupts an active turn and immediately restarts with the directive', async () => {
  await withTempDb(async () => {
    let firstTurnStarted!: () => void
    const started = new Promise<void>((resolve) => { firstTurnStarted = resolve })
    let interrupted = false
    const toCalls: string[] = []
    const router = new Router()

    router.registerAdapter(new StubAdapter('codex', async () => '[DONE]'))
    router.registerAdapter(new StubAdapter('claude-code', async (_session, message, opts) => {
      toCalls.push(message)
      if (message !== 'initial request') return 'revised result'
      firstTurnStarted()
      await new Promise<void>((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          interrupted = true
          reject(new Error('interrupted'))
        }, { once: true })
      })
      return 'unreachable'
    }))

    const session = router.startSession({
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
      initialPrompt: 'initial request',
      mode: 'collaborate',
      maxRounds: 2,
    })

    await started
    router.injectMessage(session.id, 'human correction')
    await waitFor(() => state.getSession(session.id)?.status === 'done')

    assert.equal(interrupted, true)
    assert.deepEqual(toCalls, ['initial request', 'human correction'])
    assert.equal(state.getSession(session.id)?.resumeCount, 1)
  })
})

test('human message reactivates paused, done, error, and stopped sessions', async () => {
  for (const status of ['paused', 'done', 'error', 'stopped'] as const) {
    await withTempDb(async () => {
      const toCalls: string[] = []
      const router = new Router()
      router.registerAdapter(new StubAdapter('codex', async () => '[DONE]'))
      router.registerAdapter(new StubAdapter('claude-code', async (_session, message) => {
        toCalls.push(message)
        return 'reactivated'
      }))

      const session = state.createSession({
        id: `reactivate-${status}`,
        from: { adapter: 'codex' },
        to: { adapter: 'claude-code' },
        nextTurn: 'to',
        maxRounds: 2,
      })
      state.updateSession(session.id, { status })

      router.injectMessage(session.id, `resume from ${status}`)
      await waitFor(() => state.getSession(session.id)?.status === 'done')

      assert.deepEqual(toCalls, [`resume from ${status}`])
      assert.equal(state.getSession(session.id)?.resumeCount, 1)
    })
  }
})

test('human message adds one round when the paused session already reached its limit', async () => {
  await withTempDb(async () => {
    const toCalls: string[] = []
    const router = new Router()
    router.registerAdapter(new StubAdapter('codex', async () => '[DONE]'))
    router.registerAdapter(new StubAdapter('claude-code', async (_session, message) => {
      toCalls.push(message)
      return '[DONE]'
    }))

    const session = state.createSession({
      id: 'reactivate-max-rounds',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
      nextTurn: 'to',
      maxRounds: 1,
    })
    state.updateSession(session.id, { status: 'paused', currentRound: 1 })

    router.injectMessage(session.id, 'human correction after limit')
    await waitFor(() => state.getSession(session.id)?.status === 'done')

    assert.deepEqual(toCalls, ['human correction after limit'])
    assert.equal(state.getSession(session.id)?.maxRounds, 2)
  })
})

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

test('recoverTasks resumes queued tasks and fails interrupted running tasks', async () => {
  await withTempDb(async () => {
    const router = new Router()
    router.registerAdapter(new StubAdapter('opencode', async () => '[RESULT]done[/RESULT]'))

    state.createTask({
      id: 'queued-task',
      agent: { adapter: 'opencode' },
      prompt: 'queued',
    })
    state.createTask({
      id: 'running-task',
      agent: { adapter: 'opencode' },
      prompt: 'running',
    })
    state.updateTask('running-task', { status: 'running' })

    router.recoverTasks()

    await waitFor(() => state.getTask('queued-task')?.status === 'done')
    assert.equal(state.getTask('queued-task')?.result, 'done')
    assert.equal(state.getTask('running-task')?.status, 'error')
    assert.equal(state.getTask('running-task')?.errorMessage, 'Task interrupted by server restart')
  })
})

test('recoverSessions pauses interrupted active sessions', async () => {
  await withTempDb(async () => {
    const router = new Router()
    const session = state.createSession({
      id: 'interrupted-session',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
      maxRounds: 2,
    })

    router.recoverSessions()

    assert.equal(state.getSession(session.id)?.status, 'paused')
    assert.match(state.getLogs(session.id).at(-1)?.message ?? '', /Recovered interrupted session as paused/)
  })
})

test('detectDreaminaSubmittedJob ignores completed local video output', () => {
  const pending = detectDreaminaSubmittedJob(
    'submit_id: `5db07d3a-4d66-44b7-ac53-b2f9f660ce11` querying',
    { cwd: '/tmp/project' }
  )
  assert.deepEqual(pending, {
    externalId: '5db07d3a-4d66-44b7-ac53-b2f9f660ce11',
    downloadDir: '/tmp/project/output',
  })
  assert.equal(detectDreaminaSubmittedJob(
    'submit_id: `5db07d3a-4d66-44b7-ac53-b2f9f660ce11`\n本地视频：`/tmp/video.mp4`',
    { cwd: '/tmp/project' }
  ), undefined)
})

test('detectHumanInputWait recognizes explicit approval requests', () => {
  assert.equal(detectHumanInputWait('请回复“OK/通过/确认保存”或修改意见。'), true)
  assert.equal(detectHumanInputWait('本步骤等待人工确认。'), true)
  assert.equal(detectHumanInputWait('任务已完成。'), false)
})

test('explicit human approval request pauses the session', async () => {
  await withTempDb(async () => {
    let calls = 0
    const router = new Router()
    router.registerAdapter(new StubAdapter('codex', async () => {
      calls += 1
      return '视频已生成，请回复“OK/通过/确认保存”或修改意见。'
    }))

    const session = router.startSession({
      from: { adapter: 'codex' },
      to: { adapter: 'codex' },
      initialPrompt: 'review video',
    })

    await waitFor(() => state.getSession(session.id)?.status === 'paused')
    assert.equal(calls, 1)
  })
})

test('resume rejects sessions waiting for human approval', async () => {
  await withTempDb(async () => {
    const router = new Router()
    const session = state.createSession({
      id: 'waiting-human-resume',
      from: { adapter: 'codex' },
      to: { adapter: 'codex' },
    })
    state.addMessage({
      id: 'waiting-human-message',
      sessionId: session.id,
      from: 'codex',
      content: '请回复“OK/通过/确认保存”或修改意见。',
      timestamp: Date.now(),
      round: 1,
    })
    state.updateSession(session.id, { status: 'paused' })

    await assert.rejects(
      () => router.resumeSession(session.id),
      /waiting for human input/
    )
  })
})

test('error resume rejects sessions waiting for human approval', async () => {
  await withTempDb(async () => {
    const router = new Router()
    const session = state.createSession({
      id: 'waiting-human-error-resume',
      from: { adapter: 'codex' },
      to: { adapter: 'codex' },
    })
    state.addMessage({
      id: 'waiting-human-error-message',
      sessionId: session.id,
      from: 'codex',
      content: '请回复“OK/通过/确认保存”或修改意见。',
      timestamp: Date.now(),
      round: 1,
    })
    state.updateSession(session.id, { status: 'error' })

    await assert.rejects(
      () => router.resumeErrorSession(session.id),
      /waiting for human input/
    )
  })
})

test('confirmSession completes human approval without calling an adapter', async () => {
  await withTempDb(async () => {
    const router = new Router()
    const session = state.createSession({
      id: 'direct-human-confirm',
      from: { adapter: 'codex' },
      to: { adapter: 'codex' },
    })
    state.addMessage({
      id: 'direct-human-confirm-request',
      sessionId: session.id,
      from: 'codex',
      content: '视频：`/tmp/final.mp4`\n请回复“OK/通过/确认保存”或修改意见。',
      timestamp: Date.now(),
      round: 1,
    })

    const completed = await router.confirmSession(session.id)

    assert.equal(completed.status, 'done')
    assert.match(completed.lastAgentOutput ?? '', /final\.mp4/)
    assert.deepEqual(state.getMessages(session.id).slice(-2).map((message) => message.from), ['human', 'turing'])
  })
})

test('dreamina pending output is reconciled automatically', async () => {
  await withTempDb(async () => {
    const router = new Router({}, {
      dreaminaPollIntervalMs: 1,
      dreaminaQuery: async () => ({ status: 'success', paths: ['/tmp/generated.mp4'] }),
    })
    router.registerAdapter(new StubAdapter('codex', async () => (
      '[RESULT]submit_id: `5db07d3a-4d66-44b7-ac53-b2f9f660ce11` querying[/RESULT]\n[DONE]'
    )))

    const session = router.startSession({
      from: { adapter: 'codex' },
      to: { adapter: 'codex' },
      initialPrompt: 'generate video',
      cwd: '/tmp/project',
    })

    await waitFor(() => state.getSession(session.id)?.status === 'done')
    assert.equal(state.listExternalJobs('done').length, 1)
    assert.match(state.getSession(session.id)?.lastAgentOutput ?? '', /generated\.mp4/)
  })
})

test('stopTask keeps stopped status when a late agent result arrives', async () => {
  await withTempDb(async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const router = new Router()
    router.registerAdapter(new StubAdapter('opencode', async () => {
      await gate
      return '[RESULT]late[/RESULT]'
    }))

    const task = router.startTask({
      agent: { adapter: 'opencode' },
      prompt: 'slow',
    })
    await waitFor(() => state.getTask(task.id)?.status === 'running')

    await router.stopTask(task.id)
    release()
    await new Promise((resolve) => setTimeout(resolve, 20))

    assert.equal(state.getTask(task.id)?.status, 'stopped')
    assert.equal(state.getTask(task.id)?.result, undefined)
  })
})

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

test('extendSessionTimeout exposes extra time to the running adapter call', async () => {
  await withTempDb(async () => {
    let extensionMs = -1
    let release!: () => void
    let markStarted!: () => void
    const adapterStarted = new Promise<void>((resolve) => { markStarted = resolve })
    const router = new Router()
    router.registerAdapter(new StubAdapter('codex', async () => '[DONE]'))
    router.registerAdapter(new StubAdapter('claude-code', async (_session, _message, opts) => {
      markStarted()
      await new Promise<void>((done) => { release = done })
      extensionMs = opts?.getTimeoutExtensionMs?.() ?? 0
      return '[DONE]'
    }))

    const session = router.startSession({
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
      initialPrompt: 'test timeout extension',
    })

    await adapterStarted
    router.extendSessionTimeout(session.id)
    release()
    await waitFor(() => extensionMs === 5 * 60 * 1000)
    assert.equal(extensionMs, 5 * 60 * 1000)
  })
})

test('discuss mode ignores early done and waits for convergence', async () => {
  await withTempDb(async () => {
    let toCalls = 0
    let fromCalls = 0
    const router = new Router()

    router.registerAdapter(new StubAdapter('codex', async () => {
      fromCalls += 1
      if (fromCalls === 1) return discussReply(['Fresh angle from planner'], true)
      return discussReply([], true)
    }))

    router.registerAdapter(new StubAdapter('claude-code', async () => {
      toCalls += 1
      if (toCalls === 1) return discussReply(['Counterpoint from reviewer'])
      return discussReply([])
    }))

    const session = router.startSession({
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
      initialPrompt: 'Debate the trade-offs.',
      mode: 'discuss',
      maxRounds: 5,
    })

    await waitFor(() => state.getSession(session.id)?.status === 'done')

    assert.equal(toCalls, 3)
    assert.equal(fromCalls, 3)
    assert.equal(state.getSession(session.id)?.currentRound, 3)
  })
})

test('collaborate mode completes when both agents converge without DONE tag', async () => {
  await withTempDb(async () => {
    let toCalls = 0
    let fromCalls = 0
    const router = new Router()

    router.registerAdapter(new StubAdapter('planner', async () => {
      fromCalls += 1
      return fromCalls === 1
        ? '状态稳定，无需进一步操作。'
        : '收到，状态稳定，无需操作。'
    }))

    router.registerAdapter(new StubAdapter('executor', async () => {
      toCalls += 1
      return toCalls === 1
        ? '实现完成，测试全部通过。'
        : '确认全部完成，无需操作。'
    }))

    const session = router.startSession({
      from: { adapter: 'planner' },
      to: { adapter: 'executor' },
      initialPrompt: 'Implement a feature.',
      mode: 'collaborate',
      maxRounds: 10,
    })

    await waitFor(() => state.getSession(session.id)?.status === 'done')

    assert.equal(toCalls, 2)
    assert.equal(fromCalls, 2)
    assert.equal(state.getSession(session.id)?.currentRound, 2)
  })
})

test('context is cached at session start and injected via system prompt', async () => {
  await withTempDb(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'turing-context-'))
    try {
      const filePath = join(dir, 'context.txt')
      writeFileSync(filePath, 'cached file content', 'utf-8')

      let firstMessage = ''
      let firstSystemPrompt = ''
      const router = new Router()

      router.registerAdapter(new StubAdapter('codex', async () => '[DONE]'))
      router.registerAdapter(new StubAdapter('claude-code', async (_session, message, opts) => {
        firstMessage = message
        firstSystemPrompt = opts?.systemPrompt ?? ''
        return 'executor reply'
      }))

      const session = router.startSession({
        from: { adapter: 'codex' },
        to: { adapter: 'claude-code' },
        initialPrompt: 'Implement the task.',
        mode: 'collaborate',
        context: {
          rules: 'vanilla JS only',
          text: 'Keep the UI dark.',
          files: [
            { path: filePath, content: 'cached file content' },
          ],
        },
        maxRounds: 2,
      })

      await waitFor(() => state.getSession(session.id)?.status === 'done')

      assert.equal(firstMessage, 'Implement the task.')
      assert.match(firstSystemPrompt, /\[Session Context\]/)
      assert.match(firstSystemPrompt, /Rules: vanilla JS only/)
      assert.match(firstSystemPrompt, /cached file content/)
      assert.match(firstSystemPrompt, /Background: Keep the UI dark\./)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function discussReply(newPoints: string[], done = false): string {
  const points = newPoints.length > 0
    ? newPoints.map((point) => `- ${point}`).join('\n')
    : '- None'

  return [
    'Response:',
    '- Replying to the previous point.',
    'New Points:',
    points,
    'Challenge:',
    '- Why should the other side accept this?',
    done ? '[DONE]' : '',
  ].filter(Boolean).join('\n')
}

test('pipeline dependencies inject upstream output and file contents', async () => {
  await withTempDb(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'turing-pipeline-'))
    try {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
      execFileSync('git', ['config', 'user.name', 'Turing Test'], { cwd: dir, stdio: 'ignore' })
      const filePath = join(dir, 'artifact.txt')
      writeFileSync(filePath, 'base', 'utf-8')
      execFileSync('git', ['add', 'artifact.txt'], { cwd: dir, stdio: 'ignore' })
      execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' })

      let firstSessionId = ''
      let secondSessionId = ''
      let dependencyPrompt = ''
      const router = new Router()

      router.registerAdapter(new StubAdapter('codex', async () => '[DONE]'))
      router.registerAdapter(new StubAdapter('claude-code', async (session, _message, opts) => {
        if (session.id === firstSessionId) {
          writeFileSync(filePath, 'dependency artifact', 'utf-8')
          return 'Updated artifact.txt with dependency artifact'
        }
        if (session.id === secondSessionId) {
          dependencyPrompt = opts?.systemPrompt ?? ''
          return 'Consumed dependency context'
        }
        return 'noop'
      }))

      const pipeline = router.startPipeline({
        name: 'Dependency handoff',
        steps: [
          {
            from: { adapter: 'codex' },
            to: { adapter: 'claude-code' },
            initialPrompt: 'Prepare the artifact',
            cwd: dir,
          },
          {
            from: { adapter: 'codex' },
            to: { adapter: 'claude-code' },
            initialPrompt: 'Use the previous artifact',
            cwd: dir,
            dependsOn: [0],
          },
        ],
      })

      firstSessionId = pipeline.sessions[0].sessionId
      secondSessionId = pipeline.sessions[1].sessionId

      await waitFor(() => state.getSession(secondSessionId)?.status === 'done', 5_000)

      assert.match(dependencyPrompt, /\[\[Pipeline Dependency Context\]\]/)
      assert.match(dependencyPrompt, /Updated artifact\.txt with dependency artifact/)
      assert.match(dependencyPrompt, /\[dependency /)
      assert.match(dependencyPrompt, /dependency artifact/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('pipeline approval gate waits before running a dependent step', async () => {
  await withTempDb(async () => {
    let gatedCalls = 0
    const router = new Router()
    router.registerAdapter(new StubAdapter('codex', async () => '[DONE]'))
    router.registerAdapter(new StubAdapter('claude-code', async (session) => {
      if (session.approveMode) gatedCalls += 1
      return 'completed work'
    }))

    const pipeline = router.startPipeline({
      name: 'Approval gate',
      steps: [
        {
          from: { adapter: 'codex' },
          to: { adapter: 'claude-code' },
          initialPrompt: 'Prepare input',
        },
        {
          from: { adapter: 'codex' },
          to: { adapter: 'claude-code' },
          initialPrompt: 'Execute approved command',
          approveMode: true,
          dependsOn: [0],
        },
      ],
    })

    const gatedSessionId = pipeline.sessions[1].sessionId
    await waitFor(() => state.getPipeline(pipeline.id)?.sessions[1].status === 'active')

    assert.equal(state.getSession(gatedSessionId)?.status, 'paused')
    assert.equal(gatedCalls, 0)

    await router.resumeSession(gatedSessionId)
    await waitFor(() => state.getSession(gatedSessionId)?.status === 'done')
    assert.equal(gatedCalls, 1)
  })
})

test('changing an upstream pipeline step invalidates dependent results', async () => {
  await withTempDb(async () => {
    const calls: string[] = []
    const router = new Router()
    router.registerAdapter(new StubAdapter('codex', async () => '[DONE]'))
    router.registerAdapter(new StubAdapter('claude-code', async (_session, message) => {
      calls.push(message)
      return 'completed work'
    }))

    const pipeline = router.startPipeline({
      name: 'Revision invalidation',
      steps: [
        {
          from: { adapter: 'codex' },
          to: { adapter: 'claude-code' },
          initialPrompt: 'Prepare input',
        },
        {
          from: { adapter: 'codex' },
          to: { adapter: 'claude-code' },
          initialPrompt: 'Execute approved command',
          approveMode: true,
          dependsOn: [0],
        },
        {
          from: { adapter: 'codex' },
          to: { adapter: 'claude-code' },
          initialPrompt: 'Publish approved result',
          dependsOn: [1],
        },
      ],
    })

    const sourceSessionId = pipeline.sessions[0].sessionId
    const gatedSessionId = pipeline.sessions[1].sessionId
    const publishSessionId = pipeline.sessions[2].sessionId
    await waitFor(() => state.getPipeline(pipeline.id)?.sessions[1].status === 'active')

    state.addMessage({
      id: 'stale-dependent-output',
      sessionId: gatedSessionId,
      from: 'claude-code',
      content: 'stale output',
      timestamp: Date.now(),
      round: 1,
    })

    router.injectMessage(sourceSessionId, 'Revise the input')

    assert.equal(state.getPipeline(pipeline.id)?.sessions[1].status, 'pending')
    assert.equal(state.getPipeline(pipeline.id)?.sessions[2].status, 'pending')
    assert.equal(state.getSession(gatedSessionId)?.status, 'paused')
    assert.equal(state.getSession(publishSessionId)?.status, 'paused')
    assert.deepEqual(state.getMessages(gatedSessionId).map((message) => message.content), ['Execute approved command'])

    await waitFor(() => state.getPipeline(pipeline.id)?.sessions[1].status === 'active')
    assert.equal(state.getSession(gatedSessionId)?.status, 'paused')
    assert.deepEqual(calls, ['Prepare input', 'Revise the input'])
  })
})

test('completed sessions store git artifacts and result summary', async () => {
  await withTempDb(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'turing-artifacts-'))
    try {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
      execFileSync('git', ['config', 'user.name', 'Turing Test'], { cwd: dir, stdio: 'ignore' })
      const filePath = join(dir, 'result.txt')
      writeFileSync(filePath, 'base\n', 'utf-8')
      execFileSync('git', ['add', 'result.txt'], { cwd: dir, stdio: 'ignore' })
      execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' })

      const router = new Router()
      router.registerAdapter(new StubAdapter('codex', async () => '[RESULT]Added result output[/RESULT]\n[DONE]'))
      router.registerAdapter(new StubAdapter('claude-code', async () => {
        writeFileSync(filePath, 'base\nchanged\n', 'utf-8')
        execFileSync('git', ['add', 'result.txt'], { cwd: dir, stdio: 'ignore' })
        execFileSync('git', ['commit', '-m', 'update result'], { cwd: dir, stdio: 'ignore' })
        return 'changed result.txt'
      }))

      const session = router.startSession({
        from: { adapter: 'codex' },
        to: { adapter: 'claude-code' },
        initialPrompt: 'produce artifact',
        cwd: dir,
        maxRounds: 2,
      })

      await waitFor(() => state.getSession(session.id)?.status === 'done', 5_000)

      const completed = state.getSession(session.id)
      assert.ok(completed?.gitSnapshot)
      assert.equal(completed?.artifacts?.summary, 'Added result output')
      assert.match(completed?.artifacts?.gitDiffStat ?? '', /result\.txt/)
      assert.match(completed?.artifacts?.gitDiffFull ?? '', /\+changed/)
      assert.deepEqual(completed?.artifacts?.filesChanged, [
        { path: 'result.txt', additions: 1, deletions: 0 },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
