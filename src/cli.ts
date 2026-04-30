#!/usr/bin/env node
// Turing CLI — communicates with the Turing Server via HTTP
// Usage: turing <command> [options]

import http from 'http'
import https from 'https'
import { createInterface } from 'readline'
import { AgentCatalog } from './agents.js'
import { loadConfig } from './config.js'

// ── Config / base URL ─────────────────────────────────────────────────────────

const config = loadConfig()
const BASE = `http://localhost:${config.server.port}`
const PID_FILE = '/tmp/turing-server.pid'

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function request(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path)
    const payload = body ? JSON.stringify(body) : undefined
    const lib = url.protocol === 'https:' ? https : http

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) })
          } catch {
            resolve({ status: res.statusCode ?? 0, data: raw })
          }
        })
      }
    )

    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function get(path: string) {
  return request('GET', path)
}

async function post(path: string, body?: unknown) {
  return request('POST', path, body ?? {})
}

async function put(path: string, body?: unknown) {
  return request('PUT', path, body ?? {})
}

async function del(path: string, body?: unknown) {
  return request('DELETE', path, body)
}

// ── Arg parsing helpers ───────────────────────────────────────────────────────

interface Flags {
  from?: string
  to?: string
  fromLabel?: string
  toLabel?: string
  cwd?: string
  approve?: boolean
  rounds?: number
  mode?: string
  side?: string
  status?: string
  contextRules?: string
  contextText?: string
  contextFiles?: string
  env: string[]
  adapter?: string
  command?: string
  name?: string
  port?: number
  _: string[]  // positional args
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { _: [], env: [] }
  let i = 0
  while (i < argv.length) {
    const a = argv[i]
    if (a === '--from' && argv[i + 1]) { flags.from = argv[++i] }
    else if (a === '--to' && argv[i + 1]) { flags.to = argv[++i] }
    else if (a === '--from-label' && argv[i + 1]) { flags.fromLabel = argv[++i] }
    else if (a === '--to-label' && argv[i + 1]) { flags.toLabel = argv[++i] }
    else if (a === '--cwd' && argv[i + 1]) { flags.cwd = argv[++i] }
    else if (a === '--approve' || a === '-A') { flags.approve = true }
    else if ((a === '--rounds' || a === '-r') && argv[i + 1]) { flags.rounds = parseInt(argv[++i]) }
    else if (a === '--mode' && argv[i + 1]) { flags.mode = argv[++i] }
    else if (a === '--side' && argv[i + 1]) { flags.side = argv[++i] }
    else if (a === '--status' && argv[i + 1]) { flags.status = argv[++i] }
    else if (a === '--context-rules' && argv[i + 1]) { flags.contextRules = argv[++i] }
    else if (a === '--context-text' && argv[i + 1]) { flags.contextText = argv[++i] }
    else if (a === '--context-files' && argv[i + 1]) { flags.contextFiles = argv[++i] }
    else if (a === '--env' && argv[i + 1]) { flags.env.push(argv[++i]) }
    else if (a === '--adapter' && argv[i + 1]) { flags.adapter = argv[++i] }
    else if (a === '--command' && argv[i + 1]) { flags.command = argv[++i] }
    else if (a === '--name' && argv[i + 1]) { flags.name = argv[++i] }
    else if (a === '--port' && argv[i + 1]) { flags.port = parseInt(argv[++i]) }
    else { flags._.push(a) }
    i++
  }
  return flags
}

// ── Print helpers ─────────────────────────────────────────────────────────────

function fmt(label: string, value: string | number | boolean | undefined) {
  console.log(`  ${label.padEnd(14)} ${value ?? '—'}`)
}

function statusColor(s: string): string {
  switch (s) {
    case 'active':  return `\x1b[32m${s}\x1b[0m`
    case 'paused':  return `\x1b[33m${s}\x1b[0m`
    case 'done':    return `\x1b[35m${s}\x1b[0m`
    case 'error':   return `\x1b[31m${s}\x1b[0m`
    case 'stopped': return `\x1b[90m${s}\x1b[0m`
    default:        return s
  }
}

function agentLabel(ref: { adapter: string; label?: string }): string {
  return ref.label ?? ref.adapter
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000)       return 'just now'
  if (diff < 3_600_000)    return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000)   return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}

