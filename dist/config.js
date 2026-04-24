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
            args: ['exec', '--full-auto', '--ephemeral', '--skip-git-repo-check', '{prompt}'],
            timeout: 300_000,
        },
        'claude-code': {
            adapter: 'claude-code',
            command: 'claude',
            args: ['-p', '{prompt}', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'],
            timeout: 300_000,
        },
        opencode: {
            adapter: 'opencode',
            command: 'opencode',
            args: ['run', '{prompt}', '--dangerously-skip-permissions'],
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
    const merged = readConfig();
    return validateConfig(merged);
}
function readConfig() {
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
function validateConfig(config) {
    assertPositiveInt(config.server.port, 'server.port');
    assertPositiveInt(config.policy.maxRounds, 'policy.maxRounds');
    assertPositiveInt(config.policy.messageTimeout, 'policy.messageTimeout');
    assertPositiveInt(config.policy.sessionTimeout, 'policy.sessionTimeout');
    assertNonNegativeInt(config.policy.retries, 'policy.retries');
    if (!isPlainObject(config.agents) || Object.keys(config.agents).length === 0) {
        throw new Error('[config] "agents" must be a non-empty object');
    }
    for (const [name, agent] of Object.entries(config.agents)) {
        assertNonEmptyString(agent.adapter, `agents.${name}.adapter`);
        assertNonEmptyString(agent.command, `agents.${name}.command`);
        assertStringArray(agent.args, `agents.${name}.args`);
        assertPositiveInt(agent.timeout, `agents.${name}.timeout`);
        if (agent.model !== undefined) {
            assertNonEmptyString(agent.model, `agents.${name}.model`);
        }
        if (agent.env !== undefined) {
            if (!isPlainObject(agent.env)) {
                throw new Error(`[config] "agents.${name}.env" must be an object`);
            }
            for (const [envKey, envValue] of Object.entries(agent.env)) {
                assertNonEmptyString(envValue, `agents.${name}.env.${envKey}`);
            }
        }
    }
    return config;
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
function assertNonEmptyString(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`[config] "${field}" must be a non-empty string`);
    }
}
function assertPositiveInt(value, field) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw new Error(`[config] "${field}" must be a positive integer`);
    }
}
function assertNonNegativeInt(value, field) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new Error(`[config] "${field}" must be a non-negative integer`);
    }
}
function assertStringArray(value, field) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
        throw new Error(`[config] "${field}" must be a string array`);
    }
}
//# sourceMappingURL=config.js.map