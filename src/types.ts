// Core type definitions for Turing

export type SessionStatus = 'active' | 'paused' | 'done' | 'error' | 'stopped'
export type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'stopped'
export type PermissionMode = 'safe' | 'trusted'
/**
 * Workflow node types are intentionally open-ended: the engine only treats a
 * node as a generic pipeline step and does not recognize any specific value.
 * Providers register their own node types (e.g. the bundled Dreamina video
 * provider uses 'video_generate'). Two values are conventionally treated by
 * the engine itself:
 *   - 'custom'       — plain agent-driven step (the default)
 *   - 'human_review' — step gated on human approval
 */
export type WorkflowNodeType = string
export const BUILTIN_NODE_TYPES = ['custom', 'human_review'] as const

export interface WorkflowOutputContract {
  fileName: string
  requiredSections?: string[]
}

export interface WorkflowStepContract {
  inputs?: string[]
  outputs?: WorkflowOutputContract[]
}

// Session modes determine the system prompts and interaction style
export type SessionMode = 'collaborate' | 'discuss' | 'review' | 'freeform'

export interface AgentRef {
  adapter: string   // adapter name (e.g. "codex", "claude-code")
  label?: string    // display name
}

export interface Message {
  id: string
  sessionId: string
  from: string      // agent name or "human"
  content: string
  timestamp: number
  round: number
  metadata?: RoundMetadata
}

export interface SessionLog {
  id: string
  sessionId: string
  timestamp: number
  level: 'info' | 'warn' | 'error'
  message: string
}

export interface SessionArtifacts {
  generatedFiles?: string[]
  gitDiffStat?: string
  gitDiffFull?: string
  filesChanged?: Array<{
    path: string
    additions: number
    deletions: number
  }>
  summary?: string
}

export interface SessionContextFile {
  path: string
  content: string
}

export interface SessionContextInput {
  files?: string[]
  rules?: string
  text?: string
}

export interface SessionContext {
  files?: SessionContextFile[]
  rules?: string             // constraints/rules to inject
  text?: string              // free-form background text
}

export interface Session {
  id: string
  userId?: string
  idempotencyKey?: string
  from: AgentRef
  to: AgentRef
  status: SessionStatus
  mode: SessionMode
  nextTurn: 'from' | 'to'
  maxRounds: number
  currentRound: number
  approveMode: boolean
  permissionMode: PermissionMode
  cwd?: string
  context?: SessionContext   // structured context injected every round
  systemPrompts?: {          // per-agent system prompts (generated from mode + context)
    from: string
    to: string
  }
  templateId?: string
  gitSnapshot?: string
  artifacts?: SessionArtifacts
  errorType?: SessionErrorType
  errorMessage?: string
  lastAgentOutput?: string
  errorRound?: number
  resumeCount: number
  createdAt: number
  updatedAt: number
}

export interface SessionWithMessages extends Session {
  messages: Message[]
  versions?: SessionVersion[]
}

export interface Task {
  id: string
  userId?: string
  idempotencyKey?: string
  agent: AgentRef
  prompt: string
  status: TaskStatus
  permissionMode: PermissionMode
  cwd?: string
  context?: SessionContext
  systemPrompt?: string
  output?: string
  result?: string
  errorMessage?: string
  lastAgentOutput?: string
  createdAt: number
  updatedAt: number
  startedAt?: number
  finishedAt?: number
}

export interface Pipeline {
  id: string
  userId?: string
  name: string
  status: 'active' | 'done' | 'error' | 'paused'
  sessions: PipelineStep[]
  createdAt: number
  updatedAt: number
}

export interface PipelineStep {
  sessionId: string
  title?: string
  nodeType?: WorkflowNodeType
  contract?: WorkflowStepContract
  dependsOn?: string[]
  status: 'pending' | 'active' | 'done' | 'error'
}

export interface PipelineTemplateRecordStep {
  title?: string
  nodeType?: WorkflowNodeType
  agent?: AgentRef
  contract?: WorkflowStepContract
  from: AgentRef
  to: AgentRef
  initialPrompt: string
  mode?: SessionMode
  maxRounds?: number
  approveMode?: boolean
  permissionMode?: PermissionMode
  cwd?: string
  outputDir?: string
  context?: SessionContextInput
  dependsOn?: number[]
  manualDone?: boolean
  manualOutput?: string
}

export interface PipelineTemplateRecord {
  id: string
  userId?: string
  name: string
  description?: string
  steps: PipelineTemplateRecordStep[]
  source: 'builtin' | 'user'
  createdAt: number
  updatedAt: number
}

export interface PipelineWithSessions extends Pipeline {
  sessionDetails: SessionWithMessages[]
}

export interface SessionStats {
  total: number
  active: number
  paused: number
  done: number
  completedToday: number
  error: number
  stopped: number
  successRate: number
  avgRounds: number
  avgDurationMs: number
  tokenEstimate: number
}

