import { EventEmitter } from 'events';
import type { Session, Message, Adapter, PolicyConfig, AgentRef, SessionMode } from './types.js';
export declare class Router extends EventEmitter {
    private adapters;
    private policy;
    private runningLoops;
    private runEpochs;
    constructor(policy?: Partial<PolicyConfig>);
    registerAdapter(adapter: Adapter): void;
    getAdapter(name: string): Adapter | undefined;
    listAdapters(): Adapter[];
    startSession(params: {
        from: AgentRef;
        to: AgentRef;
        initialPrompt: string;
        mode?: SessionMode;
        context?: string;
        maxRounds?: number;
        approveMode?: boolean;
        cwd?: string;
    }): Session;
    pauseSession(id: string): Promise<Session>;
    resumeSession(id: string, extraRounds?: number): Promise<Session>;
    stopSession(id: string): Promise<Session>;
    injectMessage(sessionId: string, content: string, side?: 'from' | 'to'): Message;
    /**
     * Nudge — inject a human directive and resume.
     * Unlike injectMessage, this explicitly pauses first (if active), injects, then resumes.
     * Use when the user wants to redirect the conversation mid-flight.
     */
    nudge(sessionId: string, content: string): Promise<Message>;
    /**
     * Run rounds until done / paused / error.
     * firstMessage is the content to send to `to` in the first round.
     */
    runSession(sessionId: string, firstMessage: string, epoch: number): Promise<void>;
    /**
     * Execute one message turn. `session.nextTurn` decides who should receive the
     * next message, so pause/resume can safely continue mid-round.
     */
    private processTurn;
    /**
     * Build AdapterSendOpts with system prompt and conversation history.
     * `perspective` determines which agent we're building for.
     */
    private buildSendOpts;
    private callWithRetry;
    private recordMessage;
    private markError;
    private nextRunEpoch;
}
//# sourceMappingURL=router.d.ts.map