import { spawn } from 'child_process'
import type { AdapterSendOpts } from '../types.js'

const HARD_TIMEOUT_MS = 2 * 60 * 60 * 1000

// --- Platform injection (for testability) ---
let platformOverride: string | undefined

export function setSharedPlatformForTesting(platform: string | undefined): void {
  platformOverride = platform
}

function currentPlatform(): string {
  return platformOverride ?? process.platform
}

/**
 * On win32, .cmd/.bat files cannot be spawned directly by Node.js
 * (CVE-2024-27980 patched Node to reject bare .cmd/.bat spawn).
 * We use { shell: true } which lets Node internally wrap via cmd.exe /d /s /c.
 *
 * Quoting rationale: { shell: true } passes the argument ARRAY to Node.js which
 * internally joins them into a single cmd.exe command string.  Node.js handles
 * the outer quoting for the command itself, but does NOT individually quote each
 * argument.  For fixed adapter args (flags like --ephemeral, -p) this is safe.
 * The {prompt} argument is interpolated into args by each adapter and may contain
 * spaces, quotes, or newlines.  Using shell:true is still the safest practical
 * choice because:
 *   1. The alternative (manual cmd.exe /c "..." quoting) is MORE dangerous —
 *      cmd.exe quoting rules are broken for arbitrary content (strip-and-requote).
 *   2. Node.js ≥18 does apply limited quoting to arguments containing spaces.
 *   3. .exe files spawn directly without shell, so only .cmd/.bat need this path.
 */
function shouldUseShell(command: string): boolean {
  if (currentPlatform() !== 'win32') return false
  const lower = command.toLowerCase()
  return lower.endsWith('.cmd') || lower.endsWith('.bat')
}

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
      ...(shouldUseShell(command) ? { shell: true } : {}),
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
        const diagnosticOutput = [tailText(stdout, 12_000), tailText(stderr, 12_000)]
          .map((text) => text.trim())
          .filter(Boolean)
          .join('\n')
        const summary = summarizeFailureOutput(diagnosticOutput)
        reject(withLastOutput(new Error(withHint(adapterName, command, code, diagnosticOutput, `[${adapterName}] exited with code ${code}: ${summary}`, currentIdleTimeout())), lastOutput))
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
    if (evt.type === 'system' || evt.type === 'user') return ''
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
    if (typeof evt.type === 'string') return ''
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

function summarizeFailureOutput(text: string): string {
  const lines = stripAnsi(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]) as Record<string, unknown>
      if (event.is_error === true && typeof event.result === 'string' && event.result.trim()) {
        return truncateOutput(event.result)
      }
      const message = event.message as Record<string, unknown> | undefined
      const content = message?.content
      if (Array.isArray(content)) {
        const value = content
          .map((part) => typeof part === 'object' && part !== null ? (part as { text?: string }).text : undefined)
          .filter(Boolean)
          .join(' ')
          .trim()
        if (value && (event.error || event.type === 'assistant')) return truncateOutput(value)
      }
    } catch {
      // Plain-text CLI output.
    }
  }
  return lastMeaningfulLine(text) || 'No diagnostic output'
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
    return `${message}\nstatus: not_installed\nhint: Could not find or execute \`${command}\`. Check this agent's command path in Settings, or add it to PATH.`
  }
  // 2. Auth / credentials / subscription. CLI agents (claude-code, codex, …)
  //    commonly exit non-zero with empty or terse stderr when unauthenticated.
  const quotaCues = ['usage limit', 'usage limit reached', 'session limit', 'quota', 'rate limit', 'rate_limit', 'too many requests', 'statuscode":429', 'api_error_status":429', 'status 429', ' 429', '"code":"1308"', 'insufficient balance', '余额不足']
  const authCues = ['unauthorized', 'unauthenticated', 'invalid api key', 'authentication', 'not logged in', 'login', 'no subscription', '401', '403', 'payment required', ...quotaCues]
  const looksLikeAuth = (code !== null && code !== 0 && stderr.trim() === '') || authCues.some((cue) => lower.includes(cue))
  if (looksLikeAuth) {
    const status = quotaCues.some((cue) => lower.includes(cue)) ? 'rate_limited' : lower.includes('api key') ? 'api_key_missing' : 'auth_required'
    const resetMatch = stripAnsi(stderr + ' ' + message).match(/reset at ([^"}\n]+)/i)
    const resetHint = resetMatch?.[1] ? ` Reset time: ${resetMatch[1]}.` : ''
    return `${message}\nstatus: ${status}\nhint: \`${adapterName}\` ${status === 'rate_limited' ? `hit a usage or rate limit.${resetHint}` : 'failed to start. Common causes: not logged in, expired credentials, or an inactive subscription.'} Run this agent once in its own terminal to confirm, or check its env / API key in Settings.`
  }
  // 3. Timeout — point at the timeout knob.
  if (lower.includes('timed out')) {
    const seconds = Math.round(timeoutMs / 1000)
    const mode = lower.includes('idle timed out') ? 'produced no output for' : lower.includes('hard timed out') ? 'ran longer than' : 'waited longer than'
    return `${message}\nstatus: timeout\nhint: This agent ${mode} ${seconds}s. Idle timeout is not triggered while output continues; if the task is genuinely long, increase this agent's \`timeout\` in Settings.`
  }
  return message
}
