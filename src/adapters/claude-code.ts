// Claude Code adapter — uses claude -p "prompt" --output-format stream-json

import type { Adapter } from './types.js'
import type { Session, AdapterSendOpts } from '../types.js'
import { resolveCommandArgs } from './command-args.js'
import { buildPrompt, runCommand } from './shared.js'

const DEFAULT_CLAUDE_ARGS = ['-p', '{prompt}', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions']

export interface ClaudeCodeAdapterConfig {
  command?: string
  args?: string[]
  timeout?: number
  env?: Record<string, string>
}

// Shape of a stream-json line from claude CLI
interface StreamEvent {
  type: string
  subtype?: string
  message?: {
    role?: string
    content?: Array<{ type: string; text?: string }> | string
  }
  // result event
  result?: string
}

export class ClaudeCodeAdapter implements Adapter {
  readonly name = 'claude-code'
  readonly config: Record<string, unknown>
  private command: string
  private args: string[]
  private timeout: number
  private env: Record<string, string>

  constructor(cfg: ClaudeCodeAdapterConfig = {}) {
    this.command = cfg.command ?? 'claude'
    this.args = cfg.args ?? DEFAULT_CLAUDE_ARGS
    this.timeout = cfg.timeout ?? 300_000
    this.env = cfg.env ?? {}
    this.config = { command: this.command, args: this.args, timeout: this.timeout }
  }

  async send(session: Session, message: string, opts?: AdapterSendOpts): Promise<string> {
    const fullMessage = buildPrompt(message, opts)
    const raw = await runCommand({
      adapterName: this.name,
      command: this.command,
      args: resolveCommandArgs(this.args, fullMessage),
      cwd: session.cwd,
      env: this.env,
      timeout: this.timeout,
      stdinMode: 'ignore',
      onOutput: opts?.onOutput,
      getTimeoutExtensionMs: opts?.getTimeoutExtensionMs,
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
        timeout: this.timeout,
        stdinMode: 'ignore',
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * Parse stream-json output from claude CLI.
   * Priority: result event > last assistant message content.
   */
  private extractText(raw: string): string {
    const lines = raw.split('\n').filter((l) => l.trim())
    let lastAssistantText = ''
    let resultText = ''

    for (const line of lines) {
      try {
        const evt = JSON.parse(line) as StreamEvent
        if (evt.type === 'result' && evt.result) {
          resultText = evt.result
        }
        if (evt.type === 'message' && evt.message?.role === 'assistant') {
          const content = evt.message.content
          if (typeof content === 'string') {
            lastAssistantText = content
          } else if (Array.isArray(content)) {
            const texts = content
              .filter((b) => b.type === 'text' && b.text)
              .map((b) => b.text!)
            if (texts.length > 0) lastAssistantText = texts.join('')
          }
        }
      } catch {
        // non-JSON line (e.g. version output) — ignore
      }
    }

    return (resultText || lastAssistantText || raw).trim()
  }
}
