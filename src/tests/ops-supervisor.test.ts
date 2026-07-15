import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as state from '../state.js'
import {
  OpsSupervisor,
  normalizeOutput,
  isMeaningfulProgress,
  isErrorRefreshLine,
  classifyCondition,
  acknowledgeIncident,
  listIncidents,
  DEFAULT_SUPERVISOR_CONFIG,
} from '../ops-supervisor.js'
import type { Task, WsEvent, OpsIncident } from '../types.js'

function withTempDb(fn: () => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'turing-ops-test-'))
  state.initDb(join(dir, 'turing.db'))
  return fn().finally(() => {
    state.closeDb()
    rmSync(dir, { recursive: true, force: true })
  })
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now()
  return {
    id: 'test-task',
    agent: { adapter: 'codex' },
    prompt: 'test prompt',
    status: 'running',
    permissionMode: 'safe',
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    ...overrides,
  }
}

function makeSupervisor(deps: {
  stopTask?: (id: string) => Promise<Task>
  startHandoff?: (source: Task, excludeAdapter: string) => Promise<{ task?: Task; reason?: string }>
  events?: WsEvent[]
}, configOverrides: Partial<typeof DEFAULT_SUPERVISOR_CONFIG> = {}): OpsSupervisor {
  const events: WsEvent[] = deps.events ?? []
  return new OpsSupervisor(
    {
      stopTask: deps.stopTask ?? (async (id) => {
        const stopped = state.updateTask(id, { status: 'stopped', finishedAt: Date.now() })
        return stopped
      }),
      startHandoff: deps.startHandoff ?? (async () => ({ reason: 'No fallback agent available.' })),
      emitWsEvent: (event) => { events.push(event) },
    },
    { ...DEFAULT_SUPERVISOR_CONFIG, staleProgressMs: 1000, cooldownMs: 60_000, ...configOverrides }
  )
}

// ── Pure function tests ──────────────────────────────────────────────────────

test('normalizeOutput strips ANSI escape codes', () => {
  const raw = '\x1b[32mSuccess\x1b[0m\n\x1b[1mBold\x1b[0m'
  const normalized = normalizeOutput(raw)
  assert.equal(normalized, 'Success\nBold')
})

test('normalizeOutput strips timestamps', () => {
  const raw = '[12:34:56] Starting work\n2024-01-15T12:34:56.789Z Done'
  const normalized = normalizeOutput(raw)
  assert.ok(normalized.includes('<ts>'))
  assert.ok(!normalized.includes('12:34:56'))
  assert.ok(!normalized.includes('2024-01-15'))
})

test('normalizeOutput strips heartbeat and blank noise lines', () => {
  const raw = 'heartbeat\n\nReal output\nping\npong'
  const normalized = normalizeOutput(raw)
  assert.equal(normalized, 'Real output')
})

test('isErrorRefreshLine detects model-refresh timeout', () => {
  assert.ok(isErrorRefreshLine('failed to refresh available models: timeout waiting for child process to exit'))
  assert.ok(isErrorRefreshLine('Error: timeout waiting for child process to exit'))
  assert.ok(isErrorRefreshLine('rate limit exceeded'))
  assert.ok(isErrorRefreshLine('401 Unauthorized'))
  assert.ok(!isErrorRefreshLine('Successfully wrote file.ts'))
})

test('isMeaningfulProgress returns false for identical signatures', () => {
  const sig = 'line1\nline2'
  assert.equal(isMeaningfulProgress(sig, sig), false)
})

test('isMeaningfulProgress returns false when only error-refresh lines are added', () => {
  const old = 'line1\nline2'
  const newSig = 'line1\nline2\nfailed to refresh available models: timeout waiting for child process to exit'
  assert.equal(isMeaningfulProgress(old, newSig), false)
})

test('isMeaningfulProgress returns true when real content is added', () => {
  const old = 'line1\nline2'
  const newSig = 'line1\nline2\nWrote file: src/index.ts'
  assert.equal(isMeaningfulProgress(old, newSig), true)
})

test('classifyCondition detects model_unavailable', () => {
  const task = makeTask({
    lastAgentOutput: 'failed to refresh available models: timeout waiting for child process to exit',
  })
  const result = classifyCondition(task)
  assert.ok(result)
  assert.equal(result!.classification, 'model_unavailable')
  assert.equal(result!.severity, 'critical')
})

test('classifyCondition detects quota_exhausted', () => {
  const task = makeTask({
    errorMessage: '429 rate limit exceeded. Quota exhausted.',
  })
  const result = classifyCondition(task)
  assert.ok(result)
  assert.equal(result!.classification, 'quota_exhausted')
})

