// Gemini CLI adapter — uses gemini -p "prompt" in non-interactive mode.

import type { Adapter } from './types.js'
import type { Session, AdapterSendOpts } from '../types.js'
import { resolveCommandArgs } from './command-args.js'
import { buildPrompt, runCommand } from './shared.js'

const DEFAULT_GEMINI_PATH = process.env.TURING_GEMINI_COMMAND ?? 'gemini'
const DEFAULT_GEMINI_ARGS = ['-p', '{prompt}']

export interface GeminiAdapterConfig {
  command?: string
  args?: string[]
  timeout?: number
  model?: string
  env?: Record<string, string>
}

export class GeminiAdapter implements Adapter {
  readonly name = 'gemini-cli'
  readonly config: Record<string, unknown>
  private command: string
  private args: string[]
  private timeout: number
  private model?: string
  private env: Record<string, string>

  constructor(cfg: GeminiAdapterConfig = {}) {
    this.command = cfg.command ?? DEFAULT_GEMINI_PATH
    this.args = cfg.args ?? DEFAULT_GEMINI_ARGS
    this.timeout = cfg.timeout ?? 300_000
    this.model = cfg.model
    this.env = cfg.env ?? {}
    this.config = { command: this.command, args: this.args, timeout: this.timeout, model: this.model }
  }

  async send(session: Session, message: string, opts?: AdapterSendOpts): Promise<string> {
    const fullMessage = buildPrompt(message, opts)
    const args = resolveCommandArgs(this.args, fullMessage)
    if (this.model) {
      args.push('--model', this.model)
    }

    return runCommand({
      adapterName: this.name,
      command: this.command,
      args,
      cwd: session.cwd,
      env: this.env,
      timeout: this.timeout,
      stdinMode: 'pipe',
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
        timeout: 10_000,
        stdinMode: 'pipe',
      })
      return true
    } catch {
      return false
    }
  }
}
