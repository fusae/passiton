// Server module — HTTP + WebSocket

import http from 'http'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { promisify } from 'util'
import { fileURLToPath } from 'url'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import type { AgentCatalog } from './agents.js'
import { createAdapter, createDiscoveredAgentConfig, registerBuiltinAdapters, registerConfiguredAdapters, registerUserConfiguredAdapters } from './adapters/factory.js'
import {
  AuthError,
  authCookie,
  authenticateRequest,
  createUserToken,
  listUserTokens,
  loginLocalUser,
  loginUser,
  registerUser,
  revokeUserToken,
  type AuthUser,
} from './auth.js'
import { activeAgents, getConfigPath, loadConfig, writeConfig } from './config.js'
import { KeyVaultError, decryptKey, decryptSecret, deleteKey, encryptSecret, listKeys, maskAgentKey, storeKey } from './keyvault.js'
import type { Router } from './router.js'
import * as state from './state.js'
import type { AdapterResponse, AgentConfig, AgentListResponse, ApiAgentInfo, AppConfig, Pipeline, PipelineTemplateRecord, PipelineWithSessions, AgentRef, Message, Session, SessionMode, SessionContext, SessionContextInput, Task, TaskStatus, WsEvent, WorkflowNodeType } from './types.js'
import { pipelineTemplates, templates } from './templates.js'
import { resolveWorkspacePath, validateAllowedWorkspaces, WorkspaceAccessError } from './workspace.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_DIR = path.join(__dirname, 'web')
const MAX_BODY_SIZE = 1024 * 1024
const MAX_FILE_PREVIEW_SIZE = 1024 * 1024
const MAX_IMAGE_FILE_PREVIEW_SIZE = 10 * 1024 * 1024
const WS_HEARTBEAT_MS = 30_000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Responses smaller than this are not compressed (overhead outweighs savings).
const COMPRESS_MIN_BYTES = 1024
// Responses larger than this are served uncompressed to avoid memory spikes
// from holding both the original and compressed buffer simultaneously.
const COMPRESS_MAX_BYTES = 4 * 1024 * 1024
// Static text extensions eligible for gzip/deflate compression.
const COMPRESSIBLE_EXT = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.md'])
// Maximum number of entries retained in the static-asset cache.
const STATIC_CACHE_MAX = 64
const HANDOFF_OUTPUT_TAIL_CHARS = 4000
const DEFAULT_OPS_MODEL_AGENT_NAME = '__ops__'
const API_ADAPTERS = new Set(['anthropic-api', 'openai-api', 'zhipu-api', 'deepseek-api', 'qwen-api', 'moonshot-api', 'custom-api'])
const LOCAL_CLI_ADAPTERS = new Set([
  'claude-code', 'codex', 'gemini-cli', 'opencode', 'copilot-cli', 'cursor-agent',
  'qwen-code', 'cline', 'aider', 'droid', 'amp', 'openhands', 'mistral-vibe', 'custom-cli',
])
const PROVIDER_BY_ADAPTER: Record<string, string> = {
  'anthropic-api': 'Anthropic',
  'openai-api': 'OpenAI',
  'zhipu-api': 'Zhipu',
  'deepseek-api': 'DeepSeek',
  'qwen-api': 'Qwen',
  'moonshot-api': 'Moonshot',
  'custom-api': 'Custom',
}
const DEFAULT_BASE_URLS: Record<string, string> = {
  'anthropic-api': 'https://api.anthropic.com/v1/messages',
  'openai-api': 'https://api.openai.com/v1/chat/completions',
  'zhipu-api': 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  'deepseek-api': 'https://api.deepseek.com/chat/completions',
  'qwen-api': 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  'moonshot-api': 'https://api.moonshot.cn/v1/chat/completions',
}
const API_SMOKE_TIMEOUT_MS = 15_000
const API_SMOKE_CACHE_TTL_MS = 10 * 60_000
const CORS_ALLOWED_METHODS = 'GET,POST,PUT,DELETE,OPTIONS'
const CORS_ALLOWED_HEADERS = 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version'
const CORS_EXPOSE_HEADERS = 'Mcp-Session-Id'

type ProviderKeyInfo = {
  id: string
  provider: state.StoredApiKeyRecord['provider']
  name: string
  maskedKey: string
  createdAt: number
  source: 'vault' | 'assistant' | 'global'
  usedBy?: string[]
  readOnly?: boolean
}

type JsonRpcId = string | number | null
type JsonRpcRequest = {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: unknown
}

type McpTool = {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
}

type McpContext = {
  router: Router
  agentCatalog: AgentCatalog
  authUser: AuthUser
}

type OpsTarget = {
  kind?: 'task' | 'session' | 'workflow'
  id?: string
}

type OpsPageContext = {
  path?: string
  title?: string
  summary?: string
  visibleText?: string
}

type OpsIssue = {
  severity: 'critical' | 'warning' | 'info'
  title: string
  detail: string
  recommendation: string
  target?: Required<OpsTarget>
  actions?: OpsAction[]
}

type ApiSmokeResult = {
  ok: boolean
  checkedAt: number
  error?: string
}

const apiSmokeCache = new Map<string, ApiSmokeResult>()

type OpsAction = {
  id: 'stop_task' | 'rerun_task' | 'resume_session' | 'rerun_workflow_step' | 'create_repair_task'
  label: string
  description: string
  target: Required<OpsTarget>
  risk: 'low' | 'medium' | 'high'
  requiresConfirmation: boolean
}

type OpsModelResponse = {
  configured: boolean
  effective?: 'dedicated' | 'fallback'
  name?: string
  adapter?: string
  model?: string
  provider?: string
  baseUrl?: string
  hasKey?: boolean
  keyMasked?: string
  status?: ApiAgentInfo['status']
  error?: string
  checkedAt?: number
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

// Pick the best supported compression encoding for a request. Returns
// 'gzip' | 'deflate' | undefined (none / not acceptable).
function pickEncoding(req: http.IncomingMessage): 'gzip' | 'deflate' | undefined {
  const accept = String(req.headers['accept-encoding'] ?? '')
  if (!accept) return undefined
  // gzip is universally supported and slightly better than deflate; prefer it.
  if (/\bgzip\b/i.test(accept)) return 'gzip'
  if (/\bdeflate\b/i.test(accept)) return 'deflate'
  return undefined
}

// Async compression helpers — never block the event loop.
const gzipAsync = promisify(zlib.gzip)
const deflateAsync = promisify(zlib.deflate)

async function compressBuffer(buf: Buffer, encoding: 'gzip' | 'deflate'): Promise<Buffer> {
  return encoding === 'gzip' ? gzipAsync(buf) : deflateAsync(buf)
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

// JSON response with optional gzip/deflate compression for large payloads.
// Used by endpoints that can return sizable JSON (session/pipeline detail,
// list endpoints). Falls back to an uncompressed response when the payload is
// small, too large, or the client does not advertise a supported encoding.
async function sendJson(req: http.IncomingMessage, res: http.ServerResponse, status: number, data: unknown): Promise<void> {
  const buf = Buffer.from(JSON.stringify(data), 'utf-8')
  const headers: Record<string, string | number> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Vary: 'Accept-Encoding',
  }
  const encoding =
    buf.length >= COMPRESS_MIN_BYTES && buf.length <= COMPRESS_MAX_BYTES
      ? pickEncoding(req)
      : undefined
  if (encoding) {
    const compressed = await compressBuffer(buf, encoding)
    headers['Content-Encoding'] = encoding
    headers['Content-Length'] = compressed.length
    res.writeHead(status, headers)
    res.end(compressed)
  } else {
    headers['Content-Length'] = buf.length
    res.writeHead(status, headers)
    res.end(buf)
  }
}

function configureCors(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const origin = req.headers.origin
  if (typeof origin !== 'string') return true
  if (!isAllowedCorsOrigin(origin)) return false
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', CORS_ALLOWED_METHODS)
  res.setHeader('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS)
  res.setHeader('Access-Control-Expose-Headers', CORS_EXPOSE_HEADERS)
  return true
}

function isAllowedCorsOrigin(origin: string): boolean {
  const configured = parseAllowedCorsOrigins(process.env.PASSITON_ALLOWED_ORIGINS ?? process.env.TURING_ALLOWED_ORIGINS)
  if (configured.has(origin)) return true
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  } catch {
    return false
  }
}

function parseAllowedCorsOrigins(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(',').map((item) => item.trim()).filter(Boolean))
}

function isHttpsRequest(req: http.IncomingMessage): boolean {
  const forwardedProto = req.headers['x-forwarded-proto']
  if (typeof forwardedProto === 'string') {
    return forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https'
  }
  return Boolean((req.socket as { encrypted?: boolean }).encrypted)
}

function setAuthCookie(req: http.IncomingMessage, res: http.ServerResponse, token: string): void {
  res.setHeader('Set-Cookie', authCookie(token, { secure: isHttpsRequest(req) }))
}

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (Buffer.byteLength(body) > MAX_BODY_SIZE) {
        reject(new HttpError(413, `Request body too large (max ${MAX_BODY_SIZE} bytes)`))
        req.destroy()
      }
    })
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}) }
      catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function parseAuthBody(body: unknown): { email: string; password: string } {
  const data = requireRecord(body, 'body')
  const email = requireNonEmptyString(data.email, 'email').toLowerCase()
  const password = requireNonEmptyString(data.password, 'password')
  if (!EMAIL_RE.test(email)) {
    throw new HttpError(400, 'Invalid email')
  }
  if (password.length < 8) {
    throw new HttpError(400, 'Password must be at least 8 characters')
  }
  return { email, password }
}

function parseTokenBody(body: unknown): { name?: string } {
  const data = requireRecord(body, 'body')
  return {
    name: optionalString(data.name, 'name'),
  }
}

function parseApiKeyBody(body: unknown): { provider: string; key: string; name?: string } {
  const data = requireRecord(body, 'body')
  const provider = requireNonEmptyString(data.provider, 'provider').toLowerCase()
  if (provider !== 'anthropic' && provider !== 'openai' && provider !== 'deepseek' && provider !== 'zhipu' && provider !== 'qwen' && provider !== 'moonshot') {
    throw new HttpError(400, '"provider" must be one of anthropic, openai, deepseek, zhipu, qwen, moonshot')
  }
  return {
    provider,
    name: optionalString(data.name, 'name'),
    key: requireNonEmptyString(data.key, 'key'),
  }
}

// In-memory cache for static files. Keyed by resolved path; entries are
// invalidated automatically when mtime changes, so rebuilds between deploys
// always serve fresh content while repeated requests skip disk entirely.
// Bounded to STATIC_CACHE_MAX entries via simple LRU reinsertion.
interface StaticCacheEntry {
  mtimeMs: number
  size: number
  content: Buffer
  etag: string
}
const staticCache = new Map<string, StaticCacheEntry>()

