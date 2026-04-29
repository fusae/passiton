// Core type definitions for Turing

export type SessionStatus = 'active' | 'paused' | 'done' | 'error'

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
  from: AgentRef
  to: AgentRef
  status: SessionStatus
  mode: SessionMode
  nextTurn: 'from' | 'to'
  maxRounds: number
  currentRound: number
  approveMode: boolean
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
  dependsOn?: string[]
  status: 'pending' | 'active' | 'done' | 'error'
}

export interface PipelineWithSessions extends Pipeline {
  sessionDetails: Session[]
}

export interface SessionStats {
  total: number
  active: number
  paused: number
  done: number
  error: number
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

export interface RoundMetadata {
  filesModified?: string[]
  commandsRun?: string[]
  duration?: number
  tokenEstimate?: number
}

export interface AdapterResponse {
  content: string
  metadata?: RoundMetadata
}

export interface DiffSnapshot {
  id: string
  sessionId: string
  round: number
  timestamp: number
  diffStat: string
  diffFull: string
}

// Adapter interface — one per agent type
export interface Adapter {
  name: string
  config: Record<string, unknown>
  send(session: Session, message: string, opts?: AdapterSendOpts): Promise<string | AdapterResponse>
  healthCheck(): Promise<boolean>
}

// Options for adapter.send — system prompt and conversation history
export interface AdapterSendOpts {
  systemPrompt?: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  apiKey?: string
  env?: Record<string, string>
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
  status: 'ready' | 'no_key' | 'invalid'
}

export type AgentListResponse = ApiAgentInfo[]

export interface DefaultsConfig {
  maxRounds: number
  mode: SessionMode
}

// Full app config
export interface AppConfig {
  server: {
    port: number
  }
  auth?: {
    jwtSecret?: string
    encryptionKey?: string
  }
  agents: Record<string, AgentConfig>
  defaults: DefaultsConfig
  policy: PolicyConfig
}

// WebSocket event payloads
export type WsEventType =
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
