// Router module — session lifecycle and message routing

import { EventEmitter } from 'events'
import { execFile, execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { Session, Message, Adapter, AdapterSendOpts, PolicyConfig, WsEvent, AgentRef, SessionMode, SessionContext, AdapterResponse, RoundMetadata, SessionErrorType, Pipeline, SessionArtifacts, Task, ExternalJob, WorkflowNodeType, WorkflowStepContract } from './types.js'
import * as state from './state.js'
import { decryptKey } from './keyvault.js'
import {
  checkPreRound,
  checkSessionTimeout,
  detectCompletion,
  DEFAULT_POLICY,
} from './policy.js'
import { generateSystemPrompts, generateTaskSystemPrompt } from './prompts.js'

const MAX_HISTORY_MESSAGES = 20
const DISCUSS_MIN_ROUNDS = 3
const DISCUSS_CONVERGENCE_ROUNDS = 2
const DISCUSS_MESSAGES_PER_ROUND = 2
const COLLABORATE_CONVERGENCE_MESSAGES = 4
const GIT_DIFF_TIMEOUT_MS = 10_000
const PIPELINE_DEP_MAX_FILES = 8
const PIPELINE_DEP_FILE_CHARS = 12_000
const PIPELINE_DEP_TEXT_CHARS = 4_000
const DREAMINA_COMMAND = process.env.TURING_DREAMINA_COMMAND ?? '/Users/jamesyu/.local/bin/dreamina'
const DREAMINA_POLL_INTERVAL_MS = 10_000
const CURL_COMMAND = process.env.TURING_CURL_COMMAND ?? 'curl'
const FFMPEG_COMMAND = process.env.TURING_FFMPEG_COMMAND ?? 'ffmpeg'
const ACTIVE_SESSION_WATCHDOG_INTERVAL_MS = 30_000

type DreaminaQueryResult = {
  status: 'querying' | 'success' | 'error'
  paths?: string[]
  errorMessage?: string
}

type RouterOptions = {
  dreaminaQuery?: (externalId: string, downloadDir: string) => Promise<DreaminaQueryResult>
  dreaminaSubmit?: (args: string[], cwd?: string) => Promise<string>
  dreaminaPollIntervalMs?: number
}

type StreamStep = {
  type: 'read' | 'write' | 'exec' | 'think' | 'done'
  summary: string
  detail?: string
}

type DreaminaVideoCommand = {
  args: string[]
  downloadDir: string
}

type DreaminaVideoPlan = {
  commands: DreaminaVideoCommand[]
  outputDir: string
  finalOutputPath?: string
}

export class Router extends EventEmitter {
  private adapters = new Map<string, Adapter>()
  private userAdapters = new Map<string, Map<string, Adapter>>()
  private policy: PolicyConfig
  // Track in-flight sessions so runSession loops can be cancelled
  private runningLoops = new Set<string>()
  private runEpochs = new Map<string, number>()
  private turnControllers = new Map<string, AbortController>()
  private timeoutExtensions = new Map<string, number>()
  private lastStreamStepSignatures = new Map<string, string>()
  private externalJobTimers = new Map<string, NodeJS.Timeout>()
  private activeSessionWatchdog?: NodeJS.Timeout
  private dreaminaQuery: NonNullable<RouterOptions['dreaminaQuery']>
  private dreaminaSubmit: NonNullable<RouterOptions['dreaminaSubmit']>
  private dreaminaPollIntervalMs: number

  constructor(policy: Partial<PolicyConfig> = {}, options: RouterOptions = {}) {
    super()
    this.policy = { ...DEFAULT_POLICY, ...policy }
    this.dreaminaQuery = options.dreaminaQuery ?? queryDreaminaResult
    this.dreaminaSubmit = options.dreaminaSubmit ?? submitDreaminaCommand
    this.dreaminaPollIntervalMs = options.dreaminaPollIntervalMs ?? DREAMINA_POLL_INTERVAL_MS
    this.startActiveSessionWatchdog()
  }

  // ── Adapter registry ────────────────────────────────────────────────────────

  registerAdapter(adapter: Adapter): void {
    this.adapters.set(adapter.name, adapter)
  }

  clearAdapters(): void {
    this.adapters.clear()
  }

  registerUserAdapter(userId: string, adapter: Adapter): void {
    const adapters = this.userAdapters.get(userId) ?? new Map<string, Adapter>()
    adapters.set(adapter.name, adapter)
    this.userAdapters.set(userId, adapters)
  }

  clearUserAdapters(userId: string): void {
    this.userAdapters.delete(userId)
  }

  getAdapter(name: string): Adapter | undefined {
    return this.adapters.get(name)
  }

  listAdapters(): Adapter[] {
    return Array.from(this.adapters.values())
  }

  // ── Task control ────────────────────────────────────────────────────────────

  startTask(params: {
    userId?: string
    agent: AgentRef
    prompt: string
    context?: SessionContext
    systemPrompt?: string
    cwd?: string
  }): Task {
    const task = state.createTask({
      id: uuidv4(),
      userId: params.userId,
      agent: params.agent,
      prompt: params.prompt,
      context: params.context,
      systemPrompt: params.systemPrompt,
      cwd: params.cwd,
    })

    this.emit('event', { type: 'task:created', payload: task } satisfies WsEvent)

    setImmediate(() => {
      this.runTask(task.id).catch((err) => {
        console.error(`[router] task error ${task.id}:`, err)
      })
    })

    return task
  }

  recoverTasks(): void {
    for (const task of state.listTasks({ status: 'running' })) {
      const failed = state.updateTask(task.id, {
        status: 'error',
        errorMessage: 'Task interrupted by server restart',
        finishedAt: Date.now(),
      }, task.userId)
      this.emit('event', { type: 'task:error', payload: failed } satisfies WsEvent)
    }
    for (const task of state.listTasks({ status: 'queued' })) {
      setImmediate(() => {
        this.runTask(task.id).catch((err) => {
          console.error(`[router] recovered task error ${task.id}:`, err)
        })
      })
    }
  }

  recoverSessions(): void {
    for (const session of state.listSessions({ status: 'active' })) {
      state.updateSession(session.id, { status: 'paused' })
      this.emitLog('warn', `Recovered interrupted session as paused [${session.id.slice(0, 8)}]`, session.id)
    }
  }

  private startActiveSessionWatchdog(): void {
    this.activeSessionWatchdog = setInterval(() => {
      this.reconcileActiveSessions()
    }, ACTIVE_SESSION_WATCHDOG_INTERVAL_MS)
    this.activeSessionWatchdog.unref()
  }

  private reconcileActiveSessions(): void {
    const staleAfterMs = Math.max(this.policy.messageTimeout, 60_000)
    const now = Date.now()
    for (const session of state.listSessions({ status: 'active' })) {
      const age = now - session.updatedAt
      if (age < staleAfterMs) continue
      if (this.runningLoops.has(session.id)) {
        this.emitLog('error', `Watchdog aborting stale active turn [${session.id.slice(0, 8)}]`, session.id)
        this.runningLoops.delete(session.id)
        this.abortActiveTurn(session.id)
      }
      this.markError(
        session.id,
        new Error(`Session lost active run loop after ${Math.round(age / 1000)}s without progress`),
        this.inferFailedRound(session),
        'policy_stop'
      )
      this.emitLog('error', `Watchdog marked stale active session as error [${session.id.slice(0, 8)}]`, session.id)
    }
  }

  recoverExternalJobs(): void {
    for (const job of state.listExternalJobs('querying')) {
      const session = state.getSession(job.sessionId)
      if (!session || session.status === 'done' || session.status === 'stopped') {
        state.updateExternalJob(job.provider, job.externalId, { status: 'stopped' })
        continue
      }
      state.updateSession(job.sessionId, { status: 'active' })
      this.scheduleExternalJobPoll(job, 0)
    }
  }

  async stopTask(id: string): Promise<Task> {
    const task = state.getTask(id)
    if (!task) throw new Error(`Task ${id} not found`)
    if (task.status === 'done' || task.status === 'error' || task.status === 'stopped') return task
    const stopped = state.updateTask(id, {
      status: 'stopped',
      finishedAt: Date.now(),
    }, task.userId)
    this.emit('event', { type: 'task:updated', payload: stopped } satisfies WsEvent)
    return stopped
  }

  private async runTask(taskId: string): Promise<void> {
    const task = state.getTask(taskId)
    if (!task || task.status !== 'queued') return

    const adapter = this.resolveAdapter(task.agent.adapter, task.userId)
    if (!adapter) {
      if (state.getTask(task.id, task.userId)?.status === 'stopped') return
      const failed = state.updateTask(task.id, {
        status: 'error',
        errorMessage: `Adapter not found: ${task.agent.adapter}`,
        finishedAt: Date.now(),
      }, task.userId)
      this.emit('event', { type: 'task:error', payload: failed } satisfies WsEvent)
      return
    }

    const running = state.updateTask(task.id, {
      status: 'running',
      startedAt: Date.now(),
    }, task.userId)
    this.emit('event', { type: 'task:updated', payload: running } satisfies WsEvent)

    let lastOutput = ''
    const opts: AdapterSendOpts = {
      systemPrompt: task.systemPrompt ?? generateTaskSystemPrompt(task.context),
      onOutput: (line) => {
        if (state.getTask(task.id, task.userId)?.status === 'stopped') return
        lastOutput = line
        state.updateTask(task.id, { lastAgentOutput: line }, task.userId)
      },
    }
    this.applyAdapterSecret(adapter, task.userId, opts)

    try {
      const result = await this.callTaskWithRetry(adapter, task, opts)
      if (state.getTask(task.id, task.userId)?.status === 'stopped') return
      const output = result.content
      const done = state.updateTask(task.id, {
        status: 'done',
        output,
        result: extractResultSummary(output),
        lastAgentOutput: lastOutput || output,
        finishedAt: Date.now(),
      }, task.userId)
      this.emit('event', { type: 'task:done', payload: done } satisfies WsEvent)
    } catch (err) {
      if (state.getTask(task.id, task.userId)?.status === 'stopped') return
      const failed = state.updateTask(task.id, {
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
        lastAgentOutput: readLastAgentOutput(err) || lastOutput,
        finishedAt: Date.now(),
      }, task.userId)
      this.emit('event', { type: 'task:error', payload: failed } satisfies WsEvent)
    }
  }

  private async callTaskWithRetry(adapter: Adapter, task: Task, opts?: AdapterSendOpts): Promise<AdapterResponse> {
    const pseudoSession = buildTaskSession(task)
    let lastErr: unknown

    for (let attempt = 0; attempt <= this.policy.retries; attempt++) {
      try {
        const result = await adapter.send(pseudoSession, task.prompt, opts)
        return normalizeAdapterResponse(result)
      } catch (err) {
        lastErr = err
        if (opts?.signal?.aborted) break
        if (attempt < this.policy.retries) {
          await sleep(1000)
        }
      }
    }

    throw lastErr
  }

  // ── Session control ─────────────────────────────────────────────────────────

  startSession(params: {
    userId?: string
    from: AgentRef
    to: AgentRef
    initialPrompt: string
    mode?: SessionMode
    context?: SessionContext
    systemPrompts?: { from: string; to: string }
    templateId?: string
    maxRounds?: number
    approveMode?: boolean
    permissionMode?: Session['permissionMode']
    cwd?: string
  }): Session {
    const session = this.createSessionRecord(params, 'active')

    this.emitLog('info', `Session started: ${agentLabel(params.from)} → ${agentLabel(params.to)} [${session.id.slice(0, 8)}] mode=${session.mode} permission=${session.permissionMode}${session.cwd ? ` cwd=${session.cwd}` : ''}`, session.id)

    // Kick off the run loop (non-blocking)
    this.startRunLoop(session.id, params.initialPrompt)

    return session
  }

  startPipeline(params: {
    userId?: string
    name: string
    steps: Array<{
      title?: string
      nodeType?: WorkflowNodeType
      contract?: WorkflowStepContract
      from: AgentRef
      to: AgentRef
      initialPrompt: string
      mode?: SessionMode
      context?: SessionContext
      maxRounds?: number
      approveMode?: boolean
      permissionMode?: Session['permissionMode']
      cwd?: string
      dependsOn?: number[]
      manualDone?: boolean
      manualOutput?: string
    }>
  }): Pipeline {
    if (params.steps.length === 0) {
      throw new Error('Pipeline requires at least one step')
    }

    const created = params.steps.map((step) => {
      const hasDependencies = (step.dependsOn?.length ?? 0) > 0
      const session = this.createSessionRecord({ ...step, userId: params.userId }, step.manualDone || hasDependencies ? 'paused' : 'active')
      if (!step.manualDone) return session

      const manualOutput = formatManualPipelineOutput(step.manualOutput)
      this.recordMessage(session.id, 'workflow', manualOutput, 1)
      const done = state.updateSession(session.id, {
        status: 'done',
        currentRound: 1,
        lastAgentOutput: manualOutput,
      })
      this.emitLog('info', `Workflow step marked done from manual input [${session.id.slice(0, 8)}]`, session.id)
      this.emit('event', { type: 'session:done', payload: done } satisfies WsEvent)
      return done
    })

    const stepStatuses = params.steps.map((step, index) => {
      if (step.manualDone) return 'done' as const
      return step.dependsOn?.length ? 'pending' as const : 'active' as const
    })
    const initialPipelineStatus: Pipeline['status'] = stepStatuses.every((status) => status === 'done') ? 'done' : 'active'
    const pipeline = state.createPipeline({
      id: uuidv4(),
      userId: params.userId,
      name: params.name,
      status: initialPipelineStatus,
      sessions: params.steps.map((step, index) => ({
        sessionId: created[index].id,
        title: step.title,
        nodeType: step.nodeType,
        contract: step.contract,
        dependsOn: step.dependsOn?.map((depIndex) => created[depIndex].id),
        status: stepStatuses[index],
      })),
    })

    this.emit('event', { type: 'pipeline:created', payload: pipeline } satisfies WsEvent)

    params.steps.forEach((step, index) => {
      if (!step.manualDone && !step.dependsOn?.length) {
        if (this.shouldUseHostImageGenerationStep(step.nodeType, created[index])) {
          this.prepareHostImageGenerationStep(created[index].id)
        } else if (this.shouldUseDirectVideoGenerationStep(step.nodeType)) {
          this.submitDreaminaVideoStep(created[index].id).catch((err) => this.markVideoStepSubmitError(created[index].id, err))
        } else {
          this.startRunLoop(created[index].id, step.initialPrompt)
        }
      }
    })

    if (params.steps.some((step) => step.manualDone) && initialPipelineStatus !== 'done') {
      this.resumePipelineReadySteps(pipeline).catch((err) => {
        console.error(`[router] pipeline resume error for ${pipeline.id}:`, err)
      })
    }

    return pipeline
  }

  async pauseSession(id: string): Promise<Session> {
    this.runningLoops.delete(id)
    this.timeoutExtensions.delete(id)
    this.nextRunEpoch(id)
    this.abortActiveTurn(id)
    const session = state.updateSession(id, { status: 'paused' })
    this.emit('event', { type: 'session:paused', payload: session } satisfies WsEvent)
    this.emitLog('info', `Session paused [${id.slice(0, 8)}] at round ${session.currentRound}`, id)
    return session
  }

  async resumeSession(id: string, extraRounds?: number): Promise<Session> {
    const session = state.getSession(id)
    if (!session) throw new Error(`Session ${id} not found`)
    if (session.status !== 'paused' && session.status !== 'stopped') throw new Error(`Session ${id} is not paused or stopped`)

    const pipelineStep = state.getPipelineBySession(id)?.sessions.find((step) => step.sessionId === id)
    if (this.shouldUseHostImageGenerationStep(pipelineStep?.nodeType, session)) {
      return this.prepareHostImageGenerationStep(id)
    }
    if (this.shouldUseDirectVideoGenerationStep(pipelineStep?.nodeType)) {
      try {
        return await this.submitDreaminaVideoStep(id)
      } catch (err) {
        this.markVideoStepSubmitError(id, err)
        return state.getSession(id)!
      }
    }

    const messages = state.getMessages(id)
    const lastMessage = messages.at(-1)
    if (!lastMessage) throw new Error(`Session ${id} has no messages`)
    if (lastMessage.from !== 'human' && detectHumanInputWait(lastMessage.content)) {
      throw new Error(`Session ${id} is waiting for human input; insert a reply instead of resuming`)
    }

    const effectiveExtraRounds = extraRounds ?? (session.currentRound >= session.maxRounds ? 1 : undefined)
    const updated = state.updateSession(id, {
      status: 'active',
      ...(effectiveExtraRounds !== undefined ? { maxRounds: session.maxRounds + effectiveExtraRounds } : {}),
      resumeCount: session.resumeCount + 1,
    })

    this.emit('event', { type: 'session:resumed', payload: updated } satisfies WsEvent)
    this.emitLog('info', `Session resumed [${id.slice(0, 8)}]${effectiveExtraRounds !== undefined ? ` (+${effectiveExtraRounds} rounds)` : ''}`, id)
    const epoch = this.nextRunEpoch(id)

    this.startRunLoop(id, lastMessage.content, epoch)

    return updated
  }

  async resumeErrorSession(id: string): Promise<Session> {
    const session = state.getSession(id)
    if (!session) throw new Error(`Session ${id} not found`)
    if (session.status !== 'error') throw new Error(`Session ${id} is not error`)
    const lastMessage = state.getMessages(id).at(-1)
    if (lastMessage?.from !== 'human' && detectHumanInputWait(lastMessage?.content ?? session.lastAgentOutput ?? '')) {
      throw new Error(`Session ${id} is waiting for human input; insert a reply instead of resuming`)
    }

    const failedRound = session.errorRound ?? this.inferFailedRound(session)
    const resumePrompt = this.buildCheckpointResumePrompt(session, failedRound)
    this.recordMessage(id, 'human', resumePrompt, failedRound)
    state.clearSessionError(id)

    const updated = state.updateSession(id, {
      status: 'active',
      currentRound: failedRound,
      nextTurn: session.nextTurn,
      resumeCount: session.resumeCount + 1,
    })

    this.emit('event', { type: 'session:resumed', payload: updated } satisfies WsEvent)
    this.emitLog('info', `Session checkpoint resume [${id.slice(0, 8)}] from round ${failedRound}`, id)

    const epoch = this.nextRunEpoch(id)
    setImmediate(() => {
      this.runSession(id, resumePrompt, epoch, failedRound).catch((err) => {
        console.error(`[router] resumeErrorSession error for ${id}:`, err)
        this.emitLog('error', `Session checkpoint resume error [${id.slice(0, 8)}]: ${String(err)}`, id)
        this.markError(id, err)
      })
    })

    return updated
  }

  async stopSession(id: string): Promise<Session> {
    this.runningLoops.delete(id)
    this.timeoutExtensions.delete(id)
    this.nextRunEpoch(id)
    this.abortActiveTurn(id)
    state.stopExternalJobsForSession(id)
    const session = state.updateSession(id, { status: 'stopped' })
    this.emit('event', { type: 'session:updated', payload: session } satisfies WsEvent)
    this.emitLog('info', `Session stopped [${id.slice(0, 8)}]`, id)
    return session
  }

  async confirmSession(id: string): Promise<Session> {
    const session = state.getSession(id)
    if (!session) throw new Error(`Session ${id} not found`)
    const messages = state.getMessages(id)
    const approvalRequest = [...messages].reverse().find((message) => (
      message.from !== 'human' && detectHumanInputWait(message.content)
    ))
    if (!approvalRequest) throw new Error(`Session ${id} is not waiting for human approval`)

    this.runningLoops.delete(id)
    this.timeoutExtensions.delete(id)
    this.nextRunEpoch(id)
    this.abortActiveTurn(id)
    state.clearSessionError(id)
    this.recordMessage(id, 'human', '通过，确认保存。', session.currentRound)

    const videoPaths = extractVideoPaths(approvalRequest.content)
    const content = [
      '[RESULT]',
      '成片已通过人工审核，确认为最终保存版。',
      '',
      ...(videoPaths.length ? ['最终视频：', ...videoPaths.map((filePath) => `\`${filePath}\``), ''] : []),
      '后处理事项：在剪映中完成字幕识别、字幕校对和样式微调后导出。',
      '[/RESULT]',
      '[DONE]',
    ].join('\n')
    this.recordMessage(id, 'turing', content, session.currentRound)
    state.updateSession(id, { lastAgentOutput: content })
    const completed = await this.completeSession(id)
    this.emit('event', { type: 'session:done', payload: completed } satisfies WsEvent)
    this.emitLog('info', `Session confirmed by human [${id.slice(0, 8)}]`, id)
    this.handlePipelineSessionFinished(id, 'done')
    return completed
  }

  async completeSessionWithManualArtifacts(id: string, paths: string[], summary?: string): Promise<Session> {
    const session = state.getSession(id)
    if (!session) throw new Error(`Session ${id} not found`)
    const resolvedPaths = paths.map((filePath) => resolveManualArtifactPath(filePath, session.cwd))
    if (resolvedPaths.length === 0) throw new Error('No artifact paths provided')

    this.runningLoops.delete(id)
    this.timeoutExtensions.delete(id)
    this.nextRunEpoch(id)
    this.abortActiveTurn(id)
    state.stopExternalJobsForSession(id)
    state.clearSessionError(id)

    const round = Math.max(1, session.currentRound)
    this.recordMessage(id, 'human', [
      '人工补充产物完成，回填文件：',
      ...resolvedPaths.map((filePath) => `- ${filePath}`),
    ].join('\n'), round)

    const content = [
      '[RESULT]',
      summary || '人工补充产物已回填。',
      '',
      ...resolvedPaths.map((filePath) => `产物：\`${filePath}\``),
      '[/RESULT]',
      '[DONE]',
    ].join('\n')
    this.recordMessage(id, 'turing', content, round, { filesModified: resolvedPaths })
    state.updateSession(id, {
      currentRound: round,
      lastAgentOutput: content,
      resumeCount: session.resumeCount + 1,
    })
    const completed = await this.completeSession(id)
    this.emit('event', { type: 'session:done', payload: completed } satisfies WsEvent)
    this.emitLog('info', `Manual artifacts completed session [${id.slice(0, 8)}]`, id)
    this.handlePipelineSessionFinished(id, 'done')
    return completed
  }

  extendSessionTimeout(id: string, extensionMs = 5 * 60 * 1000): { session: Session; extensionMs: number; totalExtensionMs: number } {
    const session = state.getSession(id)
    if (!session) throw new Error(`Session ${id} not found`)
    if (session.status !== 'active' || !this.runningLoops.has(id)) {
      throw new Error(`Session ${id} is not running`)
    }
    const totalExtensionMs = (this.timeoutExtensions.get(id) ?? 0) + extensionMs
    this.timeoutExtensions.set(id, totalExtensionMs)
    this.emitLog('info', `Session timeout extended by ${Math.round(extensionMs / 1000)}s [${id.slice(0, 8)}] total=${Math.round(totalExtensionMs / 1000)}s`, id)
    this.emit('event', {
      type: 'session:updated',
      payload: { ...session, timeoutExtensionMs: totalExtensionMs },
    } satisfies WsEvent)
    return { session, extensionMs, totalExtensionMs }
  }

  async pausePipeline(id: string): Promise<Pipeline> {
    const pipeline = state.getPipeline(id)
    if (!pipeline) throw new Error(`Pipeline ${id} not found`)
    for (const step of pipeline.sessions) {
      const session = state.getSession(step.sessionId)
      if (session?.status === 'active') {
        await this.pauseSession(step.sessionId)
      }
    }
    const updated = state.updatePipeline(id, { status: 'paused' })
    this.emit('event', { type: 'pipeline:updated', payload: updated } satisfies WsEvent)
    return updated
  }

  async resumePipeline(id: string): Promise<Pipeline> {
    const pipeline = state.getPipeline(id)
    if (!pipeline) throw new Error(`Pipeline ${id} not found`)
    const updated = state.updatePipeline(id, { status: 'active' })
    this.emit('event', { type: 'pipeline:updated', payload: updated } satisfies WsEvent)
    await this.resumePipelineReadySteps(updated)
    return state.getPipeline(id)!
  }

  async rerunPipelineStep(sessionId: string): Promise<Pipeline> {
    const pipeline = state.getPipelineBySession(sessionId)
    if (!pipeline) throw new Error(`Session ${sessionId} is not part of a pipeline`)
    const step = pipeline.sessions.find((item) => item.sessionId === sessionId)
    if (!step) throw new Error(`Pipeline step ${sessionId} not found`)

    const affected = new Set<string>([sessionId])
    let changed = true
    while (changed) {
      changed = false
      for (const item of pipeline.sessions) {
        if (affected.has(item.sessionId)) continue
        if ((item.dependsOn ?? []).some((dependencyId) => affected.has(dependencyId))) {
          affected.add(item.sessionId)
          changed = true
        }
      }
    }

    for (const affectedSessionId of affected) {
      this.runningLoops.delete(affectedSessionId)
      this.timeoutExtensions.delete(affectedSessionId)
      this.nextRunEpoch(affectedSessionId)
      this.abortActiveTurn(affectedSessionId)
      state.stopExternalJobsForSession(affectedSessionId)
      if (affectedSessionId === sessionId) state.clearExternalJobsForSession(affectedSessionId)
      this.saveSessionVersion(affectedSessionId, affectedSessionId === sessionId ? '重跑本步骤' : '上游重跑，自动重置')
      const reset = state.resetSessionForPipelineRerun(affectedSessionId)
      this.emit('event', { type: 'session:paused', payload: reset } satisfies WsEvent)
    }

    this.hydratePipelineDependencyContext(sessionId, step.dependsOn ?? [])
    const initialMessage = state.getMessages(sessionId).find((message) => message.from === 'human' && message.round === 0)
    if (!initialMessage) throw new Error(`Session ${sessionId} has no initial prompt`)

    const epoch = this.nextRunEpoch(sessionId)
    const activeSession = state.updateSession(sessionId, { status: 'active', resumeCount: 1 })
    this.emit('event', { type: 'session:resumed', payload: activeSession } satisfies WsEvent)

    const sessions = pipeline.sessions.map((item) => {
      if (item.sessionId === sessionId) return { ...item, status: 'active' as const }
      if (affected.has(item.sessionId)) return { ...item, status: 'pending' as const }
      return item
    })
    const updated = state.updatePipeline(pipeline.id, { status: 'active', sessions })
    this.emit('event', { type: 'pipeline:updated', payload: updated } satisfies WsEvent)
    this.emitLog('info', `Pipeline step rerun [${sessionId.slice(0, 8)}] reset ${affected.size - 1} descendant step(s)`, sessionId)
    if (this.shouldUseDirectVideoGenerationStep(step.nodeType)) {
      this.submitDreaminaVideoStep(sessionId).catch((err) => this.markVideoStepSubmitError(sessionId, err))
      return updated
    }
    this.startRunLoop(sessionId, initialMessage.content, epoch)
    return updated
  }

  async deletePipeline(id: string): Promise<void> {
    const pipeline = state.getPipeline(id)
    if (!pipeline) throw new Error(`Pipeline ${id} not found`)
    for (const step of pipeline.sessions) {
      const session = state.getSession(step.sessionId)
      if (session?.status === 'active') {
        this.runningLoops.delete(step.sessionId)
        this.nextRunEpoch(step.sessionId)
        const stopped = await this.completeSession(step.sessionId)
        this.emit('event', { type: 'session:done', payload: stopped } satisfies WsEvent)
      }
    }
    state.deletePipeline(id)
    this.emit('event', { type: 'pipeline:updated', payload: { id, deleted: true } } satisfies WsEvent)
  }

  // ── Human message injection ─────────────────────────────────────────────────

  injectMessage(sessionId: string, content: string): Message {
    const session = state.getSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    this.saveSessionVersion(sessionId, content)
    this.invalidatePipelineDescendants(sessionId)
    this.runningLoops.delete(sessionId)
    this.timeoutExtensions.delete(sessionId)
    this.abortActiveTurn(sessionId)
    state.stopExternalJobsForSession(sessionId)
    const epoch = this.nextRunEpoch(sessionId)
    const reopened = state.reopenSession(sessionId)
    const activated = state.updateSession(sessionId, {
      resumeCount: reopened.resumeCount + 1,
      ...(reopened.currentRound >= reopened.maxRounds ? { maxRounds: reopened.currentRound + 1 } : {}),
    })
    this.emit('event', { type: 'session:resumed', payload: activated } satisfies WsEvent)
    this.emitLog('info', `Human message activated session [${sessionId.slice(0, 8)}] from ${session.status}`, sessionId)

    const msg = this.recordMessage(sessionId, 'human', content, activated.currentRound)
    this.startRunLoop(sessionId, content, epoch)
    return msg
  }

  private saveSessionVersion(sessionId: string, reason: string): void {
    const session = state.getSession(sessionId)
    if (!session) return
    const output = session.lastAgentOutput || [...state.getMessages(sessionId)]
      .reverse()
      .find((msg) => msg.from !== 'human' && msg.content)?.content
    if (!output && !session.artifacts) return
    state.addSessionVersion({
      id: uuidv4(),
      sessionId,
      timestamp: Date.now(),
      round: session.currentRound,
      reason,
      ...(output ? { output } : {}),
      ...(session.artifacts ? { artifacts: session.artifacts } : {}),
    })
  }

  private invalidatePipelineDescendants(sessionId: string): void {
    const pipeline = state.getPipelineBySession(sessionId)
    if (!pipeline) return

    const descendants = new Set<string>()
    let changed = true
    while (changed) {
      changed = false
      for (const step of pipeline.sessions) {
        if (descendants.has(step.sessionId) || step.sessionId === sessionId) continue
        if ((step.dependsOn ?? []).some((dependencyId) => dependencyId === sessionId || descendants.has(dependencyId))) {
          descendants.add(step.sessionId)
          changed = true
        }
      }
    }

    for (const descendantId of descendants) {
      this.runningLoops.delete(descendantId)
      this.timeoutExtensions.delete(descendantId)
      this.nextRunEpoch(descendantId)
      this.abortActiveTurn(descendantId)
      const reset = state.resetSessionForPipelineRerun(descendantId)
      this.emit('event', { type: 'session:paused', payload: reset } satisfies WsEvent)
    }

    const sessions = pipeline.sessions.map((step) => {
      if (step.sessionId === sessionId) return { ...step, status: 'active' as const }
      if (descendants.has(step.sessionId)) return { ...step, status: 'pending' as const }
      return step
    })
    const updated = state.updatePipeline(pipeline.id, { status: 'active', sessions })
    this.emit('event', { type: 'pipeline:updated', payload: updated } satisfies WsEvent)
  }

  /**
   * Nudge — inject a human directive and resume.
   * Unlike injectMessage, this explicitly pauses first (if active), injects, then resumes.
   * Use when the user wants to redirect the conversation mid-flight.
   */
  async nudge(sessionId: string, content: string): Promise<Message> {
    return this.injectMessage(sessionId, content)
  }

  // ── Core run loop ────────────────────────────────────────────────────────────

  /**
   * Run rounds until done / paused / error.
   * firstMessage is the content to send to `to` in the first round.
   */
  async runSession(sessionId: string, firstMessage: string, epoch: number, firstRoundOverride?: number): Promise<void> {
    this.runningLoops.add(sessionId)

    let nextMessage = firstMessage
    let nextRoundOverride = firstRoundOverride

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Check if we've been cancelled
      if (!this.runningLoops.has(sessionId)) break
      if (this.runEpochs.get(sessionId) !== epoch) break

      const session = state.getSession(sessionId)
      if (!session) break
      if (session.status !== 'active') break

      // Pre-round policy check
      const policySession = nextRoundOverride !== undefined
        ? { ...session, currentRound: Math.max(0, nextRoundOverride - 1) }
        : session
      const preCheck = session.nextTurn === 'to'
        ? checkPreRound(policySession, this.policy)
        : checkSessionTimeout(policySession, this.policy)
      if (!preCheck.allowed) {
        this.emitLog('warn', `Policy check failed [${sessionId.slice(0, 8)}]: ${preCheck.reason ?? 'unknown'}`, sessionId)
        if (preCheck.reason === 'session_timeout' || preCheck.reason === 'message_timeout') {
          this.markError(
            sessionId,
            new Error(preCheck.reason),
            this.inferFailedRound(session),
            'policy_stop'
          )
          break
        }
        await this.pauseSession(sessionId)
        this.emit('event', {
          type: 'session:paused',
          payload: { session, reason: preCheck.reason },
        } satisfies WsEvent)
        break
      }

      // If approveMode, pause and wait for external resume
      if (session.approveMode && session.resumeCount === 0) {
        this.emitLog('info', `Approve mode — waiting for approval [${sessionId.slice(0, 8)}]`, sessionId)
        await this.pauseSession(sessionId)
        break
      }

      this.emitLog('info', `Round ${nextRoundOverride ?? session.currentRound + 1} starting [${sessionId.slice(0, 8)}]`, sessionId)

      try {
        const result = await this.processTurn(sessionId, nextMessage, epoch, nextRoundOverride)
        nextRoundOverride = undefined
        if (result.waiting) {
          break
        }
        if (result.done) {
          const updated = await this.completeSession(sessionId)
          this.emit('event', { type: 'session:done', payload: updated } satisfies WsEvent)
          this.emitLog('info', `Session completed [${sessionId.slice(0, 8)}] after ${updated.currentRound} rounds`, sessionId)
          this.handlePipelineSessionFinished(sessionId, 'done')
          break
        }
        nextMessage = result.nextMessage
      } catch (err) {
        if (this.runEpochs.get(sessionId) !== epoch || !this.runningLoops.has(sessionId)) {
          break
        }
        console.error(`[router] round error session ${sessionId}:`, err)
        this.emitLog('error', `Round error [${sessionId.slice(0, 8)}]: ${String(err)}`, sessionId)
        if (await this.completeWorkflowStepAfterAdapterError(sessionId, err)) {
          break
        }
        const failed = state.getSession(sessionId)
        this.markError(sessionId, err, failed ? this.inferFailedRound(failed) : undefined)
        break
      }
    }

    if (this.runEpochs.get(sessionId) === epoch) {
      this.runningLoops.delete(sessionId)
    }
  }

  /**
   * Execute one message turn. `session.nextTurn` decides who should receive the
   * next message, so pause/resume can safely continue mid-round.
   */
  private async processTurn(
    sessionId: string,
    message: string,
    epoch: number,
    roundOverride?: number
  ): Promise<{ done: boolean; waiting?: boolean; nextMessage: string }> {
    const session = state.getSession(sessionId)!
    const recipient = session.nextTurn
    const target = recipient === 'to' ? session.to : session.from
    const round = roundOverride ?? (recipient === 'to' ? session.currentRound + 1 : session.currentRound)
    const adapter = this.resolveAdapter(target.adapter, session.userId)

    if (!adapter) throw new Error(`Adapter not found: ${target.adapter}`)
    this.emitLog('info', `Adapter call: ${target.adapter} [${sessionId.slice(0, 8)}] round=${round} turn=${recipient}`, sessionId)
    let lastOutput = 'Starting...'
    const startedAt = Date.now()
    let lastProgressPersistedAt = startedAt
    state.updateSession(sessionId, { lastAgentOutput: lastOutput })
    const emitHeartbeat = () => {
      this.emit('event', {
        type: 'heartbeat',
        sessionId,
        round,
        agent: target.adapter,
        status: 'running',
        elapsed: Date.now() - startedAt,
        lastOutput,
      } satisfies WsEvent)
    }
    const heartbeat = setInterval(emitHeartbeat, 10_000)
    heartbeat.unref()
    emitHeartbeat()

    const opts = this.buildSendOpts(session, recipient, adapter)
    const controller = new AbortController()
    this.turnControllers.set(sessionId, controller)
    opts.signal = controller.signal
    opts.onOutput = (line) => {
      lastOutput = line
      const now = Date.now()
      if (now - lastProgressPersistedAt > 5_000) {
        lastProgressPersistedAt = now
        state.updateSession(sessionId, { lastAgentOutput: lastOutput })
      }
      this.emit('event', {
        type: 'message:delta',
        payload: {
          sessionId,
          content: line,
          from: target.adapter,
        },
      } satisfies WsEvent)
      this.emitStreamStep(sessionId, line)
    }
    let response: AdapterResponse
    try {
      response = await this.callWithRetry(adapter, session, message, opts)
    } catch (err) {
      if (err && typeof err === 'object') {
        Object.assign(err, { lastAgentOutput: lastOutput, errorRound: round })
      }
      throw err
    } finally {
      clearInterval(heartbeat)
      if (this.turnControllers.get(sessionId) === controller) {
        this.timeoutExtensions.delete(sessionId)
        this.turnControllers.delete(sessionId)
      }
    }
    if (this.runEpochs.get(sessionId) !== epoch || !this.runningLoops.has(sessionId)) {
      return { done: false, nextMessage: message }
    }
    const duration = Date.now() - startedAt
    const metadata: RoundMetadata = {
      ...response.metadata,
      duration,
    }
    const content = response.content
    this.emitLog('info', `Adapter response: ${target.adapter} [${sessionId.slice(0, 8)}] (${content.length} chars)`, sessionId)

    this.recordMessage(sessionId, target.adapter, content, round, metadata)
    this.emitStreamStep(sessionId, content, 'done')
    await this.captureGitSnapshot(sessionId, round)

    if (recipient === 'to') {
      state.updateSession(sessionId, {
        currentRound: round,
        nextTurn: 'from',
      })
      const pendingJob = detectDreaminaSubmittedJob(content, session)
      if (pendingJob) {
        this.registerDreaminaJob(sessionId, pendingJob)
        return { done: false, waiting: true, nextMessage: content }
      }
      if (detectHumanInputWait(content)) {
        await this.pauseSession(sessionId)
        this.emitLog('info', `Waiting for human input [${sessionId.slice(0, 8)}]`, sessionId)
        return { done: false, waiting: true, nextMessage: content }
      }
      const assistanceRequest = detectAgentAssistanceRequest(content)
      if (assistanceRequest) {
        this.emitLog('info', `Executor requested planner assistance [${sessionId.slice(0, 8)}]`, sessionId)
        return {
          done: false,
          nextMessage: buildPlannerAssistanceDirective(content, assistanceRequest),
        }
      }
      return { done: false, nextMessage: content }
    }

    state.updateSession(sessionId, { nextTurn: 'to' })
    const pendingJob = detectDreaminaSubmittedJob(content, session)
    if (pendingJob) {
      this.registerDreaminaJob(sessionId, pendingJob)
      return { done: false, waiting: true, nextMessage: content }
    }
    if (detectHumanInputWait(content)) {
      await this.pauseSession(sessionId)
      this.emitLog('info', `Waiting for human input [${sessionId.slice(0, 8)}]`, sessionId)
      return { done: false, waiting: true, nextMessage: content }
    }
    if (this.shouldCompleteSession(sessionId, session, content)) {
      return { done: true, nextMessage: content }
    }

    return { done: false, nextMessage: content }
  }

  /**
   * Build AdapterSendOpts with system prompt and conversation history.
   * `perspective` determines which agent we're building for.
   */
  private buildSendOpts(session: Session, perspective: 'from' | 'to', adapter: Adapter): AdapterSendOpts {
    const systemPrompt = session.systemPrompts?.[perspective]
    const messages = state.getMessages(session.id).slice(-MAX_HISTORY_MESSAGES)

    // Build history from the perspective of this agent
    // Messages from this agent are 'assistant', messages from the other agent (or human) are 'user'
    const selfAdapter = perspective === 'from' ? session.from.adapter : session.to.adapter
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = []

    for (const msg of messages) {
      if (msg.from === selfAdapter) {
        history.push({ role: 'assistant', content: msg.content })
      } else {
        history.push({ role: 'user', content: msg.content })
      }
    }

    const opts: AdapterSendOpts = { systemPrompt, history }
    opts.getTimeoutExtensionMs = () => this.timeoutExtensions.get(session.id) ?? 0
    this.applyAdapterSecret(adapter, session.userId, opts)
    return opts
  }

  private applyAdapterSecret(adapter: Adapter, userId: string | undefined, opts: AdapterSendOpts): void {
    const keyId = typeof adapter.config.keyId === 'string' ? adapter.config.keyId : undefined
    if (keyId && userId) {
      opts.apiKey = decryptKey(userId, keyId).key
    }
  }

  private resolveAdapter(name: string, userId?: string): Adapter | undefined {
    if (userId) {
      const adapter = this.userAdapters.get(userId)?.get(name)
      if (adapter) return adapter
    }
    return this.adapters.get(name)
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async callWithRetry(adapter: Adapter, session: Session, message: string, opts?: AdapterSendOpts): Promise<AdapterResponse> {
    let lastErr: unknown
    for (let attempt = 0; attempt <= this.policy.retries; attempt++) {
      try {
        const result = await adapter.send(session, message, opts)
        return normalizeAdapterResponse(result)
      } catch (err) {
        lastErr = err
        if (opts?.signal?.aborted) break
        if (attempt < this.policy.retries) {
          this.emitLog('warn', `Adapter ${adapter.name} attempt ${attempt + 1} failed, retrying… [${session.id.slice(0, 8)}]`, session.id)
          console.warn(`[router] adapter ${adapter.name} attempt ${attempt + 1} failed, retrying...`)
          await sleep(1000)
        } else {
          this.emitLog('error', `Adapter ${adapter.name} failed after ${attempt + 1} attempts [${session.id.slice(0, 8)}]: ${String(err)}`, session.id)
        }
      }
    }
    throw lastErr
  }

  private recordMessage(sessionId: string, from: string, content: string, round: number, metadata?: RoundMetadata): Message {
    const msg = state.addMessage({
      id: uuidv4(),
      sessionId,
      from,
      content,
      timestamp: Date.now(),
      round,
      metadata,
    })
    this.emit('event', { type: 'message:new', payload: msg } satisfies WsEvent)
    return msg
  }

  private emitStreamStep(sessionId: string, output: string, forcedType?: StreamStep['type']): void {
    const step = forcedType === 'done' ? buildDoneStep(output) : parseStreamStep(output)
    if (!step) return
    const signature = `${step.type}:${step.summary}`
    if (this.lastStreamStepSignatures.get(sessionId) === signature) return
    this.lastStreamStepSignatures.set(sessionId, signature)
    this.emit('event', {
      type: 'message:step',
      payload: { sessionId, step },
    } satisfies WsEvent)
  }

  private markError(sessionId: string, err?: unknown, errorRound?: number, errorType?: SessionErrorType): void {
    try {
      const session = state.getSession(sessionId)
      const message = errorMessage(err)
      const updated = state.updateSession(sessionId, {
        status: 'error',
        errorType: errorType ?? classifyError(message),
        errorRound: errorRound ?? errorRoundFromError(err) ?? (session ? this.inferFailedRound(session) : undefined),
        errorMessage: message,
        lastAgentOutput: lastAgentOutputFromError(err),
      })
      this.emit('event', { type: 'session:error', payload: updated } satisfies WsEvent)
      this.handlePipelineSessionFinished(sessionId, 'error')
    } catch (_) { /* best-effort */ }
  }

  private createSessionRecord(params: {
    userId?: string
    from: AgentRef
    to: AgentRef
    initialPrompt: string
    mode?: SessionMode
    context?: SessionContext
    systemPrompts?: { from: string; to: string }
    templateId?: string
    maxRounds?: number
    approveMode?: boolean
    permissionMode?: Session['permissionMode']
    cwd?: string
  }, initialStatus: 'active' | 'paused'): Session {
    if (params.permissionMode === 'trusted' && !params.cwd) {
      throw new Error('Trusted permission mode requires cwd')
    }

    const mode = params.mode ?? 'freeform'
    const fromAdapter = this.resolveAdapter(params.from.adapter, params.userId)
    const toAdapter = this.resolveAdapter(params.to.adapter, params.userId)
    const systemPrompts = params.systemPrompts ?? generateSystemPrompts(
      mode,
      params.from,
      params.to,
      params.initialPrompt,
      params.context,
      {
        fromCanUseTools: adapterCanUseTools(fromAdapter),
        toCanUseTools: adapterCanUseTools(toAdapter),
      }
    )

    const created = state.createSession({
      id: uuidv4(),
      userId: params.userId,
      from: params.from,
      to: params.to,
      mode,
      context: params.context,
      systemPrompts,
      templateId: params.templateId,
      nextTurn: 'to',
      maxRounds: params.maxRounds ?? this.policy.maxRounds,
      approveMode: params.approveMode ?? false,
      permissionMode: params.permissionMode ?? 'safe',
      cwd: params.cwd,
      gitSnapshot: captureGitHead(params.cwd),
    })
    this.recordMessage(created.id, 'human', params.initialPrompt, 0)

    const session = initialStatus === 'paused'
      ? state.updateSession(created.id, { status: 'paused' })
      : created

    this.emit('event', { type: 'session:created', payload: session } satisfies WsEvent)
    this.emitLog(session.permissionMode === 'trusted' ? 'warn' : 'info', `Permission mode: ${session.permissionMode}${session.permissionMode === 'trusted' ? ' — CLI approvals may be bypassed' : ''}`, session.id)
    return session
  }

  private startRunLoop(sessionId: string, firstMessage: string, epoch = this.nextRunEpoch(sessionId)): void {
    setImmediate(() => {
      this.runSession(sessionId, firstMessage, epoch).catch((err) => {
        console.error(`[router] runSession error for ${sessionId}:`, err)
        this.emitLog('error', `Session run error [${sessionId.slice(0, 8)}]: ${String(err)}`, sessionId)
        this.markError(sessionId, err)
      })
    })
  }

  private shouldUseHostImageGenerationStep(nodeType: WorkflowNodeType | undefined, session: Session): boolean {
    return nodeType === 'image_generate' && session.to.adapter === 'codex'
  }

  private shouldUseDirectVideoGenerationStep(nodeType: WorkflowNodeType | undefined): boolean {
    return nodeType === 'video_generate'
  }

  private async submitDreaminaVideoStep(sessionId: string): Promise<Session> {
    const session = state.getSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    this.runningLoops.delete(sessionId)
    this.timeoutExtensions.delete(sessionId)
    this.nextRunEpoch(sessionId)
    this.abortActiveTurn(sessionId)
    state.clearSessionError(sessionId)

    const active = state.updateSession(sessionId, {
      status: 'active',
      resumeCount: session.resumeCount + 1,
    })
    this.emit('event', { type: 'session:resumed', payload: active } satisfies WsEvent)
    this.emitLog('info', `Direct Dreamina video submission [${sessionId.slice(0, 8)}]`, sessionId)

    const plan = readDreaminaVideoPlan(active)
    const doneJobs = state.listExternalJobs('done')
      .filter((job) => job.sessionId === sessionId && job.resultPaths?.length)
      .sort((a, b) => a.createdAt - b.createdAt)
    const next = plan.commands[doneJobs.length]
    if (!next) return this.completeDreaminaVideoPlan(sessionId, plan)

    const stdout = await this.dreaminaSubmit(next.args, active.cwd)
    const externalId = parseDreaminaSubmitId(stdout)
    if (!externalId) {
      throw new Error(`Dreamina did not return submit_id. Output: ${truncate(stdout, 1000)}`)
    }

    const content = [
      '[RESULT]',
      `已提交即梦视频片段 ${doneJobs.length + 1}/${plan.commands.length}。`,
      '',
      `submit_id：\`${externalId}\``,
      `命令：\`${DREAMINA_COMMAND} ${next.args.map(shellQuote).join(' ')}\``,
      `下载目录：\`${next.downloadDir}\``,
      '状态：`querying`',
      '[/RESULT]',
    ].join('\n')
    this.recordMessage(sessionId, 'dreamina', content, Math.max(1, active.currentRound + 1))
    state.updateSession(sessionId, {
      currentRound: Math.max(1, active.currentRound + 1),
      lastAgentOutput: content,
    })
    this.registerDreaminaJob(sessionId, { externalId, downloadDir: next.downloadDir })
    return state.getSession(sessionId)!
  }

  private async completeDreaminaVideoPlan(sessionId: string, plan: DreaminaVideoPlan): Promise<Session> {
    const doneJobs = state.listExternalJobs('done')
      .filter((job) => job.sessionId === sessionId && job.resultPaths?.length)
      .sort((a, b) => a.createdAt - b.createdAt)
    const inputVideos = doneJobs.flatMap((job) => job.resultPaths ?? [])
    if (!inputVideos.length) throw new Error('No generated video files found for concat')

    let finalPath = plan.finalOutputPath ?? inputVideos[0]
    if (inputVideos.length > 1) {
      finalPath = plan.finalOutputPath ?? path.join(plan.outputDir, 'final-draft.mp4')
      await concatVideos(inputVideos, finalPath)
    }

    const content = [
      '[RESULT]',
      '即梦视频生成完成。',
      '',
      '片段文件：',
      ...inputVideos.map((filePath) => `\`${filePath}\``),
      '',
      `最终视频：\`${finalPath}\``,
      '[/RESULT]',
      '[DONE]',
    ].join('\n')
    const session = state.getSession(sessionId)
    this.recordMessage(sessionId, 'dreamina', content, Math.max(1, session?.currentRound ?? 1))
    state.updateSession(sessionId, { lastAgentOutput: content })
    const completed = await this.completeSession(sessionId)
    this.emit('event', { type: 'session:done', payload: completed } satisfies WsEvent)
    this.emitLog('info', `Dreamina video plan completed [${sessionId.slice(0, 8)}]`, sessionId)
    this.handlePipelineSessionFinished(sessionId, 'done')
    return completed
  }

  private markVideoStepSubmitError(sessionId: string, err: unknown): void {
    const content = [
      '[RESULT]',
      '视频生成提交失败。',
      '',
      `原因：${errorMessage(err)}`,
      '[/RESULT]',
    ].join('\n')
    const session = state.getSession(sessionId)
    this.recordMessage(sessionId, 'turing', content, Math.max(1, session?.currentRound ?? 1))
    state.updateSession(sessionId, { lastAgentOutput: content })
    this.markError(sessionId, err)
  }

  private prepareHostImageGenerationStep(sessionId: string): Session {
    const session = state.getSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    this.runningLoops.delete(sessionId)
    this.timeoutExtensions.delete(sessionId)
    this.nextRunEpoch(sessionId)
    this.abortActiveTurn(sessionId)
    state.stopExternalJobsForSession(sessionId)
    state.clearSessionError(sessionId)

    const messages = state.getMessages(sessionId)
    const existingHostRequest = [...messages].reverse().find((message) => message.from !== 'human' && message.content.includes('HOST_IMAGE_GENERATION_REQUIRED'))
    const round = Math.max(1, session.currentRound)
    const outputDirectory = sessionOutputDirectory(session) ?? session.cwd ?? ''
    const content = [
      '[RESULT]',
      'HOST_IMAGE_GENERATION_REQUIRED',
      '',
      '本步骤需要 Codex 主进程内置生图工具执行。Turing 后端不会再启动 Codex 子进程，避免空转。',
      '',
      '处理方式：',
      '1. 在 Codex 主进程根据本步骤输出和上游 `script.md`、`prompt.txt` 生成图片。',
      '2. 把生成图片保存到本工作流输出目录。',
      '3. 点击“主进程补图回填”，提交图片绝对路径。',
      '',
      `输出目录：\`${outputDirectory}\``,
      '[/RESULT]',
    ].join('\n')

    if (!existingHostRequest || !existingHostRequest.content.includes(`输出目录：\`${outputDirectory}\``)) {
      this.recordMessage(sessionId, 'turing', content, round)
    }
    const updated = state.updateSession(sessionId, {
      status: 'paused',
      currentRound: round,
      lastAgentOutput: content,
      resumeCount: session.resumeCount + 1,
    })
    this.emit('event', { type: 'session:paused', payload: updated } satisfies WsEvent)
    this.emitLog('info', `Host image generation required [${sessionId.slice(0, 8)}]`, sessionId)
    return updated
  }

  private handlePipelineSessionFinished(sessionId: string, status: 'done' | 'error'): void {
    const pipeline = state.getPipelineBySession(sessionId)
    if (!pipeline) return

    const sessions = pipeline.sessions.map((step) => (
      step.sessionId === sessionId ? { ...step, status } : step
    ))

    const hasError = sessions.some((step) => step.status === 'error')
    const allDone = sessions.every((step) => step.status === 'done')
    const nextStatus: Pipeline['status'] = hasError ? 'error' : allDone ? 'done' : 'active'
    const updated = state.updatePipeline(pipeline.id, { status: nextStatus, sessions })

    if (status === 'error') {
      this.emit('event', { type: 'pipeline:error', payload: updated } satisfies WsEvent)
    } else if (nextStatus === 'done') {
      this.emit('event', { type: 'pipeline:done', payload: updated } satisfies WsEvent)
    } else {
      this.emit('event', { type: 'pipeline:updated', payload: updated } satisfies WsEvent)
    }

    if (nextStatus !== 'done') {
      this.resumePipelineReadySteps(updated).catch((err) => {
        console.error(`[router] pipeline resume error for ${pipeline.id}:`, err)
      })
    }
  }

  private async resumePipelineReadySteps(pipeline: Pipeline): Promise<void> {
    if (pipeline.status === 'paused') return

    let changed = false
    const done = new Set(pipeline.sessions.filter((step) => step.status === 'done').map((step) => step.sessionId))
    const sessions = pipeline.sessions.map((step) => {
      if (step.status !== 'pending') return step
      if (!(step.dependsOn ?? []).every((dep) => done.has(dep))) return step
      const session = state.getSession(step.sessionId)
      if (session?.status === 'paused') {
        this.hydratePipelineDependencyContext(step.sessionId, step.dependsOn ?? [])
        if (session.approveMode) {
          this.emitLog('info', `Pipeline approval gate — waiting before step starts [${step.sessionId.slice(0, 8)}]`, step.sessionId)
          changed = true
          return { ...step, status: 'active' as const }
        }
        if (this.shouldUseHostImageGenerationStep(step.nodeType, session)) {
          this.prepareHostImageGenerationStep(step.sessionId)
          changed = true
          return { ...step, status: 'active' as const }
        }
        if (this.shouldUseDirectVideoGenerationStep(step.nodeType)) {
          this.submitDreaminaVideoStep(step.sessionId).catch((err) => this.markVideoStepSubmitError(step.sessionId, err))
          changed = true
          return { ...step, status: 'active' as const }
        }
        const initialMessage = state.getMessages(step.sessionId).find((msg) => msg.from === 'human' && msg.round === 0)
        const resumed = state.updateSession(step.sessionId, { status: 'active' })
        this.emit('event', { type: 'session:resumed', payload: resumed } satisfies WsEvent)
        if (initialMessage) {
          this.startRunLoop(step.sessionId, initialMessage.content)
        }
      }
      changed = true
      return { ...step, status: 'active' as const }
    })

    if (changed) {
      const updated = state.updatePipeline(pipeline.id, { sessions, status: pipeline.status === 'error' ? 'error' : 'active' })
      this.emit('event', { type: 'pipeline:updated', payload: updated } satisfies WsEvent)
    }
  }

  private async captureGitSnapshot(sessionId: string, round: number): Promise<void> {
    const session = state.getSession(sessionId)
    if (!session?.cwd) return

    try {
      const [diffStat, diffFull] = await Promise.all([
        runGitDiff(session.cwd, ['diff', '--stat']),
        runGitDiff(session.cwd, ['diff']),
      ])
      const snapshot = state.addSnapshot({
        id: uuidv4(),
        sessionId,
        round,
        timestamp: Date.now(),
        diffStat,
        diffFull,
      })
      this.emit('event', { type: 'snapshot:new', payload: snapshot } satisfies WsEvent)
    } catch (err) {
      this.emitLog('warn', `Git diff snapshot failed [${sessionId.slice(0, 8)}]: ${errorMessage(err)}`, sessionId)
    }
  }

  private async completeSession(sessionId: string): Promise<Session> {
    const session = state.getSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    const artifacts = await buildSessionArtifacts(session)
    const lastAgentOutput = [...state.getMessages(sessionId)]
      .reverse()
      .find((message) => message.from !== 'human' && message.content.trim())
      ?.content
    return state.updateSession(sessionId, { status: 'done', artifacts, ...(lastAgentOutput ? { lastAgentOutput } : {}) })
  }

  private registerDreaminaJob(sessionId: string, pending: { externalId: string; downloadDir: string }): void {
    const now = Date.now()
    const job = state.upsertExternalJob({
      id: uuidv4(),
      sessionId,
      provider: 'dreamina',
      externalId: pending.externalId,
      status: 'querying',
      downloadDir: pending.downloadDir,
      createdAt: now,
      updatedAt: now,
    })
    this.emitLog('info', `Dreamina task waiting [${sessionId.slice(0, 8)}] submit_id=${job.externalId}`, sessionId)
    this.scheduleExternalJobPoll(job)
  }

  private scheduleExternalJobPoll(job: ExternalJob, delay = this.dreaminaPollIntervalMs): void {
    if (this.externalJobTimers.has(job.id)) return
    const timer = setTimeout(() => {
      this.externalJobTimers.delete(job.id)
      this.pollDreaminaJob(job).catch((err) => {
        this.emitLog('warn', `Dreamina poll failed [${job.sessionId.slice(0, 8)}]: ${errorMessage(err)}`, job.sessionId)
        this.scheduleExternalJobPoll(job)
      })
    }, delay)
    timer.unref()
    this.externalJobTimers.set(job.id, timer)
  }

  private async pollDreaminaJob(job: ExternalJob): Promise<void> {
    const current = state.getExternalJob(job.provider, job.externalId)
    if (!current || current.status !== 'querying') return
    const session = state.getSession(current.sessionId)
    if (!session || session.status === 'stopped') {
      state.updateExternalJob(current.provider, current.externalId, { status: 'stopped' })
      return
    }

    const result = await this.dreaminaQuery(current.externalId, current.downloadDir)
    if (result.status === 'querying') {
      this.scheduleExternalJobPoll(current)
      return
    }
    if (result.status === 'error') {
      state.updateExternalJob(current.provider, current.externalId, {
        status: 'error',
        errorMessage: result.errorMessage ?? 'Dreamina generation failed',
      })
      this.markError(current.sessionId, new Error(result.errorMessage ?? 'Dreamina generation failed'))
      return
    }

    const paths = result.paths ?? []
    state.updateExternalJob(current.provider, current.externalId, { status: 'done', resultPaths: paths })
    if (this.shouldUseDirectVideoGenerationStep(state.getPipelineBySession(current.sessionId)?.sessions.find((step) => step.sessionId === current.sessionId)?.nodeType)) {
      try {
        await this.submitDreaminaVideoStep(current.sessionId)
      } catch (err) {
        this.markVideoStepSubmitError(current.sessionId, err)
      }
      return
    }
    const content = [
      '[RESULT]',
      '即梦视频生成完成。',
      '',
      `submit_id：\`${current.externalId}\``,
      '状态：`success`',
      '本地视频：',
      ...paths.map((filePath) => `\`${filePath}\``),
      '[/RESULT]',
      '[DONE]',
    ].join('\n')
    this.recordMessage(current.sessionId, 'dreamina', content, Math.max(1, session.currentRound))
    state.updateSession(current.sessionId, { lastAgentOutput: content })
    const updated = await this.completeSession(current.sessionId)
    this.emit('event', { type: 'session:done', payload: updated } satisfies WsEvent)
    this.emitLog('info', `Dreamina task completed [${current.sessionId.slice(0, 8)}] submit_id=${current.externalId}`, current.sessionId)
    this.handlePipelineSessionFinished(current.sessionId, 'done')
  }

  private emitLog(level: 'info' | 'warn' | 'error', message: string, sessionId: string): void {
    const entry = state.addLog({
      id: uuidv4(),
      sessionId,
      timestamp: Date.now(),
      level,
      message,
    })
    this.emit('event', {
      type: 'log',
      payload: entry,
    } satisfies WsEvent)
  }

  private nextRunEpoch(sessionId: string): number {
    const next = (this.runEpochs.get(sessionId) ?? 0) + 1
    this.runEpochs.set(sessionId, next)
    return next
  }

  private abortActiveTurn(sessionId: string): void {
    this.turnControllers.get(sessionId)?.abort()
    this.turnControllers.delete(sessionId)
  }

  private shouldCompleteSession(sessionId: string, session: Session, response: string): boolean {
    const workflowReady = this.isWorkflowCompletionReady(sessionId, response)
    if (detectCompletion(response)) {
      if (!workflowReady) return false
      if (session.mode !== 'discuss') return true
      if (session.currentRound < DISCUSS_MIN_ROUNDS) return false
      return this.hasDiscussConverged(sessionId)
    }
    if (session.mode === 'collaborate') return workflowReady && this.hasCollaborateConverged(sessionId)
    if (session.mode !== 'discuss') return false
    return false
  }

  private isWorkflowCompletionReady(sessionId: string, response: string): boolean {
    const pipeline = state.getPipelineBySession(sessionId)
    if (!pipeline) return true
    const session = state.getSession(sessionId)
    if (!session) return false
    const step = pipeline.sessions.find((item) => item.sessionId === sessionId)
    const title = step?.title ?? ''
    const messages = state.getMessages(sessionId)
    const outputs = [...messages.filter((msg) => msg.from !== 'human').map((msg) => msg.content), response].join('\n\n')
    return validateWorkflowStepOutput(title, outputs, session.cwd, step?.contract, session.createdAt)
  }

  private async completeWorkflowStepAfterAdapterError(sessionId: string, err: unknown): Promise<boolean> {
    const pipeline = state.getPipelineBySession(sessionId)
    const session = state.getSession(sessionId)
    if (!pipeline || !session) return false
    const step = pipeline.sessions.find((item) => item.sessionId === sessionId)
    if (!step?.contract?.outputs?.length) return false
    const outputs = [
      ...state.getMessages(sessionId).filter((message) => message.from !== 'human').map((message) => message.content),
      lastAgentOutputFromError(err) ?? '',
    ].join('\n\n')
    if (!validateWorkflowStepOutput(step.title ?? '', outputs, session.cwd, step.contract, session.createdAt)) return false

    const content = [
      '[RESULT]',
      '执行器异常退出，但步骤产物已完整生成并通过输出契约校验。',
      ...step.contract.outputs.map((output) => {
        const outputPath = extractExistingOutputFile(outputs, output.fileName, session.cwd, session.createdAt)
        return outputPath ? `产物：${outputPath}` : ''
      }).filter(Boolean),
      '[/RESULT]',
      '[DONE]',
    ].join('\n')
    this.recordMessage(sessionId, 'turing', content, this.inferFailedRound(session))
    state.clearSessionError(sessionId)
    state.updateSession(sessionId, { lastAgentOutput: content })
    const completed = await this.completeSession(sessionId)
    this.emit('event', { type: 'session:done', payload: completed } satisfies WsEvent)
    this.emitLog('warn', `Adapter failed after outputs satisfied contract; marked complete [${sessionId.slice(0, 8)}]`, sessionId)
    this.handlePipelineSessionFinished(sessionId, 'done')
    return true
  }

  private hasCollaborateConverged(sessionId: string): boolean {
    const recentAgentMessages = state.getMessages(sessionId)
      .filter((msg) => msg.from !== 'human' && msg.round > 0)
      .slice(-COLLABORATE_CONVERGENCE_MESSAGES)

    if (recentAgentMessages.length < COLLABORATE_CONVERGENCE_MESSAGES) return false
    const senders = new Set(recentAgentMessages.map((msg) => msg.from))
    if (senders.size < 2) return false
    return recentAgentMessages.every((msg) => isCompletionLikeMessage(msg.content))
  }

  private hasDiscussConverged(sessionId: string): boolean {
    const requiredMessages = DISCUSS_CONVERGENCE_ROUNDS * DISCUSS_MESSAGES_PER_ROUND
    const recentAgentMessages = state.getMessages(sessionId)
      .filter((msg) => msg.from !== 'human' && msg.round > 0)
      .slice(-requiredMessages)

    if (recentAgentMessages.length < requiredMessages) return false
    return recentAgentMessages.every((msg) => !this.hasDiscussNewPoints(msg.content))
  }

  private hasDiscussNewPoints(content: string): boolean {
    const section = this.extractDiscussSection(content, 'new points')
    if (!section) return true

    const lines = section
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    if (lines.length === 0) return true

    return lines.some((line) => {
      const normalized = line
        .replace(/^[-*•\d.)\s]+/, '')
        .trim()
        .toLowerCase()
      return !['none', 'none.', 'no new points', 'no new points.', 'n/a', 'na'].includes(normalized)
    })
  }

  private inferFailedRound(session: Session): number {
    return session.nextTurn === 'to'
      ? session.currentRound + 1
      : Math.max(1, session.currentRound)
  }

  private buildCheckpointResumePrompt(session: Session, failedRound: number): string {
    const messages = state.getMessages(session.id)
    const initialPrompt = messages.find((msg) => msg.from === 'human' && msg.round === 0)?.content ?? ''
    const summary = summarizeCompletedRounds(session, messages, failedRound)
    const error = session.errorMessage ?? 'Unknown error'

    return [
      'Original initial prompt:',
      initialPrompt || '(missing)',
      '',
      'Summary of completed rounds:',
      summary || '(none)',
      '',
      `The previous attempt failed at round ${failedRound} with error: ${error}. Please continue from where it left off.`,
    ].join('\n')
  }

  private extractDiscussSection(content: string, heading: string): string {
    const lines = content.split('\n')
    const startIndex = lines.findIndex((line) => line.trim().toLowerCase().startsWith(`${heading}:`))
    if (startIndex === -1) return ''

    const collected: string[] = []
    for (let i = startIndex + 1; i < lines.length; i += 1) {
      const trimmed = lines[i].trim()
      if (
        /^response:/i.test(trimmed) ||
        /^new points:/i.test(trimmed) ||
        /^challenge:/i.test(trimmed)
      ) {
        break
      }
      collected.push(lines[i])
    }
    return collected.join('\n').trim()
  }

  private hydratePipelineDependencyContext(sessionId: string, dependencyIds: string[]): void {
    const session = state.getSession(sessionId)
    if (!session || dependencyIds.length === 0) return

    const mergedContext = mergeSessionContexts(
      stripPipelineDependencyContext(session.context),
      this.buildPipelineDependencyContext(dependencyIds)
    )

    const task = state.getMessages(sessionId).find((msg) => msg.from === 'human' && msg.round === 0)?.content ?? ''
    const systemPrompts = generateSystemPrompts(
      session.mode,
      session.from,
      session.to,
      task,
      mergedContext,
      {
        fromCanUseTools: adapterCanUseTools(this.resolveAdapter(session.from.adapter, session.userId)),
        toCanUseTools: adapterCanUseTools(this.resolveAdapter(session.to.adapter, session.userId)),
      }
    )

    state.updateSession(sessionId, { context: mergedContext, systemPrompts })
    this.emitLog('info', `Injected pipeline dependency context into [${sessionId.slice(0, 8)}] from ${dependencyIds.length} upstream session(s)`, sessionId)
  }

  private buildPipelineDependencyContext(dependencyIds: string[]): SessionContext | undefined {
    const files: NonNullable<SessionContext['files']> = []
    const summaries: string[] = []

    for (const dependencyId of dependencyIds) {
      const session = state.getSession(dependencyId)
      if (!session) continue

      const messages = state.getMessages(dependencyId).filter((msg) => msg.from !== 'human')
      const snapshots = state.getSnapshots(dependencyId)
      const latestSnapshot = snapshots.at(-1)
      const lastMeaningfulMessage = [...messages].reverse().find((msg) => normalizeAgentSummary(msg.content))
      const summary = [
        `Dependency Session: ${agentLabel(session.from)} → ${agentLabel(session.to)}`,
        `Status: ${session.status}`,
        `Rounds: ${session.currentRound}/${session.maxRounds}`,
      ]
      const output = lastMeaningfulMessage ? normalizeAgentSummary(lastMeaningfulMessage.content) : ''
      if (output) {
        summary.push('Latest Output:')
        summary.push(output)
      }
      if (latestSnapshot?.diffStat) {
        summary.push('Latest Diff Stat:')
        summary.push(truncateText(latestSnapshot.diffStat, PIPELINE_DEP_TEXT_CHARS))
      }
      summaries.push(summary.join('\n'))

      if (!session.cwd || files.length >= PIPELINE_DEP_MAX_FILES) continue
      const cwd = session.cwd
      const referencedFiles = messages.flatMap((message) => extractReferencedTextFiles(message.content, cwd))
      const changedFiles = latestSnapshot ? extractChangedFiles(latestSnapshot.diffFull).map((filePath) => path.resolve(cwd, filePath)) : []
      for (const absolutePath of [...new Set([...referencedFiles, ...changedFiles])]) {
        if (files.length >= PIPELINE_DEP_MAX_FILES) break
        try {
          if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue
          const content = fs.readFileSync(absolutePath, 'utf-8')
          files.push({
            path: `[dependency ${dependencyId.slice(0, 8)}] ${absolutePath}`,
            content: truncateText(content, PIPELINE_DEP_FILE_CHARS),
          })
        } catch {
          // Best effort only.
        }
      }
    }

    if (!summaries.length && !files.length) return undefined
    return {
      ...(files.length > 0 ? { files } : {}),
      text: [
        '[[Pipeline Dependency Context]]',
        ...summaries,
        '[[End Pipeline Dependency Context]]',
      ].join('\n\n'),
    }
  }

}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function detectDreaminaSubmittedJob(content: string, session: Pick<Session, 'cwd'>): { externalId: string; downloadDir: string } | undefined {
  if (!/submit[_ -]?id/i.test(content)) return undefined
  if (/(?:本地视频|local video|downloaded)[\s\S]{0,300}\.mp4\b/i.test(content)) return undefined
  const match = content.match(/submit[_ -]?id[^\da-f-]*([0-9a-f]{8}-[0-9a-f-]{27,})/i)
  if (!match?.[1]) return undefined
  return {
    externalId: match[1],
    downloadDir: path.join(session.cwd ?? process.cwd(), 'output'),
  }
}

