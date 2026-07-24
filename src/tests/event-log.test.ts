import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EVENT_LOG_MAX_BYTES, eventLogPath, logEvent } from '../event-log.js'

test('logEvent writes valid JSONL with required fields', () => {
  withTempHome((home) => {
    logEvent('info', 'service-started', { port: 3000 })

    const lines = readFileSync(join(home, 'logs', 'events.jsonl'), 'utf8').trim().split('\n')
    assert.equal(lines.length, 1)
    const event = JSON.parse(lines[0])
    assert.equal(typeof event.ts, 'string')
    assert.equal(event.level, 'info')
    assert.equal(event.event, 'service-started')
    assert.equal(event.port, 3000)
  })
})

test('logEvent rotates events.jsonl when size threshold is exceeded', () => {
  withTempHome((home) => {
    const filePath = eventLogPath()
    fs.mkdirSync(join(home, 'logs'), { recursive: true })
    writeFileSync(filePath, 'x'.repeat(EVENT_LOG_MAX_BYTES), 'utf8')

    logEvent('warn', 'rotation-triggered')

    assert.ok(fs.existsSync(filePath))
    assert.ok(fs.existsSync(`${filePath}.1`))
    assert.equal(readFileSync(filePath, 'utf8').trim().includes('"event":"rotation-triggered"'), true)
    assert.equal(fs.statSync(`${filePath}.1`).size, EVENT_LOG_MAX_BYTES)
  })
})

test('logEvent does not throw when disk write fails', () => {
  withTempHome(() => {
    const originalAppend = fs.appendFileSync
    try {
      Object.assign(fs, {
        appendFileSync: () => {
          throw new Error('disk unavailable')
        },
      })
      assert.doesNotThrow(() => logEvent('error', 'disk-write-failed', { detail: 'test' }))
    } finally {
      Object.assign(fs, { appendFileSync: originalAppend })
    }
  })
})

function withTempHome(fn: (home: string) => void): void {
  const previousPassitonHome = process.env.PASSITON_HOME
  const previousTuringHome = process.env.TURING_HOME
  const restoreConsole = muteConsole()
  const home = mkdtempSync(join(tmpdir(), 'passiton-event-log-'))

  try {
    process.env.PASSITON_HOME = home
    process.env.TURING_HOME = ''
    fn(home)
  } finally {
    if (previousPassitonHome === undefined) delete process.env.PASSITON_HOME
    else process.env.PASSITON_HOME = previousPassitonHome
    if (previousTuringHome === undefined) delete process.env.TURING_HOME
    else process.env.TURING_HOME = previousTuringHome
    restoreConsole()
    rmSync(home, { recursive: true, force: true })
  }
}

function muteConsole(): () => void {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  }
  console.log = () => {}
  console.warn = () => {}
  console.error = () => {}
  return () => {
    console.log = original.log
    console.warn = original.warn
    console.error = original.error
  }
}
