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
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const abort = () => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
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

    const scheduleTimeout = () => {
      const totalTimeout = timeout + Math.max(0, getTimeoutExtensionMs?.() ?? 0)
      const remaining = startedAt + totalTimeout - Date.now()
      if (remaining > 0) {
        timer = setTimeout(scheduleTimeout, remaining)
        return
      }
      proc.kill('SIGTERM')
      settled = true
      signal?.removeEventListener('abort', abort)
      reject(withLastOutput(new Error(withHint(adapterName, command, null, '', `[${adapterName}] timed out after ${totalTimeout}ms`, totalTimeout)), lastOutput))
    }
    scheduleTimeout()

    proc.on('close', (code) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      const finalStdout = flushLine(stdoutBuffer, onOutput)
      const finalStderr = flushLine(stderrBuffer, onOutput)
      lastOutput = finalStderr || finalStdout || lastOutput
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(withLastOutput(new Error(withHint(adapterName, command, code, stderr, `[${adapterName}] exited with code ${code}: ${stderr.trim()}`, timeout + Math.max(0, getTimeoutExtensionMs?.() ?? 0))), lastOutput))
      }
    })

    proc.on('error', (err) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
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
  const authCues = ['unauthorized', 'unauthenticated', 'invalid api key', 'authentication', 'not logged in', 'login', 'no subscription', 'quota', 'rate limit', '401', '403', 'payment required']
  const looksLikeAuth = (code !== null && code !== 0 && stderr.trim() === '') || authCues.some((cue) => lower.includes(cue))
  if (looksLikeAuth) {
    const status = lower.includes('rate limit') || lower.includes('quota') ? 'rate_limited' : lower.includes('api key') ? 'api_key_missing' : 'auth_required'
    return `${message}\n状态：${status}\n提示：\`${adapterName}\` 启动失败（exit ${code ?? '?'}）。常见原因：未登录、凭证失效或订阅过期。请在该 Agent 的终端里手动跑一次（例如 \`${command} --version\` 后登录），或在 Settings 检查其 env / API Key。`
  }
  // 3. Timeout — point at the timeout knob.
  if (lower.includes('timed out')) {
    const seconds = Math.round(timeoutMs / 1000)
    return `${message}\n状态：timeout\n提示：该 Agent 超过 ${seconds}s 仍未返回。可在配置里调大该 Agent 的 \`timeout\`，或检查网络/模型是否可用。`
  }
  return message
}
