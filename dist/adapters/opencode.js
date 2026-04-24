// OpenCode adapter — uses opencode run "prompt" --dangerously-skip-permissions --format json
import { spawn } from 'child_process';
import { resolveCommandArgs } from './command-args.js';
const DEFAULT_OPENCODE_PATH = 'opencode';
const DEFAULT_OPENCODE_ARGS = ['run', '{prompt}', '--dangerously-skip-permissions'];
export class OpenCodeAdapter {
    name = 'opencode';
    config;
    command;
    args;
    timeout;
    model;
    env;
    constructor(cfg = {}) {
        this.command = cfg.command ?? DEFAULT_OPENCODE_PATH;
        this.args = cfg.args ?? DEFAULT_OPENCODE_ARGS;
        this.timeout = cfg.timeout ?? 300_000;
        this.model = cfg.model;
        this.env = cfg.env ?? {};
        this.config = { command: this.command, args: this.args, timeout: this.timeout, model: this.model };
    }
    async send(session, message, opts) {
        const fullMessage = this.buildPrompt(message, opts);
        const args = resolveCommandArgs(this.args, fullMessage);
        if (this.model) {
            args.push('--model', this.model);
        }
        if (session.cwd) {
            args.push('--dir', session.cwd);
        }
        const raw = await this.run([this.command, ...args], session.cwd);
        return this.extractText(raw);
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
            await this.run([this.command, '--version'], undefined, 10_000);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Extract assistant text from opencode output.
     * opencode run without --format json prints the assistant reply directly.
     * With --format json it outputs NDJSON events — we look for the last assistant text.
     */
    extractText(raw) {
        // Try parsing as NDJSON first
        const lines = raw.split('\n').filter((l) => l.trim());
        let lastText = '';
        for (const line of lines) {
            try {
                const evt = JSON.parse(line);
                // opencode json events may have various shapes
                if (evt.type === 'assistant' && evt.content) {
                    lastText = typeof evt.content === 'string'
                        ? evt.content
                        : JSON.stringify(evt.content);
                }
                if (evt.type === 'text' && evt.text) {
                    lastText = evt.text;
                }
                // result / completion event
                if (evt.result) {
                    lastText = typeof evt.result === 'string'
                        ? evt.result
                        : JSON.stringify(evt.result);
                }
                // Some opencode versions emit { content: "..." } directly
                if (!evt.type && evt.content && typeof evt.content === 'string') {
                    lastText = evt.content;
                }
            }
            catch {
                // Not JSON — plain text output, accumulate
            }
        }
        // If we found structured text, use it; otherwise return raw output
        return (lastText || raw).trim();
    }
    run(args, cwd, timeoutOverride) {
        const timeout = timeoutOverride ?? this.timeout;
        return new Promise((resolve, reject) => {
            const [cmd, ...rest] = args;
            const proc = spawn(cmd, rest, {
                cwd: cwd ?? process.cwd(),
                env: { ...process.env, ...this.env },
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            // Close stdin immediately
            proc.stdin?.end();
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (d) => { stdout += d.toString(); });
            proc.stderr.on('data', (d) => { stderr += d.toString(); });
            const timer = setTimeout(() => {
                proc.kill('SIGTERM');
                reject(new Error(`[opencode] timed out after ${timeout}ms`));
            }, timeout);
            proc.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0) {
                    resolve(stdout.trim());
                }
                else {
                    reject(new Error(`[opencode] exited with code ${code}: ${stderr.trim()}`));
                }
            });
            proc.on('error', (err) => {
                clearTimeout(timer);
                reject(new Error(`[opencode] spawn error: ${err.message}`));
            });
        });
    }
}
//# sourceMappingURL=opencode.js.map