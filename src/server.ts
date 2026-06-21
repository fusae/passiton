// Server module — HTTP + WebSocket

import http from 'http'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
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
import type { AgentConfig, AgentListResponse, ApiAgentInfo, AppConfig, PipelineTemplateRecord, AgentRef, Session, SessionMode, SessionContext, SessionContextInput, TaskStatus, WsEvent, WorkflowNodeType } from './types.js'
import { pipelineTemplates, templates } from './templates.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_DIR = path.join(__dirname, 'web')
const MAX_BODY_SIZE = 1024 * 1024
const MAX_FILE_PREVIEW_SIZE = 1024 * 1024
const MAX_IMAGE_FILE_PREVIEW_SIZE = 10 * 1024 * 1024
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
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  })
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
  if (provider !== 'anthropic' && provider !== 'openai' && provider !== 'deepseek' && provider !== 'zhipu') {
    throw new HttpError(400, '"provider" must be one of anthropic, openai, deepseek, zhipu')
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
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
    })
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
  const defaults = createDiscoveredAgentConfig(adapter, command)
  if (!defaults) {
    throw new HttpError(400, '"adapter" must be one of claude-code, codex, gemini-cli, opencode')
  }

  const env = parseEnv(data.env, 'env')
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
      model: existing && existing.adapter === adapter ? existing.model : defaults.model,
      command,
      ...(finalEnv && Object.keys(finalEnv).length > 0 ? { env: finalEnv } : {}),
    },
  }
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
    throw new HttpError(400, '"adapter" must be one of anthropic-api, openai-api, zhipu-api, custom-api')
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

async function reloadAgents(router: Router, agentCatalog: AgentCatalog, config: AppConfig): Promise<void> {
  const agents = activeAgents(config)
  router.clearAdapters()
  agentCatalog.setLocalCliAgentsEnabled(true)
  agentCatalog.setConfiguredAgents(agents)
  await agentCatalog.discover()
  registerConfiguredAdapters(router, agents)
  registerBuiltinAdapters(router)
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

async function listAgentModels(
  userId: string,
  agentCatalog?: AgentCatalog,
  opts: { refresh?: boolean } = {}
): Promise<AgentListResponse> {
  const current = loadConfig()
  const currentAgents = current.agents
  const globalApi = Object.entries(current.agents)
    .filter(([, cfg]) => API_ADAPTERS.has(cfg.adapter))
    .map(([name, cfg]) => apiAgentInfoFromConfig(name, cfg))
  const userApi = state.listUserAgents(userId).map(apiAgentInfoFromRecord)
  const userNames = new Set(userApi.map((agent) => agent.name))
  const apiAgents = [
    ...userApi,
    ...globalApi.filter((agent) => !userNames.has(agent.name)),
  ]
  if (!agentCatalog) return apiAgents

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
          ? (agent.healthy && agent.availableForSessions ? 'ready' : 'invalid')
          : (agent.healthy ? 'discovered' : 'invalid'),
        kind: 'local',
        source: agent.source,
        command: agent.command,
        args: cfg?.args ?? agent.args,
        timeout: cfg?.timeout ?? agent.timeout,
        env: cfg?.env ?? agent.env,
        version: agent.version,
      }
    })
  return [
    ...apiAgents,
    ...localAgents,
  ]
}