export interface PipelineStats {
  total: number
  active: number
  paused: number
  done: number
  error: number
}

export interface AgentUsageStats {
  name: string
  sessions: number
  active: number
  done: number
  error: number
  avgRounds: number
}

export interface TuringStats {
  sessions: SessionStats
  pipelines: PipelineStats
  agents: AgentUsageStats[]
}

export type SessionErrorType =
  | 'adapter_timeout'
  | 'adapter_crash'
  | 'network_error'
  | 'policy_stop'
  | 'unknown'

export type AgentErrorCode =
  | 'not_installed'
  | 'auth_required'
  | 'api_key_missing'
  | 'rate_limited'
  | 'timeout'
  | 'unavailable'

export interface RoundMetadata {
  filesModified?: string[]
  commandsRun?: string[]
  duration?: number
  tokenEstimate?: number
}

/**
 * Structured result returned by an adapter's send().
 *
 * `status` lets a capable adapter (API + claude-code) report a native signal
 * the router can trust, instead of parsing the agent's text for markers.
 *   - 'completed' — the model reached a natural stop (end_turn / stop).
 *   - undefined   — unknown (e.g. plain CLI stdout). The router falls back to
 *                   the [DONE] regex / maxRounds, as before.
 */
export type AdapterStatus = 'completed'

export interface AdapterResponse {
  content: string
  metadata?: RoundMetadata
  status?: AdapterStatus
}

export interface DiffSnapshot {
  id: string
  sessionId: string
  round: number
  timestamp: number
  diffStat: string
  diffFull: string
}

export interface SessionVersion {
  id: string
  sessionId: string
  timestamp: number
  round: number
  reason: string
  output?: string
  artifacts?: SessionArtifacts
}

export interface ExternalJob {
  id: string
  sessionId: string
  /** Provider name — arbitrary string, matches ExternalTaskProvider.name (e.g. 'dreamina'). */
  provider: string
  externalId: string
  status: 'querying' | 'done' | 'error' | 'stopped'
  downloadDir: string
  resultPaths?: string[]
  errorMessage?: string
  createdAt: number
  updatedAt: number
}

/**
 * Result returned by an ExternalTaskProvider when it polls its remote task.
 *   - 'querying' → still running, poll again later
 *   - 'success'  → finished, deliver resultPaths
 *   - 'error'    → failed, surface errorMessage
 */
export interface ExternalTaskQueryResult {
  status: 'querying' | 'success' | 'error'
  paths?: string[]
  errorMessage?: string
}

/**
 * Pluggable external-task provider. The engine stays free of any specific
 * vendor (Dreamina etc.) — it only knows how to talk to registered providers.
 *
 * A provider participates in two flows:
 *   1. Inline detection — after each agent round, parseAgentOutput() inspects
 *      the agent's free text and may surface a pending external job (e.g. an
 *      agent emitting a `submit_id`).
 *   2. Pipeline step takeover — handlePipelineStep() fully owns a pipeline
 *      step whose nodeType is in handledNodeTypes, bypassing the adapter run
 *      loop entirely.
 */
export interface ExternalTaskProvider {
  /** Unique provider name; stored on ExternalJob.provider. */
  name: string
  /** Pipeline nodeTypes this provider fully owns (e.g. ['video_generate']). */
  handledNodeTypes: string[]
  /** Inspect agent output and, if present, return the pending job descriptor. */
  parseAgentOutput: (content: string, session: Pick<Session, 'cwd'>) =>
    { externalId: string; downloadDir: string } | undefined
  /** Submit a fresh job and return the raw stdout (provider parses submit_id). */
  submit: (args: string[], cwd?: string) => Promise<string>
  /** Poll a submitted job for its current status. */
  query: (externalId: string, downloadDir: string) => Promise<ExternalTaskQueryResult>
  /** Default poll interval; overrides per-job if returned. */
  pollIntervalMs?: number
  /** Take over a pipeline step (e.g. read a plan file, submit, and chain completion). */
  handlePipelineStep?: (hooks: RouterExternalTaskHooks, sessionId: string) => Promise<void>
}

/**
 * The limited surface the Router exposes to providers so they can drive
 * sessions and pipelines without touching Router internals directly.
 */