function readStaticCached(resolvedPath: string): StaticCacheEntry | undefined {
  const cached = staticCache.get(resolvedPath)
  let stat: fs.Stats
  try {
    stat = fs.statSync(resolvedPath)
  } catch {
    if (cached) staticCache.delete(resolvedPath)
    return undefined
  }
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    // Promote to most-recently-used.
    staticCache.delete(resolvedPath)
    staticCache.set(resolvedPath, cached)
    return cached
  }
  const content = fs.readFileSync(resolvedPath)
  const entry: StaticCacheEntry = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    content,
    etag: `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`,
  }
  staticCache.set(resolvedPath, entry)
  // Evict oldest entries when the cache exceeds its bound.
  while (staticCache.size > STATIC_CACHE_MAX) {
    const oldest = staticCache.keys().next().value
    if (oldest === undefined) break
    staticCache.delete(oldest)
  }
  return entry
}

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, filePath: string): Promise<void> {
  const resolvedPath = path.resolve(filePath)
  if (resolvedPath !== WEB_DIR && !resolvedPath.startsWith(`${WEB_DIR}${path.sep}`)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  const ext = path.extname(filePath)
  const mime = MIME[ext] ?? 'application/octet-stream'
  const entry = readStaticCached(resolvedPath)
  if (!entry) {
    res.writeHead(404)
    res.end('Not found')
    return
  }

  // Conditional GET: serve 304 when the client's cached copy is fresh.
  // `must-revalidate` keeps correctness across rebuilds (ETag changes when
  // the file changes) while eliminating the body transfer on repeat hits.
  if (req.headers['if-none-match'] === entry.etag) {
    res.writeHead(304, { ETag: entry.etag, 'Cache-Control': 'public, max-age=0, must-revalidate' })
    res.end()
    return
  }

  const headers: Record<string, string | number> = {
    'Content-Type': mime,
    'Cache-Control': 'public, max-age=0, must-revalidate',
    ETag: entry.etag,
    Vary: 'Accept-Encoding',
  }

  // Check compression eligibility (type + size thresholds).
  const shouldCompress =
    COMPRESSIBLE_EXT.has(ext) &&
    entry.content.length >= COMPRESS_MIN_BYTES &&
    entry.content.length <= COMPRESS_MAX_BYTES
  const encoding = shouldCompress ? pickEncoding(req) : undefined

  if (encoding) {
    const compressed = await compressBuffer(entry.content, encoding)
    headers['Content-Encoding'] = encoding
    headers['Content-Length'] = compressed.length
    res.writeHead(200, headers)
    // HEAD requests receive headers but no body.
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(compressed)
    return
  }

  headers['Content-Length'] = entry.content.length
  res.writeHead(200, headers)
  // HEAD requests receive headers but no body.
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  res.end(entry.content)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new HttpError(400, `"${field}" must be an object`)
  }
  return value
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, `"${field}" must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, `"${field}" must be a string`)
  }
  return value
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'boolean') {
    throw new HttpError(400, `"${field}" must be a boolean`)
  }
  return value
}

function optionalPositiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new HttpError(400, `"${field}" must be a positive integer`)
  }
  return value
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new HttpError(400, `"${field}" must be a non-empty string array`)
  }
  return value
}

function optionalPort(value: unknown, field: string): number | undefined {
  const port = optionalPositiveInt(value, field)
  if (port !== undefined && port > 65535) {
    throw new HttpError(400, `"${field}" must be between 1 and 65535`)
  }
  return port
}

function requireSessionMode(value: unknown, field: string): SessionMode {
  const mode = parseSessionMode(value)
  if (!mode) {
    throw new HttpError(400, `"${field}" is required`)
  }
  return mode
}

function parseEnv(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  const env = requireRecord(value, field)
  const parsed: Record<string, string> = {}
  for (const [key, envValue] of Object.entries(env)) {
    const trimmedKey = key.trim()
    if (!trimmedKey) {
      throw new HttpError(400, `"${field}" cannot contain empty keys`)
    }
    parsed[trimmedKey] = requireNonEmptyString(envValue, `${field}.${key}`)
  }
  return parsed
}

function parseGlobalConfigBody(body: unknown): { maxRounds: number; mode: SessionMode; port: number; allowedWorkspaces?: string[] } {
  const data = requireRecord(body, 'body')
  const defaults = isRecord(data.defaults) ? data.defaults : data
  const server = isRecord(data.server) ? data.server : data
  const policy = isRecord(data.policy) ? data.policy : data

  return {
    maxRounds: optionalPositiveInt(defaults.maxRounds, 'defaults.maxRounds') ?? optionalPositiveInt(data.maxRounds, 'maxRounds') ?? 20,
    mode: requireSessionMode(defaults.mode ?? data.mode, 'defaults.mode'),
    port: optionalPort(server.port, 'server.port') ?? optionalPort(data.port, 'port') ?? portDefault(),
    allowedWorkspaces: optionalStringArray(policy.allowedWorkspaces, 'policy.allowedWorkspaces'),
  }
}

function portDefault(): number {
  return loadConfig().server.port
}

function parseAgentConfigBody(body: unknown, existing?: AgentConfig): { name: string; config: AgentConfig } {
  const data = requireRecord(body, 'body')
  const name = requireNonEmptyString(data.name, 'name')
  const adapter = requireNonEmptyString(data.adapter, 'adapter')
  const command = requireNonEmptyString(data.command, 'command')
  if (!LOCAL_CLI_ADAPTERS.has(adapter)) {
    throw new HttpError(400, `"adapter" must be one of ${Array.from(LOCAL_CLI_ADAPTERS).join(', ')}`)
  }
  const env = parseEnv(data.env, 'env')
  const priority = optionalAgentPriority(data.priority)
  if (adapter === 'custom-cli') {
    const args = requireStringArray(data.args, 'args')
    if (!args.some((arg) => arg.includes('{prompt}'))) {
      throw new HttpError(400, '"args" must include the {prompt} token for custom-cli')
    }
    const timeout = optionalPositiveInt(data.timeout, 'timeout')
      ?? (existing && existing.adapter === adapter ? existing.timeout : 300_000)
    return {
      name,
      config: {
        adapter: 'custom-cli',
        command,
        args,
        timeout,
        ...(priority !== undefined ? { priority } : existing?.priority !== undefined ? { priority: existing.priority } : {}),
        ...(env && Object.keys(env).length > 0 ? { env } : {}),
      },
    }
  }
  const defaults = createDiscoveredAgentConfig(adapter, command)
  if (!defaults) {
    throw new HttpError(400, `"adapter" must be one of ${Array.from(LOCAL_CLI_ADAPTERS).join(', ')}`)
  }

  const args = data.args === undefined
    ? (existing && existing.adapter === adapter ? existing.args : defaults.args)
    : requireStringArray(data.args, 'args')
  const timeout = optionalPositiveInt(data.timeout, 'timeout')
    ?? (existing && existing.adapter === adapter ? existing.timeout : defaults.timeout)
  const inheritedEnv = existing && existing.adapter === adapter ? existing.env : defaults.env
  const finalEnv = env ?? inheritedEnv
  return {
    name,
      config: {
        ...defaults,
        args,
        timeout,
        ...(existing?.autoDiscovered ? { autoDiscovered: true } : {}),
        ...(existing?.lastVerifiedAt !== undefined ? { lastVerifiedAt: existing.lastVerifiedAt } : {}),
        ...(existing?.lastVerifiedVersion !== undefined ? { lastVerifiedVersion: existing.lastVerifiedVersion } : {}),
        ...(existing?.lastVerificationAttemptAt !== undefined ? { lastVerificationAttemptAt: existing.lastVerificationAttemptAt } : {}),
        ...(existing?.lastVerificationError !== undefined ? { lastVerificationError: existing.lastVerificationError } : {}),
        ...(priority !== undefined ? { priority } : existing?.priority !== undefined ? { priority: existing.priority } : {}),
      model: existing && existing.adapter === adapter ? existing.model : defaults.model,
      command,
      ...(finalEnv && Object.keys(finalEnv).length > 0 ? { env: finalEnv } : {}),
    },
  }
}

function optionalAgentPriority(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new HttpError(400, '"priority" must be a positive integer; lower = higher priority (1 is first choice)')
  }
  return value
}

function parseApiAgentConfigBody(body: unknown, existing?: state.UserAgentRecord): {
  name: string
  adapter: string
  keyId?: string
  model?: string
  baseUrl?: string
  timeout?: number
} {
  const data = requireRecord(body, 'body')
  const name = optionalString(data.name, 'name') ?? existing?.name ?? ''
  if (!name) throw new HttpError(400, '"name" must be a non-empty string')
  const adapter = requireNonEmptyString(data.adapter ?? existing?.adapter, 'adapter')
  if (!API_ADAPTERS.has(adapter)) {
    throw new HttpError(400, '"adapter" must be one of anthropic-api, openai-api, zhipu-api, deepseek-api, qwen-api, moonshot-api, custom-api')
  }
  const baseUrl = optionalString(data.baseUrl, 'baseUrl') ?? existing?.baseUrl
  if (adapter === 'custom-api' && !baseUrl) {
    throw new HttpError(400, '"baseUrl" is required for custom-api')
  }
  return {
    name,
    adapter,
    keyId: optionalString(data.keyId, 'keyId'),
    model: optionalString(data.model, 'model') ?? existing?.model,
    baseUrl,
    timeout: optionalPositiveInt(data.timeout, 'timeout') ?? existing?.timeout,
  }
}

function parseOpsModelConfigBody(body: unknown, existing?: state.UserAgentRecord): {
  adapter: string
  apiKey?: string
  model?: string
  baseUrl?: string
  timeout?: number
} {
  const data = requireRecord(body, 'body')
  const adapter = normalizeApiAdapter(requireNonEmptyString(data.adapter ?? existing?.adapter, 'adapter'))
  if (!API_ADAPTERS.has(adapter)) {
    throw new HttpError(400, '"adapter" must be one of anthropic, openai, zhipu, deepseek, qwen, moonshot, custom')
  }
  const baseUrl = optionalString(data.baseUrl, 'baseUrl') ?? existing?.baseUrl
  if (adapter === 'custom-api' && !baseUrl) {
    throw new HttpError(400, '"baseUrl" is required for custom')
  }
  const apiKey = optionalString(data.apiKey ?? data.key, 'apiKey')
  if (!apiKey && !existing?.encryptedKey) {
    throw new HttpError(400, '"apiKey" is required')
  }
  return {
    adapter,
    apiKey,
    model: optionalString(data.model, 'model') ?? existing?.model,
    baseUrl,
    timeout: optionalPositiveInt(data.timeout, 'timeout') ?? existing?.timeout,
  }
}

function normalizeApiAdapter(value: string): string {
  if (API_ADAPTERS.has(value)) return value
  const aliases: Record<string, string> = {
    anthropic: 'anthropic-api',
    openai: 'openai-api',
    zhipu: 'zhipu-api',
    deepseek: 'deepseek-api',
    qwen: 'qwen-api',
    moonshot: 'moonshot-api',
    custom: 'custom-api',
  }
  return aliases[value] ?? value
}

function agentNameFromPath(pathname: string): string | undefined {
  const match = pathname.match(/^\/api\/config\/agents\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : undefined
}

function sessionDisplayTitle(session: Session): string {
  const pipeline = state.getPipelineBySession(session.id, session.userId)
  const stepTitle = pipeline?.sessions.find((step) => step.sessionId === session.id)?.title?.trim()
  if (stepTitle) return stepTitle

  const initial = state.getMessages(session.id).find((msg) => msg.from === 'human' && msg.round === 0)?.content ?? ''
  const firstLine = initial
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  if (firstLine) {
    return compactSessionTitle(firstLine)
  }
  return `${agentLabel(session.from)} → ${agentLabel(session.to)}`
}

function sessionDisplayTitleBatch(session: Session, stepTitles: Map<string, string>, firstMessages: Map<string, string>): string {
  const stepTitle = stepTitles.get(session.id)?.trim()
  if (stepTitle) return stepTitle

  const initial = firstMessages.get(session.id) ?? ''
  const firstLine = initial
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  if (firstLine) {
    return compactSessionTitle(firstLine)
  }
  return `${agentLabel(session.from)} → ${agentLabel(session.to)}`
}

function agentLabel(ref: AgentRef): string {
  return ref.label ?? ref.adapter
}

function compactSessionTitle(line: string): string {
  const quotedStep = line.match(/[“"]([^”"]{2,40})[”"]/)?.[1]?.trim()
  if (quotedStep) return quotedStep
  const beforeColon = line.match(/^([^:：]{2,40})[:：]/)?.[1]?.trim()
  if (beforeColon) return beforeColon
  return line.length > 56 ? `${line.slice(0, 56)}...` : line
}

function sessionForClient(session: Session): Session & { displayTitle: string } {
  return {
    ...session,
    displayTitle: sessionDisplayTitle(session),
  }
}

function sessionsForClient(sessions: Session[]): Array<Pick<Session,
  | 'id'
  | 'userId'
  | 'from'
  | 'to'
  | 'status'
  | 'mode'
  | 'nextTurn'
  | 'maxRounds'
  | 'currentRound'
  | 'approveMode'
  | 'permissionMode'
  | 'cwd'
  | 'templateId'
  | 'errorType'
  | 'errorRound'
  | 'errorMessage'
  | 'lastAgentOutput'
  | 'resumeCount'
  | 'createdAt'
  | 'updatedAt'
> & { displayTitle: string }> {
  const ids = sessions.map((s) => s.id)
  const stepTitles = state.getPipelineStepTitles(ids)
  const firstMessages = state.getFirstHumanMessages(ids)
  return sessions.map((session) => ({
    id: session.id,
    userId: session.userId,
    from: session.from,
    to: session.to,
    status: session.status,
    mode: session.mode,
    nextTurn: session.nextTurn,
    maxRounds: session.maxRounds,
    currentRound: session.currentRound,
    approveMode: session.approveMode,
    permissionMode: session.permissionMode,
    cwd: session.cwd,
    templateId: session.templateId,
    errorType: session.errorType,
    errorRound: session.errorRound,
    errorMessage: truncateText(session.errorMessage, 500),
    lastAgentOutput: truncateText(session.lastAgentOutput, 500),
    resumeCount: session.resumeCount,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    displayTitle: sessionDisplayTitleBatch(session, stepTitles, firstMessages),
  }))
}

async function reloadAgents(router: Router, agentCatalog: AgentCatalog, config: AppConfig): Promise<void> {
  const agents = activeAgents(config)
  router.clearAdapters()
  agentCatalog.setLocalCliAgentsEnabled(true)
  agentCatalog.setConfiguredAgents(agents)
  await agentCatalog.discover()
  registerConfiguredAdapters(router, agentCatalog.configuredAgentConfigs())
  registerBuiltinAdapters(router)
}

function tryDecryptUserAgentKey(record: state.UserAgentRecord): { key?: string; error?: string } {
  if (!record.encryptedKey || !record.iv || !record.authTag) return {}
  try {
    return { key: decryptSecret({ userId: record.userId, encryptedKey: record.encryptedKey, iv: record.iv, authTag: record.authTag }) }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

function decryptUserAgentKey(record: state.UserAgentRecord): string | undefined {
  return tryDecryptUserAgentKey(record).key
}

const DECRYPT_MISMATCH_HINT = 'encryption key mismatch — was the database copied from another machine?'

function opsModelAgentName(): string {
  return loadConfig().ops?.model?.userAgentName ?? DEFAULT_OPS_MODEL_AGENT_NAME
}

function isOpsModelRecord(record: Pick<state.UserAgentRecord, 'name'>): boolean {
  return record.name === opsModelAgentName()
}

function userAgentConfigs(userId: string): Record<string, AgentConfig> {
  const result: Record<string, AgentConfig> = {}
  for (const record of state.listUserAgents(userId)) {
    if (isOpsModelRecord(record)) continue
    const { key, error } = tryDecryptUserAgentKey(record)
    if (error) {
      console.warn(`[warn] Skipping agent "${record.name}": decryption failed — ${DECRYPT_MISMATCH_HINT}`)
      continue
    }
    result[record.name] = state.userAgentRecordToConfig(record, key)
  }
  return result
}

export function registerPersistedUserAgents(router: Router): void {
  const byUser = new Map<string, Record<string, AgentConfig>>()
  for (const record of state.listAllUserAgents()) {
    if (isOpsModelRecord(record)) continue
    const { key, error } = tryDecryptUserAgentKey(record)
    if (error) {
      console.warn(`[warn] Skipping persisted agent "${record.name}" (user ${record.userId}): decryption failed — ${DECRYPT_MISMATCH_HINT}. Re-configure the API key in Settings to fix.`)
      continue
    }
    const agents = byUser.get(record.userId) ?? {}
    agents[record.name] = state.userAgentRecordToConfig(record, key)
    byUser.set(record.userId, agents)
  }
  for (const [userId, agents] of byUser.entries()) {
    registerUserConfiguredAdapters(router, userId, agents)
  }
}

function reloadUserAgents(router: Router, userId: string): void {
  registerUserConfiguredAdapters(router, userId, userAgentConfigs(userId))
}

async function listAgentModels(
  userId: string,
  agentCatalog?: AgentCatalog,
  opts: { refresh?: boolean } = {}
): Promise<AgentListResponse> {
  const current = loadConfig()
  const currentAgents = current.agents
  const globalApiEntries = Object.entries(current.agents)
    .filter(([, cfg]) => API_ADAPTERS.has(cfg.adapter))
  const userRecords = state.listUserAgents(userId).filter((record) => !isOpsModelRecord(record))
  const userApiEntries = userRecords.map((record) => {
    const { key, error } = tryDecryptUserAgentKey(record)
    return {
      record,
      cfg: state.userAgentRecordToConfig(record, key),
      decryptError: error,
    }
  })
  if (opts.refresh) {
    await Promise.all([
      ...globalApiEntries.map(([name, cfg]) => verifyApiAgent(name, cfg, { force: true })),
      ...userApiEntries.map(({ record, cfg }) => verifyApiAgent(record.name, cfg, { force: true })),
    ])
  }
  const globalApi = globalApiEntries.map(([name, cfg]) => apiAgentInfoFromConfig(name, cfg))
  const userApi = userApiEntries.map(({ record, cfg, decryptError }) => apiAgentInfoFromRecord(record, cfg, decryptError))
  const userNames = new Set(userApi.map((agent) => agent.name))
  const apiAgents = [
    ...userApi,
    ...globalApi.filter((agent) => !userNames.has(agent.name)),
  ]
  if (!agentCatalog) return sortAgentsByPriority(apiAgents)

  const takenNames = new Set(apiAgents.map((agent) => agent.name))
  const localAgents = (await agentCatalog.listAgents({ refresh: opts.refresh }))
    .filter((agent) => !API_ADAPTERS.has(agent.adapter) && !takenNames.has(agent.name))
    .map((agent): ApiAgentInfo => {
      const cfg = currentAgents[agent.name]
      return {
        name: agent.name,
        adapter: agent.adapter,
        provider: 'Local CLI',
        model: agent.version,
        hasKey: true,
        status: agent.source === 'configured'
          ? (agent.verified && agent.availableForSessions
              ? 'ready'
              : agent.autoDiscovered
                ? (agent.verifying || !agent.verificationAttemptedAt ? 'verifying' : 'invalid')
                : agent.healthy ? 'unverified' : 'invalid')
          : (agent.healthy ? 'discovered' : 'invalid'),
        kind: 'local',
        source: agent.source,
        command: agent.command,
        args: cfg?.args ?? agent.args,
        timeout: cfg?.timeout ?? agent.timeout,
        priority: cfg?.priority,
        env: cfg?.env ?? agent.env,
        version: agent.version,
        autoDiscovered: agent.autoDiscovered,
        error: agent.verificationError,
      }
    })
  return sortAgentsByPriority([
    ...apiAgents,
    ...localAgents,
  ])
}

function apiAgentInfoFromConfig(name: string, cfg: AgentConfig): ApiAgentInfo {
  const hasKey = Boolean(cfg.apiKey)
  const smoke = getApiSmokeResult(name, cfg)
  const configOk = apiConfigHealthy(cfg)
  return {
    name,
    adapter: cfg.adapter,
    model: cfg.model,
    provider: providerForAdapter(cfg.adapter, cfg.baseUrl),
    baseUrl: cfg.baseUrl ?? DEFAULT_BASE_URLS[cfg.adapter],
    hasKey,
    keyMasked: cfg.apiKey ? maskAgentKey(cfg.apiKey) : undefined,
    status: !hasKey ? 'no_key' : !configOk ? 'invalid' : smoke ? (smoke.ok ? 'ready' : 'invalid') : 'unverified',
    error: smoke?.error,
    checkedAt: smoke?.checkedAt,
    kind: 'api',
    priority: cfg.priority,
  }
}

function apiAgentInfoFromRecord(record: state.UserAgentRecord, cfg?: AgentConfig, decryptError?: string): ApiAgentInfo {
  if (decryptError) {
    return {
      name: record.name,
      adapter: record.adapter,
      model: record.model,
      provider: providerForAdapter(record.adapter, record.baseUrl),
      baseUrl: record.baseUrl ?? DEFAULT_BASE_URLS[record.adapter],
      hasKey: false,
      status: 'invalid',
      error: `Decryption failed — ${DECRYPT_MISMATCH_HINT}`,
      kind: 'api',
    }
  }
  const apiKey = cfg?.apiKey ?? decryptUserAgentKey(record)
  const config = cfg ?? state.userAgentRecordToConfig(record, apiKey)
  return {
    ...apiAgentInfoFromConfig(record.name, config),
    hasKey: Boolean(apiKey),
    keyMasked: apiKey ? maskAgentKey(apiKey) : undefined,
  }
}

function providerKeyList(userId: string): ProviderKeyInfo[] {
  const keys = listKeys(userId).map((key) => ({
    ...key,
    source: 'vault' as const,
    usedBy: [] as string[],
  }))
  const result: ProviderKeyInfo[] = [...keys]
  for (const record of state.listUserAgents(userId)) {
    if (isOpsModelRecord(record)) continue
    const { key: apiKey, error } = tryDecryptUserAgentKey(record)
    if (error || !apiKey) continue
    result.push({
      id: `assistant:${record.name}`,
      provider: providerValueForAdapter(record.adapter, record.baseUrl),
      name: `${record.name} key`,
      maskedKey: maskAgentKey(apiKey),
      createdAt: record.createdAt,
      source: 'assistant',
      usedBy: [record.name],
      readOnly: true,
    })
  }
  for (const [name, cfg] of Object.entries(loadConfig().agents)) {
    if (!API_ADAPTERS.has(cfg.adapter) || !cfg.apiKey) continue
    result.push({
      id: `global:${name}`,
      provider: providerValueForAdapter(cfg.adapter, cfg.baseUrl),
      name: `${name} key`,
      maskedKey: maskAgentKey(cfg.apiKey),
      createdAt: 0,
      source: 'global',
      usedBy: [name],
      readOnly: true,
    })
  }
  return result
}

function apiConfigHealthy(cfg: AgentConfig): boolean {
  try {
    return Boolean(cfg.apiKey && createAdapter(cfg))
  } catch {
    return false
  }
}

function getApiSmokeResult(name: string, cfg: AgentConfig): ApiSmokeResult | undefined {
  const result = apiSmokeCache.get(apiSmokeKey(name, cfg))
  if (!result) return undefined
  return Date.now() - result.checkedAt <= API_SMOKE_CACHE_TTL_MS ? result : undefined
}

async function verifyApiAgent(name: string, cfg: AgentConfig, opts: { force?: boolean } = {}): Promise<ApiSmokeResult> {
  const key = apiSmokeKey(name, cfg)
  const cached = apiSmokeCache.get(key)
  if (!opts.force && cached && Date.now() - cached.checkedAt <= API_SMOKE_CACHE_TTL_MS) return cached
  const checkedAt = Date.now()
  if (!cfg.apiKey) return cacheApiSmoke(key, { ok: false, checkedAt, error: 'Missing API key' })
  let adapter
  try {
    adapter = createAdapter({ ...cfg, timeout: Math.min(cfg.timeout ?? API_SMOKE_TIMEOUT_MS, API_SMOKE_TIMEOUT_MS) })
  } catch (err) {
    return cacheApiSmoke(key, { ok: false, checkedAt, error: err instanceof Error ? err.message : String(err) })
  }
  if (!adapter) return cacheApiSmoke(key, { ok: false, checkedAt, error: 'Unsupported adapter' })
  ;(adapter as { name: string }).name = name
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_SMOKE_TIMEOUT_MS)
  try {
    const result = await adapter.send(opsPseudoSession(name, cfg), 'Reply with exactly: OK', {
      signal: controller.signal,
      systemPrompt: 'This is a health check. Reply with exactly: OK',
    })
    const content = typeof result === 'string' ? result : result.content
    return cacheApiSmoke(key, content.trim()
      ? { ok: true, checkedAt }
      : { ok: false, checkedAt, error: 'Empty API response' })
  } catch (err) {
    return cacheApiSmoke(key, { ok: false, checkedAt, error: err instanceof Error ? err.message : String(err) })
  } finally {
    clearTimeout(timer)
  }
}

function cacheApiSmoke(key: string, result: ApiSmokeResult): ApiSmokeResult {
  apiSmokeCache.set(key, result)
  return result
}

function apiSmokeKey(name: string, cfg: AgentConfig): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    name,
    adapter: cfg.adapter,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
  })).digest('hex')
}

async function assertApiAgentUsable(name: string, cfg: AgentConfig): Promise<void> {
  const result = await verifyApiAgent(name, cfg, { force: true })
  if (!result.ok) throw new HttpError(400, `API Assistant validation failed: ${result.error ?? 'unknown error'}`)
}

async function diagnoseApiAgent(userId: string, name: string, refresh: boolean): Promise<unknown | undefined> {
  const record = state.getUserAgent(userId, name)
  if (record) {
    const { key, error } = tryDecryptUserAgentKey(record)
    if (error) {
      return { name, adapter: record.adapter, model: record.model, baseUrl: record.baseUrl, healthy: false, verified: false, error: `Decryption failed — ${DECRYPT_MISMATCH_HINT}` }
    }
    const cfg = state.userAgentRecordToConfig(record, key)
    const result = await verifyApiAgent(name, cfg, { force: refresh })
    return { name, adapter: cfg.adapter, model: cfg.model, baseUrl: cfg.baseUrl, healthy: result.ok, verified: result.ok, checkedAt: result.checkedAt, error: result.error }
  }
  const cfg = activeAgents(loadConfig())[name]
  if (!cfg || !API_ADAPTERS.has(cfg.adapter)) return undefined
  const result = await verifyApiAgent(name, cfg, { force: refresh })
  return { name, adapter: cfg.adapter, model: cfg.model, baseUrl: cfg.baseUrl, healthy: result.ok, verified: result.ok, checkedAt: result.checkedAt, error: result.error }
}

function providerForAdapter(adapter: string, baseUrl?: string): string {
  if (baseUrl?.includes('api.deepseek.com')) return 'DeepSeek'
  return PROVIDER_BY_ADAPTER[adapter] ?? 'Custom'
}

function providerValueForAdapter(adapter: string, baseUrl?: string): state.StoredApiKeyRecord['provider'] {
  if (baseUrl?.includes('api.deepseek.com')) return 'deepseek'
  if (adapter === 'anthropic-api') return 'anthropic'
  if (adapter === 'openai-api' || adapter === 'custom-api') return 'openai'
  if (adapter === 'zhipu-api') return 'zhipu'
  if (adapter === 'deepseek-api') return 'deepseek'
  if (adapter === 'qwen-api') return 'qwen'
  if (adapter === 'moonshot-api') return 'moonshot'
  return 'openai'
}

function agentHasFilesystem(userId: string, ref: AgentRef): boolean {
  if (API_ADAPTERS.has(ref.adapter)) return false
  const userAgent = state.getUserAgent(userId, ref.adapter)
  if (userAgent) return !API_ADAPTERS.has(userAgent.adapter)
  const configAgent = activeAgents(loadConfig())[ref.adapter]
  if (configAgent) return !API_ADAPTERS.has(configAgent.adapter)
  return true
}

function assertTaskFilesystemCapability(userId: string, agent: AgentRef, cwd?: string): void {
  if (!cwd || agentHasFilesystem(userId, agent)) return
  throw new HttpError(400, 'Tasks with cwd require a filesystem-capable local CLI agent')
}

function assertSessionFilesystemCapability(userId: string, to: AgentRef, cwd?: string): void {
  if (!cwd || agentHasFilesystem(userId, to)) return
  throw new HttpError(400, 'Sessions with cwd require Agent B to be a filesystem-capable local CLI agent')
}

function resolveApiKeySelection(userId: string, parsed: { keyId?: string; adapter: string; baseUrl?: string }): string | undefined {
  if (!parsed.keyId) return undefined
  if (parsed.keyId.startsWith('assistant:') || parsed.keyId.startsWith('global:')) {
    throw new HttpError(400, 'Read-only keys cannot be rebound; choose a saved Provider Key')
  }
  const selected = decryptKey(userId, parsed.keyId)
  const expectedProvider = providerValueForAdapter(parsed.adapter, parsed.baseUrl)
  if (selected.provider !== expectedProvider) {
    throw new HttpError(400, `Choose a ${expectedProvider} Provider Key`)
  }
  return selected.key
}

function parseAgentRef(value: unknown, field: string): { adapter: string; label?: string } {
  const body = requireRecord(value, field)
  return {
    adapter: requireNonEmptyString(body.adapter, `${field}.adapter`),
    label: optionalString(body.label, `${field}.label`),
  }
}

function parseSessionStatus(value: string | null): 'active' | 'paused' | 'done' | 'error' | 'stopped' | null {
  if (value === null) {
    return null
  }
  if (value === 'active' || value === 'paused' || value === 'done' || value === 'error' || value === 'stopped') {
    return value
  }
  throw new HttpError(400, '"status" must be one of active, paused, done, error, stopped')
}

function parsePositiveInt(value: string | null): number | undefined {
  if (value === null) {
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, '"limit" must be a positive integer')
  }
  return parsed
}

function parseTaskStatus(value: string | null): TaskStatus | null {
  if (value === null) {
    return null
  }
  if (value === 'queued' || value === 'running' || value === 'done' || value === 'error' || value === 'stopped') {
    return value
  }
  throw new HttpError(400, '"status" must be one of queued, running, done, error, stopped')
}

function parseSessionMode(value: unknown): SessionMode | undefined {
  if (value === undefined) {
    return undefined
  }
  if (
    value === 'collaborate' ||
    value === 'discuss' ||
    value === 'review' ||
    value === 'freeform'
  ) {
    return value
  }
  throw new HttpError(400, '"mode" must be one of collaborate, discuss, review, freeform')
}

function parsePermissionMode(value: unknown, field = 'permissionMode'): 'safe' | 'trusted' | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (value === 'safe' || value === 'trusted') {
    return value
  }
  throw new HttpError(400, `"${field}" must be one of safe, trusted`)
}

function parseSessionContext(value: unknown, field: string): SessionContextInput | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  const ctx = requireRecord(value, field)
  const result: SessionContextInput = {}

  if (ctx.files !== undefined) {
    if (!Array.isArray(ctx.files)) {
      throw new HttpError(400, `"${field}.files" must be an array`)
    }
    result.files = ctx.files.map((f, i) => requireNonEmptyString(f, `${field}.files[${i}]`))
  }

  if (ctx.rules !== undefined) {
    result.rules = optionalString(ctx.rules, `${field}.rules`)
  }

  if (ctx.text !== undefined) {
    result.text = optionalString(ctx.text, `${field}.text`)
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function parseSystemPrompts(value: unknown): { from: string; to: string } | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  const prompts = requireRecord(value, 'systemPrompts')
  return {
    from: requireNonEmptyString(prompts.from, 'systemPrompts.from'),
    to: requireNonEmptyString(prompts.to, 'systemPrompts.to'),
  }
}

function resolveSessionContext(context: SessionContextInput | undefined, cwd?: string): SessionContext | undefined {
  if (!context) return undefined

  const result: SessionContext = {}

  if (context.rules) {
    result.rules = context.rules
  }

  if (context.text) {
    result.text = context.text
  }

  if (context.files && context.files.length > 0) {
    const baseDir = resolveWorkspaceDirectory(cwd ?? process.cwd(), 'cwd')
    result.files = context.files.map((filePath) => {
      try {
        const resolvedPath = resolveWorkspaceFile(filePath, 'context.files', baseDir)
        return {
          path: filePath,
          content: fs.readFileSync(resolvedPath, 'utf-8'),
        }
      } catch (err) {
        return {
          path: filePath,
          content: `[Error reading file: ${String(err)}]`,
        }
      }
    })
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function appendOutputDirContext(context: SessionContext | undefined, outputDir?: string): SessionContext | undefined {
  if (!outputDir) return context
  const text = [
    context?.text,
    `[[Passiton Output Directory]]\nSave this step's durable outputs under: ${outputDir}\n[[End Passiton Output Directory]]`,
  ].filter(Boolean).join('\n\n')
  return {
    ...(context ?? {}),
    text,
  }
}

