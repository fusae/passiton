// Codex adapter — uses codex exec -p "prompt"
import { spawn } from 'child_process';
const DEFAULT_CODEX_PATH = 'codex';
export class CodexAdapter {
    name = 'codex';
    config;
    command;
    timeout;
    env;
    constructor(cfg = {}) {
        this.command = cfg.command ?? DEFAULT_CODEX_PATH;
        this.timeout = cfg.timeout ?? 300_000;
        this.env = cfg.env ?? {};
        this.config = { command: this.command, timeout: this.timeout };
    }
    async send(session, message, opts) {
        // Build the full prompt with system context and history
        const fullMessage = this.buildPrompt(message, opts);
        return this.run([this.command, 'exec', '--full-auto', '--ephemeral', '--skip-git-repo-check', fullMessage], session.cwd);
    }
    buildPrompt(message, opts) {
        const parts = [];
        if (opts?.systemPrompt) {
            parts.push(`[System Instructions]\n${opts.systemPrompt}\n`);
        }
        if (opts?.history && opts.history.length > 0) {
            parts.push('[Conversation History]');
            for (const msg of opts.history) {
                const role = msg.role === 'assistant' ? 'You' : 'Other';
                parts.push(`${role}: ${msg.content}`);
            }
            parts.push('');
        }
        parts.push(`[Current Message]\n${message}`);
        return parts.join('\n');
    }
    async healthCheck() {
        try {
            await this.run([this.command, '--version']);
            return true;
        }
        catch {
            return false;
        }
    }
    run(args, cwd) {
        return new Promise((resolve, reject) => {
            const [cmd, ...rest] = args;
            const proc = spawn(cmd, rest, {
                cwd: cwd ?? process.cwd(),
                env: { ...process.env, ...this.env },
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            // Close stdin immediately so Codex doesn't wait for input
            proc.stdin?.end();
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (d) => { stdout += d.toString(); });
            proc.stderr.on('data', (d) => { stderr += d.toString(); });
            const timer = setTimeout(() => {
                proc.kill('SIGTERM');
                reject(new Error(`[codex] timed out after ${this.timeout}ms`));
            }, this.timeout);
            proc.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0) {
                    resolve(stdout.trim());
                }
                else {
                    reject(new Error(`[codex] exited with code ${code}: ${stderr.trim()}`));
                }
            });
            proc.on('error', (err) => {
                clearTimeout(timer);
                reject(new Error(`[codex] spawn error: ${err.message}`));
            });
        });
    }
}
//# sourceMappingURL=codex.js.map