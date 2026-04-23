import { EventEmitter } from 'events';
import type { Session, Message, Adapter, PolicyConfig, AgentRef } from './types.js';
export declare class Router extends EventEmitter {
    private adapters;
    private policy;
    private runningLoops;
    constructor(policy?: Partial<PolicyConfig>);
    registerAdapter(adapter: Adapter): void;
    getAdapter(name: string): Adapter | undefined;
    listAdapters(): Adapter[];
    startSession(params: {
        from: AgentRef;
        to: AgentRef;
        initialPrompt: string;
        maxRounds?: number;
        approveMode?: boolean;
        cwd?: string;
    }): Session;
    pauseSession(id: string): Promise<Session>;
    resumeSession(id: string, extraRounds?: number): Promise<Session>;
    stopSession(id: string): Promise<Session>;
    injectMessage(sessionId: string, content: string, side?: 'from' | 'to'): Message;
    /**
     * Run rounds until done / paused / error.
     * firstMessage is the content to send to `to` in the first round.
     */
    runSession(sessionId: string, firstMessage: string): Promise<void>;
    /**
     * Execute one full round: send to `to`, get response, send to `from`, get response.
     * Returns { done, nextMessage } where nextMessage feeds the next round's `to`.
     */
    private processRound;
    private callWithRetry;
    private recordMessage;
    private markError;
}
//# sourceMappingURL=router.d.ts.map