function parseSessionBody(body: unknown) {
  const data = requireRecord(body, 'body')
  const templateId = optionalString(data.template_id ?? data.templateId, 'template_id')

  return {
    idempotencyKey: optionalString(data.idempotencyKey, 'idempotencyKey'),
    from: parseAgentRef(data.from, 'from'),
    to: parseAgentRef(data.to, 'to'),
    initialPrompt: requireNonEmptyString(data.initialPrompt, 'initialPrompt'),
    mode: parseSessionMode(data.mode),
    systemPrompts: parseSystemPrompts(data.systemPrompts),
    templateId,
    context: parseSessionContext(data.context, 'context'),
    maxRounds: optionalPositiveInt(data.maxRounds, 'maxRounds'),
    approveMode: optionalBoolean(data.approveMode, 'approveMode'),
    permissionMode: parsePermissionMode(data.permissionMode),
    cwd: optionalString(data.cwd, 'cwd'),
  }
}

function parseManualArtifactsBody(body: unknown): { paths: string[]; summary?: string } {
  const data = requireRecord(body, 'body')
  const rawPaths = data.paths ?? data.path
  const paths = Array.isArray(rawPaths)
    ? rawPaths
    : typeof rawPaths === 'string'
      ? rawPaths.split(/\r?\n|,/)
      : []
  const cleaned = paths.map((item) => String(item).trim()).filter(Boolean)
  if (cleaned.length === 0) throw new HttpError(400, '"paths" must include at least one file path')
  return {
    paths: cleaned,
    summary: optionalString(data.summary, 'summary'),
  }
}

function parseTaskBody(body: unknown) {
  const data = requireRecord(body, 'body')
  return {
    idempotencyKey: optionalString(data.idempotencyKey, 'idempotencyKey'),
    agent: data.agent === undefined ? undefined : parseAgentRef(data.agent, 'agent'),
    prompt: requireNonEmptyString(data.prompt, 'prompt'),
    context: parseSessionContext(data.context, 'context'),
    systemPrompt: optionalString(data.systemPrompt, 'systemPrompt'),
    permissionMode: parsePermissionMode(data.permissionMode),
    cwd: optionalString(data.cwd, 'cwd'),
  }
}

function parseTaskHandoffBody(body: unknown): { agent: AgentRef } {
  const data = requireRecord(body, 'body')
  return {
    agent: parseAgentRef(data.agent, 'agent'),
  }
}

async function assertTaskAgentAccepted(userId: string, router: Router, agentCatalog: AgentCatalog, agent: AgentRef, cwd?: string): Promise<void> {
  assertTaskFilesystemCapability(userId, agent, cwd)
  if (router.getAdapter(agent.adapter)) return
  const agents = await listAgentModels(userId, agentCatalog)
  const target = agents.find((item) => item.name === agent.adapter || item.adapter === agent.adapter)
  if (!target) throw new HttpError(400, `Agent not found: ${agent.adapter}`)
  if (target.status === 'invalid' || target.status === 'no_key') {
    throw new HttpError(400, `Agent is not usable: ${agent.adapter}`)
  }
}

function agentPriority(agent: Pick<ApiAgentInfo, 'name' | 'priority'>): number {
  return agent.priority ?? 1000
}

function sortAgentsByPriority<T extends Pick<ApiAgentInfo, 'name' | 'priority'>>(agents: T[]): T[] {
  return [...agents].sort((a, b) => agentPriority(a) - agentPriority(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

async function selectDefaultTaskAgent(userId: string, agentCatalog: AgentCatalog, cwd?: string): Promise<AgentRef> {
  const agents = await listAgentModels(userId, agentCatalog)
  const accepted = agents.filter((agent) => {
    if (agent.status === 'invalid' || agent.status === 'no_key' || agent.status === 'discovered') return false
    if (cwd && !agentHasFilesystem(userId, { adapter: agent.name })) return false
    return true
  })
  const ready = accepted.filter((agent) => agent.status === 'ready')
  const candidates = ready.length ? ready : accepted.filter((agent) => agent.status === 'unverified')
  const selected = sortAgentsByPriority(candidates)[0]
  if (!selected) {
    throw new HttpError(400, 'No agent specified and no usable agent found. Configure an agent in Settings > Agents or pass "agent": {"adapter": "<name>"}.')
  }
  return { adapter: selected.name }
}

function buildTaskHandoffPrompt(source: Task): string {
  const previousOutput = truncateText(source.lastAgentOutput || source.output || source.result || '', HANDOFF_OUTPUT_TAIL_CHARS)
  const ended = source.status === 'error'
    ? `error${source.errorMessage ? `: ${source.errorMessage}` : ''}`
    : 'stopped'
  const workspace = source.workspaceState
  const workspaceSection = workspace ? [
    '## Workspace state',
    `Agent-caused changed files (${workspace.changedFileCount}):`,
    ...(workspace.files.length ? workspace.files.map((file) => `- ${file}`) : ['- none recorded']),
    `Pre-existing files count: ${workspace.preexistingFileCount ?? 0}`,
    '',
  ].join('\n') : ''

  return [
    source.prompt,
    '',
    '## Previous attempt',
    `Agent: ${agentLabel(source.agent)}`,
    `Ended: ${ended}`,
    '',
    previousOutput ? `Output tail:\n${previousOutput}` : 'Output tail: none recorded',
    '',
    workspaceSection,
    '## Continuation instructions',
    'Verify the current state first (git diff, read the files). Do not redo completed work. Finish only what remains. Report what you found versus what you did.',
  ].filter(Boolean).join('\n')
}

function parseFilePreviewBody(body: unknown): { path: string; cwd?: string } {
  const data = requireRecord(body, 'body')
  return {
    path: requireNonEmptyString(data.path, 'path'),
    cwd: optionalString(data.cwd, 'cwd'),
  }
}

function parseFileResolveBody(body: unknown): { paths: string[]; cwd?: string; baseFile?: string } {
  const data = requireRecord(body, 'body')
  return {
    paths: optionalStringArray(data.paths, 'paths') ?? [],
    cwd: optionalString(data.cwd, 'cwd'),
    baseFile: optionalString(data.baseFile, 'baseFile'),
  }
}

function previewMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.svg': return 'image/svg+xml'
    case '.mp4': return 'video/mp4'
    case '.mov': return 'video/quicktime'
    case '.webm': return 'video/webm'
    case '.wav': return 'audio/wav'
    case '.mp3': return 'audio/mpeg'
    case '.m4a': return 'audio/mp4'
    case '.aac': return 'audio/aac'
    case '.flac': return 'audio/flac'
    case '.md': return 'text/markdown; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.yaml':
    case '.yml': return 'application/yaml; charset=utf-8'
    default: return 'text/plain; charset=utf-8'
  }
}

function resolvePreviewFile(filePath: string, cwd?: string): string {
  const baseDir = cwd ? resolveWorkspaceDirectory(cwd, 'cwd') : undefined
  try {
    return resolveWorkspaceFile(filePath, 'path', baseDir)
  } catch (err) {
    if (err instanceof WorkspaceAccessError && /does not exist/.test(err.message)) throw new HttpError(404, 'File not found')
    throw err
  }
}

function resolveWorkflowFile(filePath: string, cwd?: string, baseFile?: string): string | undefined {
  const baseDir = resolveWorkspaceDirectory(cwd ?? process.cwd(), 'cwd')
  const candidates = new Set<string>()
  if (path.isAbsolute(filePath)) {
    candidates.add(path.resolve(filePath))
  } else {
    if (baseFile) {
      const resolvedBaseFile = path.isAbsolute(baseFile)
        ? path.resolve(baseFile)
        : path.resolve(baseDir, baseFile)
      candidates.add(path.resolve(path.dirname(resolvedBaseFile), filePath))
    }
    candidates.add(path.resolve(baseDir, filePath))
  }

  for (const candidate of candidates) {
    try {
      return resolveWorkspaceFile(candidate, 'path')
    } catch {
      // Try the remaining candidates.
    }
  }

  if (filePath.includes(path.sep) || filePath.includes('/')) return undefined
  const matches: string[] = []
  const visit = (dir: string, depth: number) => {
    if (depth > 6 || matches.length > 1) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (matches.length > 1) return
      const candidate = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(candidate, depth + 1)
      else if (entry.isFile() && entry.name === filePath) matches.push(candidate)
    }
  }
  visit(baseDir, 0)
  return matches.length === 1 ? matches[0] : undefined
}

function streamPreviewFile(req: http.IncomingMessage, res: http.ServerResponse, filePath: string): void {
  const stat = fs.statSync(filePath)
  const mimeType = previewMimeType(filePath)
  const range = req.headers.range
  if (!range) {
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    })
    fs.createReadStream(filePath).pipe(res)
    return
  }

  const match = range.match(/^bytes=(\d*)-(\d*)$/)
  if (!match) throw new HttpError(416, 'Invalid Range header')
  const start = match[1] ? Number(match[1]) : 0
  const end = match[2] ? Number(match[2]) : stat.size - 1
  if (start < 0 || end < start || start >= stat.size || end >= stat.size) {
    res.setHeader('Content-Range', `bytes */${stat.size}`)
    throw new HttpError(416, 'Range not satisfiable')
  }
  res.writeHead(206, {
    'Content-Type': mimeType,
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  })
  fs.createReadStream(filePath, { start, end }).pipe(res)
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new HttpError(400, `"${field}" must be a string array`)
  }
  return value.map((item) => item.trim()).filter(Boolean)
}

function formatAllowedWorkspaceRejections(rejected: { path: string; reason: string }[]): string {
  return rejected.map((item) => `rejected ${item.path}: ${item.reason}`).join('; ')
}

function assertAllowedWorkspace(cwd: string | undefined, field = 'cwd'): void {
  if (!cwd) return
  resolveWorkspaceDirectory(cwd, field)
}

function resolveWorkspaceDirectory(dir: string, field = 'cwd'): string {
  return resolveWorkspacePath(dir, {
    field,
    allowedRoots: loadConfig().policy.allowedWorkspaces ?? [],
    mustExist: true,
    requireDirectory: true,
  })
}

function resolveWorkspaceFile(filePath: string, field = 'path', baseDir?: string): string {
  return resolveWorkspacePath(filePath, {
    field,
    ...(baseDir ? { baseDir } : {}),
    allowedRoots: loadConfig().policy.allowedWorkspaces ?? [],
    mustExist: true,
    requireFile: true,
  })
}

function assertPermissionModeAllowed(permissionMode: 'safe' | 'trusted' | undefined, cwd: string | undefined, field = 'permissionMode'): void {
  if (permissionMode === 'trusted' && !cwd) {
    throw new HttpError(400, `"${field}" trusted mode requires cwd`)
  }
}

function mcpServerMetadata() {
  return {
    name: 'passiton',
    transport: 'streamable-http',
    protocolVersion: '2025-06-18',
    endpoint: '/mcp',
    auth: 'Authorization: Bearer <passiton token>',
    tools: mcpTools().map((tool) => tool.name),
  }
}

function logMcp(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`
  console.info(message)
  try {
    fs.appendFileSync('/tmp/passiton-mcp-access.log', line)
  } catch {
    // best-effort debug log
  }
}

function authenticateMcpRequest(req: http.IncomingMessage, url: URL): AuthUser {
  const token = url.searchParams.get('token')
  if (token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${token}`
  }
  return authenticateRequest(req)
}

async function handleMcpRpc(body: unknown, ctx: McpContext): Promise<unknown> {
  if (Array.isArray(body)) {
    const responses = await Promise.all(body.map((item) => handleMcpSingleRpc(item, ctx)))
    return responses.filter((item) => item !== undefined)
  }
  return handleMcpSingleRpc(body, ctx)
}

async function handleMcpSingleRpc(body: unknown, ctx: McpContext): Promise<unknown> {
  const request = body as JsonRpcRequest
  const id = request.id
  if (!request || typeof request !== 'object' || typeof request.method !== 'string') {
    return mcpError(id ?? null, -32600, 'Invalid JSON-RPC request')
  }

  try {
    switch (request.method) {
      case 'initialize':
        return mcpResult(id, {
          protocolVersion: '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'passiton', version: '0.1.1-mcp1' },
          instructions: 'Use Passiton tools to create and monitor agent tasks, sessions, and workflows. Ask before destructive operations.',
        })
      case 'notifications/initialized':
      case 'ping':
        return id === undefined ? undefined : mcpResult(id, {})
      case 'tools/list':
        return mcpResult(id, { resultType: 'complete', tools: mcpTools() })
      case 'tools/call': {
        const params = requireRecord(request.params, 'params')
        const name = requireNonEmptyString(params.name, 'params.name')
        const args = params.arguments ?? {}
        const data = await callMcpTool(name, args, ctx)
        return mcpResult(id, {
          resultType: 'complete',
          content: [{ type: 'text', text: JSON.stringify(data) }],
          structuredContent: compactMcpStructuredContent(data),
          isError: false,
        })
      }
      default:
        return mcpError(id, -32601, `Unsupported MCP method: ${request.method}`)
    }
  } catch (err) {
    return mcpError(id, -32000, err instanceof Error ? err.message : String(err))
  }
}

function mcpResult(id: JsonRpcId | undefined, result: unknown): unknown {
  if (id === undefined) return undefined
  return { jsonrpc: '2.0', id, result }
}

