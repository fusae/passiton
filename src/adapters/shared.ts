import { spawn } from 'child_process'
import type { AdapterSendOpts } from '../types.js'

interface RunCommandOptions {
  adapterName: string
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  timeout: number
  stdinMode?: 'ignore' | 'pipe'
  onOutput?: (line: string) => void
}

export function buildPrompt(message: string, opts?: AdapterSendOpts): string {
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

export function runCommand({
  adapterName,
  command,
  args,
  cwd,
  env = {},
  timeout,
  stdinMode = 'pipe',
  onOutput,
}: RunCommandOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: cwd ?? process.cwd(),
      env: { ...process.env, ...env },
      stdio: [stdinMode, 'pipe', 'pipe'],
    })

    if (stdinMode === 'pipe') {
      proc.stdin?.end()
    }

    let stdout = ''
    let stderr = ''
    let stdoutBuffer = ''
    let stderrBuffer = ''
    let lastOutput = ''

    const capture = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      const text = chunk.toString()
      if (stream === 'stdout') {
        stdout += text
        stdoutBuffer = emitCompleteLines(stdoutBuffer + text, (line) => {
          lastOutput = line
          onOutput?.(line)
        })
      } else {
        stderr += text
        stderrBuffer = emitCompleteLines(stderrBuffer + text, (line) => {
          lastOutput = line
          onOutput?.(line)
        })
      }
    }

    proc.stdout!.on('data', (d: Buffer) => { capture(d, 'stdout') })
    proc.stderr!.on('data', (d: Buffer) => { capture(d, 'stderr') })

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(withLastOutput(new Error(`[${adapterName}] timed out after ${timeout}ms`), lastOutput))
    }, timeout)

    proc.on('close', (code) => {
      clearTimeout(timer)
      const finalStdout = flushLine(stdoutBuffer, onOutput)
      const finalStderr = flushLine(stderrBuffer, onOutput)
      lastOutput = finalStderr || finalStdout || lastOutput
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(withLastOutput(new Error(`[${adapterName}] exited with code ${code}: ${stderr.trim()}`), lastOutput))
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(withLastOutput(new Error(`[${adapterName}] spawn error: ${err.message}`), lastOutput))
    })
  })
}

function emitCompleteLines(buffer: string, onOutput?: (line: string) => void): string {
  const lines = buffer.split(/\r?\n/)
  const rest = lines.pop() ?? ''
  for (const line of lines) {
    flushLine(line, onOutput)
  }
  return rest
}

function flushLine(line: string, onOutput?: (line: string) => void): string {
  const meaningful = normalizeOutputLine(line)
  if (meaningful) onOutput?.(meaningful)
  return meaningful
}

function normalizeOutputLine(line: string): string {
  const trimmed = stripAnsi(line).trim()
  if (!trimmed) return ''

  try {
    const evt = JSON.parse(trimmed) as Record<string, unknown>
    const message = evt.message as Record<string, unknown> | undefined
    const content = message?.content
    if (Array.isArray(content)) {
      const text = content
        .map((part) => typeof part === 'object' && part !== null ? (part as { text?: string }).text : undefined)
        .filter(Boolean)
        .join(' ')
        .trim()
      if (text) return truncateOutput(text)
    }
    if (typeof content === 'string' && content.trim()) return truncateOutput(content)
    if (typeof evt.result === 'string' && evt.result.trim()) return truncateOutput(evt.result)
    if (typeof evt.text === 'string' && evt.text.trim()) return truncateOutput(evt.text)
    if (typeof evt.type === 'string') {
      const subtype = typeof evt.subtype === 'string' ? `:${evt.subtype}` : ''
      return truncateOutput(`${evt.type}${subtype}`)
    }
  } catch {
    // Plain text output.
  }

  return truncateOutput(trimmed)
}

function truncateOutput(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > 200 ? `${normalized.slice(0, 197)}...` : normalized
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

function withLastOutput(error: Error, lastOutput: string): Error {
  if (lastOutput) {
    Object.assign(error, { lastAgentOutput: lastOutput })
  }
  return error
}
