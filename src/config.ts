// Config module — load ~/.turing/config.json and merge with defaults

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { AppConfig } from './types.js'

const CONFIG_PATH = join(homedir(), '.turing', 'config.json')
const DEFAULT_CODEX_COMMAND = process.env.TURING_CODEX_COMMAND ?? 'codex'
const DEFAULT_CLAUDE_COMMAND = process.env.TURING_CLAUDE_COMMAND ?? 'claude'
const DEFAULT_OPENCODE_COMMAND = process.env.TURING_OPENCODE_COMMAND ?? 'opencode'

export const DEFAULT_CONFIG: AppConfig = {
  server: {
    port: 4590,
  },
  agents: {
    codex: {
      adapter: 'codex',
      command: DEFAULT_CODEX_COMMAND,
      args: ['exec', '--full-auto', '--ephemeral', '--skip-git-repo-check', '{prompt}'],
      timeout: 300_000,
    },
    'claude-code': {
      adapter: 'claude-code',
      command: DEFAULT_CLAUDE_COMMAND,
      args: ['-p', '{prompt}', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'],
      timeout: 300_000,
    },
    opencode: {
      adapter: 'opencode',
      command: DEFAULT_OPENCODE_COMMAND,
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
}

export function loadConfig(): AppConfig {
  const merged = readConfig()
  return validateConfig(merged)
}

function readConfig(): AppConfig {
  if (!existsSync(CONFIG_PATH)) {
    return DEFAULT_CONFIG
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    const user = JSON.parse(raw) as Partial<AppConfig>
    return deepMerge(DEFAULT_CONFIG, user) as AppConfig
  } catch (err) {
    console.warn(`[config] failed to load ${CONFIG_PATH}:`, err)
    return DEFAULT_CONFIG
  }
}

function validateConfig(config: AppConfig): AppConfig {
  assertPositiveInt(config.server.port, 'server.port')
  assertPositiveInt(config.policy.maxRounds, 'policy.maxRounds')
  assertPositiveInt(config.policy.messageTimeout, 'policy.messageTimeout')
  assertPositiveInt(config.policy.sessionTimeout, 'policy.sessionTimeout')
  assertNonNegativeInt(config.policy.retries, 'policy.retries')

  if (!isPlainObject(config.agents) || Object.keys(config.agents).length === 0) {
    throw new Error('[config] "agents" must be a non-empty object')
  }

  for (const [name, agent] of Object.entries(config.agents)) {
    assertNonEmptyString(agent.adapter, `agents.${name}.adapter`)
    assertNonEmptyString(agent.command, `agents.${name}.command`)
    assertStringArray(agent.args, `agents.${name}.args`)
    assertPositiveInt(agent.timeout, `agents.${name}.timeout`)

    if (agent.model !== undefined) {
      assertNonEmptyString(agent.model, `agents.${name}.model`)
    }

    if (agent.env !== undefined) {
      if (!isPlainObject(agent.env)) {
        throw new Error(`[config] "agents.${name}.env" must be an object`)
      }
      for (const [envKey, envValue] of Object.entries(agent.env)) {
        assertNonEmptyString(envValue, `agents.${name}.env.${envKey}`)
      }
    }
  }

  return config
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (isPlainObject(base) && isPlainObject(override)) {
    const result: Record<string, unknown> = { ...(base as Record<string, unknown>) }
    for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
      result[k] = deepMerge(result[k], v)
    }
    return result
  }
  return override !== undefined ? override : base
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`[config] "${field}" must be a non-empty string`)
  }
}

function assertPositiveInt(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`[config] "${field}" must be a positive integer`)
  }
}

function assertNonNegativeInt(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`[config] "${field}" must be a non-negative integer`)
  }
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw new Error(`[config] "${field}" must be a string array`)
  }
}
