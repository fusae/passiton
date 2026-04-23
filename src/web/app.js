// Turing Web UI — vanilla JS

const API = ''  // same origin

// ── State ─────────────────────────────────────────────────────────────────────
let sessions = []
let agents = []
let activeSessionId = null
let ws = null
let currentMessages = []
let activeSession = null
let injectSide = 'from'
let sessionFilter = 'all'

// ── DOM refs ──────────────────────────────────────────────────────────────────
const sessionList      = document.getElementById('session-list')
const agentsList       = document.querySelector('.agents-list')
const emptyState       = document.getElementById('empty-state')
const sessionView      = document.getElementById('session-view')
const messagesEl       = document.getElementById('messages')
const sessionTitle     = document.getElementById('session-title')
const sessionBadge     = document.getElementById('session-badge')
const sessionRounds    = document.getElementById('session-rounds')
const injectInput      = document.getElementById('inject-input')
const modalOverlay     = document.getElementById('modal-overlay')
const roundsBanner     = document.getElementById('rounds-banner')
const roundsBannerMsg  = document.getElementById('rounds-banner-msg')
const resumeModalOv    = document.getElementById('resume-modal-overlay')
const wsStatusEl       = document.getElementById('ws-status')

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadAgents()
  await loadSessions()
  connectWs()
  setInterval(loadAgents, 30_000)
  setupSideBtns()
  setupFilterBtns()
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function api(path, method = 'GET', body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const r = await fetch(API + path, opts)
  return r.json()
}

// ── Agents ────────────────────────────────────────────────────────────────────
async function loadAgents() {
  try {
    agents = await api('/api/agents')
    renderAgents()
    populateAgentSelects()
  } catch { /* server might be down */ }
}

function renderAgents() {
  if (!agents.length) {
    agentsList.innerHTML = '<span class="no-agents">No agents registered</span>'
    return
  }
  agentsList.innerHTML = agents.map(a => `
    <div class="agent-row">
      <span class="agent-dot ${a.healthy ? 'ok' : 'err'}"></span>
      <span class="agent-name">${a.name}</span>
      <span class="agent-status ${a.healthy ? 'ok' : 'err'}">${a.healthy ? 'online' : 'offline'}</span>
    </div>
  `).join('')
}

document.getElementById('refresh-agents-btn').addEventListener('click', loadAgents)

// ── Sessions ──────────────────────────────────────────────────────────────────
async function loadSessions() {
  try {
    sessions = await api('/api/sessions')
    renderSessionList()
  } catch { /* server might be down */ }
}

function filteredSessions() {
  if (sessionFilter === 'all') return sessions
  return sessions.filter(s => s.status === sessionFilter)
}

function renderSessionList() {
  const visible = filteredSessions()
  if (!visible.length) {
    sessionList.innerHTML = '<div class="session-empty">No sessions</div>'
    return
  }
  sessionList.innerHTML = visible.map(s => `
    <div class="session-item ${s.id === activeSessionId ? 'active' : ''}" data-id="${s.id}">
      <div class="session-agents">${agentLabel(s.from)} → ${agentLabel(s.to)}</div>
      <div class="session-meta">
        <span class="badge ${s.status}">${s.status}</span>
        ${s.mode && s.mode !== 'freeform' ? `<span class="mode-chip">${s.mode}</span>` : ''}
        <span class="rounds-chip">R${s.currentRound}/${s.maxRounds}</span>
        <span class="time-chip">${timeAgo(s.updatedAt)}</span>
      </div>
    </div>
  `).join('')

  sessionList.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', () => selectSession(el.dataset.id))
  })
}

function agentLabel(ref) {
  return ref?.label || ref?.adapter || '?'
}

async function selectSession(id) {
  activeSessionId = id
  renderSessionList()
  try {
    const data = await api(`/api/sessions/${id}`)
    activeSession = data
    currentMessages = data.messages || []
    renderSessionView(data)
  } catch (e) {
    console.error('Failed to load session', e)
  }
}

function renderSessionView(session) {
  emptyState.classList.add('hidden')
  sessionView.classList.remove('hidden')

  // Update side-btn labels to reflect actual agent names
  document.getElementById('side-from-btn').textContent = `from: ${agentLabel(session.from)}`
  document.getElementById('side-to-btn').textContent   = `to: ${agentLabel(session.to)}`

  sessionTitle.textContent = `${agentLabel(session.from)} → ${agentLabel(session.to)}`
  sessionBadge.className   = `badge ${session.status}`
  sessionBadge.textContent = session.status
  sessionRounds.textContent = `R${session.currentRound}/${session.maxRounds}`

  updateToolbar(session)
  renderMessages(currentMessages, session)
}

