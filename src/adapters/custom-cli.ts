import type { Adapter } from './types.js'
import type { Session, AdapterSendOpts } from '../types.js'
import { applyPermissionModeArgs, resolveCommandArgs } from './command-args.js'
import { buildPrompt, runCommand } from './shared.js'

export interface CustomCliAdapterConfig {
  command: string
  args: string[]
  timeout?: number
  env?: Record<string, string>
  permissionProfile?: string
}

export class CustomCliAdapter implements Adapter {
  readonly name = 'custom-cli'
  readonly config: Record<string, unknown>
  private command: string
  private args: string[]
  private timeout: number
  private env: Record<string, string>
  private permissionProfile: string

  constructor(cfg: CustomCliAdapterConfig) {
    this.command = cfg.command
    this.args = cfg.args
    this.timeout = cfg.timeout ?? 300_000
    this.env = cfg.env ?? {}
    this.permissionProfile = cfg.permissionProfile ?? 'custom-cli'
    this.config = { command: this.command, args: this.args, timeout: this.timeout }
  }

  async send(session: Session, message: string, opts?: AdapterSendOpts): Promise<string> {
    const fullMessage = buildPrompt(message, opts)
    const args = resolveCommandArgs(
      applyPermissionModeArgs(this.permissionProfile, this.args, session.permissionMode),
      fullMessage
    )
    const raw = await runCommand({
      adapterName: this.name,
      command: this.command,
      args,
      cwd: session.cwd,
      env: this.env,
      timeout: this.timeout,
      stdinMode: 'pipe',
      signal: opts?.signal,
      onOutput: opts?.onOutput,
      getTimeoutExtensionMs: opts?.getTimeoutExtensionMs,
    })
    return raw.trim()
  }

  async healthCheck(): Promise<boolean> {
    try {
      await runCommand({
        adapterName: this.name,
        command: this.command,
        args: ['--version'],
        env: this.env,
        timeout: 10_000,
        stdinMode: 'pipe',
      })
      return true
    } catch {
      return false
    }
  }
}
