// Router module — session lifecycle and message routing
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as state from './state.js';
import { checkPreRound, detectCompletion, DEFAULT_POLICY, } from './policy.js';
export class Router extends EventEmitter {
    adapters = new Map();
    policy;
    // Track in-flight sessions so runSession loops can be cancelled
    runningLoops = new Set();
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
        const session = state.createSession({
            id: uuidv4(),
            from: params.from,
            to: params.to,
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
            this.runSession(session.id, params.initialPrompt).catch((err) => {
                console.error(`[router] runSession error for ${session.id}:`, err);
                this.markError(session.id);
            });
        });
        return session;
    }
    async pauseSession(id) {
        this.runningLoops.delete(id);
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
        setImmediate(() => {
            this.runSession(id, lastMessage.content).catch((err) => {
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
        // If session is paused and approveMode, we resume from this injected message
        if (session.status === 'paused' && !session.approveMode) {
            // auto-resume using injected message
            this.resumeSession(sessionId).catch(console.error);
        }
        return msg;
    }
    // ── Core run loop ────────────────────────────────────────────────────────────
    /**
     * Run rounds until done / paused / error.
     * firstMessage is the content to send to `to` in the first round.
     */
    async runSession(sessionId, firstMessage) {
        this.runningLoops.add(sessionId);
        let nextMessageForTo = firstMessage;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            // Check if we've been cancelled
            if (!this.runningLoops.has(sessionId))
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
                const result = await this.processRound(sessionId, nextMessageForTo);
                if (result.done) {
                    const updated = state.updateSession(sessionId, { status: 'done' });
                    this.emit('event', { type: 'session:done', payload: updated });
                    break;
                }
                nextMessageForTo = result.nextMessage;
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
     * Execute one full round: send to `to`, get response, send to `from`, get response.
     * Returns { done, nextMessage } where nextMessage feeds the next round's `to`.
     */
    async processRound(sessionId, messageForTo) {
        const session = state.getSession(sessionId);
        const round = session.currentRound + 1;
        const toAdapter = this.adapters.get(session.to.adapter);
        const fromAdapter = this.adapters.get(session.from.adapter);
        if (!toAdapter)
            throw new Error(`Adapter not found: ${session.to.adapter}`);
        if (!fromAdapter)
            throw new Error(`Adapter not found: ${session.from.adapter}`);
        // Send to `to` agent
        const toResponse = await this.callWithRetry(toAdapter, session, messageForTo);
        this.recordMessage(sessionId, session.to.adapter, toResponse, round);
        state.updateSession(sessionId, { currentRound: round });
        if (detectCompletion(toResponse)) {
            return { done: true, nextMessage: toResponse };
        }
        // Send `to`'s response back to `from` agent
        if (!this.runningLoops.has(sessionId)) {
            return { done: false, nextMessage: toResponse };
        }
        const fromResponse = await this.callWithRetry(fromAdapter, session, toResponse);
        this.recordMessage(sessionId, session.from.adapter, fromResponse, round);
        if (detectCompletion(fromResponse)) {
            return { done: true, nextMessage: fromResponse };
        }
        return { done: false, nextMessage: fromResponse };
    }
    // ── Helpers ─────────────────────────────────────────────────────────────────
    async callWithRetry(adapter, session, message) {
        let lastErr;
        for (let attempt = 0; attempt <= this.policy.retries; attempt++) {
            try {
                return await adapter.send(session, message);
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
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
//# sourceMappingURL=router.js.map