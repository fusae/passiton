import type { AdapterSendOpts } from '../types.js';
interface RunCommandOptions {
    adapterName: string;
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeout: number;
    stdinMode?: 'ignore' | 'pipe';
}
export declare function buildPrompt(message: string, opts?: AdapterSendOpts): string;
export declare function runCommand({ adapterName, command, args, cwd, env, timeout, stdinMode, }: RunCommandOptions): Promise<string>;
export {};
//# sourceMappingURL=shared.d.ts.map