function apiAgentInfoFromConfig(name: string, cfg: AgentConfig): ApiAgentInfo {
  const hasKey = Boolean(cfg.apiKey)
  return {
    name,
    adapter: cfg.adapter,
    model: cfg.model,
    provider: providerForAdapter(cfg.adapter, cfg.baseUrl),
    baseUrl: cfg.baseUrl ?? DEFAULT_BASE_URLS[cfg.adapter],
    hasKey,
    keyMasked: cfg.apiKey ? maskAgentKey(cfg.apiKey) : undefined,
    status: hasKey && apiConfigHealthy(cfg) ? 'ready' : hasKey ? 'invalid' : 'no_key',
    kind: 'api',
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

function providerForAdapter(adapter: string, baseUrl?: string): string {
  if (baseUrl?.includes('api.deepseek.com')) return 'DeepSeek'
  return PROVIDER_BY_ADAPTER[adapter] ?? 'Custom'
}

function providerValueForAdapter(adapter: string, baseUrl?: string): state.StoredApiKeyRecord['provider'] {
  if (baseUrl?.includes('api.deepseek.com')) return 'deepseek'
  if (adapter === 'anthropic-api') return 'anthropic'
  if (adapter === 'openai-api' || adapter === 'custom-api') return 'openai'
  if (adapter === 'zhipu-api') return 'zhipu'
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

function appendOutputDirContext(context: SessionContext | undefined, outputDir?: string): SessionContext | undefined {
  if (!outputDir) return context
  const text = [
    context?.text,
    `[[Turing Output Directory]]\nSave this step's durable outputs under: ${outputDir}\n[[End Turing Output Directory]]`,
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
    agent: parseAgentRef(data.agent, 'agent'),
    prompt: requireNonEmptyString(data.prompt, 'prompt'),
    context: parseSessionContext(data.context, 'context'),
    systemPrompt: optionalString(data.systemPrompt, 'systemPrompt'),
    cwd: optionalString(data.cwd, 'cwd'),
  }
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
  assertAllowedWorkspace(cwd, 'cwd')
  const baseDir = cwd ? path.resolve(cwd) : process.cwd()
  const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(baseDir, filePath)
  assertAllowedWorkspace(resolved, 'path')
  if (!fs.existsSync(resolved)) throw new HttpError(404, 'File not found')
  if (!fs.statSync(resolved).isFile()) throw new HttpError(400, '"path" must be a file')
  return resolved
}

function resolveWorkflowFile(filePath: string, cwd?: string, baseFile?: string): string | undefined {
  const baseDir = cwd ? path.resolve(cwd) : process.cwd()
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
      assertAllowedWorkspace(candidate, 'path')
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
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

function assertAllowedWorkspace(cwd: string | undefined, field = 'cwd'): void {
  if (!cwd) return
  const allowed = loadConfig().policy.allowedWorkspaces ?? []
  if (allowed.length === 0) return
  const target = path.resolve(cwd)
  const matched = allowed.some((root) => {
    const resolvedRoot = path.resolve(root)
    return target === resolvedRoot || target.startsWith(`${resolvedRoot}${path.sep}`)
  })
  if (!matched) {
    throw new HttpError(403, `"${field}" is outside allowed workspaces`)
  }
}

function assertPermissionModeAllowed(permissionMode: 'safe' | 'trusted' | undefined, cwd: string | undefined, field = 'permissionMode'): void {
  if (permissionMode === 'trusted' && !cwd) {
    throw new HttpError(400, `"${field}" trusted mode requires cwd`)
  }
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

      // GET /api/docs — public machine-readable HTTP API reference.
      if (pathname === '/api/docs' && method === 'GET') {
        return json(res, 200, sessionApiDocs())
      }

      // POST /api/auth/login
      if (pathname === '/api/auth/login' && method === 'POST') {
        const { email, password } = parseAuthBody(await parseBody(req))
        const result = loginUser(email, password)
        res.setHeader('Set-Cookie', authCookie(result.token))
        return json(res, 200, { token: result.token, user: result.user })
      }

      // POST /api/auth/local
      if (pathname === '/api/auth/local' && method === 'POST') {
        const config = loadConfig()
        if (!config.auth?.localAccess) {
          throw new HttpError(403, 'Local access is disabled')
        }
        const result = loginLocalUser(config.auth.localUserEmail)
        res.setHeader('Set-Cookie', authCookie(result.token))
        return json(res, 200, { token: result.token, user: result.user })
      }

      // POST /api/auth/register
      if (pathname === '/api/auth/register' && method === 'POST') {
        if (!loadConfig().auth?.allowRegistration) {
          throw new HttpError(403, 'Registration is disabled')
        }
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
        const refresh = url.searchParams.get('refresh') === '1'
        const agents = await listAgentModels(authUser!.userId, agentCatalog, { refresh })
        return json(res, 200, agents)
      }

      // GET /api/agents/:name/diagnostics
      const agentDiagnosticsMatch = pathname.match(/^\/api\/agents\/([^/]+)\/diagnostics$/)
      if (agentDiagnosticsMatch && method === 'GET') {
        const refresh = url.searchParams.get('refresh') !== '0'
        const diagnostic = await agentCatalog.diagnoseAgent(decodeURIComponent(agentDiagnosticsMatch[1]), refresh)
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
          policy: {
            ...current.policy,
            maxRounds: global.maxRounds,
            ...(global.allowedWorkspaces !== undefined ? { allowedWorkspaces: global.allowedWorkspaces } : {}),
          },
        }
        writeConfig(updated)
        return json(res, 200, loadConfig())
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
        return json(res, 200, state.listPipelines(authUser!.userId))
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
        const sessions = state.listSessions({ ...(statusFilter ? { status: statusFilter } : {}), userId: authUser!.userId })
        return json(res, 200, sessions.map(sessionForClient))
      }

      // GET /api/tasks
      if (pathname === '/api/tasks' && method === 'GET') {
        const statusFilter = parseTaskStatus(url.searchParams.get('status'))
        const tasks = state.listTasks({ ...(statusFilter ? { status: statusFilter } : {}), userId: authUser!.userId })
        return json(res, 200, tasks)
      }

      // POST /api/tasks
      if (pathname === '/api/tasks' && method === 'POST') {
        const params = parseTaskBody(await parseBody(req))
        assertAllowedWorkspace(params.cwd)
        assertTaskFilesystemCapability(authUser!.userId, params.agent, params.cwd)
        const task = router.startTask({
          userId: authUser!.userId,
          ...params,
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
        const { extraRounds } = parseResumeBody(await parseBody(req))
        const current = state.getSession(resumeMatch[1], authUser!.userId)
        if (!current) return json(res, 404, { error: 'Not found' })
        const session = current.status === 'error'
          ? await router.resumeErrorSession(resumeMatch[1])
          : await router.resumeSession(resumeMatch[1], extraRounds)
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
    ws.send(JSON.stringify({ type: 'init', payload: state.listSessions({ userId: authUser.userId }).map(sessionForClient) }))
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
