// Router module — session lifecycle and message routing

import { EventEmitter } from 'events'
import { execFile } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
import type { Session, Message, Adapter, AdapterSendOpts, PolicyConfig, WsEvent, AgentRef, SessionMode, SessionContext, AdapterResponse, RoundMetadata, SessionErrorType } from './types.js'
import * as state from './state.js'
import {
  checkPreRound,
  detectCompletion,
  DEFAULT_POLICY,
} from './policy.js'
import { generateSystemPrompts } from './prompts.js'

const MAX_HISTORY_MESSAGES = 20
const DISCUSS_MIN_ROUNDS = 3
const DISCUSS_CONVERGENCE_ROUNDS = 2
const DISCUSS_MESSAGES_PER_ROUND = 2
const GIT_DIFF_TIMEOUT_MS = 10_000

export class Router extends EventEmitter {
  private adapters = new Map<string, Adapter>()
  private policy: PolicyConfig
  // Track in-flight sessions so runSession loops can be cancelled
  private runningLoops = new Set<string>()
  private runEpochs = new Map<string, number>()

  constructor(policy: Partial<PolicyConfig> = {}) {
    super()
    this.policy = { ...DEFAULT_POLICY, ...policy }
  }

  // ── Adapter registry ────────────────────────────────────────────────────────

  registerAdapter(adapter: Adapter): void {
    this.adapters.set(adapter.name, adapter)
  }

  clearAdapters(): void {
    this.adapters.clear()
  }

  getAdapter(name: string): Adapter | undefined {
    return this.adapters.get(name)
  }

  listAdapters(): Adapter[] {
    return Array.from(this.adapters.values())
  }

  // ── Session control ─────────────────────────────────────────────────────────

  startSession(params: {
    from: AgentRef
    to: AgentRef
    initialPrompt: string
    mode?: SessionMode
    context?: SessionContext
    maxRounds?: number
    approveMode?: boolean
    cwd?: string
  }): Session {
    const mode = params.mode ?? 'freeform'

    // Generate system prompts based on mode + context
    const systemPrompts = generateSystemPrompts(
      mode,
      params.from,
      params.to,
      params.initialPrompt,
      params.context
    )

    const session = state.createSession({
      id: uuidv4(),
      from: params.from,
      to: params.to,
      mode,
      context: params.context,
      systemPrompts,
      nextTurn: 'to',
      maxRounds: params.maxRounds ?? this.policy.maxRounds,
      approveMode: params.approveMode ?? false,
      cwd: params.cwd,
    })

    // Record the initial human prompt as round 0
    this.recordMessage(session.id, 'human', params.initialPrompt, 0)

    this.emit('event', {
      type: 'session:created',
      payload: session,
    } satisfies WsEvent)

    this.emitLog('info', `Session started: ${agentLabel(params.from)} → ${agentLabel(params.to)} [${session.id.slice(0, 8)}] mode=${mode}`, session.id)

    // Kick off the run loop (non-blocking)
    setImmediate(() => {
      this.runSession(session.id, params.initialPrompt, this.nextRunEpoch(session.id)).catch((err) => {
        console.error(`[router] runSession error for ${session.id}:`, err)
        this.emitLog('error', `Session run error [${session.id.slice(0, 8)}]: ${String(err)}`, session.id)
        this.markError(session.id, err)
      })
    })

    return session
  }

  async pauseSession(id: string): Promise<Session> {
    this.runningLoops.delete(id)
    this.nextRunEpoch(id)
    const session = state.updateSession(id, { status: 'paused' })
    this.emit('event', { type: 'session:paused', payload: session } satisfies WsEvent)
    this.emitLog('info', `Session paused [${id.slice(0, 8)}] at round ${session.currentRound}`, id)
    return session
  }

  async resumeSession(id: string, extraRounds?: number): Promise<Session> {
    const session = state.getSession(id)
    if (!session) throw new Error(`Session ${id} not found`)
    if (session.status !== 'paused') throw new Error(`Session ${id} is not paused`)

    const messages = state.getMessages(id)
    const lastMessage = messages.at(-1)
    if (!lastMessage) throw new Error(`Session ${id} has no messages`)

    const updated = state.updateSession(id, {
      status: 'active',
      ...(extraRounds !== undefined ? { maxRounds: session.maxRounds + extraRounds } : {}),
    })

    this.emit('event', { type: 'session:updated', payload: updated } satisfies WsEvent)
    this.emitLog('info', `Session resumed [${id.slice(0, 8)}]${extraRounds !== undefined ? ` (+${extraRounds} rounds)` : ''}`, id)
    const epoch = this.nextRunEpoch(id)

    setImmediate(() => {
      this.runSession(id, lastMessage.content, epoch).catch((err) => {
        console.error(`[router] resumeSession error for ${id}:`, err)
        this.emitLog('error', `Session resume error [${id.slice(0, 8)}]: ${String(err)}`, id)
        this.markError(id, err)
      })
    })

    return updated
  }

  async resumeErrorSession(id: string): Promise<Session> {
    const session = state.getSession(id)
    if (!session) throw new Error(`Session ${id} not found`)
    if (session.status !== 'error') throw new Error(`Session ${id} is not error`)

    const failedRound = session.errorRound ?? this.inferFailedRound(session)
    const resumePrompt = this.buildCheckpointResumePrompt(session, failedRound)
    this.recordMessage(id, 'human', resumePrompt, failedRound)

    const updated = state.updateSession(id, {
      status: 'active',
      currentRound: failedRound,
      nextTurn: session.nextTurn,
      resumeCount: session.resumeCount + 1,
    })

    this.emit('event', { type: 'session:updated', payload: updated } satisfies WsEvent)
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
    const session = state.updateSession(id, { status: 'done' })
    this.emit('event', { type: 'session:done', payload: session } satisfies WsEvent)
    this.emitLog('info', `Session stopped [${id.slice(0, 8)}]`, id)
    return session
  }

