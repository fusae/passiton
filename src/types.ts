// Core type definitions for Turing

export type SessionStatus = 'active' | 'paused' | 'done' | 'error'

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
}

export interface Session {
  id: string
  from: AgentRef
  to: AgentRef
  status: SessionStatus
  maxRounds: number
  currentRound: number
  approveMode: boolean
  cwd?: string
  createdAt: number
  updatedAt: number
}

export interface SessionWithMessages extends Session {
  messages: Message[]
}

// Adapter interface — one per agent type
export interface Adapter {
  name: string
  config: Record<string, unknown>
  send(session: Session, message: string): Promise<string>
  healthCheck(): Promise<boolean>
}

// Policy configuration
export interface PolicyConfig {
  maxRounds: number
  messageTimeout: number   // ms, default 5 * 60 * 1000
  sessionTimeout: number   // ms, default 2 * 60 * 60 * 1000
  retries: number          // default 1
}

// Agent registration config
export interface AgentConfig {
  adapter: string
  command: string
  args: string[]
  timeout: number
  env?: Record<string, string>
}

// Full app config
export interface AppConfig {
  server: {
    port: number
  }
  agents: Record<string, AgentConfig>
  policy: PolicyConfig
}

// WebSocket event payloads
export type WsEventType =
  | 'session:created'
  | 'session:updated'
  | 'session:done'
  | 'session:error'
  | 'session:paused'
  | 'message:new'
  | 'agent:status'

export interface WsEvent {
  type: WsEventType
  payload: unknown
}

// Policy check result
export interface PolicyResult {
  allowed: boolean
  reason?: 'max_rounds' | 'message_timeout' | 'session_timeout' | 'done' | 'manual'
}
