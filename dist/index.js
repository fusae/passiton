// Turing — entry point
import { loadConfig } from './config.js';
import { initDb } from './state.js';
import { Router } from './router.js';
import { CodexAdapter } from './adapters/codex.js';
import { ClaudeCodeAdapter } from './adapters/claude-code.js';
import { createServer } from './server.js';
async function main() {
    const config = loadConfig();
    // Init persistence
    initDb();
    // Build router with policy from config
    const router = new Router(config.policy);
    // Register adapters based on config
    for (const [name, agentCfg] of Object.entries(config.agents)) {
        switch (agentCfg.adapter) {
            case 'codex':
                router.registerAdapter(new CodexAdapter({
                    command: agentCfg.command,
                    timeout: agentCfg.timeout,
                    env: agentCfg.env,
                }));
                break;
            case 'claude-code':
                router.registerAdapter(new ClaudeCodeAdapter({
                    command: agentCfg.command,
                    timeout: agentCfg.timeout,
                    env: agentCfg.env,
                }));
                break;
            default:
                console.warn(`[init] unknown adapter type "${agentCfg.adapter}" for agent "${name}" — skipping`);
        }
    }
    // Start HTTP + WebSocket server
    createServer(router, config.server.port);
}
main().catch((err) => {
    console.error('[fatal]', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map