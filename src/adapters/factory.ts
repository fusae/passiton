import type { AgentConfig, Adapter } from '../types.js'
import type { Router } from '../router.js'
import { ClaudeCodeAdapter } from './claude-code.js'
import { CodexAdapter } from './codex.js'
import { GeminiAdapter } from './gemini.js'
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
  'gemini-cli': {
    adapter: 'gemini-cli',
    args: ['-p', '{prompt}'],
    timeout: 600_000,
  },
}

export function createAdapter(agentCfg: AgentConfig): Adapter | undefined {
  let adapter: Adapter | undefined
  switch (agentCfg.adapter) {
    case 'codex':
      adapter = new CodexAdapter({
        command: agentCfg.command,
        args: agentCfg.args,
        timeout: agentCfg.timeout,
        env: agentCfg.env,
      })
      break
    case 'claude-code':
      adapter = new ClaudeCodeAdapter({
        command: agentCfg.command,
        args: agentCfg.args,
        timeout: agentCfg.timeout,
        env: agentCfg.env,
      })
      break
    case 'opencode':
      adapter = new OpenCodeAdapter({
        command: agentCfg.command,
        args: agentCfg.args,
        timeout: agentCfg.timeout,
        model: agentCfg.model,
        env: agentCfg.env,
      })
      break
    case 'gemini-cli':
      adapter = new GeminiAdapter({
        command: agentCfg.command,
        args: agentCfg.args,
        timeout: agentCfg.timeout,
        model: agentCfg.model,
        env: agentCfg.env,
      })
      break
    case 'anthropic-api':
      adapter = new AnthropicApiAdapter({
        apiKey: requireApiKey(agentCfg),
        model: agentCfg.model,
        baseUrl: agentCfg.baseUrl,
        timeout: agentCfg.timeout,
      })
      break
    case 'openai-api':
    case 'custom-api':
      adapter = new OpenAIApiAdapter({
        apiKey: requireApiKey(agentCfg),
        model: agentCfg.model,
        baseUrl: agentCfg.baseUrl,
        timeout: agentCfg.timeout,
      })
      break
    case 'zhipu-api':
      adapter = new ZhipuApiAdapter({
        apiKey: requireApiKey(agentCfg),
        model: agentCfg.model,
        baseUrl: agentCfg.baseUrl,
        timeout: agentCfg.timeout,
      })
      break
    default:
      return undefined
  }
  return withAdapterMetadata(adapter, agentCfg.adapter)
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

function withAdapterMetadata(adapter: Adapter, adapterType: string): Adapter {
  adapter.config.adapter = adapterType
  const canUseLocalTools = !isApiAdapterType(adapterType)
  adapter.capabilities = {
    tools: canUseLocalTools,
    fileSystem: canUseLocalTools,
    shell: canUseLocalTools,
  }
  return adapter
}

function isApiAdapterType(adapterType: string): boolean {
  return adapterType === 'anthropic-api' ||
    adapterType === 'openai-api' ||
    adapterType === 'zhipu-api' ||
    adapterType === 'custom-api'
}

export function createDiscoveredAgentConfig(adapter: string, command: string): AgentConfig | undefined {
  const defaults = DISCOVERED_DEFAULTS[adapter]
  if (!defaults) return undefined
  return {
    ...defaults,
    command,
  }
}
