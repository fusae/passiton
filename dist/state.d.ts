import type { Session, Message, AgentRef, SessionStatus, SessionMode } from './types.js';
export declare function initDb(dbPath?: string): void;
export declare function createSession(params: {
    id: string;
    from: AgentRef;
    to: AgentRef;
    mode?: SessionMode;
    context?: string;
    systemPrompts?: {
        from: string;
        to: string;
    };
    nextTurn?: 'from' | 'to';
    maxRounds?: number;
    approveMode?: boolean;
    cwd?: string;
}): Session;
export declare function getSession(id: string): Session | undefined;
export declare function updateSession(id: string, updates: Partial<Pick<Session, 'status' | 'currentRound' | 'maxRounds' | 'approveMode' | 'nextTurn'>>): Session;
export declare function listSessions(filter?: {
    status?: SessionStatus;
}): Session[];
export declare function addMessage(msg: Message): Message;
export declare function getMessages(sessionId: string): Message[];
//# sourceMappingURL=state.d.ts.map