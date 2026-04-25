// Server module — HTTP + WebSocket

import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import type { AgentCatalog } from './agents.js'
import { createDiscoveredAgentConfig, registerConfiguredAdapters } from './adapters/factory.js'
import { loadConfig, writeConfig } from './config.js'
import type { Router } from './router.js'
import * as state from './state.js'
import type { AgentConfig, AppConfig, SessionMode, WsEvent } from './types.js'
import { templates } from './templates.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_DIR = path.join(__dirname, 'web')
const MAX_BODY_SIZE = 1024 * 1024
const WS_HEARTBEAT_MS = 30_000

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

function parseSessionBody(body: unknown) {
  const data = requireRecord(body, 'body')

  return {
    from: parseAgentRef(data.from, 'from'),
    to: parseAgentRef(data.to, 'to'),
    initialPrompt: requireNonEmptyString(data.initialPrompt, 'initialPrompt'),
    mode: parseSessionMode(data.mode),
    context: optionalString(data.context, 'context'),
    maxRounds: optionalPositiveInt(data.maxRounds, 'maxRounds'),
    approveMode: optionalBoolean(data.approveMode, 'approveMode'),
    cwd: optionalString(data.cwd, 'cwd'),
  }
}

function parseResumeBody(body: unknown): { extraRounds?: number } {
  const data = requireRecord(body, 'body')
  return {
    extraRounds: optionalPositiveInt(data.extraRounds, 'extraRounds'),
  }
}

function parseHumanMessageBody(body: unknown): { content: string; side: 'from' | 'to' } {
  const data = requireRecord(body, 'body')
  const side = data.side === undefined ? 'from' : data.side
  if (side !== 'from' && side !== 'to') {
    throw new HttpError(400, '"side" must be "from" or "to"')
  }
  return {
    content: requireNonEmptyString(data.content, 'content'),
    side,
  }
}

function parseNudgeBody(body: unknown): { content: string } {
  const data = requireRecord(body, 'body')
  return {
    content: requireNonEmptyString(data.content, 'content'),
  }
}

export function createServer(router: Router, port: number, agentCatalog: AgentCatalog): http.Server {
  const clients = new Set<WebSocket>()

  // Forward router events to all WebSocket clients
  router.on('event', (event: WsEvent) => {
    const payload = JSON.stringify(event)
    for (const ws of clients) {
      if (ws.readyState === 1 /* OPEN */) {
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    try {
      // ── API routes ─────────────────────────────────────────────────────────

      // GET /api/agents
      if (pathname === '/api/agents' && method === 'GET') {
        const agents = await agentCatalog.listAgents()
        return json(res, 200, agents)
      }

      // GET /api/templates
      if (pathname === '/api/templates' && method === 'GET') {
        return json(res, 200, templates)
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

      // GET /api/sessions
      if (pathname === '/api/sessions' && method === 'GET') {
        const statusFilter = parseSessionStatus(url.searchParams.get('status'))
        const sessions = state.listSessions(statusFilter ? { status: statusFilter } : undefined)
        return json(res, 200, sessions)
      }

      // POST /api/sessions
      if (pathname === '/api/sessions' && method === 'POST') {
        const defaults = loadConfig().defaults
        const params = parseSessionBody(await parseBody(req))
        const session = router.startSession({
          ...params,
          mode: params.mode ?? defaults.mode,
          maxRounds: params.maxRounds ?? defaults.maxRounds,
        })
        return json(res, 201, session)
      }

      // GET /api/sessions/:id
      const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/)
      if (sessionMatch && method === 'GET') {
        const session = state.getSession(sessionMatch[1])
        if (!session) return json(res, 404, { error: 'Not found' })
        const messages = state.getMessages(session.id)
        return json(res, 200, { ...session, messages })
      }

      // POST /api/sessions/:id/pause
      const pauseMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/pause$/)
      if (pauseMatch && method === 'POST') {
        const session = await router.pauseSession(pauseMatch[1])
        return json(res, 200, session)
      }

      // POST /api/sessions/:id/resume
      const resumeMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/resume$/)
      if (resumeMatch && method === 'POST') {
        const { extraRounds } = parseResumeBody(await parseBody(req))
        const session = await router.resumeSession(resumeMatch[1], extraRounds)
        return json(res, 200, session)
      }

      // POST /api/sessions/:id/stop
      const stopMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/stop$/)
      if (stopMatch && method === 'POST') {
        const session = await router.stopSession(stopMatch[1])
        return json(res, 200, session)
      }

      // DELETE /api/sessions/:id
      const deleteMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/)
      if (deleteMatch && method === 'DELETE') {
        const sessionId = deleteMatch[1]
        const session = state.getSession(sessionId)
        if (!session) return json(res, 404, { error: 'Not found' })

        state.deleteSession(sessionId)
        router.emit('event', { type: 'session:deleted', payload: { id: sessionId } })

        return json(res, 200, { success: true })
      }

      // POST /api/sessions/:id/message
      const msgMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/message$/)
      if (msgMatch && method === 'POST') {
        const body = parseHumanMessageBody(await parseBody(req))
        const msg = router.injectMessage(
          msgMatch[1],
          body.content,
          body.side
        )
        return json(res, 200, msg)
      }

      // POST /api/sessions/:id/nudge — human redirects the conversation mid-flight
      const nudgeMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/nudge$/)
      if (nudgeMatch && method === 'POST') {
        const body = parseNudgeBody(await parseBody(req))
        const msg = await router.nudge(nudgeMatch[1], body.content)
        return json(res, 200, msg)
      }

      // POST /api/sessions/:id/takeover
      const takeoverMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/takeover$/)
      if (takeoverMatch && method === 'POST') {
        const session = await router.pauseSession(takeoverMatch[1])
        return json(res, 200, { ...session, takenOver: true })
      }

      // POST /api/sessions/:id/release
      const releaseMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/release$/)
      if (releaseMatch && method === 'POST') {
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
      if (err instanceof HttpError) {
        return json(res, err.status, { error: err.message })
      }
      console.error('[server] error:', err)
      json(res, 500, { error: String(err) })
    }
  })

  // ── WebSocket ──────────────────────────────────────────────────────────────

  const wss = new WebSocketServer({ server, path: '/ws' })
  const heartbeat = setInterval(() => {
    for (const ws of clients) {
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

  wss.on('connection', (ws) => {
    const live = ws as WebSocket & { isAlive?: boolean }
    live.isAlive = true
    clients.add(ws)
    ws.on('pong', () => { live.isAlive = true })
    ws.on('close', () => clients.delete(ws))
    ws.on('error', () => clients.delete(ws))
    // Send current sessions on connect
    ws.send(JSON.stringify({ type: 'init', payload: state.listSessions() }))
  })

  server.on('close', () => {
    clearInterval(heartbeat)
    for (const ws of clients) {
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