function mcpError(id: JsonRpcId | undefined, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

function compactMcpStructuredContent(data: unknown): unknown {
  if (!isRecord(data)) return data
  if (isRecord(data.task) && typeof data.task.result === 'string') {
    return {
      ...data,
      task: {
        ...data.task,
        result: undefined,
      },
    }
  }
  return data
}

function mcpTools(): McpTool[] {
  return [
    {
      name: 'passiton_list_agents',
      title: 'List Passiton agents',
      description: 'List agents available to create Passiton tasks, sessions, and workflows.',
      inputSchema: objectSchema({ refresh: { type: 'boolean', description: 'Run live diagnostics where supported.' } }),
      annotations: { readOnlyHint: true },
    },
    {
      name: 'passiton_create_task',
      title: 'Create Passiton task',
      description: 'Create a single-agent Passiton task. Use this for one-shot work.',
      inputSchema: objectSchema({
        agent: agentSchema('Agent adapter name or agent reference.'),
        prompt: { type: 'string' },
        cwd: { type: 'string', description: 'Optional working directory. Required for filesystem work.' },
        permissionMode: { type: 'string', enum: ['safe', 'trusted'], description: 'Use trusted for filesystem writes with local CLI agents.' },
        idempotencyKey: { type: 'string', description: 'Optional stable key to avoid duplicate task creation on retries.' },
        systemPrompt: { type: 'string' },
        context: contextSchema(),
      }, ['agent', 'prompt']),
      annotations: { destructiveHint: false },
    },
    {
      name: 'passiton_get_task_result',
      title: 'Get Passiton task result',
      description: 'Read a compact task status/result by id. By default this returns a short summary to avoid client safety truncation; set includeOutput=true only when the full report is needed.',
      inputSchema: objectSchema({
        id: { type: 'string' },
        includeOutput: { type: 'boolean', description: 'Include truncated result/output text. Default false.' },
        maxChars: { type: 'integer', description: 'Maximum characters for included result/output. Default 4000, max 12000.' },
      }, ['id']),
      annotations: { readOnlyHint: true },
    },
    {
      name: 'passiton_create_session',
      title: 'Create Passiton session',
      description: 'Create an agent-to-agent session. Use this for multi-turn planning, implementation, review, or discussion between agents.',
      inputSchema: objectSchema({
        from: agentSchema('Planner or first speaker agent name.'),
        to: agentSchema('Executor or second speaker agent name.'),
        initialPrompt: { type: 'string' },
        mode: { type: 'string', enum: ['collaborate', 'discuss', 'review', 'freeform'] },
        maxRounds: { type: 'integer' },
        approveMode: { type: 'boolean' },
        permissionMode: { type: 'string', enum: ['safe', 'trusted'] },
        idempotencyKey: { type: 'string', description: 'Optional stable key to avoid duplicate session creation on retries.' },
        cwd: { type: 'string' },
        systemPromptFrom: { type: 'string' },
        systemPromptTo: { type: 'string' },
        context: contextSchema(),
      }, ['from', 'to', 'initialPrompt']),
      annotations: { destructiveHint: false },
    },
    {
      name: 'passiton_send_feedback',
      title: 'Send feedback to Passiton session',
      description: 'Inject human feedback into a running or paused session and let the agents continue.',
      inputSchema: objectSchema({
        sessionId: { type: 'string' },
        content: { type: 'string' },
      }, ['sessionId', 'content']),
      annotations: { destructiveHint: false },
    },
    {
      name: 'passiton_get_progress',
      title: 'Get Passiton progress',
      description: 'Get progress for a task, session, workflow, or the current active runs.',
      inputSchema: objectSchema({
        kind: { type: 'string', enum: ['task', 'session', 'workflow'] },
        id: { type: 'string' },
      }),
      annotations: { readOnlyHint: true },
    },
  ]
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    additionalProperties: false,
    ...(required.length ? { required } : {}),
  }
}

function agentSchema(description: string): Record<string, unknown> {
  return {
    type: 'string',
    description,
  }
}

function contextSchema(): Record<string, unknown> {
  return objectSchema({
    text: { type: 'string' },
    rules: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
  })
}

async function callMcpTool(name: string, args: unknown, ctx: McpContext): Promise<unknown> {
  switch (name) {
    case 'passiton_list_agents':
      return mcpListAgents(args, ctx)
    case 'passiton_create_task':
      return mcpCreateTask(args, ctx)
    case 'passiton_get_task':
      return mcpGetTask(args, ctx)
    case 'passiton_get_task_result':
      return mcpGetTaskResult(args, ctx)
    case 'passiton_create_session':
      return mcpCreateSession(args, ctx)
    case 'passiton_get_session':
      return mcpGetSession(args, ctx)
    case 'passiton_create_workflow':
      return mcpCreateWorkflow(args, ctx)
    case 'passiton_get_workflow':
      return mcpGetWorkflow(args, ctx)
    case 'passiton_get_progress':
      return mcpGetProgress(args, ctx)
    case 'passiton_send_feedback':
      return mcpSendFeedback(args, ctx)
    case 'passiton_approve_step':
      return mcpApproveStep(args, ctx)
    case 'passiton_retry_step':
      return mcpRetryStep(args, ctx)
    case 'passiton_stop_run':
      return mcpStopRun(args, ctx)
    case 'passiton_read_artifact':
      return mcpReadArtifact(args)
    default:
      throw new HttpError(404, `Unknown MCP tool: ${name}`)
  }
}

async function mcpListAgents(args: unknown, ctx: McpContext): Promise<unknown> {
  const data = requireRecord(args, 'arguments')
  const refresh = optionalBoolean(data.refresh, 'refresh') ?? true
  const catalogAgents = await ctx.agentCatalog.listAgents({ refresh })
  const assistantRecords = state.listUserAgents(ctx.authUser.userId).filter((record) => !isOpsModelRecord(record))
  const assistantAgents = await Promise.all(assistantRecords.map(async (agent) => {
    const { key, error } = tryDecryptUserAgentKey(agent)
    const cfg = state.userAgentRecordToConfig(agent, key)
    const smoke = error
      ? { ok: false, checkedAt: Date.now(), error: `Decryption failed — ${DECRYPT_MISMATCH_HINT}` }
      : await verifyApiAgent(agent.name, cfg, { force: refresh })
    return {
      name: agent.name,
      adapter: agent.adapter,
      source: 'assistant',
      supported: true,
      availableForSessions: smoke.ok,
      healthy: smoke.ok,
      verified: smoke.ok,
      model: agent.model,
      baseUrl: agent.baseUrl,
      error: smoke.error,
    }
  }))
  return {
    agents: [...assistantAgents, ...catalogAgents].map((agent) => ({
      name: agent.name,
      adapter: agent.adapter,
      status: mcpAgentStatus(agent),
      usable: mcpAgentUsable(agent),
      source: agent.source,
      filesystem: !API_ADAPTERS.has(agent.adapter),
    })),
  }
}

function mcpAgentUsable(agent: {
  adapter: string
  source: string
  availableForSessions?: boolean
  healthy?: boolean
  verified?: boolean
}): boolean {
  if (API_ADAPTERS.has(agent.adapter)) return agent.healthy !== false
  return agent.source === 'configured' && agent.availableForSessions === true && agent.verified === true
}

function mcpAgentStatus(agent: {
  adapter: string
  source: string
  availableForSessions?: boolean
  healthy?: boolean
  verified?: boolean
}): string {
  if (mcpAgentUsable(agent)) return 'ready'
  if (!API_ADAPTERS.has(agent.adapter) && agent.source === 'configured' && agent.healthy) return 'unverified'
  return 'unavailable'
}

function findReusableMcpTask(userId: string, params: {
  idempotencyKey?: string
  agent: AgentRef
  prompt: string
  context?: SessionContext
  systemPrompt?: string
  permissionMode?: Task['permissionMode']
  cwd?: string
}): Task | undefined {
  if (params.idempotencyKey) {
    return state.getTaskByIdempotencyKey(userId, params.idempotencyKey)
  }
  return state.listTasks({ userId, limit: 50 }).find((task) => (
    (task.status === 'queued' || task.status === 'running') &&
    sameAgentRef(task.agent, params.agent) &&
    task.prompt === params.prompt &&
    sameOptionalString(task.cwd, params.cwd) &&
    task.systemPrompt === params.systemPrompt &&
    task.permissionMode === (params.permissionMode ?? 'safe') &&
    stableJson(task.context) === stableJson(params.context)
  ))
}

function findReusableMcpSession(userId: string, params: {
  idempotencyKey?: string
  from: AgentRef
  to: AgentRef
  initialPrompt: string
  mode?: SessionMode
  context?: SessionContext
  systemPrompts?: { from: string; to: string }
  maxRounds?: number
  approveMode?: boolean
  permissionMode?: Session['permissionMode']
  cwd?: string
}): Session | undefined {
  if (params.idempotencyKey) {
    return state.getSessionByIdempotencyKey(userId, params.idempotencyKey)
  }
  const candidates = state.listSessions({ userId, limit: 50 })
    .filter((session) => session.status === 'active' || session.status === 'paused')
  const prompts = state.getFirstHumanMessages(candidates.map((session) => session.id))
  const cheapMatch = candidates.filter((session) => (
    sameAgentRef(session.from, params.from) &&
    sameAgentRef(session.to, params.to) &&
    prompts.get(session.id) === params.initialPrompt &&
    sameOptionalString(session.cwd, params.cwd) &&
    session.mode === (params.mode ?? 'freeform') &&
    session.maxRounds === (params.maxRounds ?? loadConfig().defaults.maxRounds) &&
    session.approveMode === (params.approveMode ?? false) &&
    session.permissionMode === (params.permissionMode ?? 'safe')
  ))
  for (const candidate of cheapMatch) {
    const full = state.getSession(candidate.id, userId)
    if (!full) continue
    if (
      stableJson(full.context) === stableJson(params.context) &&
      (params.systemPrompts === undefined || stableJson(full.systemPrompts) === stableJson(params.systemPrompts))
    ) {
      return full
    }
  }
  return undefined
}

function sameAgentRef(a: AgentRef, b: AgentRef): boolean {
  return a.adapter === b.adapter && (a.label ?? '') === (b.label ?? '')
}

function sameOptionalString(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? undefined) === (b ?? undefined)
}

function stableJson(value: unknown): string {
  if (value === undefined) return ''
  return JSON.stringify(value)
}

async function mcpCreateTask(args: unknown, ctx: McpContext): Promise<unknown> {
  const params = parseTaskBody(normalizeTaskArgs(args))
  assertAllowedWorkspace(params.cwd)
  assertPermissionModeAllowed(params.permissionMode, params.cwd)
  const agent = params.agent ?? await selectDefaultTaskAgent(ctx.authUser.userId, ctx.agentCatalog, params.cwd)
  assertTaskFilesystemCapability(ctx.authUser.userId, agent, params.cwd)
  await assertMcpAgentUsable(ctx, agent, 'agent')
  const context = resolveSessionContext(params.context, params.cwd)
  const existing = findReusableMcpTask(ctx.authUser.userId, { ...params, agent, context })
  if (existing) {
    return {
      task: summarizeTask(existing),
      url: `/tasks/${existing.id}`,
      reused: true,
      message: `Task ${existing.id} reused. Use passiton_get_task_result with this id to check progress.`,
    }
  }
  const task = ctx.router.startTask({
    userId: ctx.authUser.userId,
    ...params,
    agent,
    context,
  })
  return {
    task: summarizeTask(task),
    url: `/tasks/${task.id}`,
    reused: false,
    message: `Task ${task.id} created. Use passiton_get_task_result with this id to check progress.`,
  }
}

function mcpGetTask(args: unknown, ctx: McpContext): unknown {
  const data = requireRecord(args, 'arguments')
  const task = state.getTask(requireNonEmptyString(data.id, 'id'), ctx.authUser.userId)
  if (!task) throw new HttpError(404, 'Task not found')
  return { task: summarizeTask(task, true) }
}

function mcpGetTaskResult(args: unknown, ctx: McpContext): unknown {
  const data = requireRecord(args, 'arguments')
  const task = state.getTask(requireNonEmptyString(data.id, 'id'), ctx.authUser.userId)
  if (!task) throw new HttpError(404, 'Task not found')
  const includeOutput = optionalBoolean(data.includeOutput, 'includeOutput') ?? false
  const maxChars = Math.min(optionalPositiveInt(data.maxChars, 'maxChars') ?? 4000, 12_000)
  const source = task.result || task.output || task.lastAgentOutput || ''
  return {
    task: {
      id: task.id,
      status: task.status,
      agent: agentLabel(task.agent),
      permissionMode: task.permissionMode,
      cwd: task.cwd,
      summary: compactTaskSummary(task),
      hasResult: Boolean(task.result),
      hasOutput: Boolean(task.output),
      hasLiveOutput: Boolean(task.lastAgentOutput),
      resultChars: (task.result || '').length,
      outputChars: (task.output || '').length,
      liveOutputChars: (task.lastAgentOutput || '').length,
      ...(includeOutput ? {
        truncated: source.length > maxChars,
        result: truncateText(task.result, maxChars),
        output: task.result ? undefined : truncateText(task.output, maxChars),
        liveOutput: (!task.result && !task.output) ? truncateText(task.lastAgentOutput, maxChars) : undefined,
      } : {}),
      errorMessage: truncateText(task.errorMessage, 500),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      finishedAt: task.finishedAt,
    },
  }
}

async function mcpCreateSession(args: unknown, ctx: McpContext): Promise<unknown> {
  const defaults = loadConfig().defaults
  const params = parseSessionBody(normalizeSessionArgs(args))
  assertAllowedWorkspace(params.cwd)
  assertPermissionModeAllowed(params.permissionMode, params.cwd)
  assertSessionFilesystemCapability(ctx.authUser.userId, params.to, params.cwd)
  await assertMcpAgentUsable(ctx, params.from, 'from')
  await assertMcpAgentUsable(ctx, params.to, 'to')
  const context = resolveSessionContext(params.context, params.cwd)
  const normalized = {
    ...params,
    context,
    mode: params.mode ?? defaults.mode,
    maxRounds: params.maxRounds ?? defaults.maxRounds,
  }
  const existing = findReusableMcpSession(ctx.authUser.userId, normalized)
  if (existing) return { session: summarizeSession(existing), url: `/sessions/${existing.id}`, reused: true }
  const session = ctx.router.startSession({
    userId: ctx.authUser.userId,
    ...normalized,
  })
  return { session: summarizeSession(session), url: `/sessions/${session.id}`, reused: false }
}

async function assertMcpAgentUsable(ctx: McpContext, agent: AgentRef, field: string): Promise<void> {
  if (API_ADAPTERS.has(agent.adapter)) return
  const names = Array.from(new Set([agent.label, agent.adapter].filter(Boolean))) as string[]
  for (const name of names) {
    const diagnostic = await ctx.agentCatalog.diagnoseAgent(name, true)
    if (!diagnostic) continue
    if (diagnostic.healthy) return
    throw new HttpError(400, `${field} agent "${agentLabel(agent)}" is not usable: ${diagnostic.error ?? diagnostic.errorCode ?? 'not verified'}`)
  }
}

function mcpGetSession(args: unknown, ctx: McpContext): unknown {
  const data = requireRecord(args, 'arguments')
  const id = requireNonEmptyString(data.id, 'id')
  const session = state.getSession(id, ctx.authUser.userId)
  if (!session) throw new HttpError(404, 'Session not found')
  return {
    session: summarizeSession(session),
    messages: state.getMessages(id).slice(-12).map(summarizeMessage),
    logs: state.getLogs(id).slice(-20).map((log) => ({
      ...log,
      message: truncateText(log.message, 1000),
    })),
  }
}

function mcpCreateWorkflow(args: unknown, ctx: McpContext): unknown {
  const defaults = loadConfig().defaults
  const params = parsePipelineBody(normalizeWorkflowArgs(args))
  for (const [index, step] of params.steps.entries()) {
    assertAllowedWorkspace(step.cwd, `steps[${index}].cwd`)
    assertAllowedWorkspace(step.outputDir, `steps[${index}].outputDir`)
    assertPermissionModeAllowed(step.permissionMode, step.cwd, `steps[${index}].permissionMode`)
  }
  const workflow = ctx.router.startPipeline({
    userId: ctx.authUser.userId,
    name: params.name,
    steps: params.steps.map((step) => ({
      ...step,
      context: appendOutputDirContext(resolveSessionContext(step.context, step.cwd), step.outputDir),
      mode: step.mode ?? defaults.mode,
      maxRounds: step.maxRounds ?? defaults.maxRounds,
    })),
  })
  return { workflow, url: `/workflow/${workflow.id}` }
}

function mcpGetWorkflow(args: unknown, ctx: McpContext): unknown {
  const data = requireRecord(args, 'arguments')
  const workflow = state.getPipelineWithSessions(requireNonEmptyString(data.id, 'id'), ctx.authUser.userId)
  if (!workflow) throw new HttpError(404, 'Workflow not found')
  return { workflow: summarizeWorkflow(workflow) }
}

function mcpGetProgress(args: unknown, ctx: McpContext): unknown {
  const data = requireRecord(args, 'arguments')
  const id = optionalString(data.id, 'id')
  const kind = optionalString(data.kind, 'kind')
  if (id && kind === 'task') return mcpGetTaskResult({ id }, ctx)
  if (id && kind === 'session') return mcpGetSession({ id }, ctx)
  if (id && kind === 'workflow') return mcpGetWorkflow({ id }, ctx)
  if (id) {
    const task = state.getTask(id, ctx.authUser.userId)
    if (task) {
      return {
        kind: 'task',
        task: {
          id: task.id,
          status: task.status,
          agent: agentLabel(task.agent),
          cwd: task.cwd,
          summary: compactTaskSummary(task),
          errorMessage: truncateText(task.errorMessage, 500),
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          finishedAt: task.finishedAt,
        },
      }
    }
    const session = state.getSession(id, ctx.authUser.userId)
    if (session) return { kind: 'session', session: summarizeSession(session), messages: state.getMessages(id).slice(-6).map(summarizeMessage) }
    const workflow = state.getPipelineWithSessions(id, ctx.authUser.userId)
    if (workflow) return { kind: 'workflow', workflow: summarizeWorkflow(workflow) }
    throw new HttpError(404, 'Run not found')
  }
  return {
    tasks: compactRecent(
      state.listTasks({ userId: ctx.authUser.userId })
        .filter((task) => task.status === 'queued' || task.status === 'running'),
      summarizeTask,
    ),
    sessions: compactRecent(
      state.listSessions({ userId: ctx.authUser.userId })
        .filter((session) => session.status === 'active' || session.status === 'paused'),
      summarizeSession,
    ),
    workflows: compactRecent(
      state.listPipelines(ctx.authUser.userId)
        .filter((workflow) => workflow.status === 'active' || workflow.status === 'paused'),
      summarizeWorkflow,
    ),
  }
}

