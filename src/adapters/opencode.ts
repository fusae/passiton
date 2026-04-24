// OpenCode adapter — uses opencode run "prompt" --dangerously-skip-permissions --format json

import type { Adapter } from './types.js'
import type { Session, AdapterSendOpts } from '../types.js'
import { resolveCommandArgs } from './command-args.js'
import { buildPrompt, runCommand } from './shared.js'

const DEFAULT_OPENCODE_PATH = 'opencode'
const DEFAULT_OPENCODE_ARGS = ['run', '{prompt}', '--dangerously-skip-permissions']

export interface OpenCodeAdapterConfig {
  command?: string
  args?: string[]
  timeout?: number
  model?: string
  env?: Record<string, string>
}

export class OpenCodeAdapter implements Adapter {
  readonly name = 'opencode'
  readonly config: Record<string, unknown>
  private command: string
  private args: string[]
  private timeout: number
  private model?: string
  private env: Record<string, string>

  constructor(cfg: OpenCodeAdapterConfig = {}) {
    this.command = cfg.command ?? DEFAULT_OPENCODE_PATH
    this.args = cfg.args ?? DEFAULT_OPENCODE_ARGS
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
    if (session.cwd) {
      args.push('--dir', session.cwd)
    }

    const raw = await runCommand({
      adapterName: this.name,
      command: this.command,
      args,
      cwd: session.cwd,
      env: this.env,
      timeout: this.timeout,
      stdinMode: 'pipe',
    })
    return this.extractText(raw)
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

  /**
   * Extract assistant text from opencode output.
   * opencode run without --format json prints the assistant reply directly.
   * With --format json it outputs NDJSON events — we look for the last assistant text.
   */
  private extractText(raw: string): string {
    // Try parsing as NDJSON first
    const lines = raw.split('\n').filter((l) => l.trim())
    let lastText = ''

    for (const line of lines) {
      try {
        const evt = JSON.parse(line)
        // opencode json events may have various shapes
        if (evt.type === 'assistant' && evt.content) {
          lastText = typeof evt.content === 'string'
            ? evt.content
            : JSON.stringify(evt.content)
        }
        if (evt.type === 'text' && evt.text) {
          lastText = evt.text
        }
        // result / completion event
        if (evt.result) {
          lastText = typeof evt.result === 'string'
            ? evt.result
            : JSON.stringify(evt.result)
        }
        // Some opencode versions emit { content: "..." } directly
        if (!evt.type && evt.content && typeof evt.content === 'string') {
          lastText = evt.content
        }
      } catch {
        // Not JSON — plain text output, accumulate
      }
    }

    // If we found structured text, use it; otherwise return raw output
    return (lastText || raw).trim()
  }
}