test('classifyCondition detects auth_failed', () => {
  const task = makeTask({
    errorMessage: '401 Unauthorized: invalid API key',
  })
  const result = classifyCondition(task)
  assert.ok(result)
  assert.equal(result!.classification, 'auth_failed')
})

test('classifyCondition detects reconnect_loop', () => {
  const task = makeTask({
    lastAgentOutput: 'ECONNRESET: connection reset by peer\nsocket hang up',
  })
  const result = classifyCondition(task)
  assert.ok(result)
  assert.equal(result!.classification, 'reconnect_loop')
})

test('classifyCondition detects no_output', () => {
  const task = makeTask({
    lastAgentOutput: '',
    errorMessage: '',
    status: 'running',
  })
  const result = classifyCondition(task)
  assert.ok(result)
  assert.equal(result!.classification, 'no_output')
})

test('classifyCondition returns null for healthy output', () => {
  const task = makeTask({
    lastAgentOutput: 'Working on the task...\nWrote file: src/index.ts',
    errorMessage: '',
  })
  const result = classifyCondition(task)
  assert.equal(result, null)
})

test('classifyCondition ignores failure words quoted in a task prompt', () => {
  const task = makeTask({
    lastAgentOutput: '[Current Message]\nHandle quota exhausted, 429, and auth failure cases.\nReading src/router.ts',
  })
  assert.equal(classifyCondition(task), null)
})

// ── Supervisor behavior tests ────────────────────────────────────────────────

test('repeated model-refresh errors trigger while updatedAt changes', async () => {
  await withTempDb(async () => {
    const now = Date.now()
    state.createTask({
      id: 'stuck-model-refresh',
      agent: { adapter: 'codex' },
      prompt: 'test',
    })
    state.updateTask('stuck-model-refresh', {
      status: 'running',
      startedAt: now - 120_000, // started 2 min ago
      lastAgentOutput: 'failed to refresh available models: timeout waiting for child process to exit',
    })
    // Simulate updatedAt changing (background error refresh) without meaningful progress change
    state.updateTask('stuck-model-refresh', {
      lastAgentOutput: 'failed to refresh available models: timeout waiting for child process to exit\n[12:34:57] retry',
    })

    const events: WsEvent[] = []
    const supervisor = makeSupervisor({ events })

    // First tick: establishes tracker
    await supervisor.tick()
    const task1 = state.getTask('stuck-model-refresh')!
    assert.equal(task1.status, 'running')

    // Wait for staleProgressMs to pass
    await new Promise((r) => setTimeout(r, 1100))

    // Simulate another updatedAt change with same error (just timestamp different)
    state.updateTask('stuck-model-refresh', {
      lastAgentOutput: 'failed to refresh available models: timeout waiting for child process to exit\n[12:34:58] retry',
    })

    // Second tick: should detect stuck and create incident
    await supervisor.tick()

    const incidents = listIncidents()
    assert.equal(incidents.length, 1)
    assert.equal(incidents[0].classification, 'model_unavailable')
    assert.equal(incidents[0].targetId, 'stuck-model-refresh')

    supervisor.dispose()
  })
})

test('silent running task creates a no_output incident after the stale window', async () => {
  await withTempDb(async () => {
    const now = Date.now()
    state.createTask({ id: 'silent-task', agent: { adapter: 'codex' }, prompt: 'test' })
    state.updateTask('silent-task', {
      status: 'running',
      startedAt: now - 120_000,
      lastAgentOutput: '',
    })
    const supervisor = makeSupervisor({})
    await supervisor.tick()
    const incidents = listIncidents()
    assert.equal(incidents.length, 1)
    assert.equal(incidents[0].classification, 'no_output')
    supervisor.dispose()
  })
})

test('changing useful output resets progress time', async () => {
  await withTempDb(async () => {
    const now = Date.now()
    state.createTask({
      id: 'progress-reset',
      agent: { adapter: 'codex' },
      prompt: 'test',
    })
    state.updateTask('progress-reset', {
      status: 'running',
      startedAt: now - 120_000,
      lastAgentOutput: 'failed to refresh available models: timeout waiting for child process to exit',
    })

    const supervisor = makeSupervisor({})

    // First tick: establishes tracker with error output
    await supervisor.tick()

    // Wait past staleProgressMs
    await new Promise((r) => setTimeout(r, 1100))

    // Add useful output BEFORE the next tick
    state.updateTask('progress-reset', {
      lastAgentOutput: 'Working on task...\nWrote file: src/main.ts',
    })

    // Second tick: should NOT detect stuck because progress was reset
    await supervisor.tick()

    const incidents = listIncidents()
    assert.equal(incidents.length, 0, 'No incident should be created when useful output resets progress')

    supervisor.dispose()
  })
})

