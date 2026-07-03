import { access, mkdtemp, rm } from 'fs/promises'
import { constants } from 'fs'
import { delimiter, dirname, join } from 'path'
import { homedir, tmpdir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { AgentConfig } from './types.js'
import { createAdapter, createDiscoveredAgentConfig } from './adapters/factory.js'
import type { Router } from './router.js'
import type { Session } from './types.js'

const execFileAsync = promisify(execFile)
const HEALTH_CACHE_TTL_MS = 60_000

interface DiscoveryPreset {
  name: string
  adapter: string
  commands: string[]
  envVars?: string[]
  supported: boolean
}

export interface AgentInfo {
  name: string
  adapter: string
  command?: string
  args?: string[]
  timeout?: number
  env?: Record<string, string>
  source: 'configured' | 'discovered'
  supported: boolean
  availableForSessions: boolean
  healthy: boolean
  /**
   * True only when the agent passed a real smoke test (a model round-trip).
   * An agent can be `healthy: true` (binary installed) yet `verified: false`
   * (we haven't confirmed it can actually call the model — e.g. credentials
   * may be invalid or a subscription may have lapsed). Use `verified` to gate
   * session creation, not `healthy`.
   */
  verified?: boolean
  version?: string
}

interface AgentEntry {
  name: string
  adapter: string
  command?: string
  source: 'configured' | 'discovered'
  supported: boolean
  availableForSessions: boolean
  config?: AgentConfig
}

interface ProbeCacheEntry {
  expiresAt: number
  value: { healthy: boolean; version?: string; verified: boolean }
}

export interface AgentDiagnostic {
  name: string
  adapter: string
  source: 'configured' | 'discovered'
  supported: boolean
  availableForSessions: boolean
  command?: string
  commandExecutable: boolean
  args?: string[]
  timeout?: number
  envKeys: string[]
  version?: string
  versionOk: boolean
  smokeOk?: boolean
  healthy: boolean
  errorCode?: import('./types.js').AgentErrorCode
  error?: string
}

interface ListAgentsOpts {
  refresh?: boolean
}

let searchPathCache: string[] | undefined
let extraSearchPathEntries: string[] = []

const DISCOVERY_PRESETS: DiscoveryPreset[] = [
  { name: 'codex', adapter: 'codex', commands: ['codex'], envVars: ['TURING_CODEX_COMMAND'], supported: true },
  { name: 'claude-code', adapter: 'claude-code', commands: ['claude'], envVars: ['TURING_CLAUDE_COMMAND'], supported: true },
  { name: 'gemini-cli', adapter: 'gemini-cli', commands: ['gemini'], envVars: ['TURING_GEMINI_COMMAND'], supported: true },
  { name: 'opencode', adapter: 'opencode', commands: ['opencode'], envVars: ['TURING_OPENCODE_COMMAND'], supported: true },
  // Other CLI agents (aider, goose, amp, cursor, windsurf, ...) are deliberately
  // not auto-discovered. They have no bundled adapter yet; users who want one can
  // register a custom adapter or contribute. See docs/community-adapters.md.
]

export class AgentCatalog {
  private entries = new Map<string, AgentEntry>()
  private probeCache = new Map<string, ProbeCacheEntry>()
  private localCliAgentsEnabled: boolean

  constructor(configuredAgents: Record<string, AgentConfig>, localCliAgentsEnabled = false) {
    this.localCliAgentsEnabled = localCliAgentsEnabled
    this.setConfiguredAgents(configuredAgents)
  }

  setLocalCliAgentsEnabled(enabled: boolean): void {
    this.localCliAgentsEnabled = enabled
  }

  setConfiguredAgents(configuredAgents: Record<string, AgentConfig>): void {
    this.entries.clear()
    for (const [name, agentCfg] of Object.entries(configuredAgents)) {
      this.entries.set(name, {
        name,
        adapter: agentCfg.adapter,
        command: agentCfg.command,
        source: 'configured',
        supported: createAdapter(agentCfg) !== undefined,
        availableForSessions: createAdapter(agentCfg) !== undefined,
        config: agentCfg,
      })
    }
    this.probeCache.clear()
  }

  async discover(): Promise<void> {
    if (!this.localCliAgentsEnabled) return
    for (const preset of DISCOVERY_PRESETS) {
      if (this.entries.has(preset.name)) continue
      const command = await findExecutable(preset.commands, preset.envVars)
      if (!command) continue

      this.entries.set(preset.name, {
        name: preset.name,
        adapter: preset.adapter,
        command,
        source: 'discovered',
        supported: preset.supported,
        availableForSessions: preset.supported,
        config: createDiscoveredAgentConfig(preset.adapter, command),
      })
    }
  }

  registerDiscoveredAdapters(router: Router): void {
    void router
  }

  async listAgents(opts: ListAgentsOpts = {}): Promise<AgentInfo[]> {
    const entries = Array.from(this.entries.values()).sort((a, b) => {
      if (a.availableForSessions !== b.availableForSessions) {
        return Number(b.availableForSessions) - Number(a.availableForSessions)
      }
      return a.name.localeCompare(b.name)
    })

    return Promise.all(entries.map(async (entry) => {
      if (!entry.command) {
        return {
          ...entry,
          healthy: entry.availableForSessions,
        }
      }

      const probe = await this.probe(entry, opts.refresh === true)
      return {
        ...entry,
        healthy: probe.healthy,
        verified: probe.verified,
        version: probe.version,
        args: entry.config?.args,
        timeout: entry.config?.timeout,
        env: entry.config?.env,
      }
    }))
  }

  async diagnoseAgent(name: string, refresh = true): Promise<AgentDiagnostic | undefined> {
    const entry = this.entries.get(name)
    if (!entry) return undefined
    const envKeys = Object.keys(entry.config?.env ?? {}).sort()
    if (!entry.command) {
      return {
        name: entry.name,
        adapter: entry.adapter,
        source: entry.source,
        supported: entry.supported,
        availableForSessions: entry.availableForSessions,
        commandExecutable: false,
        args: entry.config?.args,
        timeout: entry.config?.timeout,
        envKeys,
        versionOk: entry.availableForSessions,
        healthy: entry.availableForSessions,
      }
    }

    const commandExecutable = entry.command.includes('/')
      ? await isExecutable(entry.command)
      : Boolean(await resolveCommand(entry.command))
    const versionProbe = refresh ? await probeCommand(entry.command) : { healthy: commandExecutable }
    const smokeProbe = refresh && entry.source === 'configured' && entry.availableForSessions && entry.config
      ? await smokeTestAgent(entry.name, entry.config)
      : undefined
    const error = smokeProbe?.error ?? versionProbe.error
    const healthy = commandExecutable && versionProbe.healthy && (smokeProbe?.healthy ?? true) && entry.availableForSessions
    return {
      name: entry.name,
      adapter: entry.adapter,
      source: entry.source,
      supported: entry.supported,
      availableForSessions: entry.availableForSessions,
      command: entry.command,
      commandExecutable,
      args: entry.config?.args,
      timeout: entry.config?.timeout,
      envKeys,
      version: versionProbe.version,
      versionOk: versionProbe.healthy,
      smokeOk: smokeProbe?.healthy,
      healthy,
      errorCode: healthy ? undefined : classifyAgentError(error, commandExecutable),
      error,
    }
  }

  private async probe(entry: AgentEntry, refresh: boolean): Promise<{ healthy: boolean; version?: string; verified: boolean }> {
    const cacheKey = [
      entry.source,
      entry.name,
      entry.command,
      JSON.stringify(entry.config?.args ?? []),
      JSON.stringify(entry.config?.env ?? {}),
    ].join(':')
    const cached = this.probeCache.get(cacheKey)
    if (cached && !refresh) {
      return cached.value
    }

    const versionProbe = await probeCommand(entry.command!)
    // Smoke test (a real model round-trip) is the only signal that proves an
    // agent is actually callable — `--version` only proves the binary exists.
    // It's expensive (up to 60s), so we run it only on explicit refresh and
    // cache the result. `healthy` always reflects "installed" (version probe);
    // `verified` reflects "actually reached the model" (smoke probe).
    // Without `verified`, callers must not assume the agent can run a session.
    const shouldSmoke = refresh && entry.source === 'configured' && entry.availableForSessions && entry.config
    const smokeProbe = shouldSmoke
      ? await smokeTestAgent(entry.name, entry.config!)
      : undefined
    const value = {
      healthy: versionProbe.healthy,
      version: versionProbe.version,
      verified: Boolean(smokeProbe?.healthy),
    }
    this.probeCache.set(cacheKey, {
      expiresAt: Date.now() + HEALTH_CACHE_TTL_MS,
      value,
    })
    return value
  }
}

export async function findExecutable(candidates: string[], envVars: string[] = []): Promise<string | undefined> {
  const envCandidates = envVars
    .map((name) => process.env[name])
    .filter((value): value is string => Boolean(value?.trim()))

  for (const candidate of [...envCandidates, ...candidates]) {
    const found = await resolveCommand(candidate)
    if (found) return found
  }
  return undefined
}

export function setExtraAgentSearchPathsForTesting(entries: string[]): void {
  extraSearchPathEntries = entries
  searchPathCache = undefined
}

async function resolveCommand(command: string): Promise<string | undefined> {
  if (command.includes('/')) {
    return await isExecutable(command) ? command : undefined
  }

  for (const entry of await getSearchPathEntries()) {
    const fullPath = join(entry, command)
    if (await isExecutable(fullPath)) {
      return fullPath
    }
  }

  return undefined
}

async function getSearchPathEntries(): Promise<string[]> {
  if (searchPathCache) return searchPathCache

  const home = homedir()
  const entries = [
    ...extraSearchPathEntries,
    ...(process.env.PATH ?? '').split(delimiter),
    dirname(process.execPath),
    join(home, '.local', 'bin'),
    join(home, 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.npm', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.deno', 'bin'),
    join(home, '.cargo', 'bin'),
    join(home, '.yarn', 'bin'),
    join(home, 'Library', 'pnpm'),
    join(home, 'Library', 'Application Support', 'fnm', 'aliases', 'default', 'bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    ...await packageManagerBins(),
  ]

  searchPathCache = Array.from(new Set(entries.filter(Boolean)))
  return searchPathCache
}

async function packageManagerBins(): Promise<string[]> {
  const probes: Array<[string, string[]]> = [
    ['npm', ['bin', '-g']],
    ['pnpm', ['bin', '-g']],
    ['yarn', ['global', 'bin']],
    ['bun', ['pm', 'bin', '-g']],
  ]
  const bins: string[] = []

  for (const [command, args] of probes) {
    try {
      const { stdout } = await execFileAsync(command, args, { timeout: 2_000 })
      const path = String(stdout).trim()
      if (path && !path.includes('\n')) bins.push(path)
    } catch {
      // Package manager is not installed or does not expose a global bin.
    }
  }

  return bins
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function probeCommand(command: string): Promise<{ healthy: boolean; version?: string; error?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, ['--version'], { timeout: 10_000 })
    const version = parseVersion(stdout || stderr)
    return { healthy: true, version }
  } catch (err) {
    return { healthy: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function smokeTestAgent(name: string, config: AgentConfig): Promise<{ healthy: boolean; error?: string }> {
  let cwd: string | undefined
  try {
    const adapter = createAdapter({ ...config, timeout: Math.min(config.timeout ?? 60_000, 60_000) })
    if (!adapter) return { healthy: false }
    ;(adapter as { name: string }).name = name
    cwd = await mkdtemp(join(tmpdir(), 'turing-agent-smoke-'))
    const output = await adapter.send(smokeSession(cwd), 'Reply exactly with TURING_READY and nothing else.')
    const content = typeof output === 'string' ? output : output.content
    const healthy = content.trim() === 'TURING_READY'
    return { healthy, error: healthy ? undefined : `Unexpected smoke output: ${content.slice(0, 200)}` }
  } catch (err) {
    return { healthy: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    if (cwd) {
      await rm(cwd, { recursive: true, force: true })
    }
  }
}

function smokeSession(cwd: string): Session {
  const now = Date.now()
  return {
    id: 'agent-smoke-test',
    from: { adapter: 'agent-smoke' },
    to: { adapter: 'agent-smoke' },
    status: 'active',
    mode: 'freeform',
    nextTurn: 'to',
    maxRounds: 1,
    currentRound: 0,
    approveMode: false,
    permissionMode: 'safe',
    cwd,
    resumeCount: 0,
    createdAt: now,
    updatedAt: now,
  }
}

function parseVersion(output: string): string | undefined {
  const line = output
    .split('\n')
    .map((item) => item.trim())
    .find(Boolean)

  if (!line) return undefined
  return line.length > 120 ? `${line.slice(0, 117)}...` : line
}

function classifyAgentError(error: string | undefined, commandExecutable: boolean): import('./types.js').AgentErrorCode {
  const lower = (error ?? '').toLowerCase()
  if (!commandExecutable || lower.includes('enoent') || lower.includes('not found')) return 'not_installed'
  if (lower.includes('timed out') || lower.includes('timeout')) return 'timeout'
  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('quota')) return 'rate_limited'
  if (lower.includes('api key') || lower.includes('apikey')) return 'api_key_missing'
  if (lower.includes('unauthorized') || lower.includes('unauthenticated') || lower.includes('login') || lower.includes('subscription') || lower.includes('403') || lower.includes('401')) return 'auth_required'
  return 'unavailable'
}