function summarizeTask(task: Task, includeOutput = false): Record<string, unknown> {
  return {
    id: task.id,
    status: task.status,
    agent: agentLabel(task.agent),
    permissionMode: task.permissionMode,
    cwd: task.cwd,
    result: truncateText(task.result, 4000),
    errorMessage: truncateText(task.errorMessage, 1000),
    gitCommits: task.gitCommits ?? [],
    ...(includeOutput ? { output: truncateText(task.output, 8000) } : {}),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

function compactRecent<T extends { updatedAt: number }>(items: T[], mapItem: (item: T) => Record<string, unknown>, limit = 5): Record<string, unknown> {
  const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt)
  return {
    total: sorted.length,
    items: sorted.slice(0, limit).map(mapItem),
  }
}

function compactTaskSummary(task: Task): string | undefined {
  const source = task.result || task.output || task.lastAgentOutput
  if (!source) return undefined
  const firstLine = source
    .replace(/\[[A-Z]+\]/g, '')
    .replace(/\[\/[A-Z]+\]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  return truncateText(firstLine, 300)
}

function summarizeSession(session: Session): Record<string, unknown> {
  return {
    id: session.id,
    status: session.status,
    mode: session.mode,
    from: agentLabel(session.from),
    to: agentLabel(session.to),
    nextTurn: session.nextTurn,
    currentRound: session.currentRound,
    maxRounds: session.maxRounds,
    approveMode: session.approveMode,
    permissionMode: session.permissionMode,
    cwd: session.cwd,
    errorType: session.errorType,
    errorMessage: truncateText(session.errorMessage, 1000),
    lastAgentOutput: truncateText(session.lastAgentOutput, 2000),
    artifacts: session.artifacts,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

function summarizeWorkflow(workflow: Pipeline | PipelineWithSessions): Record<string, unknown> {
  return {
    id: workflow.id,
    name: workflow.name,
    status: workflow.status,
    steps: workflow.sessions.map((step) => ({
      sessionId: step.sessionId,
      title: step.title,
      nodeType: step.nodeType,
      status: step.status,
      dependsOn: step.dependsOn,
    })),
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  }
}

async function buildOpsReport(
  userId: string,
  agentCatalog: AgentCatalog,
  input: { question?: string; target?: OpsTarget; page?: OpsPageContext } = {}
) {
  const now = Date.now()
  const issues: OpsIssue[] = []
  const tasks = state.listTasks({ userId })
  const sessions = state.listSessions({ userId })
  const workflows = state.listPipelines(userId)
  const agents = await listAgentModels(userId, agentCatalog).catch(() => [])
  const staleMs = 10 * 60 * 1000
  const queuedMs = 5 * 60 * 1000

  for (const task of tasks) {
    if (task.status === 'running' && now - task.updatedAt > staleMs) {
      issues.push({
        severity: 'critical',
        title: 'Task may be stuck',
        detail: `${task.agent.label || task.agent.adapter} has run for ${formatDuration(now - (task.startedAt || task.updatedAt))}; no updates for ${formatDuration(now - task.updatedAt)}.`,
        recommendation: 'Check last agent output and the project diff first; if no child process is active, stop it and rerun with the same prompt.',
        target: { kind: 'task', id: task.id },
        actions: [
          opsAction('stop_task', { kind: 'task', id: task.id }, 'Stop Task', 'Stop this stuck background task.', 'medium'),
          opsAction('rerun_task', { kind: 'task', id: task.id }, 'Rerun Task', 'Create a new task with the original prompt.', 'medium'),
        ],
      })
    }
    if (task.status === 'queued' && now - task.createdAt > queuedMs) {
      issues.push({
        severity: 'warning',
        title: 'Task queued too long',
        detail: `Task has been queued for ${formatDuration(now - task.createdAt)}.`,
        recommendation: 'Check whether task concurrency is occupied by long-running tasks; stop stuck running tasks if needed.',
        target: { kind: 'task', id: task.id },
        actions: [
          opsAction('stop_task', { kind: 'task', id: task.id }, 'Cancel Queue', 'Stop this queued task.', 'low'),
        ],
      })
    }
    if (task.status === 'error') {
      issues.push({
        severity: classifyOpsSeverity(task.errorMessage),
        title: 'Task failed',
        detail: task.errorMessage || task.lastAgentOutput || 'Task failed without saved error details.',
        recommendation: recommendationForError(task.errorMessage || task.lastAgentOutput || ''),
        target: { kind: 'task', id: task.id },
        actions: [
          opsAction('rerun_task', { kind: 'task', id: task.id }, 'Rerun Task', 'Create a new task with the original prompt.', 'medium'),
          opsAction('create_repair_task', { kind: 'task', id: task.id }, 'Create Repair Task', 'Create a new task for an agent to fix the failure; Ops will not edit files directly.', 'high'),
        ],
      })
    }
  }

  for (const session of sessions) {
    if (session.status === 'active' && now - session.updatedAt > staleMs) {
      issues.push({
        severity: 'critical',
        title: 'Session may be stuck',
        detail: `${agentLabel(session.from)} -> ${agentLabel(session.to)} has had no updates for ${formatDuration(now - session.updatedAt)}.`,
        recommendation: 'Check the current round output; if it is a quota or auth issue, switch agents and resume.',
        target: { kind: 'session', id: session.id },
        actions: [
          opsAction('resume_session', { kind: 'session', id: session.id }, 'Resume Session', 'Try to resume this session.', 'medium'),
        ],
      })
    }
    if (session.status === 'error') {
      issues.push({
        severity: classifyOpsSeverity(session.errorMessage || session.errorType),
        title: 'Session failed',
        detail: session.errorMessage || session.errorType || session.lastAgentOutput || 'Session failed without saved error details.',
        recommendation: recommendationForError(session.errorMessage || session.errorType || session.lastAgentOutput || ''),
        target: { kind: 'session', id: session.id },
        actions: [
          opsAction('resume_session', { kind: 'session', id: session.id }, 'Resume from Error', 'Recover this session from the error state.', 'medium'),
        ],
      })
    }
    if (session.status === 'paused') {
      issues.push({
        severity: 'info',
        title: 'Session waiting for action',
        detail: `${agentLabel(session.from)} -> ${agentLabel(session.to)} is paused.`,
        recommendation: session.errorType ? 'Confirm the error cause, then resume; specify a backup agent if needed.' : 'If this is a human review point, confirm the artifact and continue.',
        target: { kind: 'session', id: session.id },
        actions: [
          opsAction('resume_session', { kind: 'session', id: session.id }, 'Resume Session', 'Resume this paused session.', 'low'),
        ],
      })
    }
  }

  for (const workflow of workflows) {
    if (workflow.status === 'active' && now - workflow.updatedAt > staleMs) {
      issues.push({
        severity: 'warning',
        title: 'Workflow has not updated for a while',
        detail: `${workflow.name} has had no updates for ${formatDuration(now - workflow.updatedAt)}.`,
        recommendation: 'Open the workflow and inspect the active step; handle failed or review-waiting steps first.',
        target: { kind: 'workflow', id: workflow.id },
      })
    }
    if (workflow.status === 'error' || workflow.status === 'paused') {
      issues.push({
        severity: workflow.status === 'error' ? 'critical' : 'info',
        title: `Workflow ${workflow.status}`,
        detail: `${workflow.name} is currently ${workflow.status}.`,
        recommendation: 'Inspect the step timeline and find the first step that is not done.',
        target: { kind: 'workflow', id: workflow.id },
      })
    }
  }

  for (const agent of agents) {
    const status = String((agent as { status?: unknown }).status || '')
    if (status && status !== 'ready' && status !== 'discovered') {
      issues.push({
        severity: status === 'invalid' || status === 'no_key' ? 'critical' : 'warning',
        title: 'Agent unavailable',
        detail: `${String((agent as { name?: unknown }).name || 'unknown')} status is ${status}.`,
        recommendation: 'Run diagnostics again in Settings; for API agents check keys, and for CLI agents check login, PATH, and subscription quota.',
      })
    }
  }

  const targetIssue = input.target?.id
    ? issues.filter(issue => issue.target?.kind === input.target?.kind && issue.target?.id === input.target?.id)
    : []
  const relevant = targetIssue.length ? targetIssue : issues
  const summary = summarizeOpsIssues(relevant, input)
  const directAnswer = directOpsAnswer(userId, input.question)
  const modelAnswer = input.question && !directAnswer
    ? await generateOpsModelAnswer(userId, input, {
        summary,
        policy: 'Read-only diagnostics; platform actions require user confirmation; do not edit project files, commit, or push.',
        issues: relevant.slice(0, 20),
        counts: {
          critical: issues.filter(issue => issue.severity === 'critical').length,
          warning: issues.filter(issue => issue.severity === 'warning').length,
          info: issues.filter(issue => issue.severity === 'info').length,
        },
        totals: {
          tasks: tasks.length,
          sessions: sessions.length,
          workflows: workflows.length,
          agents: agents.length,
        },
        page: input.page,
      }).catch((err) => ({
        answer: undefined,
        source: undefined,
        error: err instanceof Error ? err.message : String(err),
      }))
    : undefined

  return {
    ok: issues.filter(issue => issue.severity === 'critical').length === 0,
    checkedAt: now,
    summary,
    directAnswer,
    answer: modelAnswer?.answer,
    answerSource: modelAnswer?.source,
    answerError: modelAnswer?.error,
    policy: 'read_only_diagnose_with_confirmed_platform_actions',
    counts: {
      critical: issues.filter(issue => issue.severity === 'critical').length,
      warning: issues.filter(issue => issue.severity === 'warning').length,
      info: issues.filter(issue => issue.severity === 'info').length,
    },
    issues: relevant.slice(0, 20),
    totals: {
      tasks: tasks.length,
      sessions: sessions.length,
      workflows: workflows.length,
      agents: agents.length,
    },
  }
}

function directOpsAnswer(userId: string, question: string | undefined): string | undefined {
  const value = String(question || '').toLowerCase()
  if (!value) return undefined
  if (/什么模型|用的什么模型|接.*模型|llm|deepseek|gpt|claude|qwen|模型/.test(value)) {
    const selected = selectCachedOpsModelAgent(userId)
    if (selected) {
      return [
        `The current Ops steward is connected to ${selected.name}.`,
        `adapter: ${selected.config.adapter}`,
        `model: ${selected.config.model || 'not configured'}`,
        'It only diagnoses, explains, and recommends; it does not edit project files, commit, or push.',
      ].join('\n')
    }
    return [
      'No Ops LLM is currently available.',
      'Configure an Ops model from the Ops panel, or add an API Assistant as a fallback.',
    ].join('\n')
  }
  if (/能做什么|职责|权限|边界/.test(value)) {
    return [
      'Ops scope: read-only diagnostics plus platform actions after your confirmation.',
      'It can stop, resume, rerun, and create repair tasks.',
      'It does not edit project files, commit code, or push.',
    ].join('\n')
  }
  return undefined
}

function summarizeOpsIssues(issues: OpsIssue[], input: { question?: string; target?: OpsTarget }): string {
  if (issues.length === 0) {
    return input.target?.id
      ? 'No obvious issue was found for the current object.'
      : 'No high-priority issue was detected.'
  }
  const first = issues[0]
  const prefix = input.target?.id ? 'This object' : 'The platform'
  return `${prefix} has ${issues.length} issue(s). Top priority: ${first.title}. ${first.recommendation}`
}

function dedicatedOpsModelAgent(userId: string): { name: string; config: AgentConfig; record: state.UserAgentRecord } | undefined {
  const record = state.getUserAgent(userId, opsModelAgentName())
  if (!record) return undefined
  const { key, error } = tryDecryptUserAgentKey(record)
  if (error) return undefined
  const config = state.userAgentRecordToConfig(record, key)
  if (!API_ADAPTERS.has(config.adapter) || !config.apiKey || !apiConfigHealthy(config)) return undefined
  return { name: 'Ops model', config, record }
}

function fallbackOpsModelCandidates(userId: string): Array<{ name: string; config: AgentConfig }> {
  const candidates: Array<{ name: string; config: AgentConfig }> = []
  for (const [name, config] of Object.entries(userAgentConfigs(userId))) {
    if (API_ADAPTERS.has(config.adapter) && config.apiKey && apiConfigHealthy(config)) candidates.push({ name, config })
  }
  for (const [name, config] of Object.entries(activeAgents(loadConfig()))) {
    if (API_ADAPTERS.has(config.adapter) && config.apiKey && apiConfigHealthy(config)) candidates.push({ name, config })
  }
  return candidates
}

async function generateOpsModelAnswer(
  userId: string,
  input: { question?: string; target?: OpsTarget; page?: OpsPageContext },
  report: {
    summary: string
    policy: string
    issues: OpsIssue[]
    counts: { critical: number; warning: number; info: number }
    totals: { tasks: number; sessions: number; workflows: number; agents: number }
    page?: OpsPageContext
  }
): Promise<{ answer?: string; source?: string; error?: string }> {
  const selected = await selectOpsModelAgent(userId)
  if (!selected) return { error: 'No Ops LLM is available. Configure an Ops model from the Ops panel, or add an API Assistant as a fallback.' }
  const adapter = createAdapter(selected.config)
  if (!adapter) return { error: `Could not create the ${selected.name} adapter.` }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const result = await adapter.send(opsPseudoSession(selected.name, selected.config), JSON.stringify({
      question: input.question,
      target: input.target,
      report,
    }), {
      signal: controller.signal,
      systemPrompt: [
        'You are the Ops steward for the Passiton platform.',
        'Your role: inspect platform state, explain task/session/workflow issues, and recommend the next step.',
        'Your boundary: do not edit project files directly, commit, or push; when fixes are needed, recommend creating a repair task or using platform actions.',
        'Answer the user’s current question directly. Do not mechanically restate every diagnostic item.',
        'If the report lacks enough evidence, state what is missing.',
        'Answer in concise, specific English.',
      ].join('\n'),
    })
    const answer = typeof result === 'string' ? result : (result as AdapterResponse).content
    return { answer: answer.trim(), source: selected.name }
  } finally {
    clearTimeout(timer)
  }
}

async function selectOpsModelAgent(userId: string): Promise<{ name: string; config: AgentConfig } | undefined> {
  const dedicated = dedicatedOpsModelAgent(userId)
  if (dedicated) {
    const result = await verifyApiAgent(dedicated.name, dedicated.config)
    if (result.ok) return dedicated
  }
  for (const candidate of fallbackOpsModelCandidates(userId).sort((a, b) => opsModelPriority(a) - opsModelPriority(b))) {
    const result = await verifyApiAgent(candidate.name, candidate.config)
    if (result.ok) return candidate
  }
  return undefined
}

function selectCachedOpsModelAgent(userId: string): { name: string; config: AgentConfig } | undefined {
  const dedicated = dedicatedOpsModelAgent(userId)
  if (dedicated && getApiSmokeResult(dedicated.name, dedicated.config)?.ok) return dedicated
  return fallbackOpsModelCandidates(userId)
    .filter((candidate) => getApiSmokeResult(candidate.name, candidate.config)?.ok)
    .sort((a, b) => opsModelPriority(a) - opsModelPriority(b))[0]
}

function opsModelPriority(candidate: { name: string; config: AgentConfig }): number {
  const value = `${candidate.name} ${candidate.config.adapter} ${candidate.config.model ?? ''}`.toLowerCase()
  if (value.includes('ops')) return 0
  if (value.includes('deepseek')) return 1
  if (value.includes('qwen')) return 2
  if (value.includes('openai')) return 3
  if (value.includes('anthropic') || value.includes('claude')) return 4
  return 9
}

async function getOpsModelResponse(userId: string, opts: { refresh?: boolean } = {}): Promise<OpsModelResponse> {
  const record = state.getUserAgent(userId, opsModelAgentName())
  if (record) {
    const { key, error } = tryDecryptUserAgentKey(record)
    const cfg = state.userAgentRecordToConfig(record, key)
    const smoke = error
      ? { ok: false, checkedAt: Date.now(), error: `Decryption failed — ${DECRYPT_MISMATCH_HINT}` }
      : await verifyApiAgent('Ops model', cfg, { force: opts.refresh })
    return {
      configured: true,
      effective: smoke.ok ? 'dedicated' : undefined,
      name: 'Ops model',
      adapter: record.adapter,
      model: record.model,
      provider: providerForAdapter(record.adapter, record.baseUrl),
      baseUrl: record.baseUrl ?? DEFAULT_BASE_URLS[record.adapter],
      hasKey: Boolean(key),
      keyMasked: key ? maskAgentKey(key) : undefined,
      status: error ? 'invalid' : smoke.ok ? 'ready' : 'invalid',
      error: smoke.error,
      checkedAt: smoke.checkedAt,
    }
  }
  const fallback = opts.refresh ? await selectOpsModelAgent(userId) : selectCachedOpsModelAgent(userId)
  if (!fallback) return { configured: false }
  return {
    configured: false,
    effective: 'fallback',
    name: fallback.name,
    adapter: fallback.config.adapter,
    model: fallback.config.model,
    provider: providerForAdapter(fallback.config.adapter, fallback.config.baseUrl),
    baseUrl: fallback.config.baseUrl ?? DEFAULT_BASE_URLS[fallback.config.adapter],
    hasKey: Boolean(fallback.config.apiKey),
    keyMasked: fallback.config.apiKey ? maskAgentKey(fallback.config.apiKey) : undefined,
    status: 'ready',
    checkedAt: getApiSmokeResult(fallback.name, fallback.config)?.checkedAt,
  }
}

async function saveOpsModel(userId: string, body: unknown): Promise<OpsModelResponse> {
  const name = opsModelAgentName()
  const existing = state.getUserAgent(userId, name)
  const parsed = parseOpsModelConfigBody(body, existing)
  const existingKey = existing ? decryptUserAgentKey(existing) : undefined
  const apiKey = parsed.apiKey ?? existingKey
  const cfg: AgentConfig = {
    adapter: parsed.adapter,
    apiKey,
    model: parsed.model,
    baseUrl: parsed.baseUrl,
    timeout: parsed.timeout ?? 120_000,
  }
  await assertApiAgentUsable('Ops model', cfg)
  const encrypted = parsed.apiKey ? encryptSecret(userId, parsed.apiKey) : undefined
  if (existing) {
    state.updateUserAgent(userId, name, {
      adapter: parsed.adapter,
      model: parsed.model,
      baseUrl: parsed.baseUrl,
      timeout: parsed.timeout ?? 120_000,
      ...(encrypted ? { encryptedKey: encrypted.encryptedKey, iv: encrypted.iv, authTag: encrypted.authTag } : {}),
    })
  } else {
    state.createUserAgent({
      id: crypto.randomUUID(),
      userId,
      name,
      adapter: parsed.adapter,
      model: parsed.model,
      baseUrl: parsed.baseUrl,
      timeout: parsed.timeout ?? 120_000,
      ...(encrypted ?? encryptSecret(userId, apiKey!)),
    })
  }
  return getOpsModelResponse(userId)
}

function opsPseudoSession(agentName: string, agent: AgentConfig): Session {
  const now = Date.now()
  return {
    id: `ops-${crypto.randomUUID()}`,
    from: { adapter: agentName, label: agentName },
    to: { adapter: agent.adapter, label: agentName },
    status: 'active',
    mode: 'freeform',
    nextTurn: 'from',
    maxRounds: 1,
    currentRound: 0,
    approveMode: false,
    permissionMode: 'safe',
    resumeCount: 0,
    createdAt: now,
    updatedAt: now,
  }
}

function opsAction(
  id: OpsAction['id'],
  target: Required<OpsTarget>,
  label: string,
  description: string,
  risk: OpsAction['risk']
): OpsAction {
  return {
    id,
    label,
    description,
    target,
    risk,
    requiresConfirmation: true,
  }
}

function classifyOpsSeverity(text: unknown): OpsIssue['severity'] {
  const value = String(text || '').toLowerCase()
  if (/quota|usage limit|insufficient|429|rate limit|auth|login|unauthorized|permission|timeout|timed out/.test(value)) return 'critical'
  return 'warning'
}

function recommendationForError(text: string): string {
  const value = text.toLowerCase()
  if (/quota|usage limit|insufficient|429|rate limit/.test(value)) return 'Quota or rate-limit issue. Wait for recovery, then switch to a backup agent or resume manually.'
  if (/auth|login|unauthorized|forbidden|401|403/.test(value)) return 'Authentication issue. Log in to the CLI again or update the provider key.'
  if (/timeout|timed out|idle/.test(value)) return 'Timeout issue. Check whether files were written, then extend timeout and rerun if needed.'
  if (/permission|eacces|access/.test(value)) return 'Permission issue. Check cwd, file permissions, and permission mode.'
  return 'Check the last output and logs, then decide whether to rerun or switch agents.'
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.round(minutes / 60)}h`
}

function summarizeMessage(message: Message): Record<string, unknown> {
  return {
    id: message.id,
    sessionId: message.sessionId,
    from: message.from,
    round: message.round,
    timestamp: message.timestamp,
    content: truncateText(message.content, 4000),
    metadata: message.metadata,
  }
}

function truncateText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n...[truncated]` : value
}

async function mcpSendFeedback(args: unknown, ctx: McpContext): Promise<unknown> {
  const data = requireRecord(args, 'arguments')
  const sessionId = requireNonEmptyString(data.sessionId, 'sessionId')
  if (!state.getSession(sessionId, ctx.authUser.userId)) throw new HttpError(404, 'Session not found')
  const message = ctx.router.injectMessage(sessionId, requireNonEmptyString(data.content, 'content'))
  return {
    message: summarizeMessage(message),
    session: summarizeSession(state.getSession(sessionId, ctx.authUser.userId)!),
  }
}

async function mcpApproveStep(args: unknown, ctx: McpContext): Promise<unknown> {
  const data = requireRecord(args, 'arguments')
  const sessionId = requireNonEmptyString(data.sessionId, 'sessionId')
  if (!state.getSession(sessionId, ctx.authUser.userId)) throw new HttpError(404, 'Session not found')
  const session = await ctx.router.confirmSession(sessionId)
  return { session }
}

async function mcpRetryStep(args: unknown, ctx: McpContext): Promise<unknown> {
  const data = requireRecord(args, 'arguments')
  const sessionId = requireNonEmptyString(data.sessionId, 'sessionId')
  if (!state.getSession(sessionId, ctx.authUser.userId)) throw new HttpError(404, 'Session not found')
  return { workflow: await ctx.router.rerunPipelineStep(sessionId) }
}

async function mcpStopRun(args: unknown, ctx: McpContext): Promise<unknown> {
  const data = requireRecord(args, 'arguments')
  const id = requireNonEmptyString(data.id, 'id')
  const kind = requireNonEmptyString(data.kind, 'kind')
  if (kind === 'task') {
    if (!state.getTask(id, ctx.authUser.userId)) throw new HttpError(404, 'Task not found')
    return { task: await ctx.router.stopTask(id) }
  }
  if (kind === 'session') {
    if (!state.getSession(id, ctx.authUser.userId)) throw new HttpError(404, 'Session not found')
    return { session: await ctx.router.stopSession(id) }
  }
  if (kind === 'workflow') {
    if (!state.getPipeline(id, ctx.authUser.userId)) throw new HttpError(404, 'Workflow not found')
    return { workflow: await ctx.router.pausePipeline(id) }
  }
  throw new HttpError(400, '"kind" must be one of task, session, workflow')
}

function mcpReadArtifact(args: unknown): unknown {
  const data = requireRecord(args, 'arguments')
  const filePath = resolvePreviewFile(requireNonEmptyString(data.path, 'path'), optionalString(data.cwd, 'cwd'))
  const mimeType = previewMimeType(filePath)
  if (!mimeType.startsWith('text/') && !mimeType.includes('json') && !mimeType.includes('yaml')) {
    throw new HttpError(415, 'Only text artifacts can be read through MCP')
  }
  const maxChars = optionalPositiveInt(data.maxChars, 'maxChars') ?? 50_000
  const content = fs.readFileSync(filePath, 'utf-8')
  return {
    path: filePath,
    mimeType,
    truncated: content.length > maxChars,
    content: content.slice(0, maxChars),
  }
}

function normalizeTaskArgs(args: unknown): unknown {
  const data = requireRecord(args, 'arguments')
  return {
    ...data,
    agent: normalizeAgentArg(data.agent, 'agent'),
  }
}

function normalizeSessionArgs(args: unknown): unknown {
  const data = requireRecord(args, 'arguments')
  return {
    ...data,
    from: normalizeAgentArg(data.from, 'from'),
    to: normalizeAgentArg(data.to, 'to'),
  }
}

function normalizeWorkflowArgs(args: unknown): unknown {
  const data = requireRecord(args, 'arguments')
  if (!Array.isArray(data.steps)) return data
  return {
    ...data,
    steps: data.steps.map((rawStep, index) => {
      const step = requireRecord(rawStep, `steps[${index}]`)
      return {
        ...step,
        ...(step.agent !== undefined ? { agent: normalizeAgentArg(step.agent, `steps[${index}].agent`) } : {}),
        ...(step.from !== undefined ? { from: normalizeAgentArg(step.from, `steps[${index}].from`) } : {}),
        ...(step.to !== undefined ? { to: normalizeAgentArg(step.to, `steps[${index}].to`) } : {}),
      }
    }),
  }
}

function normalizeAgentArg(value: unknown, field: string): AgentRef {
  if (typeof value === 'string') return { adapter: value }
  return parseAgentRef(value, field)
}

function sessionApiDocs() {
  return {
    auth: {
      localLogin: 'POST /api/auth/local',
      header: 'Authorization: Bearer <token>',
    },
    createSession: {
      method: 'POST',
      path: '/api/sessions',
      body: {
        from: { adapter: 'opencode' },
        to: { adapter: 'claude-code' },
        initialPrompt: 'Write the article from this brief...',
        mode: 'freeform',
        maxRounds: 1,
        permissionMode: 'safe',
        cwd: '/optional/project/path',
        context: {
          text: 'Background context',
          rules: 'Output markdown only',
          files: ['docs/brief.md'],
        },
      },
    },
    createTask: {
      method: 'POST',
      path: '/api/tasks',
      description: 'If "agent" is omitted, Passiton selects the highest-priority usable agent (lower priority number first, ready before unverified, name tie-break).',
      body: {
        agent: { adapter: 'opencode' },
        prompt: 'Write the article from this brief...',
        cwd: '/optional/project/path',
        context: {
          text: 'Background context',
          rules: 'Output markdown only',
          files: ['docs/brief.md'],
        },
      },
    },
    handoffTask: {
      method: 'POST',
      path: '/api/tasks/:id/handoff',
      description: 'Continue an errored or stopped task as a new task with an accepted task agent.',
      body: {
        agent: { adapter: 'codex' },
      },
    },
    readSession: 'GET /api/sessions/:id',
    stopTask: 'POST /api/tasks/:id/stop',
    control: [
      'POST /api/sessions/:id/message',
      'POST /api/sessions/:id/nudge',
      'POST /api/sessions/:id/pause',
      'POST /api/sessions/:id/resume',
      'POST /api/sessions/:id/stop',
    ],
    agents: {
      list: 'GET /api/agents',
      refreshList: 'GET /api/agents?refresh=1',
      diagnostics: 'GET /api/agents/:name/diagnostics?refresh=1',
    },
    opsModel: {
      get: {
        method: 'GET',
        path: '/api/ops/model',
        description: 'Return the dedicated Ops model configuration with the API key masked, plus the effective fallback when no dedicated model is configured.',
      },
      set: {
        method: 'PUT',
        path: '/api/ops/model',
        description: 'Configure and smoke-test the dedicated Ops model. The API key is encrypted in the hidden user_agents record and is never stored in config.json.',
        body: {
          adapter: 'openai-api',
          model: 'gpt-4o-mini',
          baseUrl: 'https://api.example.com/v1/chat/completions',
          apiKey: '<provider-api-key>',
        },
      },
      clear: {
        method: 'DELETE',
        path: '/api/ops/model',
        description: 'Clear the dedicated Ops model and revert Ops selection to the API Assistant fallback.',
      },
    },
    agentManagement: {
      createApiAgent: {
        method: 'POST',
        path: '/api/agents',
        description: 'Create an API-backed agent (API Assistant) using a saved Provider Key. keyId is required.',
        body: {
          name: 'my-openai-agent',
          adapter: 'openai-api',
          keyId: '<provider-key-id from POST /api/keys>',
          model: 'gpt-4o',
          baseUrl: 'https://api.example.com/v1',
          timeout: 120000,
        },
      },
      updateApiAgent: {
        method: 'PUT',
        path: '/api/agents/:name',
        description: 'Update an existing API Assistant. keyId is required when changing adapter.',
        body: {
          name: 'my-openai-agent',
          adapter: 'openai-api',
          model: 'gpt-4o-mini',
        },
      },
      deleteApiAgent: {
        method: 'DELETE',
        path: '/api/agents/:name',
        description: 'Delete an API Assistant.',
      },
      createCliAgent: {
        method: 'POST',
        path: '/api/config/agents',
        description: 'Register a supported local CLI Agent in the server config file. custom-cli requires command plus args containing {prompt}; env is an optional string map.',
        body: {
          name: 'my-aider',
          adapter: 'custom-cli',
          command: 'aider',
          args: ['--message', '{prompt}'],
          timeout: 600000,
          env: { AIDER_MODEL: 'sonnet' },
        },
      },
      updateCliAgent: {
        method: 'PUT',
        path: '/api/config/agents/:name',
        description: 'Update an existing local CLI Agent configuration.',
        body: {
          name: 'my-codex',
          adapter: 'codex',
          command: 'codex',
        },
      },
      deleteCliAgent: {
        method: 'DELETE',
        path: '/api/config/agents/:name',
        description: 'Remove a local CLI Agent from the server config file.',
      },
    },
    pipelineTemplates: 'GET /api/pipeline-templates',
  }
}

function parsePipelineSteps(stepsValue: unknown) {
  if (!Array.isArray(stepsValue) || stepsValue.length === 0) {
    throw new HttpError(400, '"steps" must be a non-empty array')
  }

  return stepsValue.map((value, index) => {
    const step = requireRecord(value, `steps[${index}]`)
    let dependsOn: number[] | undefined
    if (step.dependsOn !== undefined) {
      if (!Array.isArray(step.dependsOn)) {
        throw new HttpError(400, `"steps[${index}].dependsOn" must be an array`)
      }
      dependsOn = step.dependsOn.map((dep, depIndex) => {
        if (typeof dep !== 'number' || !Number.isInteger(dep) || dep < 0 || dep >= stepsValue.length || dep === index) {
          throw new HttpError(400, `"steps[${index}].dependsOn[${depIndex}]" must be a valid step index`)
        }
        return dep
      })
    }

    const agent = step.agent !== undefined ? parseAgentRef(step.agent, `steps[${index}].agent`) : undefined
    const nodeType = parseWorkflowNodeType(step.nodeType, `steps[${index}].nodeType`)
    const effectiveAgent = workflowAgentForNode(nodeType, agent)
    const explicitFrom = step.from !== undefined ? parseAgentRef(step.from, `steps[${index}].from`) : undefined
    const contract = step.contract === undefined ? undefined : parseWorkflowStepContract(step.contract, `steps[${index}].contract`)
    return {
      title: optionalString(step.title, `steps[${index}].title`),
      nodeType,
      agent: effectiveAgent,
      contract,
      from: explicitFrom ?? effectiveAgent!,
      to: effectiveAgent ?? parseAgentRef(step.to, `steps[${index}].to`),
      initialPrompt: requireNonEmptyString(step.initialPrompt, `steps[${index}].initialPrompt`),
      mode: parseSessionMode(step.mode),
      context: parseSessionContext(step.context, `steps[${index}].context`),
      maxRounds: optionalPositiveInt(step.maxRounds, `steps[${index}].maxRounds`),
      approveMode: optionalBoolean(step.approveMode, `steps[${index}].approveMode`),
      permissionMode: parsePermissionMode(step.permissionMode, `steps[${index}].permissionMode`),
      cwd: optionalString(step.cwd, `steps[${index}].cwd`),
      outputDir: optionalString(step.outputDir, `steps[${index}].outputDir`),
      manualDone: optionalBoolean(step.manualDone, `steps[${index}].manualDone`),
      manualOutput: optionalString(step.manualOutput, `steps[${index}].manualOutput`),
      dependsOn,
    }
  })
}

function workflowAgentForNode(nodeType: WorkflowNodeType | undefined, requested: AgentRef | undefined): AgentRef | undefined {
  if (nodeType === 'image_generate' && !requested) return { adapter: 'codex', label: 'Codex' }
  return requested
}

function parseWorkflowNodeType(value: unknown, field: string): WorkflowNodeType | undefined {
  const nodeType = optionalString(value, field)
  if (nodeType === undefined) return undefined
  const allowed: WorkflowNodeType[] = ['video_parse', 'copy_adapt', 'storyboard_script', 'image_generate', 'video_command', 'video_generate', 'human_review', 'custom']
  if (!allowed.includes(nodeType as WorkflowNodeType)) throw new HttpError(400, `"${field}" is invalid`)
  return nodeType as WorkflowNodeType
}

function parseWorkflowStepContract(value: unknown, field: string) {
  const data = requireRecord(value, field)
  const inputs = optionalStringArray(data.inputs, `${field}.inputs`)
  let outputs: Array<{ fileName: string; requiredSections?: string[] }> | undefined
  if (data.outputs !== undefined) {
    if (!Array.isArray(data.outputs)) throw new HttpError(400, `"${field}.outputs" must be an array`)
    outputs = data.outputs.map((item, index) => {
      const output = requireRecord(item, `${field}.outputs[${index}]`)
      return {
        fileName: requireNonEmptyString(output.fileName, `${field}.outputs[${index}].fileName`),
        requiredSections: optionalStringArray(output.requiredSections, `${field}.outputs[${index}].requiredSections`),
      }
    })
  }
  return {
    ...(inputs?.length ? { inputs } : {}),
    ...(outputs?.length ? { outputs } : {}),
  }
}

function parsePipelineBody(body: unknown) {
  const data = requireRecord(body, 'body')
  const startAtStep = optionalPositiveInt(data.startAtStep, 'startAtStep')
  const manualOutput = optionalString(data.manualOutput, 'manualOutput')
  const steps = parsePipelineSteps(data.steps)

  if (startAtStep !== undefined && startAtStep > steps.length) {
    throw new HttpError(400, '"startAtStep" must point to an existing step')
  }

  return {
    name: requireNonEmptyString(data.name, 'name'),
    steps: steps.map((step, index) => (
      startAtStep !== undefined && index < startAtStep - 1
        ? { ...step, manualDone: true, manualOutput: step.manualOutput ?? manualOutput }
        : step
    )),
  }
}

function parsePipelineTemplateBody(body: unknown): Omit<PipelineTemplateRecord, 'id' | 'userId' | 'source' | 'createdAt' | 'updatedAt'> {
  const data = requireRecord(body, 'body')
  return {
    name: requireNonEmptyString(data.name, 'name'),
    description: optionalString(data.description, 'description'),
    steps: parsePipelineSteps(data.steps),
  }
}

function builtInPipelineTemplateRecords(): PipelineTemplateRecord[] {
  return pipelineTemplates.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    steps: template.steps.map((step) => ({
      title: step.title,
      nodeType: step.nodeType,
      agent: step.agent,
      contract: step.contract,
      from: step.from,
      to: step.to,
      initialPrompt: step.initialPrompt,
      mode: step.mode,
      maxRounds: step.maxRounds,
      approveMode: step.approveMode,
      permissionMode: step.permissionMode,
      dependsOn: step.dependsOn,
      cwd: step.cwd,
      outputDir: step.outputDir,
      context: step.context,
      manualDone: step.manualDone,
      manualOutput: step.manualOutput,
    })),
    source: 'builtin',
    createdAt: 0,
    updatedAt: 0,
  }))
}

