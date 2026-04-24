// Codex adapter — uses codex exec -p "prompt"
import { resolveCommandArgs } from './command-args.js';
import { buildPrompt, runCommand } from './shared.js';
const DEFAULT_CODEX_PATH = 'codex';
const DEFAULT_CODEX_ARGS = ['exec', '--full-auto', '--ephemeral', '--skip-git-repo-check', '{prompt}'];
export class CodexAdapter {
    name = 'codex';
    config;
    command;
    args;
    timeout;
    env;
    constructor(cfg = {}) {
        this.command = cfg.command ?? DEFAULT_CODEX_PATH;
        this.args = cfg.args ?? DEFAULT_CODEX_ARGS;
        this.timeout = cfg.timeout ?? 300_000;
        this.env = cfg.env ?? {};
        this.config = { command: this.command, args: this.args, timeout: this.timeout };
    }
    async send(session, message, opts) {
        const fullMessage = buildPrompt(message, opts);
        return runCommand({
            adapterName: this.name,
            command: this.command,
            args: resolveCommandArgs(this.args, fullMessage),
            cwd: session.cwd,
            env: this.env,
            timeout: this.timeout,
            stdinMode: 'pipe',
        });
    }
    async healthCheck() {
        try {
            await runCommand({
                adapterName: this.name,
                command: this.command,
                args: ['--version'],
                env: this.env,
                timeout: this.timeout,
                stdinMode: 'pipe',
            });
            return true;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=codex.js.map