function readDreaminaVideoPlan(session: Session): DreaminaVideoPlan {
  const commandSource = findVideoCommandSource(session)
  if (!commandSource?.content.trim()) {
    throw new Error('video-command.md not found in upstream outputs')
  }
  const outputDir = commandSource.filePath
    ? path.dirname(commandSource.filePath)
    : sessionOutputDirectory(session) ?? session.cwd ?? process.cwd()
  const rawCommands = extractDreaminaCommands(commandSource.content)
  if (!rawCommands.length) {
    throw new Error('video-command.md does not contain a dreamina generation command')
  }
  const commands = rawCommands.map((command) => normalizeDreaminaVideoCommand(command, outputDir))
  return {
    commands,
    outputDir,
    finalOutputPath: extractFinalVideoOutputPath(commandSource.content, outputDir),
  }
}

function findVideoCommandSource(session: Session): { filePath?: string; content: string } | undefined {
  const contextFile = session.context?.files?.find((file) => /video-command\.md/i.test(file.path))
  const contextPath = contextFile ? extractAbsolutePath(contextFile.path) : undefined
  if (contextPath && fs.existsSync(contextPath) && fs.statSync(contextPath).isFile()) {
    return { filePath: contextPath, content: fs.readFileSync(contextPath, 'utf-8') }
  }
  if (contextFile?.content) return { filePath: contextPath, content: contextFile.content }

  const messages = state.getMessages(session.id).map((message) => message.content).join('\n\n')
  const outputPath = extractExistingOutputFile(messages, 'video-command.md', session.cwd, session.createdAt)
  if (outputPath) return { filePath: outputPath, content: fs.readFileSync(outputPath, 'utf-8') }
  return undefined
}