function parseEnvFlags(values: string[]): Record<string, string> | undefined {
  if (!values.length) return undefined
  const env: Record<string, string> = {}
  for (const item of values) {
    const eqIndex = item.indexOf('=')
    if (eqIndex <= 0) {
      die(`Invalid --env value "${item}". Expected KEY=VALUE`)
    }
    const key = item.slice(0, eqIndex).trim()
    const value = item.slice(eqIndex + 1)
    if (!key || !value) {
      die(`Invalid --env value "${item}". Expected KEY=VALUE`)
    }
    env[key] = value
  }
  return env
}

function buildContext(flags: Flags) {
  const files = flags.contextFiles
    ? flags.contextFiles.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
    : []

  const context: Record<string, unknown> = {}
  if (flags.contextRules) context.rules = flags.contextRules
  if (flags.contextText) context.text = flags.contextText
  if (files.length > 0) context.files = files
  return Object.keys(context).length > 0 ? context : undefined
}

// ── Commands ──────────────────────────────────────────────────────────────────

// ── server start ─────────────────────────────────────────────────────────────
async function serverStart() {
  // Check if already running
  try {
    const r = await get('/api/agents')
    if (r.status === 200) {
      console.log(`Server already running at ${BASE}`)
      process.exit(0)
    }
  } catch { /* not running */ }

  // Import and start inline (same process, foreground)
  console.log(`Starting Turing server at ${BASE} ...`)
  const { initDb } = await import('./state.js')
  const { Router } = await import('./router.js')
  const { registerConfiguredAdapters } = await import('./adapters/factory.js')
  const { createServer, registerPersistedUserAgents } = await import('./server.js')
  const { installGracefulShutdown } = await import('./shutdown.js')

  initDb(undefined, { messageRetentionMs: config.policy.messageRetentionMs })
  const router = new Router(config.policy)
  const agentCatalog = new AgentCatalog(config.agents)
  await agentCatalog.discover()
  registerConfiguredAdapters(router, config.agents)
  registerPersistedUserAgents(router)
  agentCatalog.registerDiscoveredAdapters(router)

  const server = createServer(router, config.server.port, agentCatalog)
  installGracefulShutdown(server)
  // foreground — never exit
}

// ── server stop ───────────────────────────────────────────────────────────────
async function serverStop() {
  const { readFileSync, existsSync } = await import('fs')
  if (!existsSync(PID_FILE)) {
    // Try SIGTERM by hitting a health endpoint and then kill by port (best-effort)
    console.log('No PID file found. Attempting to kill process on port...')
    const { execSync } = await import('child_process')
    try {
      execSync(`lsof -ti tcp:${config.server.port} | xargs kill -15`)
      console.log('Sent SIGTERM to server process.')
    } catch {
      console.log('No server process found on that port.')
    }
    return
  }
  const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim())
  try {
    process.kill(pid, 'SIGTERM')
    console.log(`Sent SIGTERM to PID ${pid}.`)
  } catch {
    console.log(`Process ${pid} not found.`)
  }
}

// ── server status ─────────────────────────────────────────────────────────────
async function serverStatus() {
  try {
    const r = await get('/api/agents')
    if (r.status === 200) {
      console.log(`\x1b[32m● Running\x1b[0m  ${BASE}`)
    } else {
      console.log(`\x1b[31m● Unreachable\x1b[0m  ${BASE}`)
    }
  } catch {
    console.log(`\x1b[31m● Not running\x1b[0m  (${BASE} unreachable)`)
  }
}

