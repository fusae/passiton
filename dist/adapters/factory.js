import { ClaudeCodeAdapter } from './claude-code.js';
import { CodexAdapter } from './codex.js';
import { OpenCodeAdapter } from './opencode.js';
export function createAdapter(agentCfg) {
    switch (agentCfg.adapter) {
        case 'codex':
            return new CodexAdapter({
                command: agentCfg.command,
                args: agentCfg.args,
                timeout: agentCfg.timeout,
                env: agentCfg.env,
            });
        case 'claude-code':
            return new ClaudeCodeAdapter({
                command: agentCfg.command,
                args: agentCfg.args,
                timeout: agentCfg.timeout,
                env: agentCfg.env,
            });
        case 'opencode':
            return new OpenCodeAdapter({
                command: agentCfg.command,
                args: agentCfg.args,
                timeout: agentCfg.timeout,
                model: agentCfg.model,
                env: agentCfg.env,
            });
        default:
            return undefined;
    }
}
export function registerConfiguredAdapters(router, agents) {
    for (const [name, agentCfg] of Object.entries(agents)) {
        const adapter = createAdapter(agentCfg);
        if (!adapter) {
            console.warn(`[init] unknown adapter "${agentCfg.adapter}" for "${name}" — skipping`);
            continue;
        }
        router.registerAdapter(adapter);
    }
}
//# sourceMappingURL=factory.js.map