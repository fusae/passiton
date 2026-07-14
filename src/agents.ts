import { access, mkdtemp, readdir, rm, stat } from 'fs/promises'
import { constants } from 'fs'
import { delimiter, dirname, join, posix, win32 } from 'path'
import { homedir, tmpdir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { AgentConfig } from './types.js'
import { createAdapter, createDiscoveredAgentConfig } from './adapters/factory.js'
import { prepareCommandForSpawn } from './adapters/shared.js'
import { loadConfig, writeConfig } from './config.js'
import type { Router } from './router.js'
import type { Session } from './types.js'

const execFileAsync = promisify(execFile)
const HEALTH_CACHE_TTL_MS = 60_000
const PERSISTED_VERIFICATION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const FAILED_VERIFICATION_RETRY_MS = 6 * 60 * 60 * 1000
const AGENT_SMOKE_TIMEOUT_MS = 45_000

// --- Platform injection (for testability) ---
let platformOverride: string | undefined

export function setPlatformForTesting(platform: string | undefined): void {
  platformOverride = platform
  searchPathCache = undefined
}

function currentPlatform(): string {
  return platformOverride ?? process.platform
}

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
  autoDiscovered?: boolean
  verificationAttemptedAt?: number
  verificationError?: string
  verifying?: boolean
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

interface DiscoverOpts {
  refresh?: boolean
}

let searchPathCache: string[] | undefined
let extraSearchPathEntries: string[] = []

const DISCOVERY_PRESETS: DiscoveryPreset[] = [
  { name: 'codex', adapter: 'codex', commands: ['codex'], envVars: ['PASSITON_CODEX_COMMAND', 'TURING_CODEX_COMMAND'], supported: true },
  { name: 'claude-code', adapter: 'claude-code', commands: ['claude'], envVars: ['PASSITON_CLAUDE_COMMAND', 'TURING_CLAUDE_COMMAND'], supported: true },
  { name: 'gemini-cli', adapter: 'gemini-cli', commands: ['gemini'], envVars: ['PASSITON_GEMINI_COMMAND', 'TURING_GEMINI_COMMAND'], supported: true },
  { name: 'opencode', adapter: 'opencode', commands: ['opencode'], envVars: ['PASSITON_OPENCODE_COMMAND', 'TURING_OPENCODE_COMMAND'], supported: true },
  { name: 'copilot', adapter: 'copilot-cli', commands: ['copilot'], envVars: ['PASSITON_COPILOT_COMMAND'], supported: true },
  { name: 'cursor-agent', adapter: 'cursor-agent', commands: ['cursor-agent'], envVars: ['PASSITON_CURSOR_COMMAND'], supported: true },
  { name: 'qwen-code', adapter: 'qwen-code', commands: ['qwen'], envVars: ['PASSITON_QWEN_COMMAND'], supported: true },
  { name: 'cline', adapter: 'cline', commands: ['cline'], envVars: ['PASSITON_CLINE_COMMAND'], supported: true },
  { name: 'aider', adapter: 'aider', commands: ['aider', 'aider-chat'], envVars: ['PASSITON_AIDER_COMMAND'], supported: true },
  { name: 'droid', adapter: 'droid', commands: ['droid'], envVars: ['PASSITON_DROID_COMMAND'], supported: true },
  { name: 'amp', adapter: 'amp', commands: ['amp'], envVars: ['PASSITON_AMP_COMMAND'], supported: true },
  { name: 'openhands', adapter: 'openhands', commands: ['openhands'], envVars: ['PASSITON_OPENHANDS_COMMAND'], supported: true },
  { name: 'mistral-vibe', adapter: 'mistral-vibe', commands: ['vibe'], envVars: ['PASSITON_VIBE_COMMAND'], supported: true },
]

export class AgentCatalog {
  private entries = new Map<string, AgentEntry>()
  private probeCache = new Map<string, ProbeCacheEntry>()
  private backgroundProbeRuns = new Map<string, Promise<void>>()
  private diagnosticRuns = new Map<string, Promise<AgentDiagnostic | undefined>>()
  private localCliAgentsEnabled: boolean
  private autoConfigureDiscovered: boolean

  constructor(configuredAgents: Record<string, AgentConfig>, localCliAgentsEnabled = false, autoConfigureDiscovered = false) {
    this.localCliAgentsEnabled = localCliAgentsEnabled
    this.autoConfigureDiscovered = autoConfigureDiscovered
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
    this.backgroundProbeRuns.clear()
  }

  async discover(opts: DiscoverOpts = {}): Promise<void> {
    if (!this.localCliAgentsEnabled) return
    if (opts.refresh) {
      searchPathCache = undefined
      for (const [name, entry] of this.entries) {
        if (entry.source === 'discovered') this.entries.delete(name)
      }
    }

    for (const preset of DISCOVERY_PRESETS) {
      const bundledCommands = await getBundledAgentCandidates(preset.adapter)
      const commands = preset.adapter === 'opencode' && currentPlatform() === 'win32'
        ? [...bundledCommands, ...preset.commands]
        : [...preset.commands, ...bundledCommands]
      const existing = this.entries.get(preset.name)
      if (existing?.source === 'configured') {
        if (this.autoConfigureDiscovered && existing.config?.autoDiscovered) {
          const replacement = await findExecutable(commands, preset.envVars)
          if (replacement) {
            const discoveredConfig = createDiscoveredAgentConfig(preset.adapter, replacement)
            if (discoveredConfig) this.updateConfiguredAgent(existing, { ...discoveredConfig, autoDiscovered: true })
          } else {
            this.removeAutoConfiguredAgent(existing)
          }
          continue
        }

        const resolved = existing.command ? await resolveCommand(existing.command) : undefined
        if (resolved) {
          if (resolved !== existing.command) {
            this.updateConfiguredCommand(existing, resolved)
          }
          if (this.autoConfigureDiscovered && !existing.config?.autoDiscovered) {
            this.markAutoConfigured(existing)
          }
          continue
        }

        // Repair stale paths left behind when Codex moved from Codex.app to
        // ChatGPT.app, or when an npm shim changed from a bare path to .cmd.
        const replacement = await findExecutable(commands, preset.envVars)
        if (replacement) {
          this.updateConfiguredCommand(existing, replacement)
        }
        continue
      }

      const command = await findExecutable(commands, preset.envVars)
      if (!command) continue

      const discoveredConfig = createDiscoveredAgentConfig(preset.adapter, command)
      if (!discoveredConfig) continue
      const config: AgentConfig = this.autoConfigureDiscovered
        ? { ...discoveredConfig, autoDiscovered: true }
        : discoveredConfig
      if (this.autoConfigureDiscovered) {
        const current = loadConfig()
        writeConfig({
          ...current,
          agents: { ...current.agents, [preset.name]: config },
        })
      }

      this.entries.set(preset.name, {
        name: preset.name,
        adapter: preset.adapter,
        command: config.command ?? command,
        source: this.autoConfigureDiscovered ? 'configured' : 'discovered',
        supported: preset.supported,
        availableForSessions: preset.supported,
        config,
      })
    }
  }

  configuredAgentConfigs(): Record<string, AgentConfig> {
    return Object.fromEntries(
      Array.from(this.entries.values())
        .filter((entry) => entry.source === 'configured' && entry.config)
        .map((entry) => [entry.name, entry.config!])
    )
  }

  private updateConfiguredCommand(entry: AgentEntry, command: string): void {
    entry.command = command
    entry.config = { ...entry.config!, command }
    this.probeCache.clear()
  }

  private markAutoConfigured(entry: AgentEntry): void {
    if (!entry.config) return
    const current = loadConfig()
    const currentAgent = current.agents[entry.name]
    if (!currentAgent) return
    const nextAgent = { ...currentAgent, autoDiscovered: true }
    writeConfig({
      ...current,
      agents: { ...current.agents, [entry.name]: nextAgent },
    })
    entry.config = nextAgent
  }

  private updateConfiguredAgent(entry: AgentEntry, config: AgentConfig): void {
    if (!entry.config) return
    if (sameAgentConfig(entry.config, config)) return
    const current = loadConfig()
    const currentAgent = current.agents[entry.name]
    if (!currentAgent || currentAgent.adapter !== entry.adapter) return
    writeConfig({
      ...current,
      agents: { ...current.agents, [entry.name]: config },
    })
    entry.command = config.command
    entry.config = config
    this.probeCache.clear()
  }

  private removeAutoConfiguredAgent(entry: AgentEntry): void {
    if (!entry.config?.autoDiscovered) return
    const current = loadConfig()
    const currentAgent = current.agents[entry.name]
    if (!currentAgent?.autoDiscovered || currentAgent.adapter !== entry.adapter || currentAgent.command !== entry.command) return
    const { [entry.name]: _removed, ...agents } = current.agents
    void _removed
    writeConfig({ ...current, agents })
    this.entries.delete(entry.name)
    this.probeCache.clear()
  }

  registerDiscoveredAdapters(router: Router): void {
    void router
  }

  async listAgents(opts: ListAgentsOpts = {}): Promise<AgentInfo[]> {
    if (opts.refresh) await this.discover({ refresh: true })
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

      const probe = opts.refresh === true
        ? await this.probe(entry, true)
        : await this.nonBlockingProbe(entry)
      return {
        ...entry,
        healthy: probe.healthy,
        verified: probe.verified,
        version: probe.version,
        args: entry.config?.args,
        timeout: entry.config?.timeout,
        env: entry.config?.env,
        autoDiscovered: entry.config?.autoDiscovered,
        verificationAttemptedAt: entry.config?.lastVerificationAttemptAt,
        verificationError: entry.config?.lastVerificationError,
        verifying: this.backgroundProbeRuns.has(this.probeCacheKey(entry))
          && entry.config?.autoDiscovered === true
          && this.shouldRunAutomaticVerification(entry),
      }
    }))
  }

  async diagnoseAgent(name: string, refresh = true): Promise<AgentDiagnostic | undefined> {
    if (!refresh) return this.runAgentDiagnostic(name, false)
    const existing = this.diagnosticRuns.get(name)
    if (existing) return existing

    const run = this.runAgentDiagnostic(name, true)
    this.diagnosticRuns.set(name, run)
    try {
      return await run
    } finally {
      if (this.diagnosticRuns.get(name) === run) this.diagnosticRuns.delete(name)
    }
  }

  private async runAgentDiagnostic(name: string, refresh: boolean): Promise<AgentDiagnostic | undefined> {
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

    const commandExecutable = isPathLike(entry.command)
      ? await isExecutable(entry.command)
      : Boolean(await resolveCommand(entry.command))
    const versionProbe = refresh ? await probeCommand(entry.command, entry.config?.versionArgs) : { healthy: commandExecutable }
    const smokeProbe = refresh && entry.source === 'configured' && entry.availableForSessions && entry.config
      ? await smokeTestAgent(entry.name, entry.config)
      : undefined
    const error = smokeProbe?.error ?? versionProbe.error
    const healthy = commandExecutable && versionProbe.healthy && (smokeProbe?.healthy ?? true) && entry.availableForSessions
    if (refresh && smokeProbe !== undefined) {
      if (smokeProbe.healthy && versionProbe.version) {
        this.persistSuccessfulVerification(entry, versionProbe.version)
      } else {
        this.persistFailedVerification(entry, smokeProbe.error ?? versionProbe.error ?? 'Agent verification failed')
      }
    }
    if (refresh) {
      this.probeCache.set(this.probeCacheKey(entry), {
        expiresAt: Date.now() + HEALTH_CACHE_TTL_MS,
        value: {
          healthy: commandExecutable && versionProbe.healthy,
          version: versionProbe.version,
          verified: Boolean(smokeProbe?.healthy),
        },
      })
    }
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
    const cacheKey = this.probeCacheKey(entry)
    const cached = this.probeCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now() && !refresh) {
      return {
        ...cached.value,
        verified: this.isPersistedVerificationCurrent(entry, cached.value.version),
      }
    }

    const versionProbe = await probeCommand(entry.command!, entry.config?.versionArgs)
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
    if (shouldSmoke) {
      if (smokeProbe?.healthy && versionProbe.version) {
        this.persistSuccessfulVerification(entry, versionProbe.version)
      } else {
        this.persistFailedVerification(entry, smokeProbe?.error ?? versionProbe.error ?? 'Agent verification failed')
      }
    }
    const value = {
      healthy: versionProbe.healthy,
      version: versionProbe.version,
      verified: shouldSmoke
        ? Boolean(smokeProbe?.healthy)
        : this.isPersistedVerificationCurrent(entry, versionProbe.version),
    }
    this.probeCache.set(cacheKey, {
      expiresAt: Date.now() + HEALTH_CACHE_TTL_MS,
      value,
    })
    return value
  }

  private async nonBlockingProbe(entry: AgentEntry): Promise<{ healthy: boolean; version?: string; verified: boolean }> {
    const cacheKey = this.probeCacheKey(entry)
    const cached = this.probeCache.get(cacheKey)
    if (cached) {
      if (cached.expiresAt <= Date.now()) this.scheduleBackgroundProbe(entry)
      return {
        ...cached.value,
        verified: this.isPersistedVerificationCurrent(entry, cached.value.version),
      }
    }

    const storedVersion = entry.config?.lastVerifiedVersion
    const value = {
      healthy: await commandExists(entry.command!),
      version: storedVersion,
      verified: this.isPersistedVerificationCurrent(entry, storedVersion),
    }
    this.scheduleBackgroundProbe(entry)
    return value
  }

  private scheduleBackgroundProbe(entry: AgentEntry): void {
    const cacheKey = this.probeCacheKey(entry)
    if (this.backgroundProbeRuns.has(cacheKey)) return

    const shouldVerify = entry.source === 'configured'
      && entry.config?.autoDiscovered === true
      && this.shouldRunAutomaticVerification(entry)
    const run = new Promise<void>((resolve) => {
      setTimeout(() => {
        void this.probe(entry, shouldVerify)
          .catch(() => undefined)
          .finally(resolve)
      }, 0)
    }).finally(() => {
      if (this.backgroundProbeRuns.get(cacheKey) === run) this.backgroundProbeRuns.delete(cacheKey)
    })
    this.backgroundProbeRuns.set(cacheKey, run)
  }

  private probeCacheKey(entry: AgentEntry): string {
    return [
      entry.source,
      entry.name,
      entry.command,
      JSON.stringify(entry.config?.args ?? []),
      JSON.stringify(entry.config?.versionArgs ?? []),
      JSON.stringify(entry.config?.env ?? {}),
    ].join(':')
  }

  private isPersistedVerificationCurrent(entry: AgentEntry, version: string | undefined): boolean {
    if (entry.source !== 'configured' || !entry.config || !version) return false
    const { lastVerifiedAt, lastVerifiedVersion } = entry.config
    if (typeof lastVerifiedAt !== 'number' || typeof lastVerifiedVersion !== 'string') return false
    const age = Date.now() - lastVerifiedAt
    return age >= 0 && age <= PERSISTED_VERIFICATION_TTL_MS && lastVerifiedVersion === version
  }

  private shouldRunAutomaticVerification(entry: AgentEntry): boolean {
    const verifiedAt = entry.config?.lastVerifiedAt
    if (typeof verifiedAt === 'number') {
      const age = Date.now() - verifiedAt
      if (age >= 0 && age <= PERSISTED_VERIFICATION_TTL_MS) return false
    }

    const attemptedAt = entry.config?.lastVerificationAttemptAt
    if (typeof attemptedAt !== 'number') return true
    const age = Date.now() - attemptedAt
    return age < 0 || age > FAILED_VERIFICATION_RETRY_MS
  }

  private persistSuccessfulVerification(entry: AgentEntry, version: string): void {
    if (entry.source !== 'configured' || !entry.config) return
    const current = loadConfig()
    const currentAgent = current.agents[entry.name]
    if (!currentAgent || currentAgent.adapter !== entry.adapter || currentAgent.command !== entry.command) return

    const nextAgent = {
      ...currentAgent,
      lastVerifiedAt: Date.now(),
      lastVerifiedVersion: version,
      lastVerificationAttemptAt: Date.now(),
    }
    delete nextAgent.lastVerificationError
    writeConfig({
      ...current,
      agents: {
        ...current.agents,
        [entry.name]: nextAgent,
      },
    })
    entry.config = nextAgent
  }

  private persistFailedVerification(entry: AgentEntry, error: string): void {
    if (entry.source !== 'configured' || !entry.config) return
    const current = loadConfig()
    const currentAgent = current.agents[entry.name]
    if (!currentAgent || currentAgent.adapter !== entry.adapter || currentAgent.command !== entry.command) return
    const nextAgent = {
      ...currentAgent,
      lastVerificationAttemptAt: Date.now(),
      lastVerificationError: error.slice(0, 1000),
    }
    delete nextAgent.lastVerifiedAt
    delete nextAgent.lastVerifiedVersion
    writeConfig({
      ...current,
      agents: { ...current.agents, [entry.name]: nextAgent },
    })
    entry.config = nextAgent
  }

  private clearPersistedVerification(entry: AgentEntry): void {
    if (entry.source !== 'configured' || !entry.config) return
    const current = loadConfig()
    const currentAgent = current.agents[entry.name]
    if (!currentAgent || currentAgent.adapter !== entry.adapter || currentAgent.command !== entry.command) return
    if (currentAgent.lastVerifiedAt === undefined && currentAgent.lastVerifiedVersion === undefined) return

    const { lastVerifiedAt, lastVerifiedVersion, ...nextAgent } = currentAgent
    void lastVerifiedAt
    void lastVerifiedVersion
    writeConfig({
      ...current,
      agents: {
        ...current.agents,
        [entry.name]: nextAgent,
      },
    })
    entry.config = nextAgent
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

export function getBundledCodexCandidates(
  platform: string = currentPlatform(),
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (platform === 'darwin') {
    return [
      '/Applications/ChatGPT.app/Contents/Resources/codex',
      posix.join(home, 'Applications', 'ChatGPT.app', 'Contents', 'Resources', 'codex'),
      '/Applications/Codex.app/Contents/Resources/codex',
      posix.join(home, 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex'),
    ]
  }

  if (platform === 'win32') {
    return [
      env.APPDATA && win32.join(env.APPDATA, 'npm', 'codex.ps1'),
      env.APPDATA && win32.join(env.APPDATA, 'npm', 'codex.cmd'),
      env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'codex.exe'),
      env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Programs', 'ChatGPT', 'resources', 'codex.exe'),
      env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'ChatGPT', 'resources', 'codex.exe'),
      env.ProgramFiles && win32.join(env.ProgramFiles, 'ChatGPT', 'resources', 'codex.exe'),
    ].filter((value): value is string => Boolean(value))
  }

  return []
}

