import { spawn } from 'child_process'
import type { AdapterSendOpts } from '../types.js'

const HARD_TIMEOUT_MS = 2 * 60 * 60 * 1000

interface RunCommandOptions {
  adapterName: string
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  timeout: number
  stdinMode?: 'ignore' | 'pipe'
  signal?: AbortSignal
  onOutput?: (line: string) => void
  getTimeoutExtensionMs?: () => number
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
  signal,
  onOutput,
  getTimeoutExtensionMs,
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
    const startedAt = Date.now()
    let lastActivityAt = startedAt
    let settled = false
    let idleTimer: NodeJS.Timeout | undefined
    let hardTimer: NodeJS.Timeout | undefined

    const cleanupTimers = () => {
      if (idleTimer) clearTimeout(idleTimer)
      if (hardTimer) clearTimeout(hardTimer)
    }

    const currentIdleTimeout = () => timeout + Math.max(0, getTimeoutExtensionMs?.() ?? 0)

    const abort = () => {
      if (settled) return
      settled = true
      cleanupTimers()
      proc.kill('SIGTERM')
      reject(withLastOutput(new Error(`[${adapterName}] interrupted by human message`), lastOutput))
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }

    const capture = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      const text = chunk.toString()
      lastActivityAt = Date.now()
      scheduleIdleTimeout()
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

    function scheduleIdleTimeout() {
      if (settled) return
      if (idleTimer) clearTimeout(idleTimer)
      const idleTimeout = currentIdleTimeout()
      const remaining = lastActivityAt + idleTimeout - Date.now()
      if (remaining > 0) {
        idleTimer = setTimeout(scheduleIdleTimeout, remaining)
        return
      }
      idleTimer = setTimeout(() => {
        if (settled) return
        const latestIdleTimeout = currentIdleTimeout()
        proc.kill('SIGTERM')
        settled = true
        cleanupTimers()
        signal?.removeEventListener('abort', abort)
        const recentStderr = tailText(stderr, 12_000)
        reject(withLastOutput(new Error(withHint(adapterName, command, null, recentStderr, `[${adapterName}] idle timed out after ${latestIdleTimeout}ms`, latestIdleTimeout)), lastOutput || lastMeaningfulLine(recentStderr)))
      }, 0)
    }

    const scheduleHardTimeout = () => {
      if (settled) return
      if (hardTimer) clearTimeout(hardTimer)
      const hardTimeout = Math.max(HARD_TIMEOUT_MS, currentIdleTimeout())
      const remaining = startedAt + hardTimeout - Date.now()
      if (remaining > 0) {
        hardTimer = setTimeout(scheduleHardTimeout, remaining)
        return
      }
      hardTimer = setTimeout(() => {
        if (settled) return
        const latestHardTimeout = Math.max(HARD_TIMEOUT_MS, currentIdleTimeout())
        proc.kill('SIGTERM')
        settled = true
        cleanupTimers()
        signal?.removeEventListener('abort', abort)
        const recentStderr = tailText(stderr, 12_000)
        reject(withLastOutput(new Error(withHint(adapterName, command, null, recentStderr, `[${adapterName}] hard timed out after ${latestHardTimeout}ms`, latestHardTimeout)), lastOutput || lastMeaningfulLine(recentStderr)))
      }, 0)
    }

    scheduleIdleTimeout()
    scheduleHardTimeout()

    proc.on('close', (code) => {
      if (settled) return
      settled = true
      cleanupTimers()
      signal?.removeEventListener('abort', abort)
      const finalStdout = flushLine(stdoutBuffer, onOutput)
      const finalStderr = flushLine(stderrBuffer, onOutput)
      lastOutput = finalStderr || finalStdout || lastOutput
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(withLastOutput(new Error(withHint(adapterName, command, code, stderr, `[${adapterName}] exited with code ${code}: ${stderr.trim()}`, currentIdleTimeout())), lastOutput))
      }
    })

    proc.on('error', (err) => {
      if (settled) return
      settled = true
      cleanupTimers()
      signal?.removeEventListener('abort', abort)
      reject(withLastOutput(new Error(withHint(adapterName, command, null, '', `[${adapterName}] spawn error: ${err.message}`, timeout)), lastOutput))
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

function tailText(text: string, max: number): string {
  return text.length > max ? text.slice(-max) : text
}

function lastMeaningfulLine(text: string): string {
  const lines = stripAnsi(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return lines.at(-1) ?? ''
}

/**
 * Append a one-line, actionable hint to common adapter failures. The raw
 * message is kept (so logs/classification still work); the hint is the part a
 * user reads in the UI to know what to do next.
 */
export function withHint(adapterName: string, command: string, code: number | null, stderr: string, message: string, timeoutMs: number): string {
  const lower = (stderr + ' ' + message).toLowerCase()
  // 1. Binary not found / not executable.
  if (message.includes('spawn error') && (lower.includes('enoent') || lower.includes('not found') || lower.includes('eacces'))) {
    return `${message}\n状态：not_installed\n提示：找不到或无法执行 \`${command}\`。请在 Settings 里确认该 Agent 的 command 路径正确，或将其加入 PATH。`
  }
  // 2. Auth / credentials / subscription. CLI agents (claude-code, codex, …)
  //    commonly exit non-zero with empty or terse stderr when unauthenticated.
  const quotaCues = ['usage limit', 'usage limit reached', 'quota', 'rate limit', 'too many requests', 'statuscode":429', 'status 429', ' 429', '"code":"1308"', 'insufficient balance', '余额不足']
  const authCues = ['unauthorized', 'unauthenticated', 'invalid api key', 'authentication', 'not logged in', 'login', 'no subscription', '401', '403', 'payment required', ...quotaCues]
  const looksLikeAuth = (code !== null && code !== 0 && stderr.trim() === '') || authCues.some((cue) => lower.includes(cue))
  if (looksLikeAuth) {
    const status = quotaCues.some((cue) => lower.includes(cue)) ? 'rate_limited' : lower.includes('api key') ? 'api_key_missing' : 'auth_required'
    const resetMatch = stripAnsi(stderr + ' ' + message).match(/reset at ([^"}\n]+)/i)
    const resetHint = resetMatch?.[1] ? `重置时间：${resetMatch[1]}。` : ''
    return `${message}\n状态：${status}\n提示：\`${adapterName}\` ${status === 'rate_limited' ? `额度/频率限制已触发。${resetHint}` : '启动失败，常见原因：未登录、凭证失效或订阅过期。'}请在该 Agent 的终端里手动跑一次确认，或在 Settings 检查其 env / API Key。`
  }
  // 3. Timeout — point at the timeout knob.
  if (lower.includes('timed out')) {
    const seconds = Math.round(timeoutMs / 1000)
    const mode = lower.includes('idle timed out') ? '连续无输出' : lower.includes('hard timed out') ? '总运行时长' : '等待'
    return `${message}\n状态：timeout\n提示：该 Agent ${mode}超过 ${seconds}s。正常有持续输出时不会触发空闲超时；如任务确实很长，可在 Settings 调大该 Agent 的 \`timeout\`。`
  }
  return message
}
