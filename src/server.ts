// Server module — HTTP + WebSocket

import http from 'http'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import type { AgentCatalog } from './agents.js'
import { createAdapter, createDiscoveredAgentConfig, registerConfiguredAdapters, registerUserConfiguredAdapters } from './adapters/factory.js'
import {
  AuthError,
  authCookie,
  authenticateRequest,
  createUserToken,
  listUserTokens,
  loginUser,
  registerUser,
  revokeUserToken,
  type AuthUser,
} from './auth.js'
import { loadConfig, writeConfig } from './config.js'
import { KeyVaultError, decryptKey, decryptSecret, deleteKey, encryptSecret, listKeys, maskAgentKey, storeKey } from './keyvault.js'
import type { Router } from './router.js'
import * as state from './state.js'
import type { AgentConfig, AgentListResponse, ApiAgentInfo, AppConfig, SessionMode, SessionContext, SessionContextInput, WsEvent } from './types.js'
import { templates } from './templates.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_DIR = path.join(__dirname, 'web')
const MAX_BODY_SIZE = 1024 * 1024
const WS_HEARTBEAT_MS = 30_000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const API_ADAPTERS = new Set(['anthropic-api', 'openai-api', 'zhipu-api', 'custom-api'])
const PROVIDER_BY_ADAPTER: Record<string, string> = {
  'anthropic-api': 'Anthropic',
  'openai-api': 'OpenAI',
  'zhipu-api': '智谱',
  'custom-api': 'Custom',
}
const DEFAULT_BASE_URLS: Record<string, string> = {
  'anthropic-api': 'https://api.anthropic.com/v1/messages',
  'openai-api': 'https://api.openai.com/v1/chat/completions',
  'zhipu-api': 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
}

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

function json(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(body)
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
  if (provider !== 'anthropic' && provider !== 'openai' && provider !== 'zhipu') {
    throw new HttpError(400, '"provider" must be one of anthropic, openai, zhipu')
  }
  return {
    provider,
    name: optionalString(data.name, 'name'),
    key: requireNonEmptyString(data.key, 'key'),
  }
}

