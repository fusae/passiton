// Ops Supervisor — autonomous background monitor that detects stuck tasks,
// classifies failures, and safely remediates by stopping the stuck task and
// handing off to the next available filesystem-capable local CLI agent.
//
// Key design principles:
// - Tracks "meaningful progress" separately from updatedAt, which is
//   refreshed by background noise/errors that don't advance the task.
// - Deduplicates incidents so the same stuck condition isn't reported twice.
// - Remediation happens at most once per source task / incident / cooldown.
// - Never edits project files, commits, pushes, deletes, or creates
//   repair-code tasks. Only stops + hands off.
// - The configured Ops LLM may enrich unknown diagnosis but must not block
//   supervision.

import { v4 as uuidv4 } from 'uuid'
import * as state from './state.js'
import type {
  Task,
  WsEvent,
  OpsIncident,
  OpsIncidentClassification,
  OpsIncidentStatus,
  OpsSupervisorConfig,
} from './types.js'

// ── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_SUPERVISOR_CONFIG: OpsSupervisorConfig = {
  enabled: true,
  intervalMs: 15_000,
  staleProgressMs: 10 * 60_000,
  cooldownMs: 5 * 60_000,
  maxIncidents: 100,
}

// ── Dependencies injected by server.ts ───────────────────────────────────────

export interface SupervisorDeps {
  stopTask(id: string): Promise<Task>
  startHandoff(source: Task, excludeAdapter: string): Promise<{ task?: Task; reason?: string }>
  emitWsEvent(event: WsEvent): void
}

// ── Progress tracking ────────────────────────────────────────────────────────

interface TaskProgressTracker {
  taskId: string
  lastOutputSignature: string
  lastProgressAt: number
  lastSeenUpdatedAt: number
  consecutiveErrors: number
  lastErrorSignature: string
  errorFirstSeenAt: number
  errorLastSeenAt: number
}

// ── Normalization ────────────────────────────────────────────────────────────

// ANSI escape sequences: SGR, cursor moves, erase, etc.
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][AB0]|\x1b[>=]|\r/g

// ISO 8601 timestamps (2024-01-15T12:34:56.789Z)
const ISO_TS_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g

// Bracketed timestamps [12:34:56] or [12:34:56.789]
const BRACKET_TS_RE = /\[\d{2}:\d{2}:\d{2}(?:\.\d+)?\]/g

// Bare timestamps 12:34:56
const BARE_TS_RE = /\b\d{2}:\d{2}:\d{2}\b/g

// Known background noise lines that should not count as progress.
const NOISE_PATTERNS = [
  /^\s*heartbeat\s*$/i,
  /^\s*ping\s*$/i,
  /^\s*pong\s*$/i,
  /^\s*$/ // blank lines
]

// Lines that indicate a background error refresh, not real progress.
const ERROR_REFRESH_PATTERNS = [
  /failed to refresh available models/i,
  /timeout waiting for child process/i,
  /model.*unavailable/i,
  /rate.?limit/i,
  /quota/i,
  /usage limit/i,
  /insufficient/i,
  /429/,
  /unauthorized/i,
  /forbidden/i,
  /401/,
  /403/,
  /auth.*fail/i,
  /login.*fail/i,
  /reconnect/i,
  /connection.*reset/i,
  /ECONNRESET/,
  /EPIPE/,
  /^<?ts>?.*\bretry(?:ing)?\b/i,
]

/**
 * Normalize agent output to a stable signature for progress comparison.
 * Strips ANSI codes, timestamps, and known noise lines so that repeated
 * equivalent errors (which refresh updatedAt) don't count as progress.
 */
export function normalizeOutput(raw: string): string {
  if (!raw) return ''
  let lines = raw
    .replace(ANSI_RE, '')
    .replace(ISO_TS_RE, '<ts>')
    .replace(BRACKET_TS_RE, '<ts>')
    .replace(BARE_TS_RE, '<ts>')
    .split('\n')

  lines = lines
    .map((line) => line.trimEnd())
    .filter((line) => !NOISE_PATTERNS.some((re) => re.test(line)))

  return lines.join('\n').trim()
}

/**
 * Extract the "signature" — the last N characters of normalized output.
 * This is what we compare across ticks to detect meaningful change.
 */
function outputSignature(normalized: string, maxChars = 2000): string {
  if (normalized.length <= maxChars) return normalized
  return normalized.slice(-maxChars)
}

/**
 * Check whether a normalized output line is a known background-error refresh
 * rather than real task progress.
 */
export function isErrorRefreshLine(line: string): boolean {
  return ERROR_REFRESH_PATTERNS.some((re) => re.test(line))
}

/**
 * Determine whether the output change between ticks is "meaningful" — i.e.,
 * it contains new non-error, non-noise content that suggests the agent is
 * actually doing work.
 */
export function isMeaningfulProgress(oldSig: string, newSig: string): boolean {
  if (newSig === oldSig) return false
  const meaningful = (value: string) => value
    .split('\n')
    .filter((line) => line.trim() !== '' && !isErrorRefreshLine(line))
    .join('\n')
  return meaningful(oldSig) !== meaningful(newSig)
}

