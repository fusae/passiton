// OpenCode adapter — uses opencode run "prompt" --dangerously-skip-permissions --format json

import { spawn } from 'child_process'
import type { Adapter } from './types.js'
import type { Session, AdapterSendOpts } from '../types.js'

const DEFAULT_OPENCODE_PATH = 'opencode'

export interface OpenCodeAdapterConfig {
  command?: string
  timeout?: number
  model?: string
  env?: Record<string, string>
}

export class OpenCodeAdapter implements Adapter {
  readonly name = 'opencode'
  readonly config: Record<string, unknown>
  private command: string
  private timeout: number
  private model?: string
  private env: Record<string, string>

  constructor(cfg: OpenCodeAdapterConfig = {}) {
    this.command = cfg.command ?? DEFAULT_OPENCODE_PATH
    this.timeout = cfg.timeout ?? 300_000
    this.model = cfg.model
    this.env = cfg.env ?? {}
    this.config = { command: this.command, timeout: this.timeout, model: this.model }
  }

  async send(session: Session, message: string, opts?: AdapterSendOpts): Promise<string> {
    const fullMessage = this.buildPrompt(message, opts)
    const args = ['run', fullMessage, '--dangerously-skip-permissions']
    if (this.model) {
      args.push('--model', this.model)
    }
    if (session.cwd) {
      args.push('--dir', session.cwd)
    }

    const raw = await this.run([this.command, ...args], session.cwd)
    return this.extractText(raw)
  }

  private buildPrompt(message: string, opts?: AdapterSendOpts): string {
    const parts: string[] = []
    if (opts?.systemPrompt) {
      parts.push(`[System Instructions]\n${opts.systemPrompt}\n`)
    }
    if (opts?.history && opts.history.length > 0) {
      parts.push('[Conversation History]')
      for (const msg of opts.history) {
        const role = msg.role === 'assistant' ? 'You' : 'Other'
        parts.push(`${role}: ${msg.content}`)
      }
      parts.push('')
    }
    parts.push(`[Current Message]\n${message}`)
    return parts.join('\n')
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.run([this.command, '--version'], undefined, 10_000)
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

  private run(args: string[], cwd?: string, timeoutOverride?: number): Promise<string> {
    const timeout = timeoutOverride ?? this.timeout
    return new Promise((resolve, reject) => {
      const [cmd, ...rest] = args
      const proc = spawn(cmd, rest, {
        cwd: cwd ?? process.cwd(),
        env: { ...process.env, ...this.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      // Close stdin immediately
      proc.stdin?.end()

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

      const timer = setTimeout(() => {
        proc.kill('SIGTERM')
        reject(new Error(`[opencode] timed out after ${timeout}ms`))
      }, timeout)

      proc.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) {
          resolve(stdout.trim())
        } else {
          reject(new Error(`[opencode] exited with code ${code}: ${stderr.trim()}`))
        }
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        reject(new Error(`[opencode] spawn error: ${err.message}`))
      })
    })
  }
}