function updateToolbar(session) {
  const isDone    = session.status === 'done' || session.status === 'error'
  const isActive  = session.status === 'active'
  const isPaused  = session.status === 'paused'

  document.getElementById('btn-pause').classList.toggle('hidden', !isActive)
  document.getElementById('btn-resume').classList.toggle('hidden', !isPaused)
  document.getElementById('btn-stop').classList.toggle('hidden', isDone)

  // Check if paused because of round limit
  if (isPaused && session.currentRound >= session.maxRounds) {
    roundsBannerMsg.textContent = `⚠ Reached ${session.maxRounds}-round limit`
    roundsBanner.classList.remove('hidden')
  } else {
    roundsBanner.classList.add('hidden')
  }

  // Disable inject bar if session is terminal
  injectInput.disabled = isDone
  document.getElementById('inject-btn').disabled = isDone
}

function renderMessages(msgs, session) {
  const fromName = agentLabel(session?.from)
  const toName   = agentLabel(session?.to)

  let lastRound = -1
  messagesEl.innerHTML = msgs.map(m => {
    let divider = ''
    if (m.round !== lastRound && m.round > 0) {
      divider = `<div class="round-divider"><span>Round ${m.round}</span></div>`
      lastRound = m.round
    }

    const isHuman  = m.from === 'human'
    const isFrom   = m.from === (session?.from?.adapter ?? '')
    const isTo     = m.from === (session?.to?.adapter ?? '')

    let side = 'left'
    let bubbleClass = 'msg-agent-from'
    let senderLabel = m.from

    if (isHuman) {
      bubbleClass = 'msg-human'
      senderLabel = 'you'
      side = 'center'
    } else if (isFrom) {
      side = 'left'
      bubbleClass = 'msg-from'
      senderLabel = fromName
    } else if (isTo) {
      side = 'right'
      bubbleClass = 'msg-to'
      senderLabel = toName
    }

    const ts = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return `${divider}<div class="msg-wrapper ${side}">
      <div class="msg ${bubbleClass}">
        <div class="msg-header">
          <span class="msg-sender">${escHtml(senderLabel)}</span>
          <span class="msg-time">${ts}</span>
        </div>
        <div class="msg-bubble"><pre>${escHtml(m.content)}</pre></div>
      </div>
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
  if (!confirm('Stop this session permanently?')) return
  await api(`/api/sessions/${activeSessionId}/stop`, 'POST')
})

// Rounds banner buttons
document.getElementById('btn-continue-10').addEventListener('click', async () => {
  if (!activeSessionId) return
  await api(`/api/sessions/${activeSessionId}/resume`, 'POST', { extraRounds: 10 })
  roundsBanner.classList.add('hidden')
})

document.getElementById('btn-continue-custom').addEventListener('click', () => {
  resumeModalOv.classList.remove('hidden')
})

document.getElementById('btn-end-session').addEventListener('click', async () => {
  if (!activeSessionId) return
  await api(`/api/sessions/${activeSessionId}/stop`, 'POST')
  roundsBanner.classList.add('hidden')
})

// Resume +N modal
document.getElementById('resume-modal-cancel').addEventListener('click', () => {
  resumeModalOv.classList.add('hidden')
})

document.getElementById('resume-modal-ok').addEventListener('click', async () => {
  const n = parseInt(document.getElementById('resume-rounds-input').value)
  if (!n || n < 1) return
  resumeModalOv.classList.add('hidden')
  if (!activeSessionId) return
  await api(`/api/sessions/${activeSessionId}/resume`, 'POST', { extraRounds: n })
  roundsBanner.classList.add('hidden')
})

// Inject message
document.getElementById('inject-btn').addEventListener('click', doInject)
injectInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) doInject()
})

async function doInject() {
  const content = injectInput.value.trim()
  if (!content || !activeSessionId) return
  injectInput.value = ''
  await api(`/api/sessions/${activeSessionId}/message`, 'POST', {
    content,
    side: injectSide,
  })
}

// ── Side selector ─────────────────────────────────────────────────────────────
function setupSideBtns() {
  document.querySelectorAll('.side-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      injectSide = btn.dataset.side
      document.querySelectorAll('.side-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
    })
  })
}

// ── Filter bar ────────────────────────────────────────────────────────────────
function setupFilterBtns() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      sessionFilter = btn.dataset.filter
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      renderSessionList()
    })
  })
}

// ── New session modal ─────────────────────────────────────────────────────────
document.getElementById('new-btn').addEventListener('click', () => {
  populateAgentSelects()
  modalOverlay.classList.remove('hidden')
  setTimeout(() => document.getElementById('modal-prompt').focus(), 50)
})

document.getElementById('modal-cancel').addEventListener('click', closeModal)
document.getElementById('modal-close').addEventListener('click', closeModal)

modalOverlay.addEventListener('click', e => {
  if (e.target === modalOverlay) closeModal()
})

function closeModal() {
  modalOverlay.classList.add('hidden')
}

document.getElementById('modal-form').addEventListener('submit', async e => {
  e.preventDefault()
  const fd = new FormData(e.target)
  const body = {
    from: { adapter: fd.get('from') },
    to:   { adapter: fd.get('to') },
    initialPrompt: fd.get('prompt'),
    mode: fd.get('mode') || 'freeform',
    context: fd.get('context') || undefined,
    maxRounds: parseInt(fd.get('maxRounds')) || 20,
    approveMode: fd.get('approveMode') === 'on',
    cwd: fd.get('cwd') || undefined,
  }
  closeModal()
  e.target.reset()

  try {
    const session = await api('/api/sessions', 'POST', body)
    if (session.error) { alert('Error: ' + session.error); return }
    sessions.unshift(session)
    renderSessionList()
    await selectSession(session.id)
  } catch (err) {
    alert('Failed to create session: ' + err.message)
  }
})

function populateAgentSelects() {
  const names = agents.map(a => a.name)
  ;['from-select', 'to-select'].forEach((id, idx) => {
    const el = document.getElementById(id)
    if (!el) return
    const current = el.value
    el.innerHTML = names.length
      ? names.map(n => `<option value="${n}">${n}</option>`).join('')
      : '<option value="">— no agents registered —</option>'
    if (current && names.includes(current)) el.value = current
    else if (names[idx]) el.value = names[idx]
  })
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
let wsRetryTimer = null

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/ws`)

  ws.addEventListener('open', () => {
    wsStatusEl.textContent = 'live'
    wsStatusEl.className = 'ws-badge connected'
    document.getElementById('server-dot').className = 'dot green'
    if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null }
  })

  ws.addEventListener('message', ({ data }) => {
    handleWsEvent(JSON.parse(data))
  })

  ws.addEventListener('close', () => {
    wsStatusEl.textContent = 'disconnected'
    wsStatusEl.className = 'ws-badge disconnected'
    document.getElementById('server-dot').className = 'dot red'
    wsRetryTimer = setTimeout(connectWs, 3000)
  })

  ws.addEventListener('error', () => {
    wsStatusEl.textContent = 'error'
    wsStatusEl.className = 'ws-badge disconnected'
  })
}

