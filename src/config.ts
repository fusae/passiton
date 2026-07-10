// Config module — load config.json from PASSITON_HOME/TURING_HOME and merge with defaults

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { delimiter, join, dirname } from 'path'
import crypto from 'crypto'
import type { AppConfig, SessionMode } from './types.js'
import { defaultClaudeCodeArgs } from './adapters/claude-code.js'
import { resolveDataHome } from './paths.js'

function env(name: string): string | undefined {
  return process.env[`PASSITON_${name}`] ?? process.env[`TURING_${name}`]
}

const DEFAULT_CODEX_COMMAND = env('CODEX_COMMAND') ?? 'codex'
const DEFAULT_CLAUDE_COMMAND = env('CLAUDE_COMMAND') ?? 'claude'
const DEFAULT_GEMINI_COMMAND = env('GEMINI_COMMAND') ?? 'gemini'
const DEFAULT_OPENCODE_COMMAND = env('OPENCODE_COMMAND') ?? 'opencode'

export const DEFAULT_CONFIG: AppConfig = {
  server: {
    port: 4590,
    host: '127.0.0.1',
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
    localCliAgents: parseBooleanEnv(env('LOCAL_CLI_AGENTS')) ?? true,
  },
  ops: {
    model: {
      userAgentName: '__ops__',
    },
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
      args: ['exec', '--ephemeral', '--skip-git-repo-check', '{prompt}'],
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
      args: ['run', '{prompt}'],
      timeout: 600_000,
    },
}

export function loadConfig(): AppConfig {
  ensureConfigFile()
  const merged = readConfig()
  return validateConfig(merged)
}

/**
 * On first run (config.json does not exist yet), persist a base config with
 * generated secrets so the file is on disk even if the server fails to start
 * (e.g. port-in-use exit).  Existing config.json is never overwritten.
 *
 * The secrets written here are picked up later by the lazy generators in
 * auth.ts (getJwtSecret) and keyvault.ts (getEncryptionSecret), so those
 * functions become no-ops for persistence on a normal first run.
 */
function ensureConfigFile(): void {
  const configPath = getConfigPath()
  if (existsSync(configPath)) return

  const auth: AppConfig['auth'] = { ...DEFAULT_CONFIG.auth }
  if (!env('JWT_SECRET') && !auth.jwtSecret) {
    auth.jwtSecret = crypto.randomBytes(32).toString('hex')
  }
  if (!env('ENCRYPTION_KEY') && !auth.encryptionKey) {
    auth.encryptionKey = crypto.randomBytes(32).toString('hex')
  }
  const toWrite: AppConfig = { ...DEFAULT_CONFIG, auth }

  const configDir = dirname(configPath)
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }
  writeFileSync(configPath, JSON.stringify(toWrite, null, 2), 'utf-8')
}

function readConfig(): AppConfig {
  const configPath = getConfigPath()
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
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
    console.warn(`[config] failed to load ${configPath}:`, err)
    return DEFAULT_CONFIG
  }
}

function validateConfig(config: AppConfig): AppConfig {
  config = normalizeConfig(config)
  assertPort(config.server.port, 'server.port')
  if (config.server.host !== undefined) {
    assertNonEmptyString(config.server.host, 'server.host')
  }
  assertPositiveInt(config.defaults.maxRounds, 'defaults.maxRounds')
  assertSessionMode(config.defaults.mode, 'defaults.mode')
  assertPositiveInt(config.policy.maxRounds, 'policy.maxRounds')
  assertPositiveInt(config.policy.messageTimeout, 'policy.messageTimeout')
  assertNonNegativeInt(config.policy.messageRetentionMs, 'policy.messageRetentionMs')
  assertPositiveInt(config.policy.sessionTimeout, 'policy.sessionTimeout')
  assertNonNegativeInt(config.policy.retries, 'policy.retries')
  assertStringArray(config.policy.allowedWorkspaces ?? [], 'policy.allowedWorkspaces')
  if (config.ops !== undefined) {
    if (!isPlainObject(config.ops)) {
      throw new Error('[config] "ops" must be an object')
    }
    if (config.ops.model !== undefined) {
      if (!isPlainObject(config.ops.model)) {
        throw new Error('[config] "ops.model" must be an object')
      }
      if (config.ops.model.userAgentName !== undefined) {
        assertNonEmptyString(config.ops.model.userAgentName, 'ops.model.userAgentName')
      }
    }
  }

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
    if (agent.lastVerifiedAt !== undefined) {
      assertNonNegativeInt(agent.lastVerifiedAt, `agents.${name}.lastVerifiedAt`)
    }
    if (agent.lastVerifiedVersion !== undefined) {
      assertNonEmptyString(agent.lastVerifiedVersion, `agents.${name}.lastVerifiedVersion`)
    }
  }

  return config
}

