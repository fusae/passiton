import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCommand } from '../adapters/shared.js'

test('terminateProcessTree kills child and grandchild on abort (POSIX)', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-proctree-'))
  try {
    const childPidFile = join(dir, 'child.pid')
    const grandchildPidFile = join(dir, 'grandchild.pid')
    const script = join(dir, 'trap-sleep.sh')
    writeFileSync(script, [
      '#!/bin/sh',
      `echo $$ > "${childPidFile}"`,
      "trap '' TERM",
      'sleep 60 &',
      `echo $! > "${grandchildPidFile}"`,
      'wait',
      '',
    ].join('\n'))

    const controller = new AbortController()

    const promise = runCommand({
      adapterName: 'test',
      command: '/bin/sh',
      args: [script],
      timeout: 60_000,
      signal: controller.signal,
    })

    const childPid = await waitForPid(childPidFile)
    const grandchildPid = await waitForPid(grandchildPidFile)

    assert.doesNotThrow(() => process.kill(grandchildPid, 0), 'grandchild should be alive before abort')

    controller.abort()

    await assert.rejects(promise, /interrupted by human message/)

    await assertProcessGone(childPid, 7_000, 'child (sh)')
    await assertProcessGone(grandchildPid, 7_000, 'grandchild (sleep)')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

async function waitForPid(file: string, timeoutMs = 5_000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const content = readFileSync(file, 'utf8').trim()
      if (content) return Number(content)
    } catch {
      // file not written yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`PID file ${file} was not written within ${timeoutMs}ms`)
}

async function assertProcessGone(pid: number, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.fail(`${label} (pid ${pid}) was still alive after ${timeoutMs}ms`)
}