function runtimeErrorText(task: Task): string {
  if (task.errorMessage) return task.errorMessage
  return (task.lastAgentOutput || '')
    .split('\n')
    .filter((line) => {
      if (!isErrorRefreshLine(line)) return false
      return /^\s*(?:error|fatal|warn(?:ing)?|failed|reconnecting|\[error\]|[✗×])/i.test(line)
        || /^\s*\{.*"error"\s*:/i.test(line)
        || /^\s*(?:ECONNRESET|EPIPE|socket\s+hang\s+up)\b/i.test(line)
        || /failed to refresh available models/i.test(line)
        || /\b(?:401|403|429)\b.*(?:error|unauthorized|forbidden|rate|quota)/i.test(line)
    })
    .slice(-20)
    .join('\n')
}

// ── Classification ───────────────────────────────────────────────────────────

interface ClassificationResult {
  classification: OpsIncidentClassification
  severity: 'critical' | 'warning'
  evidence: string
}

/**
 * Classify a stuck/error condition based on the task's output and error message.
 * Rules handle known failures; returns null if no known pattern matches.
 */
export function classifyCondition(task: Task): ClassificationResult | null {
  const runtimeText = runtimeErrorText(task)
  const text = runtimeText.toLowerCase()
  const evidence = runtimeText.slice(-500)

  // Repeated Codex model-refresh timeout
  if (/failed to refresh available models.*timeout.*child process|timeout.*child process.*exit|model.*unavailable/i.test(text)) {
    return { classification: 'model_unavailable', severity: 'critical', evidence }
  }

  // Quota / balance / resource exhausted
  if (/quota|usage limit|insufficient|429|rate.?limit|balance/i.test(text)) {
    return { classification: 'quota_exhausted', severity: 'critical', evidence }
  }

  // Auth / login failure
  if (/auth.*fail|login.*fail|unauthorized|forbidden|401|403|invalid.*api.*key|api.*key.*invalid/i.test(text)) {
    return { classification: 'auth_failed', severity: 'critical', evidence }
  }

  // Reconnect / transport loops
  if (/reconnect|connection.*reset|ECONNRESET|EPIPE|transport.*error|socket.*hang\s*up/i.test(text)) {
    return { classification: 'reconnect_loop', severity: 'warning', evidence }
  }

  // No meaningful output at all
  if (!task.lastAgentOutput && !task.errorMessage && task.status === 'running') {
    return { classification: 'no_output', severity: 'warning', evidence: 'No agent output recorded since task started.' }
  }

  return null
}

// ── Supervisor ───────────────────────────────────────────────────────────────

export class OpsSupervisor {
  private timer?: NodeJS.Timeout
  private trackers = new Map<string, TaskProgressTracker>()
  private remediationCooldowns = new Map<string, number>() // taskId → cooldownUntil
  private disposed = false

  constructor(
    private deps: SupervisorDeps,
    private config: OpsSupervisorConfig
  ) {}

  start(): void {
    if (this.timer || this.disposed || !this.config.enabled) return
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        console.error('[ops-supervisor] tick error:', err)
      })
    }, this.config.intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  dispose(): void {
    this.stop()
    this.trackers.clear()
    this.remediationCooldowns.clear()
    this.disposed = true
  }

  isRunning(): boolean {
    return this.timer !== undefined
  }

  /** Exposed for testing: force a single supervision cycle. */
  async tick(): Promise<void> {
    const tasks = state.listTasks({ status: 'running' })
    for (const task of tasks) {
      await this.checkTask(task)
    }
    // Clean up trackers for tasks that are no longer running
    const activeIds = new Set(tasks.map((t) => t.id))
    for (const id of this.trackers.keys()) {
      if (!activeIds.has(id)) this.trackers.delete(id)
    }
    this.pruneIncidents()
  }

  /** Exposed for testing: check a single task. */
  async checkTask(task: Task): Promise<void> {
    const tracker = this.getOrCreateTracker(task)
    const now = Date.now()

    // Update progress tracking
    const normalized = normalizeOutput(task.lastAgentOutput || '')
    const sig = outputSignature(normalized)
    if (isMeaningfulProgress(tracker.lastOutputSignature, sig)) {
      tracker.lastProgressAt = now
      tracker.lastOutputSignature = sig
    } else if (tracker.lastOutputSignature === '' && sig !== '') {
      // First output seen — count as progress
      tracker.lastOutputSignature = sig
      tracker.lastProgressAt = now
    }
    tracker.lastSeenUpdatedAt = task.updatedAt

    // Check for error patterns in output (even while running)
    const outputText = task.lastAgentOutput || ''
    if (isErrorRefreshLine(outputText)) {
      const errorSig = outputSignature(normalizeOutput(outputText), 500)
      if (errorSig !== tracker.lastErrorSignature) {
        tracker.lastErrorSignature = errorSig
        tracker.errorFirstSeenAt = now
      }
      tracker.errorLastSeenAt = now
      tracker.consecutiveErrors++
    } else if (outputText && !isErrorRefreshLine(outputText)) {
      tracker.consecutiveErrors = 0
      tracker.lastErrorSignature = ''
    }

    // Determine if task is stuck
    const stuck = this.isStuck(task, tracker, now)
    if (!stuck) return

    // Classify the condition
    const result = classifyCondition(task)
    if (!result) return

    // Check for existing unacknowledged/unremediated incident (dedup)
    const existing = state.findOpsIncident(task.id, result.classification)
    if (existing && existing.status === 'detected') return

    // Create incident
    const incident = state.createOpsIncident({
      id: uuidv4(),
      userId: task.userId,
      targetId: task.id,
      targetAgent: task.agent.adapter,
      classification: result.classification,
      severity: result.severity,
      evidence: result.evidence,
      detectedAt: now,
    })

    this.emitIncident(incident)

    // Attempt auto-remediation
    await this.attemptRemediation(task, incident)
  }

  private isStuck(task: Task, tracker: TaskProgressTracker, now: number): boolean {
    // No progress for staleProgressMs
    if (now - tracker.lastProgressAt < this.config.staleProgressMs) return false

    return true
  }

  private async attemptRemediation(task: Task, incident: OpsIncident): Promise<void> {
    // Check cooldown
    const cooldownUntil = this.remediationCooldowns.get(task.id) ?? 0
    if (Date.now() < cooldownUntil) return

    // Check if task is still running (may have been stopped manually)
    const current = state.getTask(task.id, task.userId)
    if (!current || current.status !== 'running') return

    // Check if incident is already remediated or acknowledged
    const existing = state.getOpsIncident(incident.id)
    if (!existing || existing.status !== 'detected') return

    const action = `stop_and_handoff`
    const excludeAgent = task.agent.adapter

    try {
      // Step 1: Stop the stuck task
      await this.deps.stopTask(task.id)

      // Step 2: Attempt handoff to next available agent
      const handoffResult = await this.deps.startHandoff(task, excludeAgent)

      const remediatedAt = Date.now()
      this.remediationCooldowns.set(task.id, remediatedAt + this.config.cooldownMs)

      if (handoffResult.task) {
        state.updateOpsIncident(incident.id, {
          status: 'remediated',
          remediatedAt,
          action,
          actionOutcome: `Stopped task and handed off to ${handoffResult.task.agent.adapter}.`,
          excludedAgent: excludeAgent,
          handoffTaskId: handoffResult.task.id,
          handoffAgent: handoffResult.task.agent.adapter,
        })
      } else {
        state.updateOpsIncident(incident.id, {
          status: 'no_fallback',
          remediatedAt,
          action: 'stop_only',
          actionOutcome: handoffResult.reason || 'No fallback agent available; stopped task without handoff.',
          excludedAgent: excludeAgent,
        })
      }

      // Emit updated incident
      const updated = state.getOpsIncident(incident.id)
      if (updated) this.emitIncident(updated)
    } catch (err) {
      const remediatedAt = Date.now()
      this.remediationCooldowns.set(task.id, remediatedAt + this.config.cooldownMs)
      state.updateOpsIncident(incident.id, {
        status: 'no_fallback',
        remediatedAt,
        action: 'stop_failed',
        actionOutcome: `Remediation failed: ${err instanceof Error ? err.message : String(err)}`,
        excludedAgent: excludeAgent,
      })
      const updated = state.getOpsIncident(incident.id)
      if (updated) this.emitIncident(updated)
    }
  }

  private getOrCreateTracker(task: Task): TaskProgressTracker {
    let tracker = this.trackers.get(task.id)
    if (!tracker) {
      const startedAt = task.startedAt ?? task.createdAt
      tracker = {
        taskId: task.id,
        lastOutputSignature: '',
        lastProgressAt: startedAt,
        lastSeenUpdatedAt: task.updatedAt,
        consecutiveErrors: 0,
        lastErrorSignature: '',
        errorFirstSeenAt: 0,
        errorLastSeenAt: 0,
      }
      this.trackers.set(task.id, tracker)
    }
    return tracker
  }

  private emitIncident(incident: OpsIncident): void {
    this.deps.emitWsEvent({
      type: 'ops:incident',
      payload: incident,
    } satisfies WsEvent)
  }

  /** Prune old incidents to stay within maxIncidents. */
  pruneIncidents(): void {
    state.pruneOpsIncidents(this.config.maxIncidents)
  }
}

// ── Helpers for incident status updates ──────────────────────────────────────

export function acknowledgeIncident(incidentId: string): OpsIncident | undefined {
  return state.updateOpsIncident(incidentId, {
    status: 'acknowledged',
    acknowledgedAt: Date.now(),
  })
}

export function listIncidents(filter?: {
  status?: OpsIncidentStatus
  userId?: string
  limit?: number
}): OpsIncident[] {
  return state.listOpsIncidents(filter)
}
