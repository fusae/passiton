// Config module — load ~/.turing/config.json and merge with defaults
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
const CONFIG_PATH = join(homedir(), '.turing', 'config.json');
export const DEFAULT_CONFIG = {
    server: {
        port: 4590,
    },
    agents: {
        codex: {
            adapter: 'codex',
            command: 'codex',
            args: ['exec', '-p'],
            timeout: 300_000,
        },
        'claude-code': {
            adapter: 'claude-code',
            command: 'claude',
            args: ['-p', '--output-format', 'stream-json'],
            timeout: 300_000,
        },
    },
    policy: {
        maxRounds: 20,
        messageTimeout: 300_000,
        sessionTimeout: 7_200_000,
        retries: 1,
    },
};
export function loadConfig() {
    if (!existsSync(CONFIG_PATH)) {
        return DEFAULT_CONFIG;
    }
    try {
        const raw = readFileSync(CONFIG_PATH, 'utf-8');
        const user = JSON.parse(raw);
        return deepMerge(DEFAULT_CONFIG, user);
    }
    catch (err) {
        console.warn(`[config] failed to load ${CONFIG_PATH}:`, err);
        return DEFAULT_CONFIG;
    }
}
function deepMerge(base, override) {
    if (isPlainObject(base) && isPlainObject(override)) {
        const result = { ...base };
        for (const [k, v] of Object.entries(override)) {
            result[k] = deepMerge(result[k], v);
        }
        return result;
    }
    return override !== undefined ? override : base;
}
function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
//# sourceMappingURL=config.js.map