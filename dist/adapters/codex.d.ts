import type { Adapter } from './types.js';
import type { Session } from '../types.js';
export interface CodexAdapterConfig {
    command?: string;
    timeout?: number;
    env?: Record<string, string>;
}
export declare class CodexAdapter implements Adapter {
    readonly name = "codex";
    readonly config: Record<string, unknown>;
    private command;
    private timeout;
    private env;
    constructor(cfg?: CodexAdapterConfig);
    send(session: Session, message: string): Promise<string>;
    healthCheck(): Promise<boolean>;
    private run;
}
//# sourceMappingURL=codex.d.ts.map