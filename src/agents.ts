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
  source: 'configured' | 'discovered'
  supported: boolean
  availableForSessions: boolean
  healthy: boolean
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
  value: { healthy: boolean; version?: string }
}

let searchPathCache: string[] | undefined
let extraSearchPathEntries: string[] = []

const DISCOVERY_PRESETS: DiscoveryPreset[] = [
  { name: 'codex', adapter: 'codex', commands: ['codex'], envVars: ['TURING_CODEX_COMMAND'], supported: true },
  { name: 'claude-code', adapter: 'claude-code', commands: ['claude'], envVars: ['TURING_CLAUDE_COMMAND'], supported: true },
  { name: 'gemini-cli', adapter: 'gemini-cli', commands: ['gemini'], envVars: ['TURING_GEMINI_COMMAND'], supported: true },
  { name: 'opencode', adapter: 'opencode', commands: ['opencode'], envVars: ['TURING_OPENCODE_COMMAND'], supported: true },
  { name: 'amp', adapter: 'amp', commands: ['amp'], supported: false },
  { name: 'aider', adapter: 'aider', commands: ['aider'], supported: false },
  { name: 'cline', adapter: 'cline', commands: ['cline'], supported: false },
  { name: 'continue', adapter: 'continue', commands: ['continue', 'cn'], supported: false },
  { name: 'copilot', adapter: 'copilot', commands: ['copilot'], supported: false },
  { name: 'cursor', adapter: 'cursor', commands: ['cursor-agent', 'cursor'], supported: false },
  { name: 'devin', adapter: 'devin', commands: ['devin'], supported: false },
  { name: 'goose', adapter: 'goose', commands: ['goose'], supported: false },
  { name: 'kiro', adapter: 'kiro', commands: ['kiro'], supported: false },
  { name: 'kilo-code', adapter: 'kilo-code', commands: ['kilo', 'kilo-code'], supported: false },
  { name: 'openhands', adapter: 'openhands', commands: ['openhands', 'openhands-cli'], supported: false },
  { name: 'roo-code', adapter: 'roo-code', commands: ['roo', 'roo-code'], supported: false },
  { name: 'swe-agent', adapter: 'swe-agent', commands: ['sweagent', 'swe-agent'], supported: false },
  { name: 'windsurf', adapter: 'windsurf', commands: ['windsurf'], supported: false },
  { name: 'zed-agent', adapter: 'zed-agent', commands: ['zed'], supported: false },
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

  async listAgents(): Promise<AgentInfo[]> {
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

      const probe = await this.probe(entry)
      return {
        ...entry,
        healthy: probe.healthy,
        version: probe.version,
      }
    }))
  }

  private async probe(entry: AgentEntry): Promise<{ healthy: boolean; version?: string }> {
    const cacheKey = [
      entry.source,
      entry.name,
      entry.command,
      JSON.stringify(entry.config?.args ?? []),
      JSON.stringify(entry.config?.env ?? {}),
    ].join(':')
    const cached = this.probeCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }

    const versionProbe = await probeCommand(entry.command!)
    const smokeProbe = entry.source === 'configured' && entry.availableForSessions && entry.config
      ? await smokeTestAgent(entry.name, entry.config)
      : { healthy: true }
    const value = {
      healthy: versionProbe.healthy && smokeProbe.healthy,
      version: versionProbe.version,
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

async function probeCommand(command: string): Promise<{ healthy: boolean; version?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, ['--version'], { timeout: 10_000 })
    const version = parseVersion(stdout || stderr)
    return { healthy: true, version }
  } catch {
    return { healthy: false }
  }
}

async function smokeTestAgent(name: string, config: AgentConfig): Promise<{ healthy: boolean }> {
  let cwd: string | undefined
  try {
    const adapter = createAdapter({ ...config, timeout: Math.min(config.timeout ?? 60_000, 60_000) })
    if (!adapter) return { healthy: false }
    ;(adapter as { name: string }).name = name
    cwd = await mkdtemp(join(tmpdir(), 'turing-agent-smoke-'))
    const output = await adapter.send(smokeSession(cwd), 'Reply exactly with TURING_READY and nothing else.')
    const content = typeof output === 'string' ? output : output.content
    return { healthy: content.trim().length > 0 }
  } catch {
    return { healthy: false }
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