// ── chat ──────────────────────────────────────────────────────────────────────
async function chat(flags: Flags) {
  if (!flags.from) { die('--from <agent> is required') }
  if (!flags.to)   { die('--to <agent> is required') }
  const prompt = flags._.join(' ')
  if (!prompt)     { die('prompt text is required') }

  const body = {
    from: { adapter: flags.from, ...(flags.fromLabel ? { label: flags.fromLabel } : {}) },
    to:   { adapter: flags.to, ...(flags.toLabel ? { label: flags.toLabel } : {}) },
    initialPrompt: prompt,
    mode: flags.mode,
    context: buildContext(flags),
    maxRounds: flags.rounds ?? 20,
    approveMode: flags.approve ?? false,
    cwd: flags.cwd,
  }

  let r: { status: number; data: unknown }
  try {
    r = await post('/api/sessions', body)
  } catch (e) {
    die(`Cannot reach server at ${BASE}. Is it running? (turing server start)`)
  }

  if (r!.status !== 201) {
    console.error('Failed to create session:', r!.data)
    process.exit(1)
  }

  const session = r!.data as { id: string; from: { adapter: string }; to: { adapter: string } }
  console.log(`\n  Session  ${session.id}`)
  console.log(`  From     ${agentLabel(session.from)}`)
  console.log(`  To       ${agentLabel(session.to)}`)
  console.log(`\nFollowing messages (Ctrl+C to detach)...\n`)

  await followSession(session.id)
}

// ── sessions ──────────────────────────────────────────────────────────────────
async function listSessions() {
  let r: { status: number; data: unknown }
  try {
    const query = flags.status ? `?status=${encodeURIComponent(flags.status)}` : ''
    r = await get(`/api/sessions${query}`)
  } catch {
    die(`Cannot reach server at ${BASE}`)
  }

  const sessions = r!.data as Array<{
    id: string
    from: { adapter: string; label?: string }
    to: { adapter: string; label?: string }
    status: string
    mode: string
    currentRound: number
    maxRounds: number
    errorType?: string
    resumeCount?: number
    updatedAt: number
  }>

  if (!sessions.length) {
    console.log('No sessions.')
    return
  }

  console.log()
  for (const s of sessions) {
    const from = agentLabel(s.from)
    const to   = agentLabel(s.to)
    const id   = s.id.slice(0, 8)
    console.log(
      `  ${id}  ${statusColor(s.status).padEnd(20)}  ` +
      `${s.mode.padEnd(12)} ` +
      `R${s.currentRound}/${s.maxRounds}  ` +
      `${from} → ${to}  ` +
      `${s.errorType ? `err=${s.errorType}  ` : ''}` +
      `${(s.resumeCount ?? 0) > 0 ? `resume=${s.resumeCount}  ` : ''}` +
      `${timeAgo(s.updatedAt)}`
    )
  }
  console.log()
}

