import { access } from 'fs/promises'
import { constants } from 'fs'
import { delimiter, join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { AgentConfig } from './types.js'
import { createAdapter, createDiscoveredAgentConfig } from './adapters/factory.js'
import type { Router } from './router.js'

const execFileAsync = promisify(execFile)
const HEALTH_CACHE_TTL_MS = 60_000

interface DiscoveryPreset {
  name: string
  adapter: string
  commands: string[]
  supported: boolean
}

export interface AgentInfo {
  name: string
  adapter: string
  command: string
  source: 'configured' | 'discovered'
  supported: boolean
  availableForSessions: boolean
  healthy: boolean
  version?: string
}

interface AgentEntry {
  name: string
  adapter: string
  command: string
  source: 'configured' | 'discovered'
  supported: boolean
  availableForSessions: boolean
}

interface ProbeCacheEntry {
  expiresAt: number
  value: { healthy: boolean; version?: string }
}

const DISCOVERY_PRESETS: DiscoveryPreset[] = [
  { name: 'codex', adapter: 'codex', commands: ['codex'], supported: true },
  { name: 'claude-code', adapter: 'claude-code', commands: ['claude'], supported: true },
  { name: 'opencode', adapter: 'opencode', commands: ['opencode'], supported: true },
  { name: 'aider', adapter: 'aider', commands: ['aider'], supported: false },
  { name: 'cursor', adapter: 'cursor', commands: ['cursor-agent', 'cursor'], supported: false },
]

export class AgentCatalog {
  private entries = new Map<string, AgentEntry>()
  private probeCache = new Map<string, ProbeCacheEntry>()

  constructor(configuredAgents: Record<string, AgentConfig>) {
    for (const [name, agentCfg] of Object.entries(configuredAgents)) {
      this.entries.set(name, {
        name,
        adapter: agentCfg.adapter,
        command: agentCfg.command,
        source: 'configured',
        supported: createAdapter(agentCfg) !== undefined,
        availableForSessions: createAdapter(agentCfg) !== undefined,
      })
    }
  }

  async discover(): Promise<void> {
    for (const preset of DISCOVERY_PRESETS) {
      if (this.entries.has(preset.name)) continue
      const command = await findExecutable(preset.commands)
      if (!command) continue

      this.entries.set(preset.name, {
        name: preset.name,
        adapter: preset.adapter,
        command,
        source: 'discovered',
        supported: preset.supported,
        availableForSessions: preset.supported,
      })
    }
  }

  registerDiscoveredAdapters(router: Router): void {
    for (const entry of this.entries.values()) {
      if (entry.source !== 'discovered' || !entry.supported) continue
      const config = createDiscoveredAgentConfig(entry.adapter, entry.command)
      if (!config) continue
      const adapter = createAdapter(config)
      if (adapter) {
        router.registerAdapter(adapter)
      }
    }
  }

  async listAgents(): Promise<AgentInfo[]> {
    const entries = Array.from(this.entries.values()).sort((a, b) => {
      if (a.availableForSessions !== b.availableForSessions) {
        return Number(b.availableForSessions) - Number(a.availableForSessions)
      }
      return a.name.localeCompare(b.name)
    })

    return Promise.all(entries.map(async (entry) => {
      const probe = await this.probe(entry.command)
      return {
        ...entry,
        healthy: probe.healthy,
        version: probe.version,
      }
    }))
  }

  private async probe(command: string): Promise<{ healthy: boolean; version?: string }> {
    const cached = this.probeCache.get(command)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }

    const value = await probeCommand(command)
    this.probeCache.set(command, {
      expiresAt: Date.now() + HEALTH_CACHE_TTL_MS,
      value,
    })
    return value
  }
}

async function findExecutable(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    const found = await resolveCommand(candidate)
    if (found) return found
  }
  return undefined
}

async function resolveCommand(command: string): Promise<string | undefined> {
  if (command.includes('/')) {
    return await isExecutable(command) ? command : undefined
  }

  const pathEntries = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const entry of pathEntries) {
    const fullPath = join(entry, command)
    if (await isExecutable(fullPath)) {
      return fullPath
    }
  }

  return undefined
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

function parseVersion(output: string): string | undefined {
  const line = output
    .split('\n')
    .map((item) => item.trim())
    .find(Boolean)

  if (!line) return undefined
  return line.length > 120 ? `${line.slice(0, 117)}...` : line
}
