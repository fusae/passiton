import type { Adapter } from './types.js';
import type { Session, AdapterSendOpts } from '../types.js';
export interface CodexAdapterConfig {
    command?: string;
    args?: string[];
    timeout?: number;
    env?: Record<string, string>;
}
export declare class CodexAdapter implements Adapter {
    readonly name = "codex";
    readonly config: Record<string, unknown>;
    private command;
    private args;
    private timeout;
    private env;
    constructor(cfg?: CodexAdapterConfig);
    send(session: Session, message: string, opts?: AdapterSendOpts): Promise<string>;
    private buildPrompt;
    healthCheck(): Promise<boolean>;
    private run;
}
//# sourceMappingURL=codex.d.ts.map