function extractDreaminaCommands(content: string): string[] {
  const normalized = content.replace(/\\\r?\n\s*/g, ' ')
  const commands: string[] = []
  const pattern = /(?:^|\n)\s*((?:dreamina|\/[^\s`"'<>]*dreamina)\s+(?:image2video|multiframe2video|multimodal2video|text2video|video)\b[^\n`]*)/gi
  for (const match of normalized.matchAll(pattern)) {
    if (match[1]) commands.push(match[1].trim())
  }
  return commands
}

function normalizeDreaminaVideoCommand(command: string, outputDir: string): DreaminaVideoCommand {
  const argv = parseShellWords(command)
  if (argv.length < 2 || path.basename(argv[0]) !== 'dreamina') {
    throw new Error(`Unsupported Dreamina command: ${command}`)
  }
  const subcommand = argv[1]
  const flags = parseFlags(argv.slice(2))
  if (subcommand === 'video') return normalizeLegacyDreaminaVideoFlags(flags, outputDir)
  if (!['image2video', 'multiframe2video', 'multimodal2video', 'text2video'].includes(subcommand)) {
    throw new Error(`Unsupported Dreamina video subcommand: ${subcommand}`)
  }

  const args = [subcommand]
  let outputPath: string | undefined
  for (const flag of flags) {
    if (flag.name === 'output') {
      outputPath = resolveMaybePath(flag.value, outputDir)
      continue
    }
    args.push(formatFlag(flag, outputDir))
  }
  ensurePollDisabled(args)
  return { args, downloadDir: outputPath ? path.dirname(outputPath) : outputDir }
}

function normalizeLegacyDreaminaVideoFlags(flags: ParsedFlag[], outputDir: string): DreaminaVideoCommand {
  const args = ['multimodal2video']
  const images: string[] = []
  let outputPath: string | undefined
  for (const flag of flags) {
    if ((flag.name === 'image' || flag.name === 'reference') && flag.value) {
      images.push(resolveMaybePath(flag.value, outputDir))
      continue
    }
    if (flag.name === 'output') {
      outputPath = resolveMaybePath(flag.value, outputDir)
      continue
    }
    if (['prompt', 'duration', 'ratio', 'session', 'model_version', 'video_resolution'].includes(flag.name)) {
      args.push(`--${flag.name}`, flag.value ?? '')
    }
  }
  for (const image of images) args.push('--image', image)
  ensurePollDisabled(args)
  return { args, downloadDir: outputPath ? path.dirname(outputPath) : outputDir }
}

type ParsedFlag = {
  name: string
  value?: string
}

function parseFlags(tokens: string[]): ParsedFlag[] {
  const flags: ParsedFlag[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (!token.startsWith('--')) continue
    const eq = token.indexOf('=')
    if (eq !== -1) {
      flags.push({ name: token.slice(2, eq), value: token.slice(eq + 1) })
      continue
    }
    const next = tokens[i + 1]
    if (next && !next.startsWith('--')) {
      flags.push({ name: token.slice(2), value: next })
      i += 1
    } else {
      flags.push({ name: token.slice(2) })
    }
  }
  return flags
}

function formatFlag(flag: ParsedFlag, baseDir: string): string {
  const valuePathFlags = new Set(['image', 'images', 'video', 'audio'])
  if (flag.value === undefined) return `--${flag.name}`
  const value = valuePathFlags.has(flag.name) ? resolveMaybePath(flag.value, baseDir) : flag.value
  return `--${flag.name}=${value}`
}

function ensurePollDisabled(args: string[]): void {
  if (!args.some((arg) => arg === '--poll' || arg.startsWith('--poll='))) args.push('--poll=0')
}

function extractFinalVideoOutputPath(content: string, baseDir: string): string | undefined {
  const refs = Array.from(content.matchAll(/((?:\/|\.{1,2}\/)[^`\s"'<>，。；：、)）]+\.mp4)/gi)).map((match) => match[1])
  const finalRef = [...refs].reverse().find((ref) => /final|draft|成片|最终/i.test(ref)) ?? refs.at(-1)
  return finalRef ? resolveMaybePath(finalRef, baseDir) : undefined
}

function resolveMaybePath(value: string | undefined, baseDir: string): string {
  if (!value) return ''
  if (value.includes(',') && !value.includes('/,')) {
    return value.split(',').map((part) => resolveMaybePath(part.trim(), baseDir)).join(',')
  }
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(baseDir, value)
}

function extractAbsolutePath(value: string): string | undefined {
  const match = value.match(/(\/[^\n\r]+)$/)
  return match?.[1]?.trim()
}

function parseDreaminaSubmitId(stdout: string): string | undefined {
  return stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]
}

function parseShellWords(input: string): string[] {
  const words: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let escaped = false
  for (const char of input) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) words.push(current)
  return words
}

function shellQuote(value: string): string {
  if (/^[\w./:=,-]+$/.test(value)) return value
  return `'${value.replace(/'/g, "'\\''")}'`
}

export function detectHumanInputWait(content: string): boolean {
  return (
    /等待人工(?:确认|审核|回复|输入)/i.test(content) ||
    /请回复[“"'` ]*(?:OK|通过|确认保存)/i.test(content)
  )
}

function extractVideoPaths(content: string): string[] {
  return Array.from(new Set(
    [...content.matchAll(/(?:^|[`(\s])((?:\/|\.{1,2}\/)[^`\s)]+?\.(?:mp4|mov|webm))(?=$|[`\s)])/gi)]
      .map((match) => match[1])
  ))
}

async function queryDreaminaResult(externalId: string, downloadDir: string): Promise<DreaminaQueryResult> {
  fs.mkdirSync(downloadDir, { recursive: true })
  const stdout = await execFileText(DREAMINA_COMMAND, [
    'query_result',
    `--submit_id=${externalId}`,
  ])
  const payload = JSON.parse(stdout) as {
    gen_status?: string
    message?: string
    result_json?: {
      videos?: Array<{ video_url?: string; format?: string }>
    }
  }
  const status = payload.gen_status?.toLowerCase()
  if (status === 'success') {
    const videos = payload.result_json?.videos ?? []
    const paths: string[] = []
    for (const [index, video] of videos.entries()) {
      if (!video.video_url) continue
      const ext = video.format?.toLowerCase() === 'webm' ? 'webm' : 'mp4'
      const destination = path.join(downloadDir, `${externalId}_video_${index + 1}.${ext}`)
      await downloadAndValidateVideo(video.video_url, destination)
      paths.push(destination)
    }
    if (paths.length > 0) return { status: 'success', paths }
    return { status: 'querying' }
  }
  if (status === 'failed' || status === 'error') {
    return { status: 'error', errorMessage: payload.message ?? `Dreamina task ${status}` }
  }
  return { status: 'querying' }
}

async function submitDreaminaCommand(args: string[], cwd?: string): Promise<string> {
  return execFileText(DREAMINA_COMMAND, args, 5 * 60_000, cwd)
}

async function concatVideos(inputVideos: string[], destination: string): Promise<void> {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const listPath = path.join(path.dirname(destination), `.concat-${Date.now()}.txt`)
  const listContent = inputVideos
    .map((filePath) => `file '${filePath.replace(/'/g, "'\\''")}'`)
    .join('\n')
  fs.writeFileSync(listPath, listContent)
  try {
    await execFileText(FFMPEG_COMMAND, [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c', 'copy',
      destination,
    ], 20 * 60_000)
    await execFileText(FFMPEG_COMMAND, ['-v', 'error', '-i', destination, '-f', 'null', '-'], 5 * 60_000)
  } finally {
    fs.rmSync(listPath, { force: true })
  }
}

async function downloadAndValidateVideo(url: string, destination: string): Promise<void> {
  const partial = `${destination}.part`
  await execFileText(CURL_COMMAND, [
    '--location',
    '--fail',
    '--retry', '3',
    '--retry-delay', '2',
    '--continue-at', '-',
    '--output', partial,
    url,
  ], 20 * 60_000)
  try {
    await execFileText(FFMPEG_COMMAND, ['-v', 'error', '-i', partial, '-f', 'null', '-'], 5 * 60_000)
  } catch (err) {
    fs.rmSync(partial, { force: true })
    throw new Error(`Downloaded video failed integrity check: ${errorMessage(err)}`)
  }
  fs.renameSync(partial, destination)
}

function execFileText(command: string, args: string[], timeout = 60_000, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 10 * 1024 * 1024, cwd }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr || err.message).trim()))
        return
      }
      resolve(stdout.trim())
    })
  })
}