function handleWsEvent(evt) {
  switch (evt.type) {
    case 'init':
      sessions = evt.payload
      renderSessionList()
      break

    case 'session:created': {
      if (!sessions.find(s => s.id === evt.payload.id)) {
        sessions.unshift(evt.payload)
      }
      renderSessionList()
      break
    }

    case 'session:updated':
    case 'session:done':
    case 'session:error':
    case 'session:paused': {
      const s = evt.payload?.session ?? evt.payload
      upsertSession(s)
      if (s.id === activeSessionId) {
        activeSession = { ...activeSession, ...s }
        // Re-render toolbar + banner without re-fetching messages
        sessionBadge.className   = `badge ${s.status}`
        sessionBadge.textContent = s.status
        sessionRounds.textContent = `R${s.currentRound}/${s.maxRounds}`
        updateToolbar(s)
      }
      break
    }

    case 'message:new': {
      const msg = evt.payload
      if (msg.sessionId === activeSessionId) {
        currentMessages.push(msg)
        appendMessage(msg)
      }
      upsertSessionField(msg.sessionId, 'currentRound', msg.round)
      renderSessionList()
      break
    }
  }
}

// Append a single new message without re-rendering all (performance)
function appendMessage(msg) {
  const session = activeSession
  const fromName = agentLabel(session?.from)
  const toName   = agentLabel(session?.to)

  const isHuman  = msg.from === 'human'
  const isFrom   = msg.from === session?.from?.adapter
  const isTo     = msg.from === session?.to?.adapter

  let side = 'left'
  let bubbleClass = 'msg-from'
  let senderLabel = msg.from

  if (isHuman) {
    bubbleClass = 'msg-human'
    senderLabel = 'you'
    side = 'center'
  } else if (isTo) {
    side = 'right'
    bubbleClass = 'msg-to'
    senderLabel = toName
  } else if (isFrom) {
    side = 'left'
    bubbleClass = 'msg-from'
    senderLabel = fromName
  }

  // Insert round divider if needed
  const prevMsg = currentMessages[currentMessages.length - 2]
  if (!prevMsg || prevMsg.round !== msg.round) {
    const div = document.createElement('div')
    div.className = 'round-divider'
    div.innerHTML = `<span>Round ${msg.round}</span>`
    messagesEl.appendChild(div)
  }

  const ts = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const wrapper = document.createElement('div')
  wrapper.className = `msg-wrapper ${side}`
  wrapper.innerHTML = `
    <div class="msg ${bubbleClass}">
      <div class="msg-header">
        <span class="msg-sender">${escHtml(senderLabel)}</span>
        <span class="msg-time">${ts}</span>
      </div>
      <div class="msg-bubble"><pre>${escHtml(msg.content)}</pre></div>
    </div>
  `
  messagesEl.appendChild(wrapper)
  messagesEl.scrollTop = messagesEl.scrollHeight

  // Update rounds label
  sessionRounds.textContent = `R${msg.round}/${activeSession?.maxRounds ?? '?'}`
}

function upsertSession(updated) {
  const idx = sessions.findIndex(s => s.id === updated.id)
  if (idx >= 0) sessions[idx] = { ...sessions[idx], ...updated }
  else sessions.unshift(updated)
  renderSessionList()
}

function upsertSessionField(id, field, value) {
  const s = sessions.find(s => s.id === id)
  if (s) s[field] = value
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function timeAgo(ts) {
  const diff = Date.now() - ts
  if (diff < 60_000)     return 'just now'
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init)
