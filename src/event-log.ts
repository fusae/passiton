import fs from 'fs'
import path from 'path'
import { resolveDataHome } from './paths.js'

export type EventLogLevel = 'info' | 'warn' | 'error'
export type EventLogFields = Record<string, unknown>

export const EVENT_LOG_MAX_BYTES = 5 * 1024 * 1024
const HISTORY_FILES = 2

export function logEvent(level: EventLogLevel, event: string, fields: EventLogFields = {}): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...withoutReservedFields(fields),
  }
  const line = stringifyEvent(payload)
  mirrorToConsole(level, line)

  try {
    const filePath = eventLogPath()
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    rotateIfNeeded(filePath, Buffer.byteLength(line) + 1)
    fs.appendFileSync(filePath, `${line}\n`, 'utf8')
  } catch (_) {
    // System logging must never break the main Passiton process.
  }
}

export function eventLogPath(): string {
  return path.join(resolveDataHome(), 'logs', 'events.jsonl')
}

function rotateIfNeeded(filePath: string, incomingBytes: number): void {
  let size = 0
  try {
    size = fs.statSync(filePath).size
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  if (size + incomingBytes <= EVENT_LOG_MAX_BYTES) return

  for (let index = HISTORY_FILES; index >= 1; index--) {
    const source = index === 1 ? filePath : `${filePath}.${index - 1}`
    const target = `${filePath}.${index}`
    if (!fs.existsSync(source)) continue
    if (index === HISTORY_FILES) fs.rmSync(target, { force: true })
    fs.renameSync(source, target)
  }
}

function withoutReservedFields(fields: EventLogFields): EventLogFields {
  const { ts: _ts, level: _level, event: _event, ...rest } = fields
  return rest
}

function stringifyEvent(payload: EventLogFields): string {
  try {
    const seen = new WeakSet<object>()
    return JSON.stringify(payload, (_key, value) => {
      if (typeof value === 'bigint') return value.toString()
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack }
      }
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[Circular]'
        seen.add(value)
      }
      return value
    })
  } catch (err) {
    return JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      event: 'event-log-serialize-failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
}

function mirrorToConsole(level: EventLogLevel, line: string): void {
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}
