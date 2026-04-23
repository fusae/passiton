// Turing Web UI — vanilla JS

const API = ''  // same origin

// ── State ─────────────────────────────────────────────────────────────────────
let sessions = []
let agents = []
let activeSessionId = null
let ws = null
let currentMessages = []

// ── DOM refs ──────────────────────────────────────────────────────────────────
const sessionList   = document.getElementById('session-list')
const agentsPanel   = document.getElementById('agents-panel').querySelector('.agents-list')
const emptyState    = document.getElementById('empty-state')
const sessionView   = document.getElementById('session-view')
const messagesEl    = document.getElementById('messages')
const sessionTitle  = document.getElementById('session-title')
const sessionBadge  = document.getElementById('session-badge')
const injectInput   = document.getElementById('inject-input')
const modalOverlay  = document.getElementById('modal-overlay')

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadAgents()
  await loadSessions()
  connectWs()
  setInterval(loadAgents, 30_000)
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function api(path, method = 'GET', body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  const r = await fetch(API + path, opts)
  return r.json()
}

// ── Agents ────────────────────────────────────────────────────────────────────
async function loadAgents() {
  agents = await api('/api/agents')
  renderAgents()
  // Also refresh agent selects in modal
  populateAgentSelects()
}

function renderAgents() {
  agentsPanel.innerHTML = agents.map(a => `
    <div class="agent-row">
      <span class="agent-dot ${a.healthy ? 'ok' : 'err'}"></span>
      <span>${a.name}</span>
      <span style="color:var(--muted);font-size:11px">${a.healthy ? 'online' : 'offline'}</span>
    </div>
  `).join('')
}

// ── Sessions ──────────────────────────────────────────────────────────────────
async function loadSessions() {
  sessions = await api('/api/sessions')
  renderSessionList()
}

function renderSessionList() {
  sessionList.innerHTML = sessions.map(s => `
    <div class="session-item ${s.id === activeSessionId ? 'active' : ''}" data-id="${s.id}">
      <div class="agents">${agentLabel(s.from)} → ${agentLabel(s.to)}</div>
      <div class="meta">
        <span class="badge ${s.status}">${s.status}</span>
        <span>R ${s.currentRound}/${s.maxRounds}</span>
        <span>${timeAgo(s.updatedAt)}</span>
      </div>
    </div>
  `).join('')

  sessionList.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', () => selectSession(el.dataset.id))
  })
}

function agentLabel(ref) {
  return ref.label || ref.adapter
}

async function selectSession(id) {
  activeSessionId = id
  renderSessionList()
  const data = await api(`/api/sessions/${id}`)
  currentMessages = data.messages || []
  renderSessionView(data)
}

function renderSessionView(session) {
  emptyState.classList.add('hidden')
  sessionView.classList.remove('hidden')

  sessionTitle.textContent = `${agentLabel(session.from)} → ${agentLabel(session.to)}`
  sessionBadge.className = `badge ${session.status}`
  sessionBadge.textContent = session.status

  // Toolbar buttons
  document.getElementById('btn-pause').style.display  = session.status === 'active' ? '' : 'none'
  document.getElementById('btn-resume').style.display = session.status === 'paused' ? '' : 'none'
  document.getElementById('btn-stop').style.display   = (session.status === 'active' || session.status === 'paused') ? '' : 'none'

  renderMessages(currentMessages)
}

function renderMessages(msgs) {
  let lastRound = -1
  messagesEl.innerHTML = msgs.map(m => {
    let divider = ''
    if (m.round !== lastRound && m.round > 0) {
      divider = `<div class="round-divider">── Round ${m.round} ──</div>`
      lastRound = m.round
    }
    const isHuman = m.from === 'human'
    return `${divider}<div class="msg ${isHuman ? 'from-human' : ''}">
      <div class="msg-header">${m.from} · ${new Date(m.timestamp).toLocaleTimeString()}</div>
      <div class="msg-bubble">${escHtml(m.content)}</div>
    </div>`
  }).join('')
  messagesEl.scrollTop = messagesEl.scrollHeight
}

