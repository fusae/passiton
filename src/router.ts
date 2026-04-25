// Router module — session lifecycle and message routing

import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'
import type { Session, Message, Adapter, AdapterSendOpts, PolicyConfig, WsEvent, AgentRef, SessionMode } from './types.js'
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
    context?: string
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
        this.markError(session.id)
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
        this.markError(id)
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

  injectMessage(sessionId: string, content: string, side: 'from' | 'to' = 'from'): Message {
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
          this.markError(sessionId)
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
  async runSession(sessionId: string, firstMessage: string, epoch: number): Promise<void> {
    this.runningLoops.add(sessionId)

    let nextMessage = firstMessage

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Check if we've been cancelled
      if (!this.runningLoops.has(sessionId)) break
      if (this.runEpochs.get(sessionId) !== epoch) break

      const session = state.getSession(sessionId)
      if (!session) break
      if (session.status !== 'active') break

      // Pre-round policy check
      const preCheck = checkPreRound(session, this.policy)
      if (!preCheck.allowed) {
        this.emitLog('warn', `Policy check failed [${sessionId.slice(0, 8)}]: ${preCheck.reason ?? 'unknown'}`, sessionId)
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

      this.emitLog('info', `Round ${session.currentRound + 1} starting [${sessionId.slice(0, 8)}]`, sessionId)

      try {
        const result = await this.processTurn(sessionId, nextMessage, epoch)
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
        this.markError(sessionId)
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
    epoch: number
  ): Promise<{ done: boolean; nextMessage: string }> {
    const session = state.getSession(sessionId)!
    const recipient = session.nextTurn
    const target = recipient === 'to' ? session.to : session.from
    const round = recipient === 'to' ? session.currentRound + 1 : session.currentRound
    const adapter = this.adapters.get(target.adapter)

    if (!adapter) throw new Error(`Adapter not found: ${target.adapter}`)

    this.emitLog('info', `Adapter call: ${target.adapter} [${sessionId.slice(0, 8)}] round=${round} turn=${recipient}`, sessionId)
    const opts = this.buildSendOpts(session, recipient)
    const response = await this.callWithRetry(adapter, session, message, opts)
    if (this.runEpochs.get(sessionId) !== epoch || !this.runningLoops.has(sessionId)) {
      return { done: false, nextMessage: message }
    }
    this.emitLog('info', `Adapter response: ${target.adapter} [${sessionId.slice(0, 8)}] (${response.length} chars)`, sessionId)

    this.recordMessage(sessionId, target.adapter, response, round)

    if (recipient === 'to') {
      state.updateSession(sessionId, {
        currentRound: round,
        nextTurn: 'from',
      })
      return { done: false, nextMessage: response }
    }

    state.updateSession(sessionId, { nextTurn: 'to' })
    if (this.shouldCompleteSession(sessionId, session, response)) {
      return { done: true, nextMessage: response }
    }

    return { done: false, nextMessage: response }
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

  private async callWithRetry(adapter: Adapter, session: Session, message: string, opts?: AdapterSendOpts): Promise<string> {
    let lastErr: unknown
    for (let attempt = 0; attempt <= this.policy.retries; attempt++) {
      try {
        return await adapter.send(session, message, opts)
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

  private recordMessage(sessionId: string, from: string, content: string, round: number): Message {
    const msg = state.addMessage({
      id: uuidv4(),
      sessionId,
      from,
      content,
      timestamp: Date.now(),
      round,
    })
    this.emit('event', { type: 'message:new', payload: msg } satisfies WsEvent)
    return msg
  }

  private markError(sessionId: string): void {
    try {
      const session = state.updateSession(sessionId, { status: 'error' })
      this.emit('event', { type: 'session:error', payload: session } satisfies WsEvent)
    } catch (_) { /* best-effort */ }
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
