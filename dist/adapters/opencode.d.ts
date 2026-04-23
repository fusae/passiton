import type { Adapter } from './types.js';
import type { Session, AdapterSendOpts } from '../types.js';
export interface OpenCodeAdapterConfig {
    command?: string;
    timeout?: number;
    model?: string;
    env?: Record<string, string>;
}
export declare class OpenCodeAdapter implements Adapter {
    readonly name = "opencode";
    readonly config: Record<string, unknown>;
    private command;
    private timeout;
    private model?;
    private env;
    constructor(cfg?: OpenCodeAdapterConfig);
    send(session: Session, message: string, opts?: AdapterSendOpts): Promise<string>;
    private buildPrompt;
    healthCheck(): Promise<boolean>;
    /**
     * Extract assistant text from opencode output.
     * opencode run without --format json prints the assistant reply directly.
     * With --format json it outputs NDJSON events — we look for the last assistant text.
     */
    private extractText;
    private run;
}
//# sourceMappingURL=opencode.d.ts.map