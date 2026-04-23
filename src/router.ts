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

export class Router extends EventEmitter {
  private adapters = new Map<string, Adapter>()
  private policy: PolicyConfig
  // Track in-flight sessions so runSession loops can be cancelled
  private runningLoops = new Set<string>()

  constructor(policy: Partial<PolicyConfig> = {}) {
    super()
    this.policy = { ...DEFAULT_POLICY, ...policy }
  }

  // ── Adapter registry ────────────────────────────────────────────────────────

  registerAdapter(adapter: Adapter): void {
    this.adapters.set(adapter.name, adapter)
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

    // Kick off the run loop (non-blocking)
    setImmediate(() => {
      this.runSession(session.id, params.initialPrompt).catch((err) => {
        console.error(`[router] runSession error for ${session.id}:`, err)
        this.markError(session.id)
      })
    })

    return session
  }

  async pauseSession(id: string): Promise<Session> {
    this.runningLoops.delete(id)
    const session = state.updateSession(id, { status: 'paused' })
    this.emit('event', { type: 'session:paused', payload: session } satisfies WsEvent)
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

    setImmediate(() => {
      this.runSession(id, lastMessage.content).catch((err) => {
        console.error(`[router] resumeSession error for ${id}:`, err)
        this.markError(id)
      })
    })

    return updated
  }

  async stopSession(id: string): Promise<Session> {
    this.runningLoops.delete(id)
    const session = state.updateSession(id, { status: 'done' })
    this.emit('event', { type: 'session:done', payload: session } satisfies WsEvent)
    return session
  }

  // ── Human message injection ─────────────────────────────────────────────────

  injectMessage(sessionId: string, content: string, side: 'from' | 'to' = 'from'): Message {
    const session = state.getSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
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
  async runSession(sessionId: string, firstMessage: string): Promise<void> {
    this.runningLoops.add(sessionId)

    let nextMessageForTo = firstMessage

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Check if we've been cancelled
      if (!this.runningLoops.has(sessionId)) break

      const session = state.getSession(sessionId)
      if (!session) break
      if (session.status !== 'active') break

      // Pre-round policy check
      const preCheck = checkPreRound(session, this.policy)
      if (!preCheck.allowed) {
        await this.pauseSession(sessionId)
        this.emit('event', {
          type: 'session:paused',
          payload: { session, reason: preCheck.reason },
        } satisfies WsEvent)
        break
      }

      // If approveMode, pause and wait for external resume
      if (session.approveMode) {
        await this.pauseSession(sessionId)
        break
      }

      try {
        const result = await this.processRound(sessionId, nextMessageForTo)
        if (result.done) {
          const updated = state.updateSession(sessionId, { status: 'done' })
          this.emit('event', { type: 'session:done', payload: updated } satisfies WsEvent)
          break
        }
        nextMessageForTo = result.nextMessage
      } catch (err) {
        console.error(`[router] round error session ${sessionId}:`, err)
        this.markError(sessionId)
        break
      }
    }

    this.runningLoops.delete(sessionId)
  }

  /**
   * Execute one full round: send to `to`, get response, send to `from`, get response.
   * Returns { done, nextMessage } where nextMessage feeds the next round's `to`.
   */
  private async processRound(
    sessionId: string,
    messageForTo: string
  ): Promise<{ done: boolean; nextMessage: string }> {
    const session = state.getSession(sessionId)!
    const round = session.currentRound + 1

    const toAdapter = this.adapters.get(session.to.adapter)
    const fromAdapter = this.adapters.get(session.from.adapter)

    if (!toAdapter) throw new Error(`Adapter not found: ${session.to.adapter}`)
    if (!fromAdapter) throw new Error(`Adapter not found: ${session.from.adapter}`)

    // Build conversation history and send opts for `to` agent
    const toOpts = this.buildSendOpts(session, 'to')

    // Send to `to` agent with system prompt + history
    const toResponse = await this.callWithRetry(toAdapter, session, messageForTo, toOpts)
    this.recordMessage(sessionId, session.to.adapter, toResponse, round)
    state.updateSession(sessionId, { currentRound: round })

    if (detectCompletion(toResponse)) {
      return { done: true, nextMessage: toResponse }
    }

    // Send `to`'s response back to `from` agent
    if (!this.runningLoops.has(sessionId)) {
      return { done: false, nextMessage: toResponse }
    }

    // Build send opts for `from` agent
    const fromOpts = this.buildSendOpts(session, 'from')

    const fromResponse = await this.callWithRetry(fromAdapter, session, toResponse, fromOpts)
    this.recordMessage(sessionId, session.from.adapter, fromResponse, round)

    if (detectCompletion(fromResponse)) {
      return { done: true, nextMessage: fromResponse }
    }

    return { done: false, nextMessage: fromResponse }
  }

  /**
   * Build AdapterSendOpts with system prompt and conversation history.
   * `perspective` determines which agent we're building for.
   */
  private buildSendOpts(session: Session, perspective: 'from' | 'to'): AdapterSendOpts {
    const systemPrompt = session.systemPrompts?.[perspective]
    const messages = state.getMessages(session.id)

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
          console.warn(`[router] adapter ${adapter.name} attempt ${attempt + 1} failed, retrying...`)
          await sleep(1000)
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
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
