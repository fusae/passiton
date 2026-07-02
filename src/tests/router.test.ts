import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Router, detectAgentAssistanceRequest, detectHumanInputWait, extractHumanInputRequest } from '../router.js'
import { createDreaminaProvider } from '../examples/dreamina/provider.js'
import * as state from '../state.js'
import type { Adapter, AdapterCapabilities, AdapterResponse, AdapterSendOpts, Session } from '../types.js'

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

test('detects structured and natural-language executor assistance requests', () => {
  assert.match(
    detectAgentAssistanceRequest('[ASSIST_REQUEST]\naction: read_file\ntarget: /tmp/a.md\n[/ASSIST_REQUEST]') ?? '',
    /read_file/
  )
  assert.match(
    detectAgentAssistanceRequest('无法直接读取文件。请 codex 提供具体文案，以便继续改编。') ?? '',
    /无法直接读取文件/
  )
  assert.equal(detectAgentAssistanceRequest('文案已经完成，等待人工审阅。'), undefined)
})

test('routes executor capability blockers to the planner as mandatory assistance', async () => {
  await withTempDb(async () => {
    const plannerMessages: string[] = []
    const router = new Router()
    router.registerAdapter(new StubAdapter(
      'deepseek',
      async () => '无法直接读取文件。请 codex 提供原始文案，以便继续改编。',
      {},
      { tools: false, fileSystem: false, shell: false }
    ))
    router.registerAdapter(new StubAdapter('codex', async (_session, message) => {
      plannerMessages.push(message)
      return '[RESULT]已读取并提供原始文案。[/RESULT]\n[DONE]'
    }))

    const session = router.startSession({
      from: { adapter: 'codex' },
      to: { adapter: 'deepseek' },
      initialPrompt: '读取资料后改编',
      mode: 'collaborate',
      maxRounds: 1,
    })

    await waitFor(() => state.getSession(session.id)?.status === 'done')
    assert.match(plannerMessages[0] ?? '', /\[TURING_ASSISTANCE_REQUIRED\]/)
    assert.match(plannerMessages[0] ?? '', /不要把问题转交给用户/)
    assert.match(plannerMessages[0] ?? '', /请 codex 提供原始文案/)
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

test('resume automatically adds one round after max rounds is reached', async () => {
  await withTempDb(async () => {
    const router = new Router()
    router.registerAdapter(new StubAdapter('codex', async () => '[DONE]'))
    const session = state.createSession({
      id: 'resume-max-rounds',
      from: { adapter: 'codex' },
      to: { adapter: 'codex' },
      maxRounds: 2,
    })
    state.addMessage({
      id: 'resume-max-rounds-message',
      sessionId: session.id,
      from: 'codex',
      content: '继续',
      timestamp: Date.now(),
      round: 2,
    })
    state.updateSession(session.id, { status: 'paused', currentRound: 2 })

    const resumed = await router.resumeSession(session.id)
    assert.equal(resumed.maxRounds, 3)
  })
})

test('pipeline step cannot complete until its output contract is satisfied', async () => {
  await withTempDb(async () => {
    let releaseDeepseek!: () => void
    const deepseekGate = new Promise<void>((resolve) => { releaseDeepseek = resolve })
    const router = new Router()

    router.registerAdapter(new StubAdapter('deepseek', async () => {
      await deepseekGate
      return [
        '## 改编文案',
        '伪造文案',
        '## 改编说明',
        '伪造说明',
        '## 自检',
        '伪造自检',
        '文件已创建：`/tmp/nonexistent/script-adapted.md`',
      ].join('\n')
    }))
    router.registerAdapter(new StubAdapter('codex', async () => '审核通过。\n[DONE]'))

    const session = router.startSession({
      from: { adapter: 'codex' },
      to: { adapter: 'deepseek' },
      initialPrompt: '输出必须包含：改编文案、改编说明、自检。完成后以 [DONE] 结束。',
      mode: 'collaborate',
      maxRounds: 1,
    })
    state.createPipeline({
      id: 'contract-pipeline',
      name: 'Contract Pipeline',
      sessions: [{
        sessionId: session.id,
        title: '任意标题',
        nodeType: 'copy_adapt',
        contract: { outputs: [{ fileName: 'script-adapted.md', requiredSections: ['改编文案', '改编说明', '自检'] }] },
        status: 'active',
      }],
    })
    releaseDeepseek()

    await waitFor(() => state.getMessages(session.id).length >= 3)
    await new Promise((resolve) => setTimeout(resolve, 20))

    assert.notEqual(state.getSession(session.id)?.status, 'done')
    assert.equal(state.getPipeline('contract-pipeline')?.sessions[0].status, 'active')
  })
})

test('pipeline step can complete after a prior output satisfies its contract', async () => {
  await withTempDb(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'turing-contract-'))
    try {
      let releaseDeepseek!: () => void
      const deepseekGate = new Promise<void>((resolve) => { releaseDeepseek = resolve })
      const outputDir = join(dir, '012-动态选题')
      const outputPath = join(outputDir, 'script-adapted.md')
      const router = new Router()

      router.registerAdapter(new StubAdapter('deepseek', async () => {
        await deepseekGate
        return [
          '[RESULT]',
          '## 改编文案',
          '领导说：这两天新人入职都给我记住了。',
          '## 改编说明',
          '保留原视频反转结构。',
          '## 自检',
          '职场场景明确。',
          `文件：\`${outputPath}\``,
          '[/RESULT]',
        ].join('\n')
      }))
      router.registerAdapter(new StubAdapter('codex', async () => {
        mkdirSync(outputDir, { recursive: true })
        writeFileSync(outputPath, '## 改编文案\n内容\n## 改编说明\n说明\n## 自检\n通过\n', 'utf-8')
        return `已真实写入并验证：\`${outputPath}\`\n[DONE]`
      }))

      const session = router.startSession({
        from: { adapter: 'codex' },
        to: { adapter: 'deepseek' },
        initialPrompt: '输出必须包含：改编文案、改编说明、自检。完成后以 [DONE] 结束。',
        mode: 'collaborate',
        maxRounds: 2,
        cwd: dir,
      })
      state.createPipeline({
        id: 'contract-pipeline-ok',
        name: 'Contract Pipeline OK',
        sessions: [{
          sessionId: session.id,
          title: '任意标题',
          nodeType: 'copy_adapt',
          contract: { outputs: [{ fileName: 'script-adapted.md', requiredSections: ['改编文案', '改编说明', '自检'] }] },
          status: 'active',
        }],
      })
      releaseDeepseek()

      await waitFor(() => state.getSession(session.id)?.status === 'done')
      assert.equal(state.getPipeline('contract-pipeline-ok')?.sessions[0].status, 'done')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('pipeline step completes when adapter crashes after writing contract output', async () => {
  await withTempDb(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'turing-contract-crash-'))
    try {
      const outputDir = join(dir, 'downloads', 'douyin', 'video-id')
      const outputPath = join(outputDir, 'reference.md')
      const router = new Router({ retries: 0 })
      router.registerAdapter(new StubAdapter('codex', async () => {
        mkdirSync(outputDir, { recursive: true })
        writeFileSync(outputPath, '## 视频文案/台词\n内容\n## 选题 brief\n选题\n## 可复用结构\n结构\n', 'utf-8')
        throw new Error('usage limit')
      }))

      const session = router.startSession({
        from: { adapter: 'codex' },
        to: { adapter: 'codex' },
        initialPrompt: '解析视频并生成 reference.md',
        maxRounds: 1,
        cwd: dir,
      })
      state.createPipeline({
        id: 'contract-pipeline-crash',
        name: 'Contract Pipeline Crash',
        sessions: [{
          sessionId: session.id,
          title: '解析对标视频',
          nodeType: 'video_parse',
          contract: {
            outputs: [{
              fileName: 'reference.md',
              requiredSections: ['视频文案/台词', '选题 brief', '可复用结构'],
            }],
          },
          status: 'active',
        }],
      })

      await waitFor(() => state.getSession(session.id)?.status === 'done')
      assert.equal(state.getPipeline('contract-pipeline-crash')?.sessions[0].status, 'done')
      assert.match(state.getSession(session.id)?.lastAgentOutput ?? '', /产物已完整生成/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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

test('dreamina provider.parseAgentOutput ignores completed local video output', () => {
  const provider = createDreaminaProvider({ binary: '/usr/bin/true' })
  const pending = provider.parseAgentOutput(
    'submit_id: `5db07d3a-4d66-44b7-ac53-b2f9f660ce11` querying',
    { cwd: '/tmp/project' }
  )
  assert.deepEqual(pending, {
    externalId: '5db07d3a-4d66-44b7-ac53-b2f9f660ce11',
    downloadDir: '/tmp/project/output',
  })
  assert.equal(provider.parseAgentOutput(
    'submit_id: `5db07d3a-4d66-44b7-ac53-b2f9f660ce11`\n本地视频：`/tmp/video.mp4`',
    { cwd: '/tmp/project' }
  ), undefined)
})

test('detectHumanInputWait recognizes explicit approval requests', () => {
  assert.equal(detectHumanInputWait('请回复“OK/通过/确认保存”或修改意见。'), true)
  assert.equal(detectHumanInputWait('本步骤等待人工确认。'), true)
  assert.equal(detectHumanInputWait('任务已完成。'), false)
})

test('detectHumanInputWait recognizes English natural-language approval cues', () => {
  assert.equal(detectHumanInputWait('Waiting for human approval before proceeding.'), true)
  assert.equal(detectHumanInputWait('Awaiting your confirmation to publish.'), true)
  assert.equal(detectHumanInputWait('Please reply with OK to continue.'), true)
  assert.equal(detectHumanInputWait('The task is complete.'), false)
})

test('detectHumanInputWait recognizes [HUMAN_NEEDED] summon block', () => {
  assert.equal(detectHumanInputWait('some work\n[HUMAN_NEEDED]\nwhich direction?\n[/HUMAN_NEEDED]'), true)
  assert.equal(detectHumanInputWait('[human_needed]lowercase works[/human_needed]'), true)
  assert.equal(detectHumanInputWait('just normal progress, no summon'), false)
})

test('extractHumanInputRequest pulls the question out of the block', () => {
  assert.equal(
    extractHumanInputRequest('draft done\n[HUMAN_NEEDED]\npublish now or revise?\nOptions:\n- A: publish\n- B: revise\n[/HUMAN_NEEDED]'),
    'publish now or revise?\nOptions:\n- A: publish\n- B: revise'
  )
  assert.equal(extractHumanInputRequest('no block here'), null)
  assert.equal(extractHumanInputRequest('[HUMAN_NEEDED][/HUMAN_NEEDED]'), null)
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
    const router = new Router()
    router.registerExternalTaskProvider(createDreaminaProvider({
      binary: '/usr/bin/true',
      pollIntervalMs: 1,
      queryFn: async () => ({ status: 'success', paths: ['/tmp/generated.mp4'] }),
    }))
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

test('video_generate pipeline step submits Dreamina directly without adapter', async () => {
  await withTempDb(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'turing-video-step-'))
    try {
      const commandPath = join(dir, 'video-command.md')
      const commandContent = [
        '```sh',
        'dreamina video --image storyboard.png --reference hero.png --duration 15 --ratio 9:16 --prompt "camera push in" --output parts/part-01.mp4',
        '```',
      ].join('\n')
      writeFileSync(commandPath, commandContent, 'utf-8')

      const submittedArgs: string[][] = []
      const router = new Router()
      router.registerExternalTaskProvider(createDreaminaProvider({
        binary: '/usr/bin/true',
        submitFn: async (args) => {
          submittedArgs.push(args)
          return 'submit_id: 5db07d3a-4d66-44b7-ac53-b2f9f660ce11'
        },
      }))
      router.registerAdapter(new StubAdapter('codex', async () => {
        throw new Error('adapter should not run for video_generate')
      }))

      const pipeline = router.startPipeline({
        name: 'video direct',
        steps: [{
          title: '执行视频生成',
          nodeType: 'video_generate',
          from: { adapter: 'codex' },
          to: { adapter: 'codex' },
          initialPrompt: 'run video',
          cwd: dir,
          context: { files: [{ path: commandPath, content: commandContent }] },
        }],
      })
      const sessionId = pipeline.sessions[0].sessionId

      await waitFor(() => state.listExternalJobs('querying').length === 1)
      assert.equal(submittedArgs[0]?.[0], 'multimodal2video')
      assert.ok(submittedArgs[0]?.includes('--image'))
      assert.equal(state.getSession(sessionId)?.status, 'active')
      assert.match(state.getSession(sessionId)?.lastAgentOutput ?? '', /submit_id/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('core engine ignores dreamina-like agent output when no provider is registered', async () => {
  await withTempDb(async () => {
    const router = new Router()
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
    // No provider → no external job ever registered, session completes normally
    assert.equal(state.listExternalJobs('querying').length, 0)
    assert.equal(state.listExternalJobs('done').length, 0)
  })
})

test('adapter status:completed finishes a session without [DONE] in text', async () => {
  await withTempDb(async () => {
    // A capable adapter (e.g. an API agent) reports a native stop reason;
    // its text does NOT contain [DONE]. The router must trust the structured
    // signal and complete the session — this is the "contract → mechanism" path.
    const apiAdapter: Adapter = {
      name: 'api-agent',
      config: {},
      capabilities: { tools: false, fileSystem: false, shell: false },
      async send(): Promise<AdapterResponse> {
        return { content: 'Here is the answer, no done marker anywhere in this text.', status: 'completed' }
      },
      async healthCheck() { return true },
    }
    const router = new Router()
    router.registerAdapter(new StubAdapter('codex', async () => 'ack'))
    router.registerAdapter(apiAdapter)

    const session = router.startSession({
      from: { adapter: 'api-agent' },
      to: { adapter: 'codex' },
      initialPrompt: 'explain something',
      mode: 'freeform',
      maxRounds: 5,
    })

    await waitFor(() => state.getSession(session.id)?.status === 'done')
    // Confirm it was the native signal, not a text marker.
    assert.doesNotMatch(state.getSession(session.id)?.lastAgentOutput ?? '', /\[DONE\]/)
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

test('task concurrency limit queues excess tasks until a slot frees', async () => {
  await withTempDb(async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const router = new Router({ maxConcurrentTasks: 2 })
    // All three tasks block on the same gate, so the first two occupy slots and
    // the third must stay queued until release() lets a slot free up.
    router.registerAdapter(new StubAdapter('opencode', async () => {
      await gate
      return '[RESULT]done[/RESULT]'
    }))

    const t1 = router.startTask({ agent: { adapter: 'opencode' }, prompt: 'a' })
    const t2 = router.startTask({ agent: { adapter: 'opencode' }, prompt: 'b' })
    const t3 = router.startTask({ agent: { adapter: 'opencode' }, prompt: 'c' })

    // Two slots fill; the third stays queued.
    await waitFor(() => state.getTask(t1.id)?.status === 'running')
    await waitFor(() => state.getTask(t2.id)?.status === 'running')
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(state.getTask(t3.id)?.status, 'queued')

    // Release everything; the queued task drains into a slot and completes.
    release()
    await waitFor(() => state.getTask(t1.id)?.status === 'done')
    await waitFor(() => state.getTask(t2.id)?.status === 'done')
    await waitFor(() => state.getTask(t3.id)?.status === 'done')
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

test('pipeline dependencies inject referenced files even without git snapshots', async () => {
  await withTempDb(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'turing-pipeline-reference-'))
    try {
      const referenceDir = join(dir, 'downloads', 'episode')
      const referencePath = join(referenceDir, 'reference.md')
      mkdirSync(referenceDir, { recursive: true })
      writeFileSync(referencePath, '真实素材：高考考生被带回站点办理入职。', 'utf-8')

      let firstSessionId = ''
      let secondSessionId = ''
      let dependencyPrompt = ''
      const router = new Router()

      router.registerAdapter(new StubAdapter('codex', async () => '[RESULT]核验通过：reference.md 已生成。[/RESULT]\n[DONE]'))
      router.registerAdapter(new StubAdapter('claude-code', async (session, _message, opts) => {
        if (session.id === firstSessionId) {
          return '产出文件：`downloads/episode/reference.md`'
        }
        if (session.id === secondSessionId) {
          dependencyPrompt = opts?.systemPrompt ?? ''
          return '已使用依赖文件'
        }
        return 'noop'
      }))

      const pipeline = router.startPipeline({
        name: 'Referenced file handoff',
        steps: [
          {
            from: { adapter: 'codex' },
            to: { adapter: 'claude-code' },
            initialPrompt: '解析素材',
            cwd: dir,
          },
          {
            from: { adapter: 'codex' },
            to: { adapter: 'claude-code' },
            initialPrompt: '改编文案',
            cwd: dir,
            dependsOn: [0],
          },
        ],
      })

      firstSessionId = pipeline.sessions[0].sessionId
      secondSessionId = pipeline.sessions[1].sessionId
      await waitFor(() => state.getSession(secondSessionId)?.status === 'done', 5_000)

      assert.match(dependencyPrompt, new RegExp(referencePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      assert.match(dependencyPrompt, /真实素材：高考考生被带回站点办理入职/)
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

test('codex image generation pipeline step waits for host tool artifact handoff', async () => {
  await withTempDb(async () => {
    let imageCalls = 0
    const router = new Router()
    router.registerAdapter(new StubAdapter('codex', async (session) => {
      if (session.id === imageSessionId) imageCalls += 1
      return '[DONE]'
    }))

    let imageSessionId = ''
    const pipeline = router.startPipeline({
      name: 'Host image handoff',
      steps: [
        {
          from: { adapter: 'codex' },
          to: { adapter: 'codex' },
          initialPrompt: 'Prepare prompt',
        },
        {
          nodeType: 'image_generate',
          from: { adapter: 'codex' },
          to: { adapter: 'codex' },
          initialPrompt: 'Generate storyboard image',
          approveMode: true,
          dependsOn: [0],
        },
      ],
    })

    imageSessionId = pipeline.sessions[1]!.sessionId
    await waitFor(() => state.getPipeline(pipeline.id)?.sessions[1]?.status === 'active')
    assert.equal(state.getSession(imageSessionId)?.status, 'paused')

    await router.resumeSession(imageSessionId)

    assert.equal(imageCalls, 0)
    assert.equal(state.getSession(imageSessionId)?.status, 'paused')
    assert.match(state.getSession(imageSessionId)?.lastAgentOutput ?? '', /HOST_IMAGE_GENERATION_REQUIRED/)
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

test('rerun pipeline step resets itself and downstream steps', async () => {
  await withTempDb(async () => {
    const calls: string[] = []
    const router = new Router()
    router.registerAdapter(new StubAdapter('codex', async () => '[RESULT]rerun complete[/RESULT]\n[DONE]'))
    router.registerAdapter(new StubAdapter('claude-code', async (_session, message) => {
      calls.push(message)
      return 'executor result'
    }))

    state.createSession({
      id: 'rerun-source',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
      maxRounds: 2,
    })
    state.addMessage({
      id: 'rerun-source-initial',
      sessionId: 'rerun-source',
      from: 'human',
      content: 'Produce source',
      timestamp: 1,
      round: 0,
    })
    state.addMessage({
      id: 'rerun-source-output',
      sessionId: 'rerun-source',
      from: 'codex',
      content: '[RESULT]old source[/RESULT]\n[DONE]',
      timestamp: 2,
      round: 1,
    })
    state.updateSession('rerun-source', { status: 'done', currentRound: 1, lastAgentOutput: 'old source' })

    state.createSession({
      id: 'rerun-child',
      from: { adapter: 'codex' },
      to: { adapter: 'claude-code' },
      maxRounds: 2,
    })
    state.addMessage({
      id: 'rerun-child-initial',
      sessionId: 'rerun-child',
      from: 'human',
      content: 'Use source',
      timestamp: 3,
      round: 0,
    })
    state.addMessage({
      id: 'rerun-child-output',
      sessionId: 'rerun-child',
      from: 'codex',
      content: '[RESULT]old child[/RESULT]\n[DONE]',
      timestamp: 4,
      round: 1,
    })
    state.updateSession('rerun-child', { status: 'done', currentRound: 1, lastAgentOutput: 'old child' })

    state.createPipeline({
      id: 'rerun-pipeline',
      name: 'Rerun Pipeline',
      sessions: [
        { sessionId: 'rerun-source', title: 'Source', status: 'done' },
        { sessionId: 'rerun-child', title: 'Child', dependsOn: ['rerun-source'], status: 'done' },
      ],
    })

    const updated = await router.rerunPipelineStep('rerun-source')
    assert.deepEqual(updated.sessions.map((step) => step.status), ['active', 'pending'])
    assert.deepEqual(state.getMessages('rerun-child').map((message) => message.content), ['Use source'])

    await waitFor(() => state.getSession('rerun-source')?.status === 'done')
    assert.equal(calls[0], 'Produce source')
    assert.equal(state.getPipeline('rerun-pipeline')?.sessions[0].status, 'done')
    assert.notEqual(state.getPipeline('rerun-pipeline')?.sessions[1].status, 'pending')
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