function parseResumeBody(body: unknown): { extraRounds?: number; agentOverride?: AgentRef; permissionMode?: Session['permissionMode'] } {
  const data = requireRecord(body, 'body')
  return {
    extraRounds: optionalPositiveInt(data.extraRounds, 'extraRounds'),
    agentOverride: data.agentOverride === undefined ? undefined : parseAgentRef(data.agentOverride, 'agentOverride'),
    permissionMode: parsePermissionMode(data.permissionMode),
  }
}

function parseHumanMessageBody(body: unknown): { content: string } {
  const data = requireRecord(body, 'body')
  return {
    content: requireNonEmptyString(data.content, 'content'),
  }
}

function parseOpsDiagnoseBody(body: unknown): { question?: string; target?: OpsTarget; page?: OpsPageContext } {
  const data = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
  const targetData = data.target && typeof data.target === 'object' && !Array.isArray(data.target)
    ? data.target as Record<string, unknown>
    : undefined
  const kind = targetData?.kind
  const target: OpsTarget | undefined = targetData && (kind === 'task' || kind === 'session' || kind === 'workflow') && typeof targetData.id === 'string'
    ? { kind: kind as OpsTarget['kind'], id: targetData.id }
    : undefined
  const pageData = data.page && typeof data.page === 'object' && !Array.isArray(data.page)
    ? data.page as Record<string, unknown>
    : undefined
  return {
    question: optionalString(data.question, 'question'),
    target,
    page: pageData
      ? {
          path: optionalString(pageData.path, 'page.path'),
          title: optionalString(pageData.title, 'page.title'),
          summary: optionalString(pageData.summary, 'page.summary'),
          visibleText: optionalString(pageData.visibleText, 'page.visibleText')?.slice(0, 4000),
        }
      : undefined,
  }
}

function parseOpsActionBody(body: unknown): { actionId: OpsAction['id']; target: Required<OpsTarget>; confirmed: boolean } {
  const data = requireRecord(body, 'body')
  const actionId = optionalString(data.actionId, 'actionId')
  if (actionId !== 'stop_task' && actionId !== 'rerun_task' && actionId !== 'resume_session' && actionId !== 'rerun_workflow_step' && actionId !== 'create_repair_task') {
    throw new HttpError(400, 'Unsupported ops action')
  }
  const targetData = requireRecord(data.target, 'target')
  const kind = optionalString(targetData.kind, 'target.kind')
  if (kind !== 'task' && kind !== 'session' && kind !== 'workflow') throw new HttpError(400, 'Invalid target.kind')
  return {
    actionId,
    target: { kind, id: requireNonEmptyString(targetData.id, 'target.id') },
    confirmed: data.confirmed === true,
  }
}

function parseNudgeBody(body: unknown): { content: string } {
  const data = requireRecord(body, 'body')
  return {
    content: requireNonEmptyString(data.content, 'content'),
  }
}

