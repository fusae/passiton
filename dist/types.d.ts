export type SessionStatus = 'active' | 'paused' | 'done' | 'error';
export interface AgentRef {
    adapter: string;
    label?: string;
}
export interface Message {
    id: string;
    sessionId: string;
    from: string;
    content: string;
    timestamp: number;
    round: number;
}
export interface Session {
    id: string;
    from: AgentRef;
    to: AgentRef;
    status: SessionStatus;
    maxRounds: number;
    currentRound: number;
    approveMode: boolean;
    cwd?: string;
    createdAt: number;
    updatedAt: number;
}
export interface SessionWithMessages extends Session {
    messages: Message[];
}
export interface Adapter {
    name: string;
    config: Record<string, unknown>;
    send(session: Session, message: string): Promise<string>;
    healthCheck(): Promise<boolean>;
}
export interface PolicyConfig {
    maxRounds: number;
    messageTimeout: number;
    sessionTimeout: number;
    retries: number;
}
export interface AgentConfig {
    adapter: string;
    command: string;
    args: string[];
    timeout: number;
    env?: Record<string, string>;
}
export interface AppConfig {
    server: {
        port: number;
    };
    agents: Record<string, AgentConfig>;
    policy: PolicyConfig;
}
export type WsEventType = 'session:created' | 'session:updated' | 'session:done' | 'session:error' | 'session:paused' | 'message:new' | 'agent:status';
export interface WsEvent {
    type: WsEventType;
    payload: unknown;
}
export interface PolicyResult {
    allowed: boolean;
    reason?: 'max_rounds' | 'message_timeout' | 'session_timeout' | 'done' | 'manual';
}
//# sourceMappingURL=types.d.ts.map