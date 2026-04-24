// Config module — load ~/.turing/config.json and merge with defaults

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { AppConfig } from './types.js'

const CONFIG_PATH = join(homedir(), '.turing', 'config.json')

export const DEFAULT_CONFIG: AppConfig = {
  server: {
    port: 4590,
  },
  agents: {
    codex: {
      adapter: 'codex',
      command: 'codex',
      args: ['exec', '--full-auto', '--ephemeral', '--skip-git-repo-check', '{prompt}'],
      timeout: 300_000,
    },
    'claude-code': {
      adapter: 'claude-code',
      command: 'claude',
      args: ['-p', '{prompt}', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'],
      timeout: 300_000,
    },
    opencode: {
      adapter: 'opencode',
      command: 'opencode',
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