test('deduplication: same condition does not create second incident', async () => {
  await withTempDb(async () => {
    const now = Date.now()
    state.createTask({
      id: 'dedup-task',
      agent: { adapter: 'codex' },
      prompt: 'test',
    })
    state.updateTask('dedup-task', {
      status: 'running',
      startedAt: now - 120_000,
      lastAgentOutput: 'failed to refresh available models: timeout waiting for child process to exit',
    })

    const supervisor = makeSupervisor({ startHandoff: async () => ({ reason: 'no fallback' }) })

    // First tick
    await supervisor.tick()
    await new Promise((r) => setTimeout(r, 1100))
    await supervisor.tick()

    // Should have 1 incident
    assert.equal(listIncidents().length, 1)

    // Third tick: should NOT create a second incident
    await supervisor.tick()
    assert.equal(listIncidents().length, 1, 'Duplicate incident should not be created')

    supervisor.dispose()
  })
})

test('one remediation only: second tick does not remediate again', async () => {
  await withTempDb(async () => {
    const now = Date.now()
    let stopCallCount = 0
    let handoffCallCount = 0

    state.createTask({
      id: 'remediate-once',
      agent: { adapter: 'codex' },
      prompt: 'test',
    })
    state.updateTask('remediate-once', {
      status: 'running',
      startedAt: now - 120_000,
      lastAgentOutput: 'failed to refresh available models: timeout waiting for child process to exit',
    })

    const supervisor = makeSupervisor({
      stopTask: async (id) => {
        stopCallCount++
        return state.updateTask(id, { status: 'stopped', finishedAt: Date.now() })
      },
      startHandoff: async (source) => {
        handoffCallCount++
        const task = state.createTask({
          id: 'handoff-' + handoffCallCount,
          agent: { adapter: 'claude-code' },
          prompt: 'handoff',
        })
        state.updateTask('handoff-' + handoffCallCount, { status: 'queued' })
        return { task }
      },
    })

    // First tick: establish tracker
    await supervisor.tick()
    await new Promise((r) => setTimeout(r, 1100))

    // Second tick: detect + remediate
    await supervisor.tick()

    assert.equal(stopCallCount, 1, 'stopTask should be called once')
    assert.equal(handoffCallCount, 1, 'startHandoff should be called once')

    const incidents = listIncidents()
    assert.equal(incidents.length, 1)
    assert.equal(incidents[0].status, 'remediated')
    assert.equal(incidents[0].handoffAgent, 'claude-code')

    // Recreate the task as running (simulating a new stuck condition with same id)
    state.updateTask('remediate-once', { status: 'running' })

    // Third tick: should NOT remediate again (cooldown)
    await supervisor.tick()
    assert.equal(stopCallCount, 1, 'stopTask should not be called again during cooldown')
    assert.equal(handoffCallCount, 1, 'startHandoff should not be called again during cooldown')

    supervisor.dispose()
  })
})

test('exclusion of failing agent in handoff', async () => {
  await withTempDb(async () => {
    const now = Date.now()
    let receivedExcludeAdapter = ''

    state.createTask({
      id: 'exclude-task',
      agent: { adapter: 'codex' },
      prompt: 'test',
    })
    state.updateTask('exclude-task', {
      status: 'running',
      startedAt: now - 120_000,
      lastAgentOutput: 'failed to refresh available models: timeout waiting for child process to exit',
    })

    const supervisor = makeSupervisor({
      startHandoff: async (source, excludeAdapter) => {
        receivedExcludeAdapter = excludeAdapter
        const task = state.createTask({
          id: 'handoff-excluded',
          agent: { adapter: 'claude-code' },
          prompt: 'handoff',
        })
        return { task }
      },
    })

    await supervisor.tick()
    await new Promise((r) => setTimeout(r, 1100))
    await supervisor.tick()

    assert.equal(receivedExcludeAdapter, 'codex', 'Failing agent should be excluded from handoff')

    supervisor.dispose()
  })
})

test('no-fallback reporting without loops', async () => {
  await withTempDb(async () => {
    const now = Date.now()
    let handoffCallCount = 0

    state.createTask({
      id: 'no-fallback-task',
      agent: { adapter: 'codex' },
      prompt: 'test',
    })
    state.updateTask('no-fallback-task', {
      status: 'running',
      startedAt: now - 120_000,
      lastAgentOutput: 'failed to refresh available models: timeout waiting for child process to exit',
    })

    const supervisor = makeSupervisor({
      startHandoff: async () => {
        handoffCallCount++
        return { reason: 'No filesystem-capable local CLI agent available (excluding failing agent).' }
      },
    })

    await supervisor.tick()
    await new Promise((r) => setTimeout(r, 1100))
    await supervisor.tick()

    // Should have created a no_fallback incident
    const incidents = listIncidents()
    assert.equal(incidents.length, 1)
    assert.equal(incidents[0].status, 'no_fallback')
    assert.ok(incidents[0].actionOutcome, `Expected action outcome to be set, got: ${incidents[0].actionOutcome}`)

    // Task should be stopped
    const task = state.getTask('no-fallback-task')!
    assert.equal(task.status, 'stopped')

    // Multiple ticks should not loop (no repeated handoff calls)
    await supervisor.tick()
    await supervisor.tick()
    assert.equal(handoffCallCount, 1, 'startHandoff should only be called once (no loop)')

    supervisor.dispose()
  })
})