function isApiAdapter(adapter: string): boolean {
  return adapter === 'anthropic-api' || adapter === 'openai-api' || adapter === 'zhipu-api' || adapter === 'deepseek-api' || adapter === 'qwen-api' || adapter === 'moonshot-api' || adapter === 'custom-api'
}

function normalizeConfig(config: AppConfig): AppConfig {
  const auth = {
    ...config.auth,
    allowRegistration: parseBooleanEnv(env('ALLOW_REGISTRATION')) ?? config.auth?.allowRegistration ?? false,
    localAccess: parseBooleanEnv(env('LOCAL_ACCESS')) ?? config.auth?.localAccess ?? true,
    localUserEmail: env('LOCAL_USER_EMAIL') ?? config.auth?.localUserEmail,
  }
  const defaults = {
    maxRounds: config.defaults?.maxRounds ?? config.policy?.maxRounds ?? DEFAULT_CONFIG.defaults.maxRounds,
    mode: config.defaults?.mode ?? DEFAULT_CONFIG.defaults.mode,
  }
  const features = {
    ...DEFAULT_CONFIG.features,
    ...config.features,
    localCliAgents: parseBooleanEnv(env('LOCAL_CLI_AGENTS')) ?? config.features?.localCliAgents ?? DEFAULT_CONFIG.features.localCliAgents,
  }
  const ops = {
    ...DEFAULT_CONFIG.ops,
    ...config.ops,
    model: {
      ...DEFAULT_CONFIG.ops?.model,
      ...config.ops?.model,
    },
  }

  return {
    ...config,
    server: {
      ...config.server,
      port: resolvePort(process.env.PORT) ?? config.server?.port ?? DEFAULT_CONFIG.server.port,
      host: env('HOST') ?? config.server?.host ?? DEFAULT_CONFIG.server.host,
    },
    auth,
    defaults,
    features,
    ops,
    agents: config.agents ?? {},
    policy: {
      ...config.policy,
      maxRounds: defaults.maxRounds,
      allowedWorkspaces: parseListEnv(env('ALLOWED_WORKSPACES')) ?? config.policy?.allowedWorkspaces ?? [],
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

export function validateExposureConfig(config: AppConfig): void {
  const host = config.server.host ?? '127.0.0.1'
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return
  if (config.auth?.localAccess !== false) {
    throw new Error('[security] Non-localhost bind requires PASSITON_LOCAL_ACCESS=false')
  }
  if (!env('JWT_SECRET') && !config.auth?.jwtSecret) {
    throw new Error('[security] Non-localhost bind requires PASSITON_JWT_SECRET or auth.jwtSecret')
  }
  if ((config.policy.allowedWorkspaces ?? []).length === 0) {
    throw new Error('[security] Non-localhost bind requires policy.allowedWorkspaces')
  }
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

function resolvePort(envValue: string | undefined): number | undefined {
  if (envValue === undefined) return undefined
  const parsed = Number.parseInt(envValue, 10)
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
    console.warn(`[config] Invalid PORT "${envValue}", falling back to config file or default`)
    return undefined
  }
  return parsed
}

export function writeConfig(config: AppConfig): void {
  const validated = validateConfig(config)
  const configPath = getConfigPath()
  const configDir = dirname(configPath)

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }

  writeFileSync(configPath, JSON.stringify(validated, null, 2), 'utf-8')
}

export function getConfigPath(): string {
  return join(resolveDataHome(), 'config.json')
}
