import type { AgentConfig, Adapter } from '../types.js'
import type { Router } from '../router.js'
import { ClaudeCodeAdapter } from './claude-code.js'
import { CodexAdapter } from './codex.js'
import { OpenCodeAdapter } from './opencode.js'
import { AnthropicApiAdapter } from './api/anthropic.js'
import { OpenAIApiAdapter } from './api/openai.js'
import { ZhipuApiAdapter } from './api/zhipu.js'

const DISCOVERED_DEFAULTS: Record<string, Omit<AgentConfig, 'command'>> = {
  codex: {
    adapter: 'codex',
    args: ['exec', '--full-auto', '--ephemeral', '--skip-git-repo-check', '{prompt}'],
    timeout: 600_000,
  },
  'claude-code': {
    adapter: 'claude-code',
    args: ['-p', '{prompt}', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'],
    timeout: 600_000,
  },
  opencode: {
    adapter: 'opencode',
    args: ['run', '{prompt}', '--dangerously-skip-permissions'],
    timeout: 600_000,
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
    case 'anthropic-api':
      return new AnthropicApiAdapter({
        apiKey: requireApiKey(agentCfg),
        model: agentCfg.model,
        baseUrl: agentCfg.baseUrl,
        timeout: agentCfg.timeout,
      })
    case 'openai-api':
    case 'custom-api':
      return new OpenAIApiAdapter({
        apiKey: requireApiKey(agentCfg),
        model: agentCfg.model,
        baseUrl: agentCfg.baseUrl,
        timeout: agentCfg.timeout,
      })
    case 'zhipu-api':
      return new ZhipuApiAdapter({
        apiKey: requireApiKey(agentCfg),
        model: agentCfg.model,
        baseUrl: agentCfg.baseUrl,
        timeout: agentCfg.timeout,
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
    ;(adapter as { name: string }).name = name
    router.registerAdapter(adapter)
  }
}

export function registerUserConfiguredAdapters(
  router: Router,
  userId: string,
  agents: Record<string, AgentConfig>
): void {
  router.clearUserAdapters(userId)
  for (const [name, agentCfg] of Object.entries(agents)) {
    let adapter: Adapter | undefined
    try {
      adapter = createAdapter(agentCfg)
    } catch {
      continue
    }
    if (!adapter) continue
    ;(adapter as { name: string }).name = name
    router.registerUserAdapter(userId, adapter)
  }
}

function requireApiKey(agentCfg: AgentConfig): string {
  if (!agentCfg.apiKey) {
    throw new Error(`[init] apiKey is required for adapter "${agentCfg.adapter}"`)
  }
  return agentCfg.apiKey
}

export function createDiscoveredAgentConfig(adapter: string, command: string): AgentConfig | undefined {
  const defaults = DISCOVERED_DEFAULTS[adapter]
  if (!defaults) return undefined
  return {
    ...defaults,
    command,
  }
}
