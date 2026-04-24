// Claude Code adapter — uses claude -p "prompt" --output-format stream-json
import { resolveCommandArgs } from './command-args.js';
import { buildPrompt, runCommand } from './shared.js';
const DEFAULT_CLAUDE_ARGS = ['-p', '{prompt}', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];
export class ClaudeCodeAdapter {
    name = 'claude-code';
    config;
    command;
    args;
    timeout;
    env;
    constructor(cfg = {}) {
        this.command = cfg.command ?? 'claude';
        this.args = cfg.args ?? DEFAULT_CLAUDE_ARGS;
        this.timeout = cfg.timeout ?? 300_000;
        this.env = cfg.env ?? {};
        this.config = { command: this.command, args: this.args, timeout: this.timeout };
    }
    async send(session, message, opts) {
        const fullMessage = buildPrompt(message, opts);
        const raw = await runCommand({
            adapterName: this.name,
            command: this.command,
            args: resolveCommandArgs(this.args, fullMessage),
            cwd: session.cwd,
            env: this.env,
            timeout: this.timeout,
            stdinMode: 'ignore',
        });
        return this.extractText(raw);
    }
    async healthCheck() {
        try {
            await runCommand({
                adapterName: this.name,
                command: this.command,
                args: ['--version'],
                env: this.env,
                timeout: this.timeout,
                stdinMode: 'ignore',
            });
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
}
//# sourceMappingURL=claude-code.js.map