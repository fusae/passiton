#!/usr/bin/env node
// Turing CLI — communicates with the Turing Server via HTTP
// Usage: turing <command> [options]

import http from 'http'
import https from 'https'
import { createInterface } from 'readline'
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

// ── Arg parsing helpers ───────────────────────────────────────────────────────

interface Flags {
  from?: string
  to?: string
  cwd?: string
  approve?: boolean
  rounds?: number
  side?: string
  _: string[]  // positional args
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  let i = 0
  while (i < argv.length) {
    const a = argv[i]
    if (a === '--from' && argv[i + 1]) { flags.from = argv[++i] }
    else if (a === '--to' && argv[i + 1]) { flags.to = argv[++i] }
    else if (a === '--cwd' && argv[i + 1]) { flags.cwd = argv[++i] }
    else if (a === '--approve' || a === '-A') { flags.approve = true }
    else if ((a === '--rounds' || a === '-r') && argv[i + 1]) { flags.rounds = parseInt(argv[++i]) }
    else if (a === '--side' && argv[i + 1]) { flags.side = argv[++i] }
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
  const { createServer } = await import('./server.js')
  const { installGracefulShutdown } = await import('./shutdown.js')

  initDb()
  const router = new Router(config.policy)
  registerConfiguredAdapters(router, config.agents)

  const server = createServer(router, config.server.port)
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
    from: { adapter: flags.from },
    to:   { adapter: flags.to },
    initialPrompt: prompt,
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
    r = await get('/api/sessions')
  } catch {
    die(`Cannot reach server at ${BASE}`)
  }

  const sessions = r!.data as Array<{
    id: string
    from: { adapter: string; label?: string }
    to: { adapter: string; label?: string }
    status: string
    currentRound: number
    maxRounds: number
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
      `R${s.currentRound}/${s.maxRounds}  ` +
      `${from} → ${to}  ` +
      `${timeAgo(s.updatedAt)}`
    )
  }
  console.log()
}

// ── log ───────────────────────────────────────────────────────────────────────
async function logSession(sessionId: string) {
  let r: { status: number; data: unknown }
  try {
    r = await get(`/api/sessions/${sessionId}`)
  } catch {
    die(`Cannot reach server at ${BASE}`)
  }

  if (r!.status === 404) { die(`Session ${sessionId} not found`) }

  const data = r!.data as {
    id: string
    from: { adapter: string; label?: string }
    to: { adapter: string; label?: string }
    status: string
    currentRound: number
    maxRounds: number
    messages: Array<{ from: string; content: string; timestamp: number; round: number }>
  }

  console.log(`\n  Session  ${data.id}`)
  console.log(`  From     ${agentLabel(data.from)}`)
  console.log(`  To       ${agentLabel(data.to)}`)
  console.log(`  Status   ${statusColor(data.status)}`)
  console.log(`  Rounds   ${data.currentRound}/${data.maxRounds}`)
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

// ── takeover / release ────────────────────────────────────────────────────────
async function takeover(sessionId: string, side: string) {
  if (side !== 'from' && side !== 'to') { die('--side must be "from" or "to"') }

  // Pause the session first
  await post(`/api/sessions/${sessionId}/takeover`).catch(() => die('Cannot reach server'))
  console.log(`\nTaken over session ${sessionId.slice(0, 8)} as ${side} side.`)
  console.log('Type messages and press Enter. Type /release to hand back.\n')

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const prompt = () => rl.question(`[you as ${side}] `, async (input) => {
    if (input.trim() === '/release') {
      rl.close()
      await releaseSession(sessionId)
      return
    }
    if (input.trim()) {
      await post(`/api/sessions/${sessionId}/message`, {
        content: input.trim(),
        side,
      }).catch((e) => console.error('Error:', e))
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

// ── agents ────────────────────────────────────────────────────────────────────
async function listAgents() {
  let r: { status: number; data: unknown }
  try {
    r = await get('/api/agents')
  } catch {
    die(`Cannot reach server at ${BASE}`)
  }

  const agents = r!.data as Array<{ name: string; healthy: boolean }>
  if (!agents.length) { console.log('No agents registered.'); return }

  console.log()
  for (const a of agents) {
    const dot = a.healthy ? '\x1b[32m●\x1b[0m' : '\x1b[31m●\x1b[0m'
    const status = a.healthy ? '\x1b[32monline\x1b[0m' : '\x1b[31moffline\x1b[0m'
    console.log(`  ${dot}  ${a.name.padEnd(20)} ${status}`)
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

  const agents = r!.data as Array<{ name: string; healthy: boolean }>
  let allHealthy = true
  console.log()
  for (const a of agents) {
    if (a.healthy) {
      console.log(`  \x1b[32m✓\x1b[0m  ${a.name}`)
    } else {
      console.log(`  \x1b[31m✗\x1b[0m  ${a.name}  (unreachable)`)
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

      if (
        (evt.type === 'session:done' || evt.type === 'session:error') &&
        (evt.payload as { id?: string; session?: { id: string } })?.id === sessionId
      ) {
        const status = evt.type === 'session:done' ? 'done' : 'error'
        console.log(`\n  [session ${statusColor(status)}]\n`)
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

    turing chat --from <agent> --to <agent> [--cwd <path>] [--approve] [--rounds <n>] "<prompt>"

    turing sessions
    turing log <session-id>

    turing pause  <session-id>
    turing resume <session-id> [--rounds <n>]
    turing stop   <session-id>

    turing takeover <session-id> --side <from|to>
    turing release  <session-id>

    turing agents
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

    case 'takeover': {
      const id = argv[1]
      if (!id) die('Usage: turing takeover <session-id> --side <from|to>')
      if (!flags.side) die('--side <from|to> is required')
      await takeover(id, flags.side)
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