function serveStatic(res: http.ServerResponse, filePath: string): void {
  const resolvedPath = path.resolve(filePath)
  if (resolvedPath !== WEB_DIR && !resolvedPath.startsWith(`${WEB_DIR}${path.sep}`)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  const ext = path.extname(filePath)
  const mime = MIME[ext] ?? 'application/octet-stream'
  try {
    const content = fs.readFileSync(resolvedPath)
    res.writeHead(200, { 'Content-Type': mime })
    res.end(content)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
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

function parseGlobalConfigBody(body: unknown): { maxRounds: number; mode: SessionMode; port: number } {
  const data = requireRecord(body, 'body')
  const defaults = isRecord(data.defaults) ? data.defaults : data
  const server = isRecord(data.server) ? data.server : data

  return {
    maxRounds: optionalPositiveInt(defaults.maxRounds, 'defaults.maxRounds') ?? optionalPositiveInt(data.maxRounds, 'maxRounds') ?? 20,
    mode: requireSessionMode(defaults.mode ?? data.mode, 'defaults.mode'),
    port: optionalPort(server.port, 'server.port') ?? optionalPort(data.port, 'port') ?? portDefault(),
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
  const defaults = createDiscoveredAgentConfig(adapter, command)
  if (!defaults) {
    throw new HttpError(400, '"adapter" must be one of claude-code, codex, opencode')
  }

  const env = parseEnv(data.env, 'env')
  return {
    name,
    config: {
      ...defaults,
      args: existing && existing.adapter === adapter ? existing.args : defaults.args,
      timeout: existing && existing.adapter === adapter ? existing.timeout : defaults.timeout,
      model: existing && existing.adapter === adapter ? existing.model : defaults.model,
      command,
      ...(env && Object.keys(env).length > 0 ? { env } : {}),
    },
  }
}

function parseApiAgentConfigBody(body: unknown, existing?: state.UserAgentRecord): {
  name: string
  adapter: string
  apiKey?: string
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
    throw new HttpError(400, '"adapter" must be one of anthropic-api, openai-api, zhipu-api, custom-api')
  }
  const baseUrl = optionalString(data.baseUrl, 'baseUrl') ?? existing?.baseUrl
  if (adapter === 'custom-api' && !baseUrl) {
    throw new HttpError(400, '"baseUrl" is required for custom-api')
  }
  return {
    name,
    adapter,
    apiKey: optionalString(data.apiKey, 'apiKey'),
    keyId: optionalString(data.keyId, 'keyId'),
    model: optionalString(data.model, 'model') ?? existing?.model,
    baseUrl,
    timeout: optionalPositiveInt(data.timeout, 'timeout') ?? existing?.timeout,
  }
}

function agentNameFromPath(pathname: string): string | undefined {
  const match = pathname.match(/^\/api\/config\/agents\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : undefined
}

async function reloadAgents(router: Router, agentCatalog: AgentCatalog, config: AppConfig): Promise<void> {
  router.clearAdapters()
  agentCatalog.setConfiguredAgents(config.agents)
  await agentCatalog.discover()
  registerConfiguredAdapters(router, config.agents)
  agentCatalog.registerDiscoveredAdapters(router)
}

function decryptUserAgentKey(record: state.UserAgentRecord): string | undefined {
  if (!record.encryptedKey || !record.iv || !record.authTag) return undefined
  return decryptSecret({
    userId: record.userId,
    encryptedKey: record.encryptedKey,
    iv: record.iv,
    authTag: record.authTag,
  })
}

function userAgentConfigs(userId: string): Record<string, AgentConfig> {
  const result: Record<string, AgentConfig> = {}
  for (const record of state.listUserAgents(userId)) {
    result[record.name] = state.userAgentRecordToConfig(record, decryptUserAgentKey(record))
  }
  return result
}

export function registerPersistedUserAgents(router: Router): void {
  const byUser = new Map<string, Record<string, AgentConfig>>()
  for (const record of state.listAllUserAgents()) {
    const agents = byUser.get(record.userId) ?? {}
    agents[record.name] = state.userAgentRecordToConfig(record, decryptUserAgentKey(record))
    byUser.set(record.userId, agents)
  }
  for (const [userId, agents] of byUser.entries()) {
    registerUserConfiguredAdapters(router, userId, agents)
  }
}

function reloadUserAgents(router: Router, userId: string): void {
  registerUserConfiguredAdapters(router, userId, userAgentConfigs(userId))
}

async function listAgentModels(userId: string): Promise<AgentListResponse> {
  const current = loadConfig()
  const globalApi = Object.entries(current.agents)
    .filter(([, cfg]) => API_ADAPTERS.has(cfg.adapter))
    .map(([name, cfg]) => apiAgentInfoFromConfig(name, cfg))
  const userApi = state.listUserAgents(userId).map(apiAgentInfoFromRecord)
  const userNames = new Set(userApi.map((agent) => agent.name))
  return [
    ...userApi,
    ...globalApi.filter((agent) => !userNames.has(agent.name)),
  ]
}

function apiAgentInfoFromConfig(name: string, cfg: AgentConfig): ApiAgentInfo {
  const hasKey = Boolean(cfg.apiKey)
  return {
    name,
    adapter: cfg.adapter,
    model: cfg.model,
    provider: providerForAdapter(cfg.adapter),
    baseUrl: cfg.baseUrl ?? DEFAULT_BASE_URLS[cfg.adapter],
    hasKey,
    keyMasked: cfg.apiKey ? maskAgentKey(cfg.apiKey) : undefined,
    status: hasKey && apiConfigHealthy(cfg) ? 'ready' : hasKey ? 'invalid' : 'no_key',
  }
}

function apiAgentInfoFromRecord(record: state.UserAgentRecord): ApiAgentInfo {
  const apiKey = decryptUserAgentKey(record)
  const cfg = state.userAgentRecordToConfig(record, apiKey)
  return {
    ...apiAgentInfoFromConfig(record.name, cfg),
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
    const apiKey = decryptUserAgentKey(record)
    if (!apiKey) continue
    result.push({
      id: `assistant:${record.name}`,
      provider: providerValueForAdapter(record.adapter),
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
      provider: providerValueForAdapter(cfg.adapter),
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

function providerForAdapter(adapter: string): string {
  return PROVIDER_BY_ADAPTER[adapter] ?? 'Custom'
}

function providerValueForAdapter(adapter: string): state.StoredApiKeyRecord['provider'] {
  if (adapter === 'anthropic-api') return 'anthropic'
  if (adapter === 'openai-api' || adapter === 'custom-api') return 'openai'
  if (adapter === 'zhipu-api') return 'zhipu'
  return 'openai'
}

function resolveApiKeySelection(userId: string, parsed: { apiKey?: string; keyId?: string }): string | undefined {
  if (parsed.apiKey) return parsed.apiKey
  if (!parsed.keyId) return undefined
  if (parsed.keyId.startsWith('assistant:') || parsed.keyId.startsWith('global:')) {
    throw new HttpError(400, 'Read-only keys cannot be rebound; paste a key or choose a saved Provider Key')
  }
  return decryptKey(userId, parsed.keyId).key
}

function parseAgentRef(value: unknown, field: string): { adapter: string; label?: string } {
  const body = requireRecord(value, field)
  return {
    adapter: requireNonEmptyString(body.adapter, `${field}.adapter`),
    label: optionalString(body.label, `${field}.label`),
  }
}

function parseSessionStatus(value: string | null): 'active' | 'paused' | 'done' | 'error' | null {
  if (value === null) {
    return null
  }
  if (value === 'active' || value === 'paused' || value === 'done' || value === 'error') {
    return value
  }
  throw new HttpError(400, '"status" must be one of active, paused, done, error')
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
    const baseDir = cwd ? path.resolve(cwd) : process.cwd()
    result.files = context.files.map((filePath) => {
      const resolvedPath = path.resolve(baseDir, filePath)
      try {
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

function parseSessionBody(body: unknown) {
  const data = requireRecord(body, 'body')
  const templateId = optionalString(data.template_id ?? data.templateId, 'template_id')

  return {
    from: parseAgentRef(data.from, 'from'),
    to: parseAgentRef(data.to, 'to'),
    initialPrompt: requireNonEmptyString(data.initialPrompt, 'initialPrompt'),
    mode: parseSessionMode(data.mode),
    systemPrompts: parseSystemPrompts(data.systemPrompts),
    templateId,
    context: parseSessionContext(data.context, 'context'),
    maxRounds: optionalPositiveInt(data.maxRounds, 'maxRounds'),
    approveMode: optionalBoolean(data.approveMode, 'approveMode'),
    cwd: optionalString(data.cwd, 'cwd'),
  }
}

function parsePipelineBody(body: unknown) {
  const data = requireRecord(body, 'body')
  const stepsValue = data.steps
  if (!Array.isArray(stepsValue) || stepsValue.length === 0) {
    throw new HttpError(400, '"steps" must be a non-empty array')
  }

  const steps = stepsValue.map((value, index) => {
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

    return {
      from: parseAgentRef(step.from, `steps[${index}].from`),
      to: parseAgentRef(step.to, `steps[${index}].to`),
      initialPrompt: requireNonEmptyString(step.initialPrompt, `steps[${index}].initialPrompt`),
      mode: parseSessionMode(step.mode),
      context: parseSessionContext(step.context, `steps[${index}].context`),
      maxRounds: optionalPositiveInt(step.maxRounds, `steps[${index}].maxRounds`),
      approveMode: optionalBoolean(step.approveMode, `steps[${index}].approveMode`),
      cwd: optionalString(step.cwd, `steps[${index}].cwd`),
      dependsOn,
    }
  })

  return {
    name: requireNonEmptyString(data.name, 'name'),
    steps,
  }
}

function parseResumeBody(body: unknown): { extraRounds?: number } {
  const data = requireRecord(body, 'body')
  return {
    extraRounds: optionalPositiveInt(data.extraRounds, 'extraRounds'),
  }
}

function parseHumanMessageBody(body: unknown): { content: string } {
  const data = requireRecord(body, 'body')
  return {
    content: requireNonEmptyString(data.content, 'content'),
  }
}

function parseNudgeBody(body: unknown): { content: string } {
  const data = requireRecord(body, 'body')
  return {
    content: requireNonEmptyString(data.content, 'content'),
  }
}

export function createServer(router: Router, port: number, agentCatalog: AgentCatalog): http.Server {
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

    // CORS for local dev
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    try {
      // ── API routes ─────────────────────────────────────────────────────────

      // GET /health — unauthenticated liveness check for Docker/Fly.
      if (pathname === '/health' && method === 'GET') {
        return json(res, 200, { ok: true })
      }

      // POST /api/auth/login
      if (pathname === '/api/auth/login' && method === 'POST') {
        const { email, password } = parseAuthBody(await parseBody(req))
        const result = loginUser(email, password)
        res.setHeader('Set-Cookie', authCookie(result.token))
        return json(res, 200, { token: result.token, user: result.user })
      }

      // POST /api/auth/register
      if (pathname === '/api/auth/register' && method === 'POST') {
        const { email, password } = parseAuthBody(await parseBody(req))
        const result = registerUser(email, password)
        res.setHeader('Set-Cookie', authCookie(result.token))
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
        const agents = await listAgentModels(authUser!.userId)
        return json(res, 200, agents)
      }

      // POST /api/agents
      if (pathname === '/api/agents' && method === 'POST') {
        const parsed = parseApiAgentConfigBody(await parseBody(req))
        const apiKey = resolveApiKeySelection(authUser!.userId, parsed)
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
        return json(res, 201, await listAgentModels(authUser!.userId))
      }

      const userAgentMatch = pathname.match(/^\/api\/agents\/([^/]+)$/)
      if (userAgentMatch && method === 'PUT') {
        const current = state.getUserAgent(authUser!.userId, decodeURIComponent(userAgentMatch[1]))
        if (!current) return json(res, 404, { error: 'Not found' })
        const parsed = parseApiAgentConfigBody(await parseBody(req), current)
        const apiKey = resolveApiKeySelection(authUser!.userId, parsed)
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
        return json(res, 200, await listAgentModels(authUser!.userId))
      }

      if (userAgentMatch && method === 'DELETE') {
        if (!state.deleteUserAgent(authUser!.userId, decodeURIComponent(userAgentMatch[1]))) {
          return json(res, 404, { error: 'Not found' })
        }
        reloadUserAgents(router, authUser!.userId)
        return json(res, 200, await listAgentModels(authUser!.userId))
      }

      // GET /api/templates
      if (pathname === '/api/templates' && method === 'GET') {
        return json(res, 200, templates)
      }

      // GET /api/stats
      if (pathname === '/api/stats' && method === 'GET') {
        return json(res, 200, state.getStats(authUser!.userId))
      }

      // GET /api/config
      if (pathname === '/api/config' && method === 'GET') {
        return json(res, 200, loadConfig())
      }

      // PUT /api/config
      if (pathname === '/api/config' && method === 'PUT') {
        const current = loadConfig()
        const global = parseGlobalConfigBody(await parseBody(req))
        const updated: AppConfig = {
          ...current,
          server: { ...current.server, port: global.port },
          defaults: { maxRounds: global.maxRounds, mode: global.mode },
          policy: { ...current.policy, maxRounds: global.maxRounds },
        }
        writeConfig(updated)
        return json(res, 200, loadConfig())
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
        if (Object.keys(current.agents).length <= 1) {
          throw new HttpError(400, 'At least one agent is required')
        }
        const agents = { ...current.agents }
        delete agents[configAgentName]
        const updated: AppConfig = { ...current, agents }
        writeConfig(updated)
        const saved = loadConfig()
        await reloadAgents(router, agentCatalog, saved)
        return json(res, 200, saved)
      }

      // GET /api/pipelines
      if (pathname === '/api/pipelines' && method === 'GET') {
        return json(res, 200, state.listPipelines(authUser!.userId))
      }

      // POST /api/pipelines
      if (pathname === '/api/pipelines' && method === 'POST') {
        const defaults = loadConfig().defaults
        const params = parsePipelineBody(await parseBody(req))
        const pipeline = router.startPipeline({
          userId: authUser!.userId,
          name: params.name,
          steps: params.steps.map((step) => ({
            ...step,
            context: resolveSessionContext(step.context, step.cwd),
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
        const sessions = state.listSessions({ ...(statusFilter ? { status: statusFilter } : {}), userId: authUser!.userId })
        return json(res, 200, sessions)
      }

      // POST /api/sessions
      if (pathname === '/api/sessions' && method === 'POST') {
        const defaults = loadConfig().defaults
        const params = parseSessionBody(await parseBody(req))
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
        return json(res, 200, { ...session, messages })
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
        const { extraRounds } = parseResumeBody(await parseBody(req))
        const current = state.getSession(resumeMatch[1], authUser!.userId)
        if (!current) return json(res, 404, { error: 'Not found' })
        const session = current.status === 'error'
          ? await router.resumeErrorSession(resumeMatch[1])
          : await router.resumeSession(resumeMatch[1], extraRounds)
        return json(res, 200, session)
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

      if (method === 'GET') {
        if (pathname === '/' || pathname === '/index.html') {
          return serveStatic(res, path.join(WEB_DIR, 'index.html'))
        }
        const staticPath = path.resolve(WEB_DIR, pathname.replace(/^\//, ''))
        if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
          return serveStatic(res, staticPath)
        }
        // SPA fallback
        return serveStatic(res, path.join(WEB_DIR, 'index.html'))
      }

      json(res, 404, { error: 'Not found' })
    } catch (err) {
      if (err instanceof HttpError || err instanceof AuthError || err instanceof KeyVaultError) {
        return json(res, err.status, { error: err.message })
      }
      console.error('[server] error:', err)
      json(res, 500, { error: String(err) })
    }
  })

  // ── WebSocket ──────────────────────────────────────────────────────────────

  const wss = new WebSocketServer({ server, path: '/ws' })
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
    ws.send(JSON.stringify({ type: 'init', payload: state.listSessions({ userId: authUser.userId }) }))
  })

  server.on('close', () => {
    clearInterval(heartbeat)
    for (const ws of clients.keys()) {
      ws.terminate()
    }
    clients.clear()
    wss.close()
  })

  server.listen(port, () => {
    console.log(`[server] Turing running at http://localhost:${port}`)
  })

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
