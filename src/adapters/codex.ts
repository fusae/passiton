// Codex adapter — uses codex exec -p "prompt"

import { spawn } from 'child_process'
import type { Adapter } from './types.js'
import type { Session } from '../types.js'

const DEFAULT_CODEX_PATH = 'codex'

export interface CodexAdapterConfig {
  command?: string
  timeout?: number
  env?: Record<string, string>
}

export class CodexAdapter implements Adapter {
  readonly name = 'codex'
  readonly config: Record<string, unknown>
  private command: string
  private timeout: number
  private env: Record<string, string>

  constructor(cfg: CodexAdapterConfig = {}) {
    this.command = cfg.command ?? DEFAULT_CODEX_PATH
    this.timeout = cfg.timeout ?? 300_000
    this.env = cfg.env ?? {}
    this.config = { command: this.command, timeout: this.timeout }
  }

  async send(session: Session, message: string): Promise<string> {
    return this.run([this.command, 'exec', '--full-auto', '--ephemeral', '--skip-git-repo-check', message], session.cwd)
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.run([this.command, '--version'])
      return true
    } catch {
      return false
    }
  }

  private run(args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const [cmd, ...rest] = args
      const proc = spawn(cmd, rest, {
        cwd: cwd ?? process.cwd(),
        env: { ...process.env, ...this.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      // Close stdin immediately so Codex doesn't wait for input
      proc.stdin?.end()

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

      const timer = setTimeout(() => {
        proc.kill('SIGTERM')
        reject(new Error(`[codex] timed out after ${this.timeout}ms`))
      }, this.timeout)

      proc.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) {
          resolve(stdout.trim())
        } else {
          reject(new Error(`[codex] exited with code ${code}: ${stderr.trim()}`))
        }
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        reject(new Error(`[codex] spawn error: ${err.message}`))
      })
    })
  }
}