// ── log ───────────────────────────────────────────────────────────────────────
async function logSession(sessionId: string) {
  let r: { status: number; data: unknown }
  try {
    const [sessionRes, logsRes, snapshotsRes] = await Promise.all([
      get(`/api/sessions/${sessionId}`),
      get(`/api/sessions/${sessionId}/logs`),
      get(`/api/sessions/${sessionId}/snapshots`),
    ])
    r = {
      status: sessionRes.status,
      data: {
        session: sessionRes.data,
        logs: logsRes.data,
        snapshots: snapshotsRes.data,
      },
    }
  } catch {
    die(`Cannot reach server at ${BASE}`)
  }

  if (r!.status === 404) { die(`Session ${sessionId} not found`) }

  const payload = r!.data as {
    session: {
      id: string
      from: { adapter: string; label?: string }
      to: { adapter: string; label?: string }
      status: string
      mode: string
      currentRound: number
      maxRounds: number
      errorType?: string
      errorMessage?: string
      lastAgentOutput?: string
      errorRound?: number
      resumeCount?: number
      context?: { rules?: string; text?: string; files?: Array<{ path: string; content: string }> }
      messages: Array<{ from: string; content: string; timestamp: number; round: number; metadata?: { duration?: number; filesModified?: string[]; commandsRun?: string[]; tokenEstimate?: number } }>
    }
    logs: Array<{ timestamp: number; level: string; message: string }>
    snapshots: Array<{ round: number; timestamp: number; diffStat: string; diffFull: string }>
  }
  const data = payload.session

  console.log(`\n  Session  ${data.id}`)
  console.log(`  From     ${agentLabel(data.from)}`)
  console.log(`  To       ${agentLabel(data.to)}`)
  console.log(`  Status   ${statusColor(data.status)}`)
  fmt('Mode', data.mode)
  console.log(`  Rounds   ${data.currentRound}/${data.maxRounds}`)
  if (data.resumeCount) fmt('Resumes', data.resumeCount)
  if (data.errorType) fmt('ErrorType', data.errorType)
  if (data.errorRound !== undefined) fmt('ErrorRound', data.errorRound)
  if (data.errorMessage) fmt('Error', data.errorMessage)
  if (data.lastAgentOutput) fmt('LastOutput', data.lastAgentOutput.slice(0, 120))
  if (data.context?.rules) fmt('Rules', data.context.rules)
  if (data.context?.text) fmt('Context', data.context.text.slice(0, 120))
  if (data.context?.files?.length) fmt('Files', data.context.files.map((file) => file.path).join(', '))
  console.log()

  let lastRound = -1
  for (const msg of data.messages) {
    if (msg.round !== lastRound && msg.round > 0) {
      console.log(`  ── Round ${msg.round} ──────────────────────────────`)
      lastRound = msg.round
    }
    const speaker = msg.from === 'human'
      ? '\x1b[36mhuman\x1b[0m'
      : `\x1b[33m${msg.from}\x1b[0m`
    const ts = new Date(msg.timestamp).toLocaleTimeString()
    console.log(`\n  [${ts}] ${speaker}:`)
    // Indent content
    const lines = msg.content.split('\n')
    for (const line of lines) {
      console.log(`    ${line}`)
    }
    if (msg.metadata) {
      const parts = [
        msg.metadata.duration !== undefined ? `duration=${msg.metadata.duration}ms` : '',
        msg.metadata.tokenEstimate !== undefined ? `tokens≈${msg.metadata.tokenEstimate}` : '',
        msg.metadata.filesModified?.length ? `files=${msg.metadata.filesModified.join(',')}` : '',
        msg.metadata.commandsRun?.length ? `cmds=${msg.metadata.commandsRun.join(' | ')}` : '',
      ].filter(Boolean)
      if (parts.length) {
        console.log(`    [meta] ${parts.join('  ')}`)
      }
    }
  }

  if (payload.logs.length) {
    console.log('\n  ── Logs ──────────────────────────────')
    for (const entry of payload.logs) {
      const ts = new Date(entry.timestamp).toLocaleTimeString()
      console.log(`  [${ts}] ${entry.level.padEnd(5)} ${entry.message}`)
    }
  }

  if (payload.snapshots.length) {
    console.log('\n  ── Snapshots ─────────────────────────')
    for (const snapshot of payload.snapshots) {
      const ts = new Date(snapshot.timestamp).toLocaleTimeString()
      console.log(`\n  Round ${snapshot.round} @ ${ts}`)
      if (snapshot.diffStat.trim()) {
        for (const line of snapshot.diffStat.split('\n')) {
          console.log(`    ${line}`)
        }
      } else {
        console.log('    (no diff)')
      }
    }
  }
  console.log()
}

// ── pause / resume / stop ─────────────────────────────────────────────────────
async function pauseSession(sessionId: string) {
  const r = await post(`/api/sessions/${sessionId}/pause`).catch(() => die(`Cannot reach server`))
  const s = (r as { status: number; data: unknown })
  if (s.status === 200) { console.log(`Paused session ${sessionId.slice(0, 8)}`) }
  else { console.error('Error:', s.data) }
}

async function resumeSession(sessionId: string, extraRounds?: number) {
  const body = extraRounds !== undefined ? { extraRounds } : {}
  const r = await post(`/api/sessions/${sessionId}/resume`, body).catch(() => die(`Cannot reach server`))
  const s = (r as { status: number; data: unknown })
  if (s.status === 200) { console.log(`Resumed session ${sessionId.slice(0, 8)}`) }
  else { console.error('Error:', s.data) }
}

async function stopSession(sessionId: string) {
  const r = await post(`/api/sessions/${sessionId}/stop`).catch(() => die(`Cannot reach server`))
  const s = (r as { status: number; data: unknown })
  if (s.status === 200) { console.log(`Stopped session ${sessionId.slice(0, 8)}`) }
  else { console.error('Error:', s.data) }
}

async function deleteSession(sessionId: string) {
  const r = await del(`/api/sessions/${sessionId}`).catch(() => die('Cannot reach server'))
  const s = (r as { status: number; data: unknown })
  if (s.status === 200) { console.log(`Deleted session ${sessionId.slice(0, 8)}`) }
  else { console.error('Error:', s.data) }
}

