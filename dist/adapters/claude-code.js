// Claude Code adapter — uses claude -p "prompt" --output-format stream-json
import { spawn } from 'child_process';
export class ClaudeCodeAdapter {
    name = 'claude-code';
    config;
    command;
    timeout;
    env;
    constructor(cfg = {}) {
        this.command = cfg.command ?? 'claude';
        this.timeout = cfg.timeout ?? 300_000;
        this.env = cfg.env ?? {};
        this.config = { command: this.command, timeout: this.timeout };
    }
    async send(session, message, opts) {
        const fullMessage = this.buildPrompt(message, opts);
        const raw = await this.run([this.command, '-p', fullMessage, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'], session.cwd);
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
            await this.run([this.command, '--version']);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Parse stream-json output from claude CLI.
     * Priority: result event > last assistant message content.
     */
    extractText(raw) {
        const lines = raw.split('\n').filter((l) => l.trim());
        let lastAssistantText = '';
        let resultText = '';
        for (const line of lines) {
            try {
                const evt = JSON.parse(line);
                if (evt.type === 'result' && evt.result) {
                    resultText = evt.result;
                }
                if (evt.type === 'message' && evt.message?.role === 'assistant') {
                    const content = evt.message.content;
                    if (typeof content === 'string') {
                        lastAssistantText = content;
                    }
                    else if (Array.isArray(content)) {
                        const texts = content
                            .filter((b) => b.type === 'text' && b.text)
                            .map((b) => b.text);
                        if (texts.length > 0)
                            lastAssistantText = texts.join('');
                    }
                }
            }
            catch {
                // non-JSON line (e.g. version output) — ignore
            }
        }
        return (resultText || lastAssistantText || raw).trim();
    }
    run(args, cwd) {
        return new Promise((resolve, reject) => {
            const [cmd, ...rest] = args;
            const proc = spawn(cmd, rest, {
                cwd: cwd ?? process.cwd(),
                env: { ...process.env, ...this.env },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (d) => { stdout += d.toString(); });
            proc.stderr.on('data', (d) => { stderr += d.toString(); });
            const timer = setTimeout(() => {
                proc.kill('SIGTERM');
                reject(new Error(`[claude-code] timed out after ${this.timeout}ms`));
            }, this.timeout);
            proc.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0) {
                    resolve(stdout.trim());
                }
                else {
                    reject(new Error(`[claude-code] exited with code ${code}: ${stderr.trim()}`));
                }
            });
            proc.on('error', (err) => {
                clearTimeout(timer);
                reject(new Error(`[claude-code] spawn error: ${err.message}`));
            });
        });
    }
}
//# sourceMappingURL=claude-code.js.map