function agentLabel(ref: AgentRef): string {
  return ref.label ?? ref.adapter
}

function normalizeAgentSummary(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return ''
  if (trimmed === '[DONE]') return ''
  return truncateText(trimmed, PIPELINE_DEP_TEXT_CHARS)
}

function extractChangedFiles(diff: string): string[] {
  const seen = new Set<string>()
  for (const line of diff.split('\n')) {
    const match = line.match(/^\+\+\+ b\/(.+)$/) ?? line.match(/^diff --git a\/.+ b\/(.+)$/)
    const filePath = match?.[1]
    if (!filePath || filePath === '/dev/null') continue
    seen.add(filePath)
  }
  return Array.from(seen)
}

function extractReferencedTextFiles(content: string, cwd: string): string[] {
  const matches = new Set<string>()
  const patterns = [
    /`([^`\n]+\.(?:md|txt|json|ya?ml|csv|tsv))`/gi,
    /(^|[\s("'（])((?:\/|\.{0,2}\/)[^\s`'"<>，。；：、)）]+\.(?:md|txt|json|ya?ml|csv|tsv))(?=$|[\s`'"<>，。；：、)）])/gim,
  ]
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const candidate = (match[2] ?? match[1] ?? '').trim()
      if (!candidate || /^https?:\/\//i.test(candidate)) continue
      matches.add(path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(cwd, candidate))
    }
  }
  return [...matches]
}