test('clean timer shutdown: stop and dispose clear the timer', () => {
  const supervisor = makeSupervisor({})
  supervisor.start()
  assert.ok(supervisor.isRunning(), 'Supervisor should be running after start')

  supervisor.stop()
  assert.ok(!supervisor.isRunning(), 'Supervisor should not be running after stop')

  // Start again and dispose
  supervisor.start()
  assert.ok(supervisor.isRunning())
  supervisor.dispose()
  assert.ok(!supervisor.isRunning(), 'Supervisor should not be running after dispose')
})

test('acknowledgeIncident updates status to acknowledged', async () => {
  await withTempDb(async () => {
    state.createOpsIncident({
      id: 'ack-test',
      targetId: 'task-1',
      targetAgent: 'codex',
      classification: 'model_unavailable',
      evidence: 'test evidence',
    })

    const updated = acknowledgeIncident('ack-test')
    assert.ok(updated)
    assert.equal(updated!.status, 'acknowledged')
    assert.ok(updated!.acknowledgedAt)

    // After ack, it should not appear in default list (status filter)
    const all = listIncidents()
    const acked = all.find(i => i.id === 'ack-test')
    assert.equal(acked!.status, 'acknowledged')
  })
})

test('supervisor emits ops:incident WS event on detection', async () => {
  await withTempDb(async () => {
    const now = Date.now()
    const events: WsEvent[] = []

    state.createTask({
      id: 'ws-event-task',
      agent: { adapter: 'codex' },
      prompt: 'test',
    })
    state.updateTask('ws-event-task', {
      status: 'running',
      startedAt: now - 120_000,
      lastAgentOutput: 'failed to refresh available models: timeout waiting for child process to exit',
    })

    const supervisor = makeSupervisor({ events, startHandoff: async () => ({ reason: 'none' }) })

    await supervisor.tick()
    await new Promise((r) => setTimeout(r, 1100))
    await supervisor.tick()

    const incidentEvents = events.filter(e => e.type === 'ops:incident')
    assert.ok(incidentEvents.length >= 1, 'Should emit at least one ops:incident event')

    const incident = incidentEvents[0]
    assert.ok('payload' in incident, 'incident event should have payload')
    const payload = incident.payload as OpsIncident
    assert.equal(payload.classification, 'model_unavailable')
    assert.equal(payload.targetId, 'ws-event-task')

    supervisor.dispose()
  })
})

test('incident timeline: evidence, action, and outcome are persisted', async () => {
  await withTempDb(async () => {
    const now = Date.now()
    state.createTask({
      id: 'timeline-task',
      agent: { adapter: 'codex' },
      prompt: 'test',
    })
    state.updateTask('timeline-task', {
      status: 'running',
      startedAt: now - 120_000,
      lastAgentOutput: '429 rate limit exceeded. Quota exhausted.',
    })

    const supervisor = makeSupervisor({
      startHandoff: async (source) => {
        const task = state.createTask({
          id: 'timeline-handoff',
          agent: { adapter: 'claude-code' },
          prompt: 'handoff',
        })
        return { task }
      },
    })

    await supervisor.tick()
    await new Promise((r) => setTimeout(r, 1100))
    await supervisor.tick()

    const incidents = listIncidents()
    assert.equal(incidents.length, 1)
    const inc = incidents[0]
    assert.equal(inc.classification, 'quota_exhausted')
    assert.ok(inc.evidence.includes('429') || inc.evidence.includes('rate limit'), 'Evidence should contain error text')
    assert.equal(inc.status, 'remediated')
    assert.ok(inc.action, 'Action should be recorded')
    assert.ok(inc.actionOutcome, 'Action outcome should be recorded')
    assert.equal(inc.excludedAgent, 'codex')
    assert.equal(inc.handoffAgent, 'claude-code')
    assert.ok(inc.handoffTaskId, 'Handoff task ID should be recorded')
    assert.ok(inc.remediatedAt, 'Remediated timestamp should be recorded')

    supervisor.dispose()
  })
})