// ── Session controls ──────────────────────────────────────────────────────────
document.getElementById('btn-pause').addEventListener('click', async () => {
  if (!activeSessionId) return
  await api(`/api/sessions/${activeSessionId}/pause`, 'POST')
})

document.getElementById('btn-resume').addEventListener('click', async () => {
  if (!activeSessionId) return
  await api(`/api/sessions/${activeSessionId}/resume`, 'POST')
})

document.getElementById('btn-stop').addEventListener('click', async () => {
  if (!activeSessionId) return
  if (!confirm('Stop this session?')) return
  await api(`/api/sessions/${activeSessionId}/stop`, 'POST')
})

// Inject message
document.getElementById('inject-btn').addEventListener('click', injectMessage)
injectInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) injectMessage()
})

async function injectMessage() {
  const content = injectInput.value.trim()
  if (!content || !activeSessionId) return
  injectInput.value = ''
  await api(`/api/sessions/${activeSessionId}/message`, 'POST', { content })
}

// ── New session modal ─────────────────────────────────────────────────────────
document.getElementById('new-btn').addEventListener('click', () => {
  populateAgentSelects()
  modalOverlay.classList.remove('hidden')
})

document.getElementById('modal-cancel').addEventListener('click', () => {
  modalOverlay.classList.add('hidden')
})

document.getElementById('modal-form').addEventListener('submit', async e => {
  e.preventDefault()
  const fd = new FormData(e.target)
  const body = {
    from: { adapter: fd.get('from') },
    to: { adapter: fd.get('to') },
    initialPrompt: fd.get('prompt'),
    maxRounds: parseInt(fd.get('maxRounds')) || 20,
    approveMode: fd.get('approveMode') === 'on',
    cwd: fd.get('cwd') || undefined,
  }
  modalOverlay.classList.add('hidden')
  const session = await api('/api/sessions', 'POST', body)
  sessions.unshift(session)
  renderSessionList()
  await selectSession(session.id)
})

function populateAgentSelects() {
  const names = agents.map(a => a.name)
  ;['from-select', 'to-select'].forEach((id, idx) => {
    const el = document.getElementById(id)
    if (!el) return
    const current = el.value
    el.innerHTML = names.map(n => `<option value="${n}" ${n === current ? 'selected' : ''}>${n}</option>`).join('')
    if (!current && names[idx]) el.value = names[idx]
  })
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/ws`)

  ws.addEventListener('message', ({ data }) => {
    const evt = JSON.parse(data)
    handleWsEvent(evt)
  })

  ws.addEventListener('close', () => {
    setTimeout(connectWs, 3000)
  })
}

function handleWsEvent(evt) {
  switch (evt.type) {
    case 'init':
      sessions = evt.payload
      renderSessionList()
      break

    case 'session:created':
      if (!sessions.find(s => s.id === evt.payload.id)) {
        sessions.unshift(evt.payload)
      }
      renderSessionList()
      break

    case 'session:updated':
    case 'session:done':
    case 'session:error':
    case 'session:paused': {
      const s = evt.payload.session || evt.payload
      upsertSession(s)
      if (s.id === activeSessionId) {
        renderSessionView({ ...s, messages: currentMessages })
      }
      break
    }

    case 'message:new': {
      const msg = evt.payload
      if (msg.sessionId === activeSessionId) {
        currentMessages.push(msg)
        renderMessages(currentMessages)
      }
      // Update session round display
      upsertSessionField(msg.sessionId, 'currentRound', msg.round)
      renderSessionList()
      break
    }
  }
}

function upsertSession(updated) {
  const idx = sessions.findIndex(s => s.id === updated.id)
  if (idx >= 0) sessions[idx] = updated
  else sessions.unshift(updated)
  renderSessionList()
}

function upsertSessionField(id, field, value) {
  const s = sessions.find(s => s.id === id)
  if (s) s[field] = value
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function timeAgo(ts) {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init)