export interface RouterExternalTaskHooks {
  /** Emit a structured event + log entry; also stored in session log table. */
  emitLog: (level: 'info' | 'warn' | 'error', message: string, sessionId: string) => void
  /** Record an assistant-style message on the session. */
  recordMessage: (sessionId: string, from: string, content: string, round: number) => void
  /** Patch session fields (status, currentRound, lastAgentOutput, ...). */
  updateSession: (sessionId: string, patch: Record<string, unknown>) => void
  /** Mark the session errored with the given cause. */
  markError: (sessionId: string, err: unknown) => void
  /** Mark the session done and emit session:done / pipeline finished events. */
  completeSession: (sessionId: string) => Promise<void>
  /** Read session by id. */
  getSession: (sessionId: string) => Session | undefined
  /** Read the pipeline that contains a session (if any). */
  getPipelineBySession: (sessionId: string) => Pipeline | undefined
  /** Read external jobs of a given status. */
  listExternalJobs: (status: ExternalJob['status']) => ExternalJob[]
  /** Create or replace an external job row keyed by (provider, externalId). */
  upsertExternalJob: (job: ExternalJob) => ExternalJob
  /** Patch an external job row. */
  updateExternalJob: (provider: string, externalId: string, patch: Partial<ExternalJob>) => void
  /** Cancel all timers + mark querying jobs for a session as stopped. */
  stopExternalJobsForSession: (sessionId: string) => void
  /** Schedule the next poll for an external job (debounced by job id). */
  scheduleExternalJobPoll: (job: ExternalJob, delayMs?: number) => void
}

export interface AdapterCapabilities {
  tools: boolean
  fileSystem: boolean
  shell: boolean
  imageGeneration?: boolean
}

// Adapter interface — one per agent type
export interface Adapter {
  name: string
  config: Record<string, unknown>
  capabilities?: AdapterCapabilities
  send(session: Session, message: string, opts?: AdapterSendOpts): Promise<string | AdapterResponse>
  healthCheck(): Promise<boolean>
}

// Options for adapter.send — system prompt and conversation history
export interface AdapterSendOpts {
  systemPrompt?: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  apiKey?: string
  env?: Record<string, string>
  signal?: AbortSignal
  onOutput?: (line: string) => void
  getTimeoutExtensionMs?: () => number
}

export interface HeartbeatPayload {
  sessionId: string
  round: number
  agent: string
  status: 'running'
  elapsed: number
  lastOutput: string
}

// Policy configuration
export interface PolicyConfig {
  maxRounds: number
  messageTimeout: number   // ms, default 5 * 60 * 1000
  messageRetentionMs: number // ms, default 30 days, 0 disables GC
  sessionTimeout: number   // ms, default 2 * 60 * 60 * 1000
  retries: number          // default 1
  /** Max concurrently-running background tasks. 0 = unlimited. Prevents
   *  spawning dozens of agent subprocesses at once when many tasks are queued. */
  maxConcurrentTasks?: number // default 3
  allowedWorkspaces?: string[] // empty means unrestricted
}

// Agent registration config
export interface AgentConfig {
  adapter: string
  command?: string
  args?: string[]
  timeout?: number
  model?: string
  apiKey?: string
  baseUrl?: string
  env?: Record<string, string>
}

export interface ApiAgentInfo {
  name: string
  adapter: string
  model?: string
  provider: string
  baseUrl?: string
  hasKey: boolean
  keyMasked?: string
  status: 'ready' | 'no_key' | 'invalid' | 'discovered' | 'unverified'
  kind?: 'api' | 'local'
  source?: 'configured' | 'discovered'
  command?: string
  args?: string[]
  timeout?: number
  env?: Record<string, string>
  version?: string
}

export type AgentListResponse = ApiAgentInfo[]

export interface DefaultsConfig {
  maxRounds: number
  mode: SessionMode
}

export interface FeatureConfig {
  localCliAgents: boolean
}

// Full app config
export interface AppConfig {
  server: {
    port: number
    host?: string
  }
  auth?: {
    jwtSecret?: string
    encryptionKey?: string
    allowRegistration?: boolean
    localAccess?: boolean
    localUserEmail?: string
  }
  agents: Record<string, AgentConfig>
  defaults: DefaultsConfig
  features: FeatureConfig
  policy: PolicyConfig
}

// WebSocket event payloads
export type WsEventType =
  | 'task:created'
  | 'task:updated'
  | 'task:done'
  | 'task:error'
  | 'session:created'
  | 'session:updated'
  | 'session:done'
  | 'session:error'
  | 'session:paused'
  | 'session:resumed'
  | 'session:deleted'
  | 'pipeline:created'
  | 'pipeline:updated'
  | 'pipeline:done'
  | 'pipeline:error'
  | 'message:new'
  | 'message:delta'
  | 'message:step'
  | 'snapshot:new'
  | 'agent:status'
  | 'heartbeat'
  | 'log'

export interface StandardWsEvent {
  type: WsEventType
  payload: unknown
}

export interface HeartbeatWsEvent extends HeartbeatPayload {
  type: 'heartbeat'
}

export type WsEvent = StandardWsEvent | HeartbeatWsEvent

// Policy check result
export interface PolicyResult {
  allowed: boolean
  reason?: 'max_rounds' | 'message_timeout' | 'session_timeout' | 'done' | 'manual'
}