async function nudgeSession(sessionId: string, content: string) {
  const r = await post(`/api/sessions/${sessionId}/nudge`, { content }).catch(() => die('Cannot reach server'))
  const s = (r as { status: number; data: unknown })
  if (s.status === 200) { console.log(`Nudged session ${sessionId.slice(0, 8)}`) }
  else { console.error('Error:', s.data) }
}

// ── takeover / release ────────────────────────────────────────────────────────
async function takeover(sessionId: string) {
  // Pause the session first
  await post(`/api/sessions/${sessionId}/takeover`).catch(() => die('Cannot reach server'))
  console.log(`\nTaken over session ${sessionId.slice(0, 8)} as human.`)
  console.log('Type messages and press Enter. Type /release to hand back.\n')

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const prompt = () => rl.question('[you] ', async (input) => {
    if (input.trim() === '/release') {
      rl.close()
      await releaseSession(sessionId)
      return
    }
    if (input.trim()) {
      await post(`/api/sessions/${sessionId}/message`, { content: input.trim() }).catch((e) => console.error('Error:', e))
    }
    prompt()
  })
  prompt()
}

async function releaseSession(sessionId: string) {
  const r = await post(`/api/sessions/${sessionId}/release`).catch(() => die('Cannot reach server'))
  const s = (r as { status: number; data: unknown })
  if (s.status === 200) { console.log(`Released session ${sessionId.slice(0, 8)} — agents resuming.`) }
  else { console.error('Error:', s.data) }
}

async function listTemplates() {
  const r = await get('/api/templates').catch(() => die(`Cannot reach server at ${BASE}`))
  const templates = (r as { status: number; data: unknown }).data as Array<{
    id: string
    name: string
    mode: string
    description: string
  }>
  if (!templates.length) {
    console.log('No templates.')
    return
  }
  console.log()
  for (const template of templates) {
    console.log(`  ${template.id.padEnd(20)} ${template.mode.padEnd(12)} ${template.name}`)
    console.log(`      ${template.description}`)
  }
  console.log()
}

