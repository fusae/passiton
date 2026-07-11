import type { PermissionMode } from '../types.js'

export const PROMPT_PLACEHOLDER = '{prompt}'

export function resolveCommandArgs(args: string[], prompt: string): string[] {
  if (args.some((arg) => arg.includes(PROMPT_PLACEHOLDER))) {
    return args.map((arg) => arg.replaceAll(PROMPT_PLACEHOLDER, prompt))
  }

  return [...args, prompt]
}

export function applyPermissionModeArgs(adapter: string, args: string[], mode: PermissionMode): string[] {
  const cleaned = removeTrustedFlags(adapter, args)
  if (mode !== 'trusted') {
    return adapter === 'aider' ? appendUnique(cleaned, '--dry-run') : cleaned
  }

  switch (adapter) {
    case 'codex':
      return insertBeforePrompt(cleaned, '--dangerously-bypass-approvals-and-sandbox')
    case 'claude-code':
    case 'opencode':
      return appendUnique(cleaned, '--dangerously-skip-permissions')
    case 'copilot-cli':
      return appendUnique(cleaned, '--allow-all')
    case 'cursor-agent':
      return appendUnique(cleaned, '--force')
    case 'qwen-code':
      return appendUnique(cleaned, '--yolo')
    case 'cline':
      return insertBeforePrompt(cleaned, '-y')
    case 'aider':
      return appendUnique(cleaned, '--yes-always')
    case 'droid':
      return insertBeforePrompt(cleaned, '--skip-permissions-unsafe')
    case 'mistral-vibe':
      return [...cleaned, '--agent', 'auto-approve', '--trust']
    default:
      return cleaned
  }
}

function removeTrustedFlags(adapter: string, args: string[]): string[] {
  const unsafe = new Set([
    '--dangerously-skip-permissions',
    '--dangerously-bypass-approvals-and-sandbox',
    '--allow-all',
    '--force',
    '--yolo',
    '-y',
    '--yes-always',
    '--skip-permissions-unsafe',
    '--dry-run',
  ])
  const result: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (unsafe.has(arg)) continue
    if (adapter === 'mistral-vibe' && arg === '--agent' && args[index + 1] === 'auto-approve') {
      index += 1
      continue
    }
    if (adapter === 'mistral-vibe' && arg === '--trust') continue
    result.push(arg)
  }
  if (adapter === 'codex') {
    return result.filter((arg) => arg !== '--full-auto')
  }
  return result
}

function appendUnique(args: string[], flag: string): string[] {
  return args.includes(flag) ? args : [...args, flag]
}

function insertBeforePrompt(args: string[], flag: string): string[] {
  if (args.includes(flag)) return args
  const index = args.findIndex((arg) => arg.includes(PROMPT_PLACEHOLDER))
  if (index === -1) return [...args, flag]
  return [...args.slice(0, index), flag, ...args.slice(index)]
}