async function executeOpsAction(
  router: Router,
  userId: string,
  input: { actionId: OpsAction['id']; target: Required<OpsTarget>; confirmed: boolean }
): Promise<unknown> {
  if (!input.confirmed) throw new HttpError(400, 'Ops action requires explicit confirmation')
  const { actionId, target } = input
  if ((actionId === 'stop_task' || actionId === 'rerun_task' || actionId === 'create_repair_task') && target.kind !== 'task') {
    throw new HttpError(400, 'Task action requires task target')
  }
  if (actionId === 'resume_session' && target.kind !== 'session') {
    throw new HttpError(400, 'Session action requires session target')
  }
  if (actionId === 'rerun_workflow_step' && target.kind !== 'session') {
    throw new HttpError(400, 'Workflow step rerun requires session target')
  }

  if (actionId === 'stop_task') {
    if (!state.getTask(target.id, userId)) throw new HttpError(404, 'Task not found')
    return { action: actionId, task: await router.stopTask(target.id) }
  }

  if (actionId === 'resume_session') {
    if (!state.getSession(target.id, userId)) throw new HttpError(404, 'Session not found')
    return { action: actionId, session: await router.resumeSession(target.id) }
  }

  if (actionId === 'rerun_workflow_step') {
    if (!state.getSession(target.id, userId)) throw new HttpError(404, 'Session not found')
    return { action: actionId, workflow: await router.rerunPipelineStep(target.id) }
  }

  const task = state.getTask(target.id, userId)
  if (!task) throw new HttpError(404, 'Task not found')
  if (actionId === 'rerun_task') {
    const created = router.startTask({
      userId,
      agent: task.agent,
      prompt: task.prompt,
      cwd: task.cwd,
      context: task.context,
      systemPrompt: task.systemPrompt,
      permissionMode: task.permissionMode,
    })
    return { action: actionId, task: created }
  }

  const previous = task.result || task.output || task.lastAgentOutput || task.errorMessage || ''
  const created = router.startTask({
    userId,
    agent: task.agent,
    cwd: task.cwd,
    context: task.context,
    systemPrompt: task.systemPrompt,
    permissionMode: task.permissionMode,
    prompt: [
      'You are a repair task created by Passiton Ops. Fix only the issue exposed by the failed task below.',
      'Requirements: check the current workspace state first; edit only necessary files; do not push; do not rewrite history; finish with a change summary.',
      '',
      '## Original Task',
      task.prompt,
      '',
      previous ? `## Failure Output or Error\n${previous}` : '',
    ].filter(Boolean).join('\n'),
  })
  return { action: actionId, task: created }
}

