import type { Adapter } from './types.js';
import type { Session, AdapterSendOpts } from '../types.js';
export interface ClaudeCodeAdapterConfig {
    command?: string;
    args?: string[];
    timeout?: number;
    env?: Record<string, string>;
}
export declare class ClaudeCodeAdapter implements Adapter {
    readonly name = "claude-code";
    readonly config: Record<string, unknown>;
    private command;
    private args;
    private timeout;
    private env;
    constructor(cfg?: ClaudeCodeAdapterConfig);
    send(session: Session, message: string, opts?: AdapterSendOpts): Promise<string>;
    private buildPrompt;
    healthCheck(): Promise<boolean>;
    /**
     * Parse stream-json output from claude CLI.
     * Priority: result event > last assistant message content.
     */
    private extractText;
    private run;
}
//# sourceMappingURL=claude-code.d.ts.map