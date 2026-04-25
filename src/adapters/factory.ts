import type { AgentConfig, Adapter } from '../types.js'
import type { Router } from '../router.js'
import { ClaudeCodeAdapter } from './claude-code.js'
import { CodexAdapter } from './codex.js'
import { OpenCodeAdapter } from './opencode.js'

const DISCOVERED_DEFAULTS: Record<string, Omit<AgentConfig, 'command'>> = {
  codex: {
    adapter: 'codex',
    args: ['exec', '--full-auto', '--ephemeral', '--skip-git-repo-check', '{prompt}'],
    timeout: 300_000,
  },
  'claude-code': {
    adapter: 'claude-code',
    args: ['-p', '{prompt}', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'],
    timeout: 300_000,
  },
  opencode: {
    adapter: 'opencode',
    args: ['run', '{prompt}', '--dangerously-skip-permissions'],
    timeout: 300_000,
  },
}

export function createAdapter(agentCfg: AgentConfig): Adapter | undefined {
  switch (agentCfg.adapter) {
    case 'codex':
      return new CodexAdapter({
        command: agentCfg.command,
        args: agentCfg.args,
        timeout: agentCfg.timeout,
        env: agentCfg.env,
      })
    case 'claude-code':
      return new ClaudeCodeAdapter({
        command: agentCfg.command,
        args: agentCfg.args,
        timeout: agentCfg.timeout,
        env: agentCfg.env,
      })
    case 'opencode':
      return new OpenCodeAdapter({
        command: agentCfg.command,
        args: agentCfg.args,
        timeout: agentCfg.timeout,
        model: agentCfg.model,
        env: agentCfg.env,
      })
    default:
      return undefined
  }
}

export function registerConfiguredAdapters(
  router: Router,
  agents: Record<string, AgentConfig>
): void {
  for (const [name, agentCfg] of Object.entries(agents)) {
    const adapter = createAdapter(agentCfg)
    if (!adapter) {
      console.warn(`[init] unknown adapter "${agentCfg.adapter}" for "${name}" — skipping`)
      continue
    }
    router.registerAdapter(adapter)
  }
}

export function createDiscoveredAgentConfig(adapter: string, command: string): AgentConfig | undefined {
  const defaults = DISCOVERED_DEFAULTS[adapter]
  if (!defaults) return undefined
  return {
    ...defaults,
    command,
  }
}