export function createServer(router: Router, port: number, agentCatalog: AgentCatalog, host?: string): http.Server {
  const clients = new Map<WebSocket, string>()

  // Forward router events only to the owner. Some events only carry a sessionId,
  // so ownership is resolved from SQLite before sending.
  router.on('event', (event: WsEvent) => {
    const userId = eventUserId(event)
    const payload = JSON.stringify(event)
    for (const [ws, clientUserId] of clients) {
      if (ws.readyState === 1 /* OPEN */) {
        if (userId && userId !== clientUserId) continue
        ws.send(payload)
      }
    }
  })

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`)
    const pathname = url.pathname
    const method = req.method ?? 'GET'

    if (!configureCors(req, res)) {
      res.writeHead(403)
      res.end('CORS origin not allowed')
      return
    }
    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    try {
      // ── API routes ─────────────────────────────────────────────────────────

      // GET /health — unauthenticated liveness check for Docker/Fly.
      if (pathname === '/health' && method === 'GET') {
        return json(res, 200, { ok: true })
      }

      // GET /api/docs — public machine-readable HTTP API reference.
      if (pathname === '/api/docs' && method === 'GET') {
        return await sendJson(req, res, 200, sessionApiDocs())
      }

      if ((pathname === '/mcp' || pathname === '/api/mcp') && method === 'GET') {
        logMcp(`[mcp] GET ${pathname} token=${url.searchParams.has('token') ? 'query' : 'none'} accept=${req.headers.accept ?? ''} ua=${req.headers['user-agent'] ?? ''}`)
        const authUser = authenticateMcpRequest(req, url)
        if (String(req.headers.accept ?? '').includes('text/event-stream')) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-store',
            'Connection': 'keep-alive',
            'Mcp-Session-Id': authUser.userId,
          })
          res.write(': connected\n\n')
          const heartbeat = setInterval(() => {
            if (!res.destroyed) res.write(': ping\n\n')
          }, 25_000)
          req.on('close', () => clearInterval(heartbeat))
          return
        }
        return json(res, 200, mcpServerMetadata())
      }

      if ((pathname === '/mcp' || pathname === '/api/mcp') && method === 'POST') {
        logMcp(`[mcp] POST ${pathname} token=${url.searchParams.has('token') ? 'query' : 'none'} accept=${req.headers.accept ?? ''} ua=${req.headers['user-agent'] ?? ''}`)
        const authUser = authenticateMcpRequest(req, url)
        const body = await parseBody(req)
        if (typeof body === 'object' && body) {
          const methodName = Array.isArray(body)
            ? `batch:${body.length}`
            : 'method' in body
              ? String((body as { method?: unknown }).method)
              : 'unknown'
          logMcp(`[mcp] rpc ${methodName}`)
        }
        const result = await handleMcpRpc(body, { router, agentCatalog, authUser })
        if (result === undefined) {
          res.writeHead(202, { 'Cache-Control': 'no-store' })
          res.end()
          return
        }
        res.setHeader('Mcp-Session-Id', authUser.userId)
        return json(res, 200, result)
      }

      // POST /api/auth/login
      if (pathname === '/api/auth/login' && method === 'POST') {
        const { email, password } = parseAuthBody(await parseBody(req))
        const result = loginUser(email, password)
        setAuthCookie(req, res, result.token)
        return json(res, 200, { token: result.token, user: result.user })
      }

      // POST /api/auth/local
      if (pathname === '/api/auth/local' && method === 'POST') {
        const config = loadConfig()
        if (!config.auth?.localAccess) {
          throw new HttpError(403, 'Local access is disabled')
        }
        const result = loginLocalUser(config.auth.localUserEmail)
        setAuthCookie(req, res, result.token)
        return json(res, 200, { token: result.token, user: result.user })
      }

      // POST /api/auth/register
      if (pathname === '/api/auth/register' && method === 'POST') {
        if (!loadConfig().auth?.allowRegistration) {
          throw new HttpError(403, 'Registration is disabled')
        }
        const { email, password } = parseAuthBody(await parseBody(req))
        const result = registerUser(email, password)
        setAuthCookie(req, res, result.token)
        return json(res, 201, { token: result.token, user: result.user })
      }

      const authUser = pathname.startsWith('/api/') ? authenticateRequest(req) : undefined

      // GET /api/auth/tokens
      if (pathname === '/api/auth/tokens' && method === 'GET') {
        return json(res, 200, listUserTokens(authUser!.userId))
      }

      // POST /api/auth/tokens
      if (pathname === '/api/auth/tokens' && method === 'POST') {
        const { name } = parseTokenBody(await parseBody(req))
        return json(res, 201, createUserToken(authUser!.userId, name))
      }

      // DELETE /api/auth/tokens/:id
      const tokenMatch = pathname.match(/^\/api\/auth\/tokens\/([^/]+)$/)
      if (tokenMatch && method === 'DELETE') {
        if (!revokeUserToken(authUser!.userId, tokenMatch[1])) return json(res, 404, { error: 'Not found' })
        return json(res, 200, { success: true })
      }

      // GET /api/keys
      if (pathname === '/api/keys' && method === 'GET') {
        return json(res, 200, providerKeyList(authUser!.userId))
      }

      // POST /api/keys
      if (pathname === '/api/keys' && method === 'POST') {
        const key = parseApiKeyBody(await parseBody(req))
        return json(res, 201, storeKey({ userId: authUser!.userId, ...key }))
      }

      // GET /api/keys/:id/decrypt
      const apiKeyDecryptMatch = pathname.match(/^\/api\/keys\/([^/]+)\/decrypt$/)
      if (apiKeyDecryptMatch && method === 'GET') {
        return json(res, 200, decryptKey(authUser!.userId, apiKeyDecryptMatch[1]))
      }

      // DELETE /api/keys/:id
      const apiKeyMatch = pathname.match(/^\/api\/keys\/([^/]+)$/)
      if (apiKeyMatch && method === 'DELETE') {
        if (!deleteKey(authUser!.userId, apiKeyMatch[1])) return json(res, 404, { error: 'Not found' })
        return json(res, 200, { success: true })
      }

      // GET /api/agents
      if (pathname === '/api/agents' && method === 'GET') {
        const refresh = url.searchParams.get('refresh') === '1'
        const agents = await listAgentModels(authUser!.userId, agentCatalog, { refresh })
        return json(res, 200, agents)
      }

      // GET /api/agents/:name/diagnostics
      const agentDiagnosticsMatch = pathname.match(/^\/api\/agents\/([^/]+)\/diagnostics$/)
      if (agentDiagnosticsMatch && method === 'GET') {
        const refresh = url.searchParams.get('refresh') !== '0'
        const agentName = decodeURIComponent(agentDiagnosticsMatch[1])
        const apiDiagnostic = await diagnoseApiAgent(authUser!.userId, agentName, refresh)
        if (apiDiagnostic) return json(res, 200, apiDiagnostic)
        const diagnostic = await agentCatalog.diagnoseAgent(agentName, refresh)
        if (!diagnostic) return json(res, 404, { error: 'Not found' })
        return json(res, 200, diagnostic)
      }

      // POST /api/agents
      if (pathname === '/api/agents' && method === 'POST') {
        const parsed = parseApiAgentConfigBody(await parseBody(req))
        if (!parsed.keyId) {
          throw new HttpError(400, 'Choose a saved Provider Key before creating an Agent')
        }
        const apiKey = resolveApiKeySelection(authUser!.userId, parsed)
        await assertApiAgentUsable(parsed.name, {
          adapter: parsed.adapter,
          model: parsed.model,
          baseUrl: parsed.baseUrl,
          timeout: parsed.timeout,
          apiKey,
        })
        const encrypted = apiKey ? encryptSecret(authUser!.userId, apiKey) : {}
        try {
          state.createUserAgent({
            id: crypto.randomUUID(),
            userId: authUser!.userId,
            name: parsed.name,
            adapter: parsed.adapter,
            model: parsed.model,
            baseUrl: parsed.baseUrl,
            timeout: parsed.timeout,
            ...encrypted,
          })
        } catch (err) {
          if (err instanceof Error && err.message.includes('UNIQUE')) {
            throw new HttpError(409, `Agent "${parsed.name}" already exists`)
          }
          throw err
        }
        reloadUserAgents(router, authUser!.userId)
        return json(res, 201, await listAgentModels(authUser!.userId, agentCatalog))
      }

      const userAgentMatch = pathname.match(/^\/api\/agents\/([^/]+)$/)
      if (userAgentMatch && method === 'PUT') {
        const current = state.getUserAgent(authUser!.userId, decodeURIComponent(userAgentMatch[1]))
        if (!current) return json(res, 404, { error: 'Not found' })
        const parsed = parseApiAgentConfigBody(await parseBody(req), current)
        if (parsed.adapter !== current.adapter && !parsed.keyId) {
          throw new HttpError(400, 'Choose a saved Provider Key when changing adapter')
        }
        const apiKey = resolveApiKeySelection(authUser!.userId, parsed) ?? decryptUserAgentKey(current)
        await assertApiAgentUsable(parsed.name, {
          adapter: parsed.adapter,
          model: parsed.model,
          baseUrl: parsed.baseUrl,
          timeout: parsed.timeout,
          apiKey,
        })
        const encrypted = apiKey ? encryptSecret(authUser!.userId, apiKey) : undefined
        try {
          state.updateUserAgent(authUser!.userId, current.name, {
            name: parsed.name,
            adapter: parsed.adapter,
            model: parsed.model,
            baseUrl: parsed.baseUrl,
            timeout: parsed.timeout,
            ...(encrypted ? encrypted : {}),
          })
        } catch (err) {
          if (err instanceof Error && err.message.includes('UNIQUE')) {
            throw new HttpError(409, `Agent "${parsed.name}" already exists`)
          }
          throw err
        }
        reloadUserAgents(router, authUser!.userId)
        return json(res, 200, await listAgentModels(authUser!.userId, agentCatalog))
      }

      if (userAgentMatch && method === 'DELETE') {
        if (!state.deleteUserAgent(authUser!.userId, decodeURIComponent(userAgentMatch[1]))) {
          return json(res, 404, { error: 'Not found' })
        }
        reloadUserAgents(router, authUser!.userId)
        return json(res, 200, await listAgentModels(authUser!.userId, agentCatalog))
      }

      // GET /api/templates
      if (pathname === '/api/templates' && method === 'GET') {
        return json(res, 200, templates)
      }

      // GET /api/pipeline-templates
      if (pathname === '/api/pipeline-templates' && method === 'GET') {
        return json(res, 200, [
          ...state.listPipelineTemplates(authUser!.userId),
          ...builtInPipelineTemplateRecords(),
        ])
      }

      // POST /api/pipeline-templates
      if (pathname === '/api/pipeline-templates' && method === 'POST') {
        const params = parsePipelineTemplateBody(await parseBody(req))
        return json(res, 201, state.createPipelineTemplate({
          id: crypto.randomUUID(),
          userId: authUser!.userId,
          ...params,
        }))
      }

      // DELETE /api/pipeline-templates/:id
      const pipelineTemplateMatch = pathname.match(/^\/api\/pipeline-templates\/([^/]+)$/)
      if (pipelineTemplateMatch && method === 'DELETE') {
        if (!state.deletePipelineTemplate(pipelineTemplateMatch[1], authUser!.userId)) {
          return json(res, 404, { error: 'Not found' })
        }
        return json(res, 200, { success: true })
      }

      // GET /api/stats
      if (pathname === '/api/stats' && method === 'GET') {
        return json(res, 200, state.getStats(authUser!.userId))
      }

      // GET /api/ops/status
      if (pathname === '/api/ops/status' && method === 'GET') {
        return json(res, 200, await buildOpsReport(authUser!.userId, agentCatalog))
      }

      // GET /api/ops/model
      if (pathname === '/api/ops/model' && method === 'GET') {
        return json(res, 200, await getOpsModelResponse(authUser!.userId, { refresh: url.searchParams.get('refresh') === '1' }))
      }

      // PUT /api/ops/model
      if (pathname === '/api/ops/model' && method === 'PUT') {
        return json(res, 200, await saveOpsModel(authUser!.userId, await parseBody(req)))
      }

      // DELETE /api/ops/model
      if (pathname === '/api/ops/model' && method === 'DELETE') {
        state.deleteUserAgent(authUser!.userId, opsModelAgentName())
        return json(res, 200, await getOpsModelResponse(authUser!.userId))
      }

      // POST /api/ops/diagnose
      if (pathname === '/api/ops/diagnose' && method === 'POST') {
        return json(res, 200, await buildOpsReport(authUser!.userId, agentCatalog, parseOpsDiagnoseBody(await parseBody(req))))
      }

      // POST /api/ops/action
      if (pathname === '/api/ops/action' && method === 'POST') {
        return json(res, 200, await executeOpsAction(router, authUser!.userId, parseOpsActionBody(await parseBody(req))))
      }

      // GET /api/config
      if (pathname === '/api/config' && method === 'GET') {
        return json(res, 200, loadConfig())
      }

      // PUT /api/config
      if (pathname === '/api/config' && method === 'PUT') {
        const current = loadConfig()
        const global = parseGlobalConfigBody(await parseBody(req))
        const allowedWorkspaces = global.allowedWorkspaces === undefined ? undefined : validateAllowedWorkspaces(global.allowedWorkspaces)
        if (allowedWorkspaces && allowedWorkspaces.ok.length === 0 && allowedWorkspaces.rejected.length > 0) {
          throw new HttpError(400, `No safe allowedWorkspaces entries were provided; ${formatAllowedWorkspaceRejections(allowedWorkspaces.rejected)}`)
        }
        const updated: AppConfig = {
          ...current,
          server: { ...current.server, port: global.port },
          defaults: { maxRounds: global.maxRounds, mode: global.mode },
          policy: {
            ...current.policy,
            maxRounds: global.maxRounds,
            ...(allowedWorkspaces !== undefined ? { allowedWorkspaces: allowedWorkspaces.ok } : {}),
          },
        }
        writeConfig(updated)
        const saved = loadConfig()
        return json(res, 200, allowedWorkspaces && allowedWorkspaces.rejected.length > 0
          ? { ...saved, warning: `Dropped unsafe allowedWorkspaces entries; ${formatAllowedWorkspaceRejections(allowedWorkspaces.rejected)}` }
          : saved)
      }

      // GET /api/files/content
      if (pathname === '/api/files/content' && method === 'GET') {
        const filePath = resolvePreviewFile(
          requireNonEmptyString(url.searchParams.get('path'), 'path'),
          optionalString(url.searchParams.get('cwd'), 'cwd')
        )
        return streamPreviewFile(req, res, filePath)
      }

      // POST /api/files/resolve
      if (pathname === '/api/files/resolve' && method === 'POST') {
        const body = parseFileResolveBody(await parseBody(req))
        assertAllowedWorkspace(body.cwd, 'cwd')
        return json(res, 200, body.paths.map((source) => {
          const resolved = resolveWorkflowFile(source, body.cwd, body.baseFile)
          return {
            source,
            exists: Boolean(resolved),
            ...(resolved ? { path: resolved } : {}),
          }
        }))
      }

      // POST /api/files/preview
      if (pathname === '/api/files/preview' && method === 'POST') {
        const body = parseFilePreviewBody(await parseBody(req))
        const filePath = resolvePreviewFile(body.path, body.cwd)
        const stat = fs.statSync(filePath)
        const mimeType = previewMimeType(filePath)
        const isImage = mimeType.startsWith('image/')
        const isVideo = mimeType.startsWith('video/')
        const isAudio = mimeType.startsWith('audio/')
        const maxPreviewSize = isImage ? MAX_IMAGE_FILE_PREVIEW_SIZE : MAX_FILE_PREVIEW_SIZE
        if (!isVideo && !isAudio && stat.size > maxPreviewSize) throw new HttpError(413, `File too large to preview (max ${maxPreviewSize} bytes)`)
        const content = isVideo || isAudio
          ? undefined
          : isImage
          ? fs.readFileSync(filePath).toString('base64')
          : fs.readFileSync(filePath, 'utf-8')
        return json(res, 200, {
          path: filePath,
          name: path.basename(filePath),
          size: stat.size,
          mtime: stat.mtimeMs,
          mimeType,
          encoding: isVideo || isAudio ? 'stream' : isImage ? 'base64' : 'utf-8',
          ...(isVideo || isAudio ? { streamUrl: `/api/files/content?path=${encodeURIComponent(filePath)}` } : {}),
          content,
        })
      }

      // GET /api/deploy/check
      if (pathname === '/api/deploy/check' && method === 'GET') {
        const startedAt = Date.now()
        const agents = await listAgentModels(authUser!.userId, agentCatalog)
        return json(res, 200, {
          ok: true,
          node: process.version,
          pid: process.pid,
          uptimeMs: Math.round(process.uptime() * 1000),
          configPath: getConfigPath(),
          agents: agents.length,
          checkedAt: Date.now(),
          durationMs: Date.now() - startedAt,
        })
      }

      // POST /api/config/agents
      if (pathname === '/api/config/agents' && method === 'POST') {
        const current = loadConfig()
        const { name, config } = parseAgentConfigBody(await parseBody(req))
        if (current.agents[name]) {
          throw new HttpError(409, `Agent "${name}" already exists`)
        }
        const updated: AppConfig = {
          ...current,
          agents: { ...current.agents, [name]: config },
        }
        writeConfig(updated)
        const saved = loadConfig()
        await reloadAgents(router, agentCatalog, saved)
        await listAgentModels(authUser!.userId, agentCatalog, { refresh: true })
        return json(res, 201, saved)
      }

      const configAgentName = agentNameFromPath(pathname)
      if (configAgentName && method === 'PUT') {
        const current = loadConfig()
        const existing = current.agents[configAgentName]
        if (!existing) return json(res, 404, { error: 'Not found' })
        const { name, config } = parseAgentConfigBody(await parseBody(req), existing)
        if (name !== configAgentName && current.agents[name]) {
          throw new HttpError(409, `Agent "${name}" already exists`)
        }
        const agents = { ...current.agents }
        delete agents[configAgentName]
        agents[name] = config
        const updated: AppConfig = { ...current, agents }
        writeConfig(updated)
        const saved = loadConfig()
        await reloadAgents(router, agentCatalog, saved)
        return json(res, 200, saved)
      }

      if (configAgentName && method === 'DELETE') {
        const current = loadConfig()
        if (!current.agents[configAgentName]) return json(res, 404, { error: 'Not found' })
        const agents = { ...current.agents }
        delete agents[configAgentName]
        const updated: AppConfig = { ...current, agents }
        writeConfig(updated)
        const saved = loadConfig()
        reloadAgents(router, agentCatalog, saved)
        return json(res, 200, saved)
      }

      // GET /api/pipelines
      if (pathname === '/api/pipelines' && method === 'GET') {
        const limit = parsePositiveInt(url.searchParams.get('limit'))
        const offset = parsePositiveInt(url.searchParams.get('offset'))
        return json(res, 200, state.listPipelines(
          authUser!.userId,
          { ...(limit ? { limit } : {}), ...(offset ? { offset } : {}) }
        ))
      }

      // POST /api/pipelines
      if (pathname === '/api/pipelines' && method === 'POST') {
        const defaults = loadConfig().defaults
        const params = parsePipelineBody(await parseBody(req))
        for (const [index, step] of params.steps.entries()) {
          assertAllowedWorkspace(step.cwd, `steps[${index}].cwd`)
          assertAllowedWorkspace(step.outputDir, `steps[${index}].outputDir`)
          assertPermissionModeAllowed(step.permissionMode, step.cwd, `steps[${index}].permissionMode`)
        }
        const pipeline = router.startPipeline({
          userId: authUser!.userId,
          name: params.name,
          steps: params.steps.map((step) => ({
            ...step,
            context: appendOutputDirContext(resolveSessionContext(step.context, step.cwd), step.outputDir),
            mode: step.mode ?? defaults.mode,
            maxRounds: step.maxRounds ?? defaults.maxRounds,
          })),
        })
        return json(res, 201, pipeline)
      }

      // GET /api/pipelines/:id
      const pipelineMatch = pathname.match(/^\/api\/pipelines\/([^/]+)$/)
      if (pipelineMatch && method === 'GET') {
        const pipeline = state.getPipelineWithSessions(pipelineMatch[1], authUser!.userId)
        if (!pipeline) return json(res, 404, { error: 'Not found' })
        return json(res, 200, pipeline)
      }

      // DELETE /api/pipelines/:id
      if (pipelineMatch && method === 'DELETE') {
        const pipeline = state.getPipeline(pipelineMatch[1], authUser!.userId)
        if (!pipeline) return json(res, 404, { error: 'Not found' })
        await router.deletePipeline(pipelineMatch[1])
        return json(res, 200, { success: true })
      }

      // POST /api/pipelines/:id/pause
      const pipelinePauseMatch = pathname.match(/^\/api\/pipelines\/([^/]+)\/pause$/)
      if (pipelinePauseMatch && method === 'POST') {
        const pipeline = state.getPipeline(pipelinePauseMatch[1], authUser!.userId)
        if (!pipeline) return json(res, 404, { error: 'Not found' })
        return json(res, 200, await router.pausePipeline(pipelinePauseMatch[1]))
      }

      // POST /api/pipelines/:id/resume
      const pipelineResumeMatch = pathname.match(/^\/api\/pipelines\/([^/]+)\/resume$/)
      if (pipelineResumeMatch && method === 'POST') {
        const pipeline = state.getPipeline(pipelineResumeMatch[1], authUser!.userId)
        if (!pipeline) return json(res, 404, { error: 'Not found' })
        return json(res, 200, await router.resumePipeline(pipelineResumeMatch[1]))
      }

      // GET /api/sessions
      if (pathname === '/api/sessions' && method === 'GET') {
        const statusFilter = parseSessionStatus(url.searchParams.get('status'))
        const limit = parsePositiveInt(url.searchParams.get('limit'))
        const sessions = state.listSessions({ ...(statusFilter ? { status: statusFilter } : {}), userId: authUser!.userId, ...(limit ? { limit } : {}) })
        return json(res, 200, sessionsForClient(sessions))
      }

      // GET /api/tasks
      if (pathname === '/api/tasks' && method === 'GET') {
        const statusFilter = parseTaskStatus(url.searchParams.get('status'))
        const limit = parsePositiveInt(url.searchParams.get('limit'))
        const offset = parsePositiveInt(url.searchParams.get('offset'))
        const tasks = state.listTasks({ ...(statusFilter ? { status: statusFilter } : {}), userId: authUser!.userId, ...(limit ? { limit } : {}), ...(offset ? { offset } : {}) })
        return json(res, 200, tasks)
      }

      // POST /api/tasks
      if (pathname === '/api/tasks' && method === 'POST') {
        const params = parseTaskBody(await parseBody(req))
        assertAllowedWorkspace(params.cwd)
        assertPermissionModeAllowed(params.permissionMode, params.cwd)
        const agent = params.agent ?? await selectDefaultTaskAgent(authUser!.userId, agentCatalog, params.cwd)
        await assertTaskAgentAccepted(authUser!.userId, router, agentCatalog, agent, params.cwd)
        const task = router.startTask({
          userId: authUser!.userId,
          ...params,
          agent,
          context: resolveSessionContext(params.context, params.cwd),
        })
        return json(res, 201, task)
      }

      // POST /api/sessions
      if (pathname === '/api/sessions' && method === 'POST') {
        const defaults = loadConfig().defaults
        const params = parseSessionBody(await parseBody(req))
        assertAllowedWorkspace(params.cwd)
        assertPermissionModeAllowed(params.permissionMode, params.cwd)
        assertSessionFilesystemCapability(authUser!.userId, params.to, params.cwd)
        const template = params.templateId ? templates.find((item) => item.id === params.templateId) : undefined
        if (params.templateId && !template) {
          throw new HttpError(400, 'Unknown template_id')
        }
        const templateConfig = template?.config
        const session = router.startSession({
          userId: authUser!.userId,
          ...params,
          context: resolveSessionContext(params.context, params.cwd),
          systemPrompts: params.systemPrompts ?? templateConfig?.systemPrompts,
          mode: params.mode ?? templateConfig?.mode ?? defaults.mode,
          maxRounds: params.maxRounds ?? templateConfig?.maxRounds ?? defaults.maxRounds,
        })
        return json(res, 201, session)
      }

      // GET /api/sessions/:id
      const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/)
      if (sessionMatch && method === 'GET') {
        const session = state.getSession(sessionMatch[1], authUser!.userId)
        if (!session) return json(res, 404, { error: 'Not found' })
        const messages = state.getMessages(session.id)
        return json(res, 200, { ...sessionForClient(session), messages })
      }

      // GET /api/tasks/:id
      const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/)
      if (taskMatch && method === 'GET') {
        const task = state.getTask(taskMatch[1], authUser!.userId)
        if (!task) return json(res, 404, { error: 'Not found' })
        return json(res, 200, task)
      }

      // POST /api/tasks/:id/handoff
      const taskHandoffMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/handoff$/)
      if (taskHandoffMatch && method === 'POST') {
        const source = state.getTask(taskHandoffMatch[1], authUser!.userId)
        if (!source) return json(res, 404, { error: 'Not found' })
        if (source.status !== 'error' && source.status !== 'stopped') {
          throw new HttpError(400, 'Task handoff requires an error or stopped source task')
        }
        const params = parseTaskHandoffBody(await parseBody(req))
        assertAllowedWorkspace(source.cwd)
        assertPermissionModeAllowed(source.permissionMode, source.cwd)
        await assertTaskAgentAccepted(authUser!.userId, router, agentCatalog, params.agent, source.cwd)
        const task = router.startTask({
          userId: authUser!.userId,
          agent: params.agent,
          prompt: buildTaskHandoffPrompt(source),
          context: source.context,
          systemPrompt: source.systemPrompt,
          cwd: source.cwd,
          permissionMode: source.permissionMode,
          metadata: { continuedFromTaskId: source.id },
        })
        return json(res, 201, task)
      }

      // POST /api/tasks/:id/stop
      const taskStopMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/stop$/)
      if (taskStopMatch && method === 'POST') {
        if (!state.getTask(taskStopMatch[1], authUser!.userId)) return json(res, 404, { error: 'Not found' })
        return json(res, 200, await router.stopTask(taskStopMatch[1]))
      }

      // GET /api/sessions/:id/logs
      const sessionLogsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/logs$/)
      if (sessionLogsMatch && method === 'GET') {
        const session = state.getSession(sessionLogsMatch[1], authUser!.userId)
        if (!session) return json(res, 404, { error: 'Not found' })
        return json(res, 200, state.getLogs(session.id))
      }

      // GET /api/sessions/:id/snapshots
      const sessionSnapshotsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/snapshots$/)
      if (sessionSnapshotsMatch && method === 'GET') {
        const session = state.getSession(sessionSnapshotsMatch[1], authUser!.userId)
        if (!session) return json(res, 404, { error: 'Not found' })
        return json(res, 200, state.getSnapshots(session.id))
      }

      // POST /api/sessions/:id/pause
      const pauseMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/pause$/)
      if (pauseMatch && method === 'POST') {
        if (!state.getSession(pauseMatch[1], authUser!.userId)) return json(res, 404, { error: 'Not found' })
        const session = await router.pauseSession(pauseMatch[1])
        return json(res, 200, session)
      }

      // POST /api/sessions/:id/resume
      const resumeMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/resume$/)
      if (resumeMatch && method === 'POST') {
        const resumeOpts = parseResumeBody(await parseBody(req))
        const current = state.getSession(resumeMatch[1], authUser!.userId)
        if (!current) return json(res, 404, { error: 'Not found' })
        assertPermissionModeAllowed(resumeOpts.permissionMode, current.cwd)
        const session = current.status === 'error'
          ? await router.resumeErrorSession(resumeMatch[1], resumeOpts)
          : await router.resumeSession(resumeMatch[1], resumeOpts)
        return json(res, 200, session)
      }

      // POST /api/sessions/:id/rerun
      const rerunMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/rerun$/)
      if (rerunMatch && method === 'POST') {
        if (!state.getSession(rerunMatch[1], authUser!.userId)) return json(res, 404, { error: 'Not found' })
        return json(res, 200, await router.rerunPipelineStep(rerunMatch[1]))
      }

      // POST /api/sessions/:id/confirm
      const confirmMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/confirm$/)
      if (confirmMatch && method === 'POST') {
        if (!state.getSession(confirmMatch[1], authUser!.userId)) return json(res, 404, { error: 'Not found' })
        return json(res, 200, await router.confirmSession(confirmMatch[1]))
      }

      // POST /api/sessions/:id/manual-artifacts
      const manualArtifactsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/manual-artifacts$/)
      if (manualArtifactsMatch && method === 'POST') {
        if (!state.getSession(manualArtifactsMatch[1], authUser!.userId)) return json(res, 404, { error: 'Not found' })
        const body = parseManualArtifactsBody(await parseBody(req))
        return json(res, 200, await router.completeSessionWithManualArtifacts(manualArtifactsMatch[1], body.paths, body.summary))
      }

      // POST /api/sessions/:id/extend-timeout
      const extendTimeoutMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/extend-timeout$/)
      if (extendTimeoutMatch && method === 'POST') {
        if (!state.getSession(extendTimeoutMatch[1], authUser!.userId)) return json(res, 404, { error: 'Not found' })
        return json(res, 200, router.extendSessionTimeout(extendTimeoutMatch[1], 5 * 60 * 1000))
      }

      // POST /api/sessions/:id/stop
      const stopMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/stop$/)
      if (stopMatch && method === 'POST') {
        if (!state.getSession(stopMatch[1], authUser!.userId)) return json(res, 404, { error: 'Not found' })
        const session = await router.stopSession(stopMatch[1])
        return json(res, 200, session)
      }

      // DELETE /api/sessions/:id
      const deleteMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/)
      if (deleteMatch && method === 'DELETE') {
        const sessionId = deleteMatch[1]
        const session = state.getSession(sessionId, authUser!.userId)
        if (!session) return json(res, 404, { error: 'Not found' })

        state.deleteSession(sessionId, authUser!.userId)
        router.emit('event', { type: 'session:deleted', payload: { id: sessionId, userId: authUser!.userId } })

        return json(res, 200, { success: true })
      }

      // POST /api/sessions/:id/message
      const msgMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/message$/)
      if (msgMatch && method === 'POST') {
        if (!state.getSession(msgMatch[1], authUser!.userId)) return json(res, 404, { error: 'Not found' })
        const body = parseHumanMessageBody(await parseBody(req))
        const msg = router.injectMessage(msgMatch[1], body.content)
        return json(res, 200, msg)
      }

      // POST /api/sessions/:id/nudge — human redirects the conversation mid-flight
      const nudgeMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/nudge$/)
      if (nudgeMatch && method === 'POST') {
        if (!state.getSession(nudgeMatch[1], authUser!.userId)) return json(res, 404, { error: 'Not found' })
        const body = parseNudgeBody(await parseBody(req))
        const msg = await router.nudge(nudgeMatch[1], body.content)
        return json(res, 200, msg)
      }

      // POST /api/sessions/:id/takeover
      const takeoverMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/takeover$/)
      if (takeoverMatch && method === 'POST') {
        if (!state.getSession(takeoverMatch[1], authUser!.userId)) return json(res, 404, { error: 'Not found' })
        const session = await router.pauseSession(takeoverMatch[1])
        return json(res, 200, { ...session, takenOver: true })
      }

      // POST /api/sessions/:id/release
      const releaseMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/release$/)
      if (releaseMatch && method === 'POST') {
        if (!state.getSession(releaseMatch[1], authUser!.userId)) return json(res, 404, { error: 'Not found' })
        const session = await router.resumeSession(releaseMatch[1])
        return json(res, 200, session)
      }

      // ── Static files ────────────────────────────────────────────────────────

      if (method === 'GET' || method === 'HEAD') {
        if (pathname === '/' || pathname === '/index.html') {
          return await serveStatic(req, res, path.join(WEB_DIR, 'index.html'))
        }
        const staticPath = path.resolve(WEB_DIR, pathname.replace(/^\//, ''))
        try {
          if (fs.statSync(staticPath).isFile()) {
            return await serveStatic(req, res, staticPath)
          }
        } catch {
          // not a real file — fall through to SPA fallback below
        }
        // SPA fallback
        return await serveStatic(req, res, path.join(WEB_DIR, 'index.html'))
      }

      json(res, 404, { error: 'Not found' })
    } catch (err) {
      if (err instanceof WorkspaceAccessError) {
        return json(res, 403, { error: err.message })
      }
      if (err instanceof HttpError || err instanceof AuthError || err instanceof KeyVaultError) {
        return json(res, err.status, { error: err.message })
      }
      console.error('[server] error:', err)
      json(res, 500, { error: String(err) })
    }
  })

  // ── WebSocket ──────────────────────────────────────────────────────────────

  const wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('error', () => {})
  const heartbeat = setInterval(() => {
    for (const ws of clients.keys()) {
      const live = ws as WebSocket & { isAlive?: boolean }
      if (live.isAlive === false) {
        clients.delete(ws)
        ws.terminate()
        continue
      }
      live.isAlive = false
      ws.ping()
    }
  }, WS_HEARTBEAT_MS)
  heartbeat.unref()

  wss.on('connection', (ws, req) => {
    let authUser
    try {
      const wsUrl = new URL(req.url ?? '/ws', `http://localhost:${port}`)
      const token = wsUrl.searchParams.get('token')
      if (token) {
        req.headers.authorization = `Bearer ${token}`
      }
      authUser = authenticateRequest(req)
    } catch {
      ws.close(1008, 'Authentication required')
      return
    }

    const live = ws as WebSocket & { isAlive?: boolean }
    live.isAlive = true
    clients.set(ws, authUser.userId)
    ws.on('pong', () => { live.isAlive = true })
    ws.on('close', () => clients.delete(ws))
    ws.on('error', () => clients.delete(ws))
    // Send current sessions on connect
    ws.send(JSON.stringify({ type: 'init', payload: sessionsForClient(state.listSessions({ userId: authUser.userId })) }))
  })

  server.on('close', () => {
    clearInterval(heartbeat)
    for (const ws of clients.keys()) {
      ws.terminate()
    }
    clients.clear()
    wss.close()
  })

  const onListening = () => {
    const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host
    console.log(`[server] Passiton running at http://${displayHost ?? 'localhost'}:${port}`)
  }
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[server] Port ${port} is already in use. Another Passiton instance may be running; stop it, or change server.port in ${getConfigPath()} and retry.`)
    } else {
      console.error(`[server] Startup failed: ${err.code ?? ''} ${err.message}`)
    }
    process.exit(1)
  })
  if (host) server.listen(port, host, onListening)
  else server.listen(port, onListening)

  return server
}

function eventUserId(event: WsEvent): string | undefined {
  if (event.type === 'heartbeat' && 'sessionId' in event && typeof event.sessionId === 'string') {
    return state.getSession(event.sessionId)?.userId
  }

  if (!('payload' in event)) {
    return undefined
  }
  const payload = event.payload
  if (!payload || typeof payload !== 'object') {
    return undefined
  }

  const record = payload as Record<string, unknown>
  if (typeof record.userId === 'string') {
    return record.userId
  }
  if (typeof record.sessionId === 'string') {
    return state.getSession(record.sessionId)?.userId
  }
  if (typeof record.id === 'string' && event.type.startsWith('session:')) {
    return state.getSession(record.id)?.userId
  }
  if (typeof record.id === 'string' && event.type.startsWith('pipeline:')) {
    return state.getPipeline(record.id)?.userId
  }
  return undefined
}
