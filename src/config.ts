// Config module — load ~/.turing/config.json and merge with defaults

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { delimiter, join, dirname } from 'path'
import { homedir } from 'os'
import type { AppConfig, SessionMode } from './types.js'
import { defaultClaudeCodeArgs } from './adapters/claude-code.js'

const CONFIG_PATH = join(homedir(), '.turing', 'config.json')
const DEFAULT_CODEX_COMMAND = process.env.TURING_CODEX_COMMAND ?? 'codex'
const DEFAULT_CLAUDE_COMMAND = process.env.TURING_CLAUDE_COMMAND ?? 'claude'
const DEFAULT_GEMINI_COMMAND = process.env.TURING_GEMINI_COMMAND ?? 'gemini'
const DEFAULT_OPENCODE_COMMAND = process.env.TURING_OPENCODE_COMMAND ?? 'opencode'

export const DEFAULT_CONFIG: AppConfig = {
  server: {
    port: 4590,
  },
  auth: {
    allowRegistration: false,
    localAccess: true,
  },
  defaults: {
    maxRounds: 20,
    mode: 'collaborate',
  },
  features: {
    localCliAgents: parseBooleanEnv(process.env.TURING_LOCAL_CLI_AGENTS) ?? false,
  },
  agents: {},
  policy: {
    maxRounds: 20,
    messageTimeout: 600_000,
    messageRetentionMs: 30 * 24 * 60 * 60 * 1000,
    sessionTimeout: 7_200_000,
    retries: 1,
    allowedWorkspaces: [],
  },
}

export const LOCAL_CLI_AGENT_DEFAULTS: Record<string, AppConfig['agents'][string]> = {
    codex: {
      adapter: 'codex',
      command: DEFAULT_CODEX_COMMAND,
      args: ['exec', '--full-auto', '--ephemeral', '--skip-git-repo-check', '{prompt}'],
      timeout: 600_000,
    },
    'claude-code': {
      adapter: 'claude-code',
      command: DEFAULT_CLAUDE_COMMAND,
      args: defaultClaudeCodeArgs(),
      timeout: 600_000,
    },
    'gemini-cli': {
      adapter: 'gemini-cli',
      command: DEFAULT_GEMINI_COMMAND,
      args: ['-p', '{prompt}'],
      timeout: 600_000,
    },
    opencode: {
      adapter: 'opencode',
      command: DEFAULT_OPENCODE_COMMAND,
      args: ['run', '{prompt}', '--dangerously-skip-permissions'],
      timeout: 600_000,
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
    const merged = deepMerge(DEFAULT_CONFIG, user) as AppConfig
    if (isPlainObject(user.agents)) {
      merged.agents = Object.fromEntries(
        Object.entries(user.agents).map(([name, agent]) => {
          const baseAgent = merged.agents?.[name]
          return [name, deepMerge(baseAgent ?? {}, agent) as AppConfig['agents'][string]]
        })
      )
    }
    return normalizeConfig(merged)
  } catch (err) {
    console.warn(`[config] failed to load ${CONFIG_PATH}:`, err)
    return DEFAULT_CONFIG
  }
}