export async function getBundledClaudeCandidates(
  platform: string = currentPlatform(),
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env
): Promise<string[]> {
  if (platform === 'darwin') {
    const versionRoot = posix.join(home, 'Library', 'Application Support', 'Claude', 'claude-code')
    return [
      '/Applications/Claude.app/Contents/Resources/claude',
      posix.join(home, 'Applications', 'Claude.app', 'Contents', 'Resources', 'claude'),
      ...await versionedCandidates(versionRoot, posix.join('claude.app', 'Contents', 'MacOS', 'claude')),
    ]
  }

  if (platform === 'win32') {
    const roots = [
      env.APPDATA && win32.join(env.APPDATA, 'Claude', 'claude-code'),
      env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Claude', 'claude-code'),
    ].filter((value): value is string => Boolean(value))
    const versioned = (await Promise.all(roots.map((root) => versionedCandidates(root, 'claude.exe')))).flat()
    return [
      env.APPDATA && win32.join(env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
      env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Programs', 'Claude', 'resources', 'claude.exe'),
      env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Programs', 'Claude', 'claude.exe'),
      ...versioned,
    ].filter((value): value is string => Boolean(value))
  }

  return []
}

export function getBundledOpenCodeCandidates(
  platform: string = currentPlatform(),
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (platform === 'win32') {
    return [
      env.APPDATA && win32.join(env.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
      win32.join(home, '.opencode', 'bin', 'opencode.exe'),
      win32.join(home, '.opencode', 'bin', 'opencode.cmd'),
      env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'opencode', 'bin', 'opencode.exe'),
    ].filter((value): value is string => Boolean(value))
  }
  return [posix.join(home, '.opencode', 'bin', 'opencode')]
}

async function getBundledAgentCandidates(adapter: string): Promise<string[]> {
  switch (adapter) {
    case 'codex': return getBundledCodexCandidates()
    case 'claude-code': return getBundledClaudeCandidates()
    case 'opencode': return getBundledOpenCodeCandidates()
    default: return []
  }
}

async function versionedCandidates(root: string, executableSuffix: string): Promise<string[]> {
  try {
    const versions = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    return versions.map((version) => join(root, version, executableSuffix))
  } catch {
    return []
  }
}

export function setExtraAgentSearchPathsForTesting(entries: string[]): void {
  extraSearchPathEntries = entries
  searchPathCache = undefined
}

async function resolveCommand(command: string): Promise<string | undefined> {
  const platform = currentPlatform()

  if (isPathLike(command, platform)) {
    if (platform === 'win32') {
      return resolvePathWithExtensions(command)
    }
    return await isExecutable(command) ? command : undefined
  }

  if (platform === 'win32') {
    const extensions = getExecutableExtensions()
    for (const entry of await getSearchPathEntries()) {
      for (const ext of extensions) {
        const fullPath = join(entry, command + ext)
        if (await isSpawnableExecutable(fullPath)) {
          return fullPath
        }
      }
    }
    return undefined
  }

  for (const entry of await getSearchPathEntries()) {
    const fullPath = join(entry, command)
    if (await isExecutable(fullPath)) {
      return fullPath
    }
  }

  return undefined
}

async function commandExists(command: string): Promise<boolean> {
  const platform = currentPlatform()

  if (isPathLike(command, platform)) {
    if (platform === 'win32') {
      return Boolean(await resolvePathWithExtensions(command))
    }
    return isExecutable(command)
  }

  if (platform === 'win32') {
    for (const entry of staticSearchPathEntries()) {
      for (const ext of getExecutableExtensions()) {
        if (await isSpawnableExecutable(join(entry, command + ext))) return true
      }
    }
    return false
  }

  for (const entry of staticSearchPathEntries()) {
    if (await isExecutable(join(entry, command))) return true
  }
  return false
}

function staticSearchPathEntries(): string[] {
  const home = homedir()
  const platform = currentPlatform()
  const entries = [
    ...extraSearchPathEntries,
    ...(process.env.PATH ?? '').split(delimiter),
    dirname(process.execPath),
    join(home, '.local', 'bin'),
    join(home, 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.npm', 'bin'),
    join(home, '.opencode', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.asdf', 'shims'),
    join(home, '.local', 'share', 'mise', 'shims'),
    join(home, '.local', 'share', 'pnpm'),
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
  ]

  if (platform === 'win32') {
    if (process.env.APPDATA) entries.push(join(process.env.APPDATA, 'npm'))
    if (process.env.LOCALAPPDATA) entries.push(join(process.env.LOCALAPPDATA, 'pnpm'))
    if (process.env.PNPM_HOME) entries.push(process.env.PNPM_HOME)
    if (process.env.VOLTA_HOME) entries.push(join(process.env.VOLTA_HOME, 'bin'))
    if (process.env.NVM_SYMLINK) entries.push(process.env.NVM_SYMLINK)
    entries.push(join(home, 'scoop', 'shims'))
    if (process.env.ProgramData) entries.push(join(process.env.ProgramData, 'chocolatey', 'bin'))
    if (process.env.LOCALAPPDATA) {
      entries.push(join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps'))
      entries.push(join(process.env.LOCALAPPDATA, 'Programs'))
    }
  }

  return Array.from(new Set(entries.filter(Boolean)))
}

function isPathLike(command: string, platform: string = currentPlatform()): boolean {
  if (command.includes('/')) return true
  if (platform === 'win32') {
    return command.includes('\\') || /^[a-zA-Z]:/.test(command)
  }
  return false
}

async function resolvePathWithExtensions(commandPath: string): Promise<string | undefined> {
  const lower = commandPath.toLowerCase()
  if (lower.endsWith('.exe') || lower.endsWith('.ps1') || lower.endsWith('.cmd') || lower.endsWith('.bat')) {
    return await isSpawnableExecutable(commandPath) ? commandPath : undefined
  }
  for (const ext of getExecutableExtensions()) {
    const candidate = ext ? commandPath + ext : commandPath
    if (await isSpawnableExecutable(candidate)) {
      return candidate
    }
  }
  return undefined
}

function isKnownUnspawnableWindowsPath(filePath: string): boolean {
  if (currentPlatform() !== 'win32') return false
  const normalized = filePath.replaceAll('/', '\\').toLowerCase()
  return normalized.includes('\\program files\\windowsapps\\openai.codex_')
}

async function isSpawnableExecutable(filePath: string): Promise<boolean> {
  if (isKnownUnspawnableWindowsPath(filePath)) return false
  return isExecutable(filePath)
}

function getExecutableExtensions(): string[] {
  const ourPriority = ['.exe', '.ps1', '.cmd', '.bat']
  const pathext = process.env.PATHEXT
  if (pathext) {
    const userExts = pathext.split(';').filter(Boolean).map((e) => e.toLowerCase())
    const result: string[] = []
    for (const ext of ourPriority) {
      if (!result.includes(ext)) result.push(ext)
    }
    for (const ext of userExts) {
      if (!result.includes(ext)) result.push(ext)
    }
    result.push('')
    return result
  }
  return [...ourPriority, '']
}

async function getSearchPathEntries(): Promise<string[]> {
  if (searchPathCache) return searchPathCache

  const entries = [
    ...staticSearchPathEntries(),
    ...await loginShellPathEntries(),
    ...await versionManagerBins(),
    ...await packageManagerBins(),
  ]
  searchPathCache = Array.from(new Set(entries.filter(Boolean)))
  return searchPathCache
}

async function loginShellPathEntries(): Promise<string[]> {
  if (currentPlatform() === 'win32' || process.platform === 'win32') return []
  const shell = process.env.SHELL || '/bin/sh'
  try {
    const marker = '__PASSITON_PATH__'
    const { stdout } = await execFileAsync(shell, ['-lic', `printf "\\n${marker}%s" "$PATH"`], { timeout: 3_000 })
    const pathValue = String(stdout).split(marker).at(-1)?.trim() ?? ''
    return pathValue.split(delimiter).filter(Boolean)
  } catch {
    return []
  }
}

async function versionManagerBins(): Promise<string[]> {
  const home = homedir()
  if (currentPlatform() === 'win32') return []
  const roots: Array<[string, string]> = [
    [join(home, '.nvm', 'versions', 'node'), 'bin'],
    [join(home, '.fnm', 'node-versions'), join('installation', 'bin')],
    [join(home, 'Library', 'Application Support', 'fnm', 'node-versions'), join('installation', 'bin')],
  ]
  return (await Promise.all(roots.map(([root, suffix]) => versionedCandidates(root, suffix)))).flat()
}

async function packageManagerBins(): Promise<string[]> {
  const isWin32 = currentPlatform() === 'win32'
  const probes: Array<[string, string[]]> = [
    ['npm', ['bin', '-g']],
    ['pnpm', ['bin', '-g']],
    ['yarn', ['global', 'bin']],
    ['bun', ['pm', 'bin', '-g']],
  ]
  const bins: string[] = []

  for (const [command, args] of probes) {
    try {
      const { stdout } = await execFileAsync(command, args, {
        timeout: 2_000,
        ...(isWin32 ? { shell: true } : {}),
      })
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
    if (currentPlatform() === 'win32') {
      // On Windows, X_OK succeeds for any existing file (no execute bit concept).
      // Check existence and that it's a regular file.
      await access(filePath, constants.F_OK)
      return (await stat(filePath)).isFile()
    }
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function probeCommand(command: string, versionArgs?: string[]): Promise<{ healthy: boolean; version?: string; error?: string }> {
  const attempts = versionArgs ? [versionArgs] : [['--version'], ['version'], ['-v']]
  let lastError = ''
  for (const args of attempts) {
    try {
      const invocation = prepareCommandForSpawn(command, args, currentPlatform())
      const { stdout, stderr } = await execFileAsync(invocation.command, invocation.args, {
        timeout: 10_000,
        ...(invocation.shell ? { shell: true } : {}),
      })
      const version = parseVersion(stdout || stderr)
      return { healthy: true, version }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }
  return { healthy: false, error: lastError }
}

function sameAgentConfig(left: AgentConfig, right: AgentConfig): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function smokeTestAgent(name: string, config: AgentConfig): Promise<{ healthy: boolean; error?: string }> {
  let cwd: string | undefined
  try {
    const adapter = createAdapter({ ...config, timeout: Math.min(config.timeout ?? AGENT_SMOKE_TIMEOUT_MS, AGENT_SMOKE_TIMEOUT_MS) })
    if (!adapter) return { healthy: false }
    ;(adapter as { name: string }).name = name
    cwd = await mkdtemp(join(tmpdir(), 'turing-agent-smoke-'))
    const output = await adapter.send(smokeSession(cwd), 'Reply exactly with TURING_READY and nothing else.')
    const content = typeof output === 'string' ? output : output.content
    const healthy = content.includes('TURING_READY')
    return { healthy, error: healthy ? undefined : `Unexpected smoke output: ${content.slice(0, 200)}` }
  } catch (err) {
    return { healthy: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    if (cwd) {
      await removeDirEventually(cwd)
    }
  }
}

async function removeDirEventually(path: string, timeoutMs = 15_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
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
