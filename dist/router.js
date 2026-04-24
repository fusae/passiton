// Router module — session lifecycle and message routing
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as state from './state.js';
import { checkPreRound, detectCompletion, DEFAULT_POLICY, } from './policy.js';
import { generateSystemPrompts } from './prompts.js';
const MAX_HISTORY_MESSAGES = 20;
export class Router extends EventEmitter {
    adapters = new Map();
    policy;
    // Track in-flight sessions so runSession loops can be cancelled
    runningLoops = new Set();
    runEpochs = new Map();
    constructor(policy = {}) {
        super();
        this.policy = { ...DEFAULT_POLICY, ...policy };
    }
    // ── Adapter registry ────────────────────────────────────────────────────────
    registerAdapter(adapter) {
        this.adapters.set(adapter.name, adapter);
    }
    getAdapter(name) {
        return this.adapters.get(name);
    }
    listAdapters() {
        return Array.from(this.adapters.values());
    }
    // ── Session control ─────────────────────────────────────────────────────────
    startSession(params) {
        const mode = params.mode ?? 'freeform';
        // Generate system prompts based on mode + context
        const systemPrompts = generateSystemPrompts(mode, params.from, params.to, params.initialPrompt, params.context);
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
        });
        // Record the initial human prompt as round 0
        this.recordMessage(session.id, 'human', params.initialPrompt, 0);
        this.emit('event', {
            type: 'session:created',
            payload: session,
        });
        // Kick off the run loop (non-blocking)
        setImmediate(() => {
            this.runSession(session.id, params.initialPrompt, this.nextRunEpoch(session.id)).catch((err) => {
                console.error(`[router] runSession error for ${session.id}:`, err);
                this.markError(session.id);
            });
        });
        return session;
    }
    async pauseSession(id) {
        this.runningLoops.delete(id);
        this.nextRunEpoch(id);
        const session = state.updateSession(id, { status: 'paused' });
        this.emit('event', { type: 'session:paused', payload: session });
        return session;
    }
    async resumeSession(id, extraRounds) {
        const session = state.getSession(id);
        if (!session)
            throw new Error(`Session ${id} not found`);
        if (session.status !== 'paused')
            throw new Error(`Session ${id} is not paused`);
        const messages = state.getMessages(id);
        const lastMessage = messages.at(-1);
        if (!lastMessage)
            throw new Error(`Session ${id} has no messages`);
        const updated = state.updateSession(id, {
            status: 'active',
            ...(extraRounds !== undefined ? { maxRounds: session.maxRounds + extraRounds } : {}),
        });
        this.emit('event', { type: 'session:updated', payload: updated });
        const epoch = this.nextRunEpoch(id);
        setImmediate(() => {
            this.runSession(id, lastMessage.content, epoch).catch((err) => {
                console.error(`[router] resumeSession error for ${id}:`, err);
                this.markError(id);
            });
        });
        return updated;
    }
    async stopSession(id) {
        this.runningLoops.delete(id);
        const session = state.updateSession(id, { status: 'done' });
        this.emit('event', { type: 'session:done', payload: session });
        return session;
    }
    // ── Human message injection ─────────────────────────────────────────────────
    injectMessage(sessionId, content, side = 'from') {
        const session = state.getSession(sessionId);
        if (!session)
            throw new Error(`Session ${sessionId} not found`);
        const msg = this.recordMessage(sessionId, 'human', content, session.currentRound);
        // If session is paused, auto-resume using injected message
        if (session.status === 'paused') {
            this.resumeSession(sessionId).catch(console.error);
        }
        return msg;
    }
    /**
     * Nudge — inject a human directive and resume.
     * Unlike injectMessage, this explicitly pauses first (if active), injects, then resumes.
     * Use when the user wants to redirect the conversation mid-flight.
     */
    async nudge(sessionId, content) {
        const session = state.getSession(sessionId);
        if (!session)
            throw new Error(`Session ${sessionId} not found`);
        // Pause if currently active
        if (session.status === 'active') {
            await this.pauseSession(sessionId);
        }
        // Record the human message
        const msg = this.recordMessage(sessionId, 'human', content, session.currentRound);
        // Resume — the run loop will pick up from the last message (the human injection)
        await this.resumeSession(sessionId);
        return msg;
    }
    // ── Core run loop ────────────────────────────────────────────────────────────
    /**
     * Run rounds until done / paused / error.
     * firstMessage is the content to send to `to` in the first round.
     */
    async runSession(sessionId, firstMessage, epoch) {
        this.runningLoops.add(sessionId);
        let nextMessage = firstMessage;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            // Check if we've been cancelled
            if (!this.runningLoops.has(sessionId))
                break;
            if (this.runEpochs.get(sessionId) !== epoch)
                break;
            const session = state.getSession(sessionId);
            if (!session)
                break;
            if (session.status !== 'active')
                break;
            // Pre-round policy check
            const preCheck = checkPreRound(session, this.policy);
            if (!preCheck.allowed) {
                await this.pauseSession(sessionId);
                this.emit('event', {
                    type: 'session:paused',
                    payload: { session, reason: preCheck.reason },
                });
                break;
            }
            // If approveMode, pause and wait for external resume
            if (session.approveMode) {
                await this.pauseSession(sessionId);
                break;
            }
            try {
                const result = await this.processTurn(sessionId, nextMessage, epoch);
                if (result.done) {
                    const updated = state.updateSession(sessionId, { status: 'done' });
                    this.emit('event', { type: 'session:done', payload: updated });
                    break;
                }
                nextMessage = result.nextMessage;
            }
            catch (err) {
                console.error(`[router] round error session ${sessionId}:`, err);
                this.markError(sessionId);
                break;
            }
        }
        this.runningLoops.delete(sessionId);
    }
    /**
     * Execute one message turn. `session.nextTurn` decides who should receive the
     * next message, so pause/resume can safely continue mid-round.
     */
    async processTurn(sessionId, message, epoch) {
        const session = state.getSession(sessionId);
        const recipient = session.nextTurn;
        const target = recipient === 'to' ? session.to : session.from;
        const round = recipient === 'to' ? session.currentRound + 1 : session.currentRound;
        const adapter = this.adapters.get(target.adapter);
        if (!adapter)
            throw new Error(`Adapter not found: ${target.adapter}`);
        const opts = this.buildSendOpts(session, recipient);
        const response = await this.callWithRetry(adapter, session, message, opts);
        if (this.runEpochs.get(sessionId) !== epoch || !this.runningLoops.has(sessionId)) {
            return { done: false, nextMessage: message };
        }
        this.recordMessage(sessionId, target.adapter, response, round);
        if (recipient === 'to') {
            state.updateSession(sessionId, {
                currentRound: round,
                nextTurn: 'from',
            });
            return { done: false, nextMessage: response };
        }
        state.updateSession(sessionId, { nextTurn: 'to' });
        if (detectCompletion(response)) {
            return { done: true, nextMessage: response };
        }
        return { done: false, nextMessage: response };
    }
    /**
     * Build AdapterSendOpts with system prompt and conversation history.
     * `perspective` determines which agent we're building for.
     */
    buildSendOpts(session, perspective) {
        const systemPrompt = session.systemPrompts?.[perspective];
        const messages = state.getMessages(session.id).slice(-MAX_HISTORY_MESSAGES);
        // Build history from the perspective of this agent
        // Messages from this agent are 'assistant', messages from the other agent (or human) are 'user'
        const selfAdapter = perspective === 'from' ? session.from.adapter : session.to.adapter;
        const history = [];
        for (const msg of messages) {
            if (msg.from === selfAdapter) {
                history.push({ role: 'assistant', content: msg.content });
            }
            else {
                history.push({ role: 'user', content: msg.content });
            }
        }
        return { systemPrompt, history };
    }
    // ── Helpers ─────────────────────────────────────────────────────────────────
    async callWithRetry(adapter, session, message, opts) {
        let lastErr;
        for (let attempt = 0; attempt <= this.policy.retries; attempt++) {
            try {
                return await adapter.send(session, message, opts);
            }
            catch (err) {
                lastErr = err;
                if (attempt < this.policy.retries) {
                    console.warn(`[router] adapter ${adapter.name} attempt ${attempt + 1} failed, retrying...`);
                    await sleep(1000);
                }
            }
        }
        throw lastErr;
    }
    recordMessage(sessionId, from, content, round) {
        const msg = state.addMessage({
            id: uuidv4(),
            sessionId,
            from,
            content,
            timestamp: Date.now(),
            round,
        });
        this.emit('event', { type: 'message:new', payload: msg });
        return msg;
    }
    markError(sessionId) {
        try {
            const session = state.updateSession(sessionId, { status: 'error' });
            this.emit('event', { type: 'session:error', payload: session });
        }
        catch (_) { /* best-effort */ }
    }
    nextRunEpoch(sessionId) {
        const next = (this.runEpochs.get(sessionId) ?? 0) + 1;
        this.runEpochs.set(sessionId, next);
        return next;
    }
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
//# sourceMappingURL=router.js.map