async function configCommand(subcommand: string | undefined, flags: Flags, argv: string[]) {
  switch (subcommand) {
    case undefined:
    case 'show': {
      const r = await get('/api/config').catch(() => die(`Cannot reach server at ${BASE}`))
      const cfg = (r as { status: number; data: unknown }).data as {
        server: { port: number }
        defaults: { mode: string; maxRounds: number }
        agents: Record<string, { adapter: string; command: string; env?: Record<string, string> }>
      }
      console.log(`\n  Server port     ${cfg.server.port}`)
      console.log(`  Default mode    ${cfg.defaults.mode}`)
      console.log(`  Default rounds  ${cfg.defaults.maxRounds}`)
      console.log('\n  Agents')
      for (const [name, agent] of Object.entries(cfg.agents)) {
        console.log(`    ${name}: ${agent.adapter} -> ${agent.command}`)
        if (agent.env && Object.keys(agent.env).length) {
          console.log(`      env: ${Object.keys(agent.env).join(', ')}`)
        }
      }
      console.log()
      break
    }

    case 'set-defaults': {
      const body: Record<string, unknown> = { defaults: {} }
      if (flags.mode) (body.defaults as Record<string, unknown>).mode = flags.mode
      if (flags.rounds) (body.defaults as Record<string, unknown>).maxRounds = flags.rounds
      if (Object.keys(body.defaults as Record<string, unknown>).length === 0) {
        die('Usage: turing config set-defaults [--mode <mode>] [--rounds <n>]')
      }
      const r = await put('/api/config', body).catch(() => die(`Cannot reach server at ${BASE}`))
      if ((r as { status: number }).status === 200) console.log('Updated defaults.')
      else console.error('Error:', (r as { data: unknown }).data)
      break
    }

    case 'set-port': {
      if (!flags.port) die('Usage: turing config set-port --port <n>')
      const r = await put('/api/config', { server: { port: flags.port } }).catch(() => die(`Cannot reach server at ${BASE}`))
      if ((r as { status: number }).status === 200) console.log('Updated server port. Restart required.')
      else console.error('Error:', (r as { data: unknown }).data)
      break
    }

    case 'add-agent': {
      if (!flags.name || !flags.adapter || !flags.command) {
        die('Usage: turing config add-agent --name <name> --adapter <adapter> --command <path> [--env KEY=VALUE]')
      }
      const r = await post('/api/config/agents', {
        name: flags.name,
        adapter: flags.adapter,
        command: flags.command,
        env: parseEnvFlags(flags.env),
      }).catch(() => die(`Cannot reach server at ${BASE}`))
      if ((r as { status: number }).status === 200) console.log(`Added agent ${flags.name}.`)
      else console.error('Error:', (r as { data: unknown }).data)
      break
    }

    case 'update-agent': {
      const name = argv[2]
      if (!name) die('Usage: turing config update-agent <name> [--adapter <adapter>] [--command <path>] [--env KEY=VALUE]')
      const currentRes = await get('/api/config').catch(() => die(`Cannot reach server at ${BASE}`))
      const current = (currentRes as { data: unknown }).data as {
        agents: Record<string, { adapter: string; command: string; env?: Record<string, string> }>
      }
      const existing = current.agents[name]
      if (!existing) die(`Agent ${name} not found`)
      const r = await put(`/api/config/agents/${encodeURIComponent(name)}`, {
        name,
        adapter: flags.adapter ?? existing.adapter,
        command: flags.command ?? existing.command,
        env: flags.env.length > 0 ? parseEnvFlags(flags.env) : existing.env,
      }).catch(() => die(`Cannot reach server at ${BASE}`))
      if ((r as { status: number }).status === 200) console.log(`Updated agent ${name}.`)
      else console.error('Error:', (r as { data: unknown }).data)
      break
    }

    case 'delete-agent': {
      const name = argv[2]
      if (!name) die('Usage: turing config delete-agent <name>')
      const r = await del(`/api/config/agents/${encodeURIComponent(name)}`).catch(() => die(`Cannot reach server at ${BASE}`))
      if ((r as { status: number }).status === 200) console.log(`Deleted agent ${name}.`)
      else console.error('Error:', (r as { data: unknown }).data)
      break
    }

    default:
      die(`Unknown config command "${subcommand}"`)
  }
}

// ── agents ────────────────────────────────────────────────────────────────────
async function listAgents() {
  let r: { status: number; data: unknown }
  try {
    r = await get('/api/agents')
  } catch {
    die(`Cannot reach server at ${BASE}`)
  }

  const agents = r!.data as Array<{ name: string; adapter: string; model?: string; provider: string; status: string }>
  if (!agents.length) { console.log('No agents registered.'); return }

  console.log()
  for (const a of agents) {
    const ok = a.status === 'ready' || a.status === 'online'
    const dot = ok ? '\x1b[32m●\x1b[0m' : '\x1b[90m●\x1b[0m'
    const status = ok ? `\x1b[32m${a.status}\x1b[0m` : `\x1b[90m${a.status}\x1b[0m`
    const model = 'model' in a && a.model ? ` ${a.model}` : ''
    console.log(`  ${dot}  ${a.name.padEnd(18)} ${status}  ${a.adapter.padEnd(14)}${model}`)
  }
  console.log()
}

// ── health ────────────────────────────────────────────────────────────────────
async function health() {
  let r: { status: number; data: unknown }
  try {
    r = await get('/api/agents')
  } catch {
    console.log(`\x1b[31m✗ Server unreachable\x1b[0m  ${BASE}`)
    process.exit(1)
  }

  const agents = r!.data as Array<{ name: string; status: string }>
  let allHealthy = true
  console.log()
  for (const a of agents) {
    if (a.status === 'ready' || a.status === 'online') {
      console.log(`  \x1b[32m✓\x1b[0m  ${a.name}`)
    } else {
      console.log(`  \x1b[31m✗\x1b[0m  ${a.name}  (${a.status})`)
      allHealthy = false
    }
  }
  console.log()
  if (!allHealthy) process.exit(1)
}

