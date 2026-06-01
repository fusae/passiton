// Codex adapter — uses the configured codex CLI command.

import type { Adapter } from './types.js'
import type { Session, AdapterSendOpts } from '../types.js'
import { applyPermissionModeArgs, resolveCommandArgs } from './command-args.js'
import { buildPrompt, runCommand } from './shared.js'

const DEFAULT_CODEX_PATH = process.env.TURING_CODEX_COMMAND ?? 'codex'
const DEFAULT_CODEX_ARGS = ['exec', '--ephemeral', '--skip-git-repo-check', '{prompt}']

export interface CodexAdapterConfig {
  command?: string
  args?: string[]
  timeout?: number
  env?: Record<string, string>
}

export class CodexAdapter implements Adapter {
  readonly name = 'codex'
  readonly config: Record<string, unknown>
  private command: string
  private args: string[]
  private timeout: number
  private env: Record<string, string>

  constructor(cfg: CodexAdapterConfig = {}) {
    this.command = cfg.command ?? DEFAULT_CODEX_PATH
    this.args = cfg.args ?? DEFAULT_CODEX_ARGS
    this.timeout = cfg.timeout ?? 300_000
    this.env = cfg.env ?? {}
    this.config = { command: this.command, args: this.args, timeout: this.timeout }
  }

  async send(session: Session, message: string, opts?: AdapterSendOpts): Promise<string> {
    const fullMessage = buildPrompt(message, opts)
    return runCommand({
      adapterName: this.name,
      command: this.command,
      args: resolveCommandArgs(applyPermissionModeArgs(this.name, this.args, session.permissionMode), fullMessage),
      cwd: session.cwd,
      env: this.env,
      timeout: this.timeout,
      stdinMode: 'pipe',
      signal: opts?.signal,
      onOutput: opts?.onOutput,
      getTimeoutExtensionMs: opts?.getTimeoutExtensionMs,
    })
  }

  async healthCheck(): Promise<boolean> {
    try {
      await runCommand({
        adapterName: this.name,
        command: this.command,
        args: ['--version'],
        env: this.env,
        timeout: this.timeout,
        stdinMode: 'pipe',
      })
      return true
    } catch {
      return false
    }
  }
}