function truncateText(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function stripPipelineDependencyContext(context?: SessionContext): SessionContext | undefined {
  if (!context) return undefined
  const next: SessionContext = {}
  if (context.rules) next.rules = context.rules
  if (context.files?.length) {
    next.files = context.files.filter((file) => !file.path.startsWith('[dependency '))
  }
  if (context.text) {
    const stripped = context.text.replace(/\n?\[\[Pipeline Dependency Context\]\][\s\S]*?\[\[End Pipeline Dependency Context\]\]\n?/g, '').trim()
    if (stripped) next.text = stripped
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function mergeSessionContexts(base?: SessionContext, extra?: SessionContext): SessionContext | undefined {
  if (!base && !extra) return undefined
  const files = new Map<string, string>()
  for (const file of base?.files ?? []) files.set(file.path, file.content)
  for (const file of extra?.files ?? []) files.set(file.path, file.content)

  const textParts = [base?.text, extra?.text].filter(Boolean)
  const merged: SessionContext = {}
  if (base?.rules || extra?.rules) merged.rules = [base?.rules, extra?.rules].filter(Boolean).join('\n')
  if (files.size > 0) {
    merged.files = Array.from(files.entries()).map(([filePath, content]) => ({ path: filePath, content }))
  }
  if (textParts.length > 0) merged.text = textParts.join('\n\n')
  return Object.keys(merged).length > 0 ? merged : undefined
}

function normalizeAdapterResponse(result: string | AdapterResponse): AdapterResponse {
  if (typeof result === 'string') {
    return { content: result }
  }
  return {
    content: result.content,
    metadata: result.metadata,
  }
}

function buildTaskSession(task: Task): Session {
  return {
    id: task.id,
    userId: task.userId,
    from: task.agent,
    to: task.agent,
    status: 'active',
    mode: 'freeform',
    nextTurn: 'to',
    maxRounds: 1,
    currentRound: 0,
    approveMode: false,
    permissionMode: 'safe',
    cwd: task.cwd,
    context: task.context,
    systemPrompts: task.systemPrompt ? { from: task.systemPrompt, to: task.systemPrompt } : undefined,
    resumeCount: 0,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

function extractResultSummary(content: string): string {
  const resultMatch = content.match(/\[RESULT\]([\s\S]*?)\[\/RESULT\]/i)
  return (resultMatch?.[1] ?? content).trim()
}

function readLastAgentOutput(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const value = (error as { lastAgentOutput?: unknown }).lastAgentOutput
  return typeof value === 'string' ? value : undefined
}

function adapterCanUseTools(adapter: Adapter | undefined): boolean {
  return adapter?.capabilities?.tools ?? true
}

export function detectAgentAssistanceRequest(content: string): string | undefined {
  const structured = content.match(/\[ASSIST_REQUEST\]([\s\S]*?)\[\/ASSIST_REQUEST\]/i)?.[1]?.trim()
  if (structured) return structured

  const text = String(content || '').trim()
  if (!text) return undefined
  const cannotAccess = /(?:无法|不能|不具备|没有权限).{0,24}(?:读取|访问|联网|搜索|浏览|执行|运行|写入|创建|验证|查看)/i
  const asksPlanner = /(?:请|需要|麻烦).{0,20}(?:codex|planner|规划者|上游).{0,20}(?:提供|读取|搜索|查找|执行|写入|创建|验证|协助)/i
  const english = /(?:cannot|can't|unable to).{0,30}(?:read|access|browse|search|run|execute|write|create|verify).{0,50}(?:codex|planner|you)/i
  if (!cannotAccess.test(text) && !asksPlanner.test(text) && !english.test(text)) return undefined
  return text
}

function buildPlannerAssistanceDirective(content: string, request: string): string {
  return [
    '[TURING_ASSISTANCE_REQUIRED]',
    '执行 Agent 因能力限制无法继续。你必须立即使用自己的工具完成所需的读取、搜索、执行、写入或验证。',
    '完成后把具体资料、命令结果或已验证文件路径回复给执行 Agent，让它继续原任务。',
    '不要把问题转交给用户，也不要只给操作建议。',
    '',
    '请求内容：',
    request,
    '[/TURING_ASSISTANCE_REQUIRED]',
    '',
    '执行 Agent 原始回复：',
    content,
  ].join('\n')
}

function parseStreamStep(output: string): StreamStep | undefined {
  const text = normalizeStreamText(output)
  if (!text) return undefined
  const lower = text.toLowerCase()
  const file = extractStreamFile(text)
  const command = extractStreamCommand(text)

  if (/\b(read file|read_file|reading|read|cat|sed|rg|grep)\b/i.test(text)) {
    return {
      type: 'read',
      summary: `正在读取 ${file ?? command ?? '文件'}...`,
      detail: text,
    }
  }

  if (/\b(write|edit|apply_patch|patch|wrote|modified|update file|create file|save)\b/i.test(text)) {
    return {
      type: 'write',
      summary: `正在修改 ${file ?? '文件'}...`,
      detail: text,
    }
  }

  if (/\b(bash|shell|exec|execute|run command|npm|pnpm|yarn|git|node|tsc|pytest|vitest|make)\b/i.test(text)) {
    return {
      type: 'exec',
      summary: `正在执行 ${command ?? text.slice(0, 60)}...`,
      detail: text,
    }
  }

  if (lower.includes('thinking') || lower.includes('analysis') || lower.includes('plan') || text.includes('分析') || text.includes('计划')) {
    return {
      type: 'think',
      summary: '正在分析...',
      detail: text,
    }
  }

  return undefined
}

function buildDoneStep(output: string): StreamStep {
  return {
    type: 'done',
    summary: '已完成本轮输出',
    detail: normalizeStreamText(output).slice(0, 2000),
  }
}

function normalizeStreamText(output: string): string {
  return output.replace(/\s+/g, ' ').trim()
}

function extractStreamFile(text: string): string | undefined {
  const quoted = text.match(/[`'"]([^`'"]+\.[\w.-]+)[`'"]/)
  if (quoted?.[1]) return quoted[1]
  const pathMatch = text.match(/(?:^|\s)((?:\.{1,2}\/|\/)?[\w@.-]+(?:\/[\w@.-]+)+\.[\w.-]+)/)
  if (pathMatch?.[1]) return pathMatch[1]
  const simple = text.match(/\b([\w@.-]+\.[A-Za-z0-9_-]{1,8})\b/)
  return simple?.[1]
}

function extractStreamCommand(text: string): string | undefined {
  const quoted = text.match(/(?:cmd|command|bash|exec|执行|运行)[^`'"]*[`'"]([^`'"]+)[`'"]/i)
  if (quoted?.[1]) return truncate(quoted[1], 80)
  const match = text.match(/\b((?:npm|pnpm|yarn|git|node|npx|tsc|pytest|vitest|make|bash|sh|rg|sed|cat)\s+[^.;\n]{1,80})/i)
  return match?.[1]?.trim()
}

function classifyError(message: string): SessionErrorType {
  const normalized = message.toLowerCase()
  if (normalized.includes('policy')) {
    return 'policy_stop'
  }
  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    return 'adapter_timeout'
  }
  if (
    normalized.includes('econnrefused') ||
    normalized.includes('econnreset') ||
    normalized.includes('connection refused') ||
    normalized.includes('connection reset') ||
    normalized.includes('network')
  ) {
    return 'network_error'
  }
  if (normalized.includes('exited with code') || normalized.includes('spawn error')) {
    return 'adapter_crash'
  }
  return 'unknown'
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err ?? 'Unknown error')
}

function lastAgentOutputFromError(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'lastAgentOutput' in err) {
    const output = (err as { lastAgentOutput?: unknown }).lastAgentOutput
    return typeof output === 'string' ? output : undefined
  }
  return undefined
}

function errorRoundFromError(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'errorRound' in err) {
    const round = (err as { errorRound?: unknown }).errorRound
    return typeof round === 'number' ? round : undefined
  }
  return undefined
}

function isCompletionLikeMessage(content: string): boolean {
  const normalized = content
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return false

  const completionSignals = [
    /\[done\]/i,
    /all tests? (passed|pass)/i,
    /tests? (passed|pass)/i,
    /fully complete/i,
    /completed successfully/i,
    /implementation (is )?complete/i,
    /no further (action|changes|work) (is )?(needed|required)/i,
    /nothing else (is )?(needed|required)/i,
    /无需(进一步)?(操作|处理|修改)/,
    /无(需|须)(进一步)?(操作|处理|修改)/,
    /无需后续操作/,
    /无需任何操作/,
    /全部(完成|通过|就绪)/,
    /测试(全部)?通过/,
    /状态(稳定|正常)/,
    /一切(正常|就绪)/,
    /已(完成|就绪|启用|启动|验证通过)/,
  ]

  const blockingSignals = [
    /需要你/,
    /请你/,
    /等待/,
    /please provide/i,
    /waiting for/i,
    /needs? human/i,
    /requires? (input|approval|action)/i,
  ]

  return completionSignals.some((pattern) => pattern.test(normalized)) &&
    !blockingSignals.some((pattern) => pattern.test(normalized))
}

function validateWorkflowStepOutput(title: string, content: string, cwd?: string, contract?: WorkflowStepContract, createdAt?: number): boolean {
  if (contract?.outputs?.length) {
    return contract.outputs.every((output) => {
      const outputPath = extractExistingOutputFile(content, output.fileName, cwd, createdAt)
      if (!outputPath) return false
      if (!output.requiredSections?.length) return true
      try {
        const fileContent = fs.readFileSync(outputPath, 'utf-8')
        return output.requiredSections.every((section) => fileContent.includes(section))
      } catch {
        return false
      }
    })
  }

  const normalizedTitle = title.trim()
  if (!normalizedTitle) return true

  if (/改编文案/.test(normalizedTitle)) {
    const outputPath = extractExistingOutputFile(content, 'script-adapted.md', cwd)
    if (!outputPath) return false
    try {
      const fileContent = fs.readFileSync(outputPath, 'utf-8')
      return /改编文案/.test(fileContent) && /改编说明/.test(fileContent) && /自检/.test(fileContent)
    } catch {
      return false
    }
  }

  if (/生成分镜与 Prompt|生成分镜脚本/.test(normalizedTitle)) {
    return /reference\.md/.test(content) && /script\.md/.test(content) && /prompt\.txt/.test(content)
  }

  if (/生成视觉资产/.test(normalizedTitle)) {
    return /\.(png|jpe?g|webp)/i.test(content) && /storyboard|分镜/i.test(content) && /character|角色|三视图/i.test(content)
  }

  if (/生成分镜图/.test(normalizedTitle)) {
    return /\.(png|jpe?g|webp)/i.test(content) && /storyboard|分镜/i.test(content)
  }

  if (/生成角色三视图/.test(normalizedTitle)) {
    return /\.(png|jpe?g|webp)/i.test(content) && /character|角色|三视图/i.test(content)
  }

  if (/准备视频生成命令/.test(normalizedTitle)) {
    return /本步未执行生成命令/.test(content) && /命令|command/i.test(content)
  }

  if (/执行视频生成/.test(normalizedTitle)) {
    return /\.(mp4|mov|webm)/i.test(content)
  }

  if (/成片审核|最终保存/.test(normalizedTitle)) {
    return /最终/.test(content) && /\.(mp4|mov|webm)/i.test(content)
  }

  return true
}

function extractExistingOutputFile(content: string, fileName: string, cwd?: string, createdAt?: number): string | undefined {
  const escapedName = fileName.startsWith('*.')
    ? `[^\\s\\x60"'<>，。；：、)）]*${fileName.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
    : fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:\\x60|["'])([^\\x60"'\\n]*${escapedName})(?:\\x60|["'])|((?:\\/|\\.{0,2}\\/)[^\\s\\x60"'<>，。；：、)）]*${escapedName})`, 'gi')
  for (const match of content.matchAll(pattern)) {
    const candidate = (match[1] ?? match[2] ?? '').trim()
    if (!candidate) continue
    const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(cwd ?? process.cwd(), candidate)
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved
    } catch {
      // Ignore invalid candidates.
    }
  }
  if (!cwd) return undefined
  const matches: Array<{ filePath: string; mtimeMs: number }> = []
  const wildcardExt = fileName.startsWith('*.') ? fileName.slice(1).toLowerCase() : undefined
  const visit = (dir: string, depth: number) => {
    if (depth > 6 || matches.length > 100) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.venv')) continue
      const candidate = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(candidate, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const nameMatches = wildcardExt ? entry.name.toLowerCase().endsWith(wildcardExt) : entry.name === fileName
      if (!nameMatches) continue
      try {
        const mtimeMs = fs.statSync(candidate).mtimeMs
        if (createdAt && mtimeMs + 1000 < createdAt) continue
        matches.push({ filePath: candidate, mtimeMs })
      } catch {
        // Ignore files that disappear during discovery.
      }
    }
  }
  visit(path.resolve(cwd), 0)
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return matches[0]?.filePath
}

function summarizeCompletedRounds(session: Session, messages: Message[], failedRound: number): string {
  return messages
    .filter((msg) => msg.round > 0 && msg.round < failedRound)
    .map((msg) => {
      const sender = msg.from === session.from.adapter
        ? agentLabel(session.from)
        : msg.from === session.to.adapter
          ? agentLabel(session.to)
          : msg.from
      return `Round ${msg.round} ${sender}: ${truncate(msg.content, 500)}`
    })
    .join('\n')
}

function formatManualPipelineOutput(output?: string): string {
  const trimmed = output?.trim()
  return [
    '[RESULT] 本步骤已由人工确认完成，工作流从后续步骤继续。',
    trimmed ? `\n人工补充：\n${trimmed}` : '',
    '[/RESULT]',
  ].join('\n')
}

function sessionOutputDirectory(session: Session): string | undefined {
  const sources = [session.context?.rules, session.context?.text].filter((value): value is string => Boolean(value))
  for (const source of sources) {
    const tagged = source.match(/\[\[Turing Output Directory\]\]\s*Save this step's durable outputs under:\s*(.+?)\s*\[\[End Turing Output Directory\]\]/s)
    if (tagged?.[1]?.trim()) return tagged[1].trim()
    const fixed = source.match(/输出目录固定为\s*(.+?)(?:。|\n|$)/)
    if (fixed?.[1]?.trim()) return fixed[1].trim()
  }
  return undefined
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

function captureGitHead(cwd?: string): string | undefined {
  if (!cwd || !fs.existsSync(path.join(cwd, '.git'))) return undefined
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      timeout: GIT_DIFF_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

async function buildSessionArtifacts(session: Session): Promise<SessionArtifacts> {
  const artifacts: SessionArtifacts = {
    summary: extractSessionSummary(session.id),
  }
  const generatedFiles = collectSessionGeneratedFiles(session)
  if (generatedFiles.length) artifacts.generatedFiles = generatedFiles

  if (!session.cwd || !session.gitSnapshot) return artifacts

  try {
    const [gitDiffStat, gitDiffFull] = await Promise.all([
      runGitDiff(session.cwd, ['diff', session.gitSnapshot, 'HEAD', '--stat']),
      runGitDiff(session.cwd, ['diff', session.gitSnapshot, 'HEAD']),
    ])
    artifacts.gitDiffStat = gitDiffStat
    artifacts.gitDiffFull = gitDiffFull
    artifacts.filesChanged = parseGitDiffStat(gitDiffStat)
  } catch {
    // Git artifacts are best-effort; non-git dirs and command failures are ignored.
  }

  return artifacts
}

function collectSessionGeneratedFiles(session: Session): string[] {
  const messages = state.getMessages(session.id)
  const lastHumanTimestamp = Math.max(0, ...messages
    .filter((message) => message.from === 'human')
    .map((message) => Number(message.timestamp) || 0))
  const outputs = messages
    .filter((message) => message.from !== 'human' && (Number(message.timestamp) || 0) >= lastHumanTimestamp)
    .map((message) => message.content)
    .join('\n\n')
  const generated = new Set<string>()
  const add = (filePath?: string) => {
    if (!filePath) return
    try {
      const resolved = path.resolve(filePath)
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) generated.add(resolved)
    } catch {
      // Ignore paths that are not readable at completion time.
    }
  }

  for (const ref of extractArtifactFileRefs(outputs)) {
    add(resolveArtifactFileRef(ref, session.cwd))
  }
  for (const message of messages) {
    if (message.from === 'human') continue
    for (const filePath of message.metadata?.filesModified ?? []) {
      add(path.isAbsolute(filePath) ? filePath : path.resolve(session.cwd ?? process.cwd(), filePath))
    }
  }

  const step = state.getPipelineBySession(session.id)?.sessions.find((item) => item.sessionId === session.id)
  for (const output of step?.contract?.outputs ?? []) {
    add(extractExistingOutputFile(outputs, output.fileName, session.cwd, session.createdAt))
  }

  return [...generated].sort()
}

function extractArtifactFileRefs(content: string): string[] {
  const files = new Set<string>()
  const extensions = 'md|txt|log|json|yaml|yml|csv|tsv|png|jpe?g|webp|gif|svg|mp4|mov|webm|wav|mp3|m4a|aac|flac|pdf|docx|xlsx|pptx|zip'
  const fileExtensionPattern = new RegExp(`\\.(${extensions})$`, 'i')
  const patterns = [
    new RegExp('`([^`]+\\.(' + extensions + '))`', 'gi'),
    new RegExp('(^|[\\s(（"\\\',])(/[^\\s`\'"<>，。；：、)）,=\\\\]+?\\.(' + extensions + '))(?=$|[\\s`\'"<>，。；：、)）,=\\\\])', 'gim'),
    new RegExp('(^|[\\s(（"\\\'])([\\w.\\-/\\u4e00-\\u9fa5]+/[^\\s`\'"<>，。；：、)）]+\\.(' + extensions + '))(?=$|[\\s`\'"<>，。；：、)）])', 'gim'),
  ]
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const file = match.slice(1).map((value) => (value || '').trim()).find((value) => fileExtensionPattern.test(value))
      if (file && !/^https?:\/\//i.test(file)) files.add(file)
    }
  }
  const directories: string[] = []
  for (const match of content.matchAll(/(?:目录|路径|文件夹|输出目录|保存目录)\s*[：:]\s*`?([^`\n]+\/)`?/gi)) {
    const dir = String(match[1] || '').trim()
    if (dir && !/^https?:\/\//i.test(dir)) directories.push(dir)
  }
  for (const dir of directories) {
    for (const file of [...files]) {
      if (!file.includes('/') && fileExtensionPattern.test(file)) files.add(`${dir}${file}`)
    }
  }
  return [...files]
}

function resolveArtifactFileRef(filePath: string, cwd?: string): string | undefined {
  const baseDir = cwd ? path.resolve(cwd) : process.cwd()
  const candidate = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(baseDir, filePath)
  try {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  } catch {
    return undefined
  }
  return undefined
}

function resolveManualArtifactPath(filePath: string, cwd?: string): string {
  const trimmed = filePath.trim()
  if (!trimmed) throw new Error('Artifact path is empty')
  const baseDir = cwd ? path.resolve(cwd) : process.cwd()
  const resolved = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(baseDir, trimmed)
  if (!fs.existsSync(resolved)) throw new Error(`Artifact not found: ${resolved}`)
  if (!fs.statSync(resolved).isFile()) throw new Error(`Artifact is not a file: ${resolved}`)
  return resolved
}

function extractSessionSummary(sessionId: string): string {
  const messages = state.getMessages(sessionId)
  const lastAgentMessage = [...messages].reverse().find((msg) => msg.from !== 'human')
  const content = lastAgentMessage?.content ?? messages.at(-1)?.content ?? ''
  const resultMatch = content.match(/\[RESULT\]([\s\S]*?)\[\/RESULT\]/i)
  return (resultMatch?.[1] ?? content).trim().slice(0, 300)
}

function parseGitDiffStat(stat: string): SessionArtifacts['filesChanged'] {
  return stat
    .split('\n')
    .map((line) => {
      const match = line.match(/^\s*(.+?)\s+\|\s+(?:\d+|-)\s+([+\-]*)\s*$/)
      if (!match) return undefined
      const marks = match[2] ?? ''
      return {
        path: match[1].trim(),
        additions: (marks.match(/\+/g) ?? []).length,
        deletions: (marks.match(/-/g) ?? []).length,
      }
    })
    .filter((item): item is NonNullable<SessionArtifacts['filesChanged']>[number] => Boolean(item))
}

function runGitDiff(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: GIT_DIFF_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr || err.message).trim()))
        return
      }
      resolve(stdout.trim())
    })
  })
}