  // ── Human message injection ─────────────────────────────────────────────────

  injectMessage(sessionId: string, content: string): Message {
    const session = state.getSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    // If session is done, reopen it first
    if (session.status === 'done') {
      const reopened = state.reopenSession(sessionId)
      this.emit('event', { type: 'session:updated', payload: reopened } satisfies WsEvent)
      this.emitLog('info', `Session reopened [${sessionId.slice(0, 8)}] via message injection`, sessionId)

      const msg = this.recordMessage(sessionId, 'human', content, reopened.currentRound)

      // Kick off the run loop with the injected message
      const epoch = this.nextRunEpoch(sessionId)
      setImmediate(() => {
        this.runSession(sessionId, content, epoch).catch((err) => {
          console.error(`[router] runSession error for ${sessionId}:`, err)
          this.emitLog('error', `Session reopen error [${sessionId.slice(0, 8)}]: ${String(err)}`, sessionId)
          this.markError(sessionId, err)
        })
      })

      return msg
    }

    const msg = this.recordMessage(sessionId, 'human', content, session.currentRound)

    // If session is paused, auto-resume using injected message
    if (session.status === 'paused') {
      this.resumeSession(sessionId).catch(console.error)
    }

    return msg
  }

  /**
   * Nudge — inject a human directive and resume.
   * Unlike injectMessage, this explicitly pauses first (if active), injects, then resumes.
   * Use when the user wants to redirect the conversation mid-flight.
   */
  async nudge(sessionId: string, content: string): Promise<Message> {
    const session = state.getSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    // Pause if currently active
    if (session.status === 'active') {
      await this.pauseSession(sessionId)
    }

    // Record the human message
    const msg = this.recordMessage(sessionId, 'human', content, session.currentRound)

    // Resume — the run loop will pick up from the last message (the human injection)
    await this.resumeSession(sessionId)

    return msg
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
      const preCheck = checkPreRound(policySession, this.policy)
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
      if (session.approveMode) {
        this.emitLog('info', `Approve mode — waiting for approval [${sessionId.slice(0, 8)}]`, sessionId)
        await this.pauseSession(sessionId)
        break
      }

      this.emitLog('info', `Round ${nextRoundOverride ?? session.currentRound + 1} starting [${sessionId.slice(0, 8)}]`, sessionId)

      try {
        const result = await this.processTurn(sessionId, nextMessage, epoch, nextRoundOverride)
        nextRoundOverride = undefined
        if (result.done) {
          const updated = state.updateSession(sessionId, { status: 'done' })
          this.emit('event', { type: 'session:done', payload: updated } satisfies WsEvent)
          this.emitLog('info', `Session completed [${sessionId.slice(0, 8)}] after ${updated.currentRound} rounds`, sessionId)
          break
        }
        nextMessage = result.nextMessage
      } catch (err) {
        console.error(`[router] round error session ${sessionId}:`, err)
        this.emitLog('error', `Round error [${sessionId.slice(0, 8)}]: ${String(err)}`, sessionId)
        const failed = state.getSession(sessionId)
        this.markError(sessionId, err, failed ? this.inferFailedRound(failed) : undefined)
        break
      }
    }

    this.runningLoops.delete(sessionId)
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
  ): Promise<{ done: boolean; nextMessage: string }> {
    const session = state.getSession(sessionId)!
    const recipient = session.nextTurn
    const target = recipient === 'to' ? session.to : session.from
    const round = roundOverride ?? (recipient === 'to' ? session.currentRound + 1 : session.currentRound)
    const adapter = this.adapters.get(target.adapter)

    if (!adapter) throw new Error(`Adapter not found: ${target.adapter}`)
    this.emitLog('info', `Adapter call: ${target.adapter} [${sessionId.slice(0, 8)}] round=${round} turn=${recipient}`, sessionId)
    let lastOutput = 'Starting...'
    const startedAt = Date.now()
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

    const opts = this.buildSendOpts(session, recipient)
    opts.onOutput = (line) => {
      lastOutput = line
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
    await this.captureGitSnapshot(sessionId, round)

    if (recipient === 'to') {
      state.updateSession(sessionId, {
        currentRound: round,
        nextTurn: 'from',
      })
      return { done: false, nextMessage: content }
    }

    state.updateSession(sessionId, { nextTurn: 'to' })
    if (this.shouldCompleteSession(sessionId, session, content)) {
      return { done: true, nextMessage: content }
    }

    return { done: false, nextMessage: content }
  }

  /**
   * Build AdapterSendOpts with system prompt and conversation history.
   * `perspective` determines which agent we're building for.
   */
  private buildSendOpts(session: Session, perspective: 'from' | 'to'): AdapterSendOpts {
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

    return { systemPrompt, history }
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
    } catch (_) { /* best-effort */ }
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

  private shouldCompleteSession(sessionId: string, session: Session, response: string): boolean {
    if (!detectCompletion(response)) return false
    if (session.mode !== 'discuss') return true
    if (session.currentRound < DISCUSS_MIN_ROUNDS) return false
    return this.hasDiscussConverged(sessionId)
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

}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function agentLabel(ref: AgentRef): string {
  return ref.label ?? ref.adapter
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

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
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