function validateConfig(config: AppConfig): AppConfig {
  config = normalizeConfig(config)
  assertPort(config.server.port, 'server.port')
  assertPositiveInt(config.defaults.maxRounds, 'defaults.maxRounds')
  assertSessionMode(config.defaults.mode, 'defaults.mode')
  assertPositiveInt(config.policy.maxRounds, 'policy.maxRounds')
  assertPositiveInt(config.policy.messageTimeout, 'policy.messageTimeout')
  assertNonNegativeInt(config.policy.messageRetentionMs, 'policy.messageRetentionMs')
  assertPositiveInt(config.policy.sessionTimeout, 'policy.sessionTimeout')
  assertNonNegativeInt(config.policy.retries, 'policy.retries')
  assertStringArray(config.policy.allowedWorkspaces ?? [], 'policy.allowedWorkspaces')

  if (!isPlainObject(config.agents)) {
    throw new Error('[config] "agents" must be an object')
  }

  for (const [name, agent] of Object.entries(config.agents)) {
    assertNonEmptyString(agent.adapter, `agents.${name}.adapter`)
    const isApiAgent = isApiAdapter(agent.adapter)
    if (isApiAgent) {
      assertNonEmptyString(agent.apiKey, `agents.${name}.apiKey`)
    } else {
      assertNonEmptyString(agent.command, `agents.${name}.command`)
      assertStringArray(agent.args, `agents.${name}.args`)
      assertPositiveInt(agent.timeout, `agents.${name}.timeout`)
    }

    if (agent.command !== undefined) {
      assertNonEmptyString(agent.command, `agents.${name}.command`)
    }
    if (agent.args !== undefined) {
      assertStringArray(agent.args, `agents.${name}.args`)
    }
    if (agent.timeout !== undefined) {
      assertPositiveInt(agent.timeout, `agents.${name}.timeout`)
    }

    if (agent.model !== undefined) {
      assertNonEmptyString(agent.model, `agents.${name}.model`)
    }
    if (agent.apiKey !== undefined) {
      assertNonEmptyString(agent.apiKey, `agents.${name}.apiKey`)
    }
    if (agent.baseUrl !== undefined) {
      assertNonEmptyString(agent.baseUrl, `agents.${name}.baseUrl`)
    }

    if (agent.env !== undefined) {
      if (!isPlainObject(agent.env)) {
        throw new Error(`[config] "agents.${name}.env" must be an object`)
      }
      for (const [envKey, envValue] of Object.entries(agent.env)) {
        assertNonEmptyString(envKey, `agents.${name}.env key`)
        assertNonEmptyString(envValue, `agents.${name}.env.${envKey}`)
      }
    }
  }

  return config
}

function isApiAdapter(adapter: string): boolean {
  return adapter === 'anthropic-api' || adapter === 'openai-api' || adapter === 'zhipu-api' || adapter === 'custom-api'
}

function normalizeConfig(config: AppConfig): AppConfig {
  const auth = {
    ...config.auth,
    allowRegistration: parseBooleanEnv(process.env.TURING_ALLOW_REGISTRATION) ?? config.auth?.allowRegistration ?? false,
    localAccess: parseBooleanEnv(process.env.TURING_LOCAL_ACCESS) ?? config.auth?.localAccess ?? true,
    localUserEmail: process.env.TURING_LOCAL_USER_EMAIL ?? config.auth?.localUserEmail,
  }
  const defaults = {
    maxRounds: config.defaults?.maxRounds ?? config.policy?.maxRounds ?? DEFAULT_CONFIG.defaults.maxRounds,
    mode: config.defaults?.mode ?? DEFAULT_CONFIG.defaults.mode,
  }
  const features = {
    ...DEFAULT_CONFIG.features,
    ...config.features,
    localCliAgents: parseBooleanEnv(process.env.TURING_LOCAL_CLI_AGENTS) ?? config.features?.localCliAgents ?? DEFAULT_CONFIG.features.localCliAgents,
  }

  return {
    ...config,
    auth,
    defaults,
    features,
    agents: config.agents ?? {},
    policy: {
      ...config.policy,
      maxRounds: defaults.maxRounds,
      allowedWorkspaces: parseListEnv(process.env.TURING_ALLOWED_WORKSPACES) ?? config.policy?.allowedWorkspaces ?? [],
    },
  }
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

function assertPort(value: unknown, field: string): asserts value is number {
  assertPositiveInt(value, field)
  if (value > 65535) {
    throw new Error(`[config] "${field}" must be between 1 and 65535`)
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

function assertSessionMode(value: unknown, field: string): asserts value is SessionMode {
  if (value !== 'collaborate' && value !== 'discuss' && value !== 'review' && value !== 'freeform') {
    throw new Error(`[config] "${field}" must be one of collaborate, discuss, review, freeform`)
  }
}

export function activeAgents(config: AppConfig): AppConfig['agents'] {
  return config.agents
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false
  return undefined
}

function parseListEnv(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  return value.split(delimiter).map((item) => item.trim()).filter(Boolean)
}

export function writeConfig(config: AppConfig): void {
  const validated = validateConfig(config)
  const configDir = dirname(CONFIG_PATH)

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }

  writeFileSync(CONFIG_PATH, JSON.stringify(validated, null, 2), 'utf-8')
}

export function getConfigPath(): string {
  return CONFIG_PATH
}