// ── follow (stream WebSocket messages) ───────────────────────────────────────
async function followSession(sessionId: string): Promise<void> {
  // Fetch existing messages first
  try {
    const r = await get(`/api/sessions/${sessionId}`)
    if (r.status === 200) {
      const data = r.data as { messages: Array<{ from: string; content: string; timestamp: number; round: number }> }
      for (const msg of data.messages) {
        printMsg(msg, sessionId)
      }
    }
  } catch { /* ignore */ }

  // Then stream via WebSocket
  const { default: WebSocket } = await import('ws') as unknown as { default: typeof import('ws').WebSocket }
  const wsUrl = BASE.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws'
  const ws = new (WebSocket as unknown as new (url: string) => import('ws').WebSocket)(wsUrl)

  return new Promise((resolve) => {
    ws.on('message', (raw: Buffer) => {
      const evt = JSON.parse(raw.toString()) as { type: string; payload: unknown }

      if (evt.type === 'message:new') {
        const msg = evt.payload as { sessionId: string; from: string; content: string; timestamp: number; round: number }
        if (msg.sessionId === sessionId) {
          printMsg(msg, sessionId)
        }
      }

      if (evt.type === 'log') {
        const entry = evt.payload as { sessionId: string; level: string; message: string; timestamp: number }
        if (entry.sessionId === sessionId) {
          const ts = new Date(entry.timestamp).toLocaleTimeString()
          console.log(`\n  [${ts}] log/${entry.level}: ${entry.message}`)
        }
      }

      if (evt.type === 'heartbeat') {
        const hb = evt as unknown as {
          type: 'heartbeat'
          sessionId: string
          round: number
          agent: string
          elapsed: number
          lastOutput: string
        }
        if (hb.sessionId === sessionId) {
          console.log(`\n  [heartbeat] round=${hb.round} agent=${hb.agent} elapsed=${Math.floor(hb.elapsed / 1000)}s ${hb.lastOutput}`)
        }
      }

      if (evt.type === 'snapshot:new') {
        const snapshot = evt.payload as { sessionId: string; round: number; diffStat: string }
        if (snapshot.sessionId === sessionId) {
          console.log(`\n  [snapshot] round ${snapshot.round}`)
          if (snapshot.diffStat?.trim()) {
            for (const line of snapshot.diffStat.split('\n')) {
              console.log(`    ${line}`)
            }
          }
        }
      }

      if (
        (evt.type === 'session:done' || evt.type === 'session:error' || evt.type === 'session:updated') &&
        (evt.payload as { id?: string; session?: { id: string } })?.id === sessionId
      ) {
        const payload = evt.payload as { id?: string; status?: string; errorType?: string; errorMessage?: string; lastAgentOutput?: string; errorRound?: number }
        const status = evt.type === 'session:done' ? 'done' : evt.type === 'session:error' ? 'error' : payload.status
        if (status !== 'done' && status !== 'error' && status !== 'stopped') return
        console.log(`\n  [session ${statusColor(status)}]\n`)
        if (evt.type === 'session:error') {
          if (payload.errorType) console.log(`  errorType: ${payload.errorType}`)
          if (payload.errorRound !== undefined) console.log(`  errorRound: ${payload.errorRound}`)
          if (payload.errorMessage) console.log(`  error: ${payload.errorMessage}`)
          if (payload.lastAgentOutput) console.log(`  lastOutput: ${payload.lastAgentOutput}`)
          console.log()
        }
        ws.close()
        resolve()
      }

      if (evt.type === 'session:paused') {
        const s = (evt.payload as { session?: { id: string }; id?: string })
        const id = s?.session?.id ?? (s as unknown as { id?: string })?.id
        if (id === sessionId) {
          const reason = (evt.payload as { reason?: string })?.reason
          console.log(`\n  [session ${statusColor('paused')}${reason ? ` — ${reason}` : ''}]\n`)
        }
      }
    })

    ws.on('error', (err: Error) => {
      console.error('\n  WebSocket error:', err.message)
      resolve()
    })

    process.on('SIGINT', () => {
      console.log('\n  Detached.')
      ws.close()
      resolve()
    })
  })
}

let lastRound = -1

function printMsg(msg: { from: string; content: string; timestamp: number; round: number }, _sessionId: string) {
  if (msg.round !== lastRound && msg.round > 0) {
    console.log(`\n  ── Round ${msg.round} ──────────────────────────────`)
    lastRound = msg.round
  }
  const speaker =
    msg.from === 'human'
      ? '\x1b[36mhuman\x1b[0m'
      : `\x1b[33m${msg.from}\x1b[0m`
  const ts = new Date(msg.timestamp).toLocaleTimeString()
  console.log(`\n  [${ts}] ${speaker}:`)
  const lines = msg.content.split('\n')
  for (const line of lines) {
    console.log(`    ${line}`)
  }
}

// ── Error helper ──────────────────────────────────────────────────────────────
function die(msg: string): never {
  console.error(`\x1b[31merror:\x1b[0m ${msg}`)
  process.exit(1)
}

// ── Usage ─────────────────────────────────────────────────────────────────────
function usage() {
  console.log(`
  Turing — agent-to-agent communication proxy

  Usage:
    turing server start
    turing server stop
    turing server status

    turing chat --from <agent> --to <agent> [--from-label <label>] [--to-label <label>]
                [--mode <mode>] [--cwd <path>] [--approve] [--rounds <n>]
                [--context-rules <text>] [--context-text <text>] [--context-files <paths>]
                "<prompt>"

    turing sessions [--status <active|paused|done|error|stopped>]
    turing log <session-id>
    turing delete <session-id>

    turing pause  <session-id>
    turing resume <session-id> [--rounds <n>]
    turing stop   <session-id>
    turing nudge  <session-id> "<message>"

    turing takeover <session-id>
    turing release  <session-id>

    turing agents
    turing templates
    turing config show
    turing config set-defaults [--mode <mode>] [--rounds <n>]
    turing config set-port --port <n>
    turing config add-agent --name <name> --adapter <adapter> --command <path> [--env KEY=VALUE]
    turing config update-agent <name> [--adapter <adapter>] [--command <path>] [--env KEY=VALUE]
    turing config delete-agent <name>
    turing health
  `)
}

// ── Main ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const cmd  = argv[0]
const sub  = argv[1]
const flags = parseArgs(argv.slice(cmd === 'server' ? 2 : 1))

async function main() {
  switch (cmd) {
    case 'server':
      switch (sub) {
        case 'start':  await serverStart(); break
        case 'stop':   await serverStop();  break
        case 'status': await serverStatus(); break
        default: die(`Unknown server command "${sub}". Try: start | stop | status`)
      }
      break

    case 'chat':
      await chat(flags)
      break

    case 'sessions':
      await listSessions()
      break

    case 'templates':
      await listTemplates()
      break

    case 'config':
      await configCommand(sub, flags, argv)
      break

    case 'log': {
      const id = argv[1]
      if (!id) die('Usage: turing log <session-id>')
      await logSession(id)
      break
    }

    case 'pause': {
      const id = argv[1]
      if (!id) die('Usage: turing pause <session-id>')
      await pauseSession(id)
      break
    }

    case 'resume': {
      const id = argv[1]
      if (!id) die('Usage: turing resume <session-id> [--rounds <n>]')
      await resumeSession(id, flags.rounds)
      break
    }

    case 'stop': {
      const id = argv[1]
      if (!id) die('Usage: turing stop <session-id>')
      await stopSession(id)
      break
    }

    case 'delete': {
      const id = argv[1]
      if (!id) die('Usage: turing delete <session-id>')
      await deleteSession(id)
      break
    }

    case 'nudge': {
      const id = argv[1]
      const message = argv.slice(2).join(' ')
      if (!id || !message) die('Usage: turing nudge <session-id> "<message>"')
      await nudgeSession(id, message)
      break
    }

    case 'takeover': {
      const id = argv[1]
      if (!id) die('Usage: turing takeover <session-id>')
      await takeover(id)
      break
    }

    case 'release': {
      const id = argv[1]
      if (!id) die('Usage: turing release <session-id>')
      await releaseSession(id)
      break
    }

    case 'agents':
      await listAgents()
      break

    case 'health':
      await health()
      break

    case undefined:
    case '--help':
    case '-h':
      usage()
      break

    default:
      die(`Unknown command "${cmd}". Run \`turing --help\` for usage.`)
  }
}

main().catch((err) => {
  console.error('\x1b[31merror:\x1b[0m', err instanceof Error ? err.message : err)
  process.exit(1)
})
