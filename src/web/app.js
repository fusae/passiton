// Turing Web UI — vanilla JS

const API = ''  // same origin

// ── State ─────────────────────────────────────────────────────────────────────
let sessions = []
let agents = []
let templates = []
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
  await loadTemplates()
  await loadSessions()
  connectWs()
  setInterval(loadAgents, 30_000)
  setupSideBtns()
  setupFilterBtns()
  setupMobileMenu()
  setupMarked()
  setupMessageActions()
}

// ── Marked.js setup ───────────────────────────────────────────────────────────
function setupMarked() {
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      breaks: true,
      gfm: true,
    })
  }
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
      <div class="agent-meta">
        <div class="agent-line">
          <span class="agent-name">${a.name}</span>
          <span class="agent-status ${a.healthy ? 'ok' : 'err'}">${a.healthy ? 'online' : 'offline'}</span>
        </div>
        <div class="agent-subline">
          <span class="agent-kind">${a.adapter}</span>
          <span class="agent-source">${a.source}</span>
          ${a.version ? `<span class="agent-version">${escHtml(a.version)}</span>` : ''}
        </div>
      </div>
    </div>
  `).join('')
}

document.getElementById('refresh-agents-btn').addEventListener('click', loadAgents)

// ── Templates ─────────────────────────────────────────────────────────────────
async function loadTemplates() {
  try {
    templates = await api('/api/templates')
    renderTemplateSelector()
  } catch { /* server might be down */ }
}

function renderTemplateSelector() {
  const container = document.getElementById('template-selector')
  if (!container || !templates.length) return
  container.innerHTML =
    `<div class="template-card selected" data-template="">
      <div class="template-name">自定义</div>
      <div class="template-desc">从头配置 session 参数</div>
    </div>` +
    templates.map(t => `
      <div class="template-card" data-template="${t.id}">
        <div class="template-name">${escHtml(t.name)}</div>
        <div class="template-desc">${escHtml(t.description)}</div>
      </div>
    `).join('')

  container.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', () => {
      container.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'))
      card.classList.add('selected')
      applyTemplate(card.dataset.template)
    })
  })
}

function applyTemplate(templateId) {
  const modeSelect = document.getElementById('mode-select')
  const promptEl = document.getElementById('modal-prompt')
  if (!templateId) {
    // Custom — reset to defaults
    modeSelect.value = 'collaborate'
    promptEl.value = ''
    promptEl.placeholder = 'Describe the task…'
    return
  }
  const tpl = templates.find(t => t.id === templateId)
  if (!tpl) return
  modeSelect.value = tpl.mode
  if (tpl.promptPrefix) {
    promptEl.value = tpl.promptPrefix
    promptEl.setSelectionRange(tpl.promptPrefix.length, tpl.promptPrefix.length)
  } else {
    promptEl.value = ''
  }
  promptEl.placeholder = tpl.description
  promptEl.focus()
}

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
  sessionList.innerHTML = visible.map(s => {
    const firstMsg = s.messages?.[0]?.content || s.initialPrompt || ''
    const preview = firstMsg.slice(0, 60) + (firstMsg.length > 60 ? '…' : '')
    return `
    <div class="session-item ${s.id === activeSessionId ? 'active' : ''}" data-id="${s.id}">
      <div class="session-agents">${agentLabel(s.from)} → ${agentLabel(s.to)}</div>
      ${preview ? `<div class="session-preview">${escHtml(preview)}</div>` : ''}
      <div class="session-meta">
        <span class="badge ${s.status}">${s.status}</span>
        ${s.mode && s.mode !== 'freeform' ? `<span class="mode-chip">${s.mode}</span>` : ''}
        <span class="rounds-chip">R${s.currentRound}/${s.maxRounds}</span>
        <span class="time-chip">${timeAgo(s.updatedAt)}</span>
      </div>
    </div>
  `}).join('')

  sessionList.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', () => {
      selectSession(el.dataset.id)
      closeMobileMenu()
    })
  })

  if (!activeSessionId && !emptyState && visible[0]?.id) {
    selectSession(visible[0].id)
  }
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
  if (emptyState) {
    emptyState.classList.add('hidden')
  }
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
  const isError   = session.status === 'error'
  const isDone    = session.status === 'done'
  const isActive  = session.status === 'active'
  const isPaused  = session.status === 'paused'

  document.getElementById('btn-pause').classList.toggle('hidden', !isActive)
  document.getElementById('btn-resume').classList.toggle('hidden', !isPaused)
  document.getElementById('btn-stop').classList.toggle('hidden', isDone || isError)

  // Check if paused because of round limit
  if (isPaused && session.currentRound >= session.maxRounds) {
    roundsBannerMsg.textContent = `⚠ Reached ${session.maxRounds}-round limit`
    roundsBanner.classList.remove('hidden')
  } else {
    roundsBanner.classList.add('hidden')
  }

  // Allow inject for done sessions (triggers reopen), disable only for error
  injectInput.disabled = isError
  document.getElementById('inject-btn').disabled = isError

  // Update placeholder to hint reopen behavior
  if (isDone) {
    injectInput.placeholder = '发送消息以重启讨论...'
  } else {
    injectInput.placeholder = 'Inject a message… (⌘+Enter to send)'
  }
}

function renderMessages(msgs, session) {
  let lastRound = -1
  messagesEl.innerHTML = msgs.map(m => {
    const divider = m.round !== lastRound && m.round > 0
      ? `<div class="round-divider"><span>Round ${m.round}</span></div>`
      : ''
    lastRound = m.round
    return divider + buildMessageMarkup(m, session)
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

document.getElementById('btn-export').addEventListener('click', () => {
  exportSession()
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
  const wasDone = activeSession && activeSession.status === 'done'
  injectInput.value = ''
  await api(`/api/sessions/${activeSessionId}/message`, 'POST', {
    content,
    side: injectSide,
  })
  // If session was done, refresh to pick up reopened state
  if (wasDone) {
    await selectSession(activeSessionId)
  }
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
  // Reset template selection to "custom"
  const container = document.getElementById('template-selector')
  if (container) {
    container.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'))
    const customCard = container.querySelector('[data-template=""]')
    if (customCard) customCard.classList.add('selected')
  }
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
  const names = agents.filter(a => a.availableForSessions).map(a => a.name)
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

    case 'log': {
      handleLogEvent(evt.payload)
      break
    }
  }
}

// Append a single new message without re-rendering all (performance)
function appendMessage(msg) {
  // Insert round divider if needed
  const prevMsg = currentMessages[currentMessages.length - 2]
  if (!prevMsg || prevMsg.round !== msg.round) {
    const div = document.createElement('div')
    div.className = 'round-divider'
    div.innerHTML = `<span>Round ${msg.round}</span>`
    messagesEl.appendChild(div)
  }

  const temp = document.createElement('div')
  temp.innerHTML = buildMessageMarkup(msg, activeSession)
  messagesEl.appendChild(temp.firstElementChild)
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

function buildMessageMarkup(msg, session) {
  const { side, bubbleClass, senderLabel } = getMessagePresentation(msg, session)
  const avatarInitial = senderLabel.charAt(0).toUpperCase()
  const renderedContent = renderMarkdown(msg.content)
  return `<div class="msg-wrapper ${side}">
    <div class="msg ${bubbleClass}">
      <div class="msg-header">
        <div class="msg-avatar">${escHtml(avatarInitial)}</div>
        <span class="msg-sender">${escHtml(senderLabel)}</span>
      </div>
      <div class="msg-bubble">${renderedContent}</div>
      <div class="msg-footer">
        <span class="msg-time">${formatMessageTime(msg.timestamp)}</span>
        <button
          class="msg-copy-btn"
          type="button"
          data-message-id="${msg.id}"
          title="Copy"
          aria-label="Copy message"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="5" y="2.5" width="8" height="10" rx="2"></rect>
            <rect x="2.5" y="5.5" width="8" height="8" rx="2"></rect>
          </svg>
        </button>
      </div>
    </div>
  </div>`
}

function getMessagePresentation(msg, session) {
  const fromName = agentLabel(session?.from)
  const toName = agentLabel(session?.to)
  const isHuman = msg.from === 'human'
  const isFrom = msg.from === (session?.from?.adapter ?? '')
  const isTo = msg.from === (session?.to?.adapter ?? '')

  if (isHuman) {
    return { side: 'center', bubbleClass: 'msg-human', senderLabel: 'you' }
  }
  if (isTo) {
    return { side: 'right', bubbleClass: 'msg-to', senderLabel: toName }
  }
  if (isFrom) {
    return { side: 'left', bubbleClass: 'msg-from', senderLabel: fromName }
  }
  return { side: 'left', bubbleClass: 'msg-from', senderLabel: msg.from }
}

function renderMarkdown(content) {
  if (typeof marked === 'undefined') {
    return `<pre>${escHtml(content)}</pre>`
  }
  try {
    const html = marked.parse(content)
    return `<div class="markdown-content">${sanitizeRenderedHtml(html, content)}</div>`
  } catch (e) {
    return `<pre>${escHtml(content)}</pre>`
  }
}

function timeAgo(ts) {
  const diff = Date.now() - ts
  if (diff < 60_000)     return 'just now'
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}

function formatMessageTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function setupMessageActions() {
  messagesEl.addEventListener('click', async (event) => {
    const btn = event.target.closest('.msg-copy-btn')
    if (!btn) return
    const messageId = btn.dataset.messageId
    const msg = currentMessages.find(item => item.id === messageId)
    if (!msg) return
    const ok = await copyText(msg.content)
    btn.classList.toggle('copied', ok)
    btn.title = ok ? 'Copied' : 'Copy failed'
    setTimeout(() => {
      btn.classList.remove('copied')
      btn.title = 'Copy'
    }, 1200)
  })
}

async function copyText(content) {
  try {
    await navigator.clipboard.writeText(content)
    return true
  } catch {
    const input = document.createElement('textarea')
    input.value = content
    input.setAttribute('readonly', '')
    input.style.position = 'absolute'
    input.style.left = '-9999px'
    document.body.appendChild(input)
    input.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(input)
    return ok
  }
}

function exportSession() {
  if (!activeSession) return
  const content = buildSessionExport(activeSession, currentMessages)
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `turing-session-${activeSession.id}.md`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function buildSessionExport(session, messages) {
  const lines = [
    `# ${agentLabel(session.from)} -> ${agentLabel(session.to)}`,
    '',
    `- Session ID: ${session.id}`,
    `- Status: ${session.status}`,
    `- Mode: ${session.mode}`,
    `- Rounds: ${session.currentRound}/${session.maxRounds}`,
    `- Exported At: ${new Date().toLocaleString()}`,
    '',
  ]

  let lastRound = null
  for (const msg of messages) {
    if (msg.round !== lastRound) {
      lines.push(`## Round ${msg.round}`)
      lines.push('')
      lastRound = msg.round
    }
    const sender = msg.from === 'human'
      ? 'you'
      : msg.from === session.from.adapter
        ? agentLabel(session.from)
        : msg.from === session.to.adapter
          ? agentLabel(session.to)
          : msg.from
    lines.push(`### ${sender} · ${formatMessageTime(msg.timestamp)}`)
    lines.push('')
    lines.push(msg.content || '_empty_')
    lines.push('')
  }

  return lines.join('\n')
}

function sanitizeRenderedHtml(html, fallbackText) {
  const template = document.createElement('template')
  template.innerHTML = html
  const blockedTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META'])
  let unsafeLinkFound = false

  for (const node of template.content.querySelectorAll('*')) {
    if (blockedTags.has(node.tagName)) {
      node.remove()
      continue
    }
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim()
      if (name.startsWith('on')) {
        node.removeAttribute(attr.name)
        continue
      }
      if (name === 'href' || name === 'src') {
        if (!isSafeUrl(value)) {
          unsafeLinkFound = true
          break
        }
        if (name === 'href') {
          node.setAttribute('rel', 'noopener noreferrer nofollow')
          node.setAttribute('target', '_blank')
        }
      }
    }
    if (unsafeLinkFound) break
  }

  if (unsafeLinkFound) {
    return `<pre>${escHtml(fallbackText)}</pre>`
  }
  return template.innerHTML
}

function isSafeUrl(value) {
  if (!value) return false
  if (value.startsWith('#')) return true
  try {
    const url = new URL(value, window.location.origin)
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)
  } catch {
    return false
  }
}

// ── Mobile menu ───────────────────────────────────────────────────────────────
function setupMobileMenu() {
  const menuBtn = document.getElementById('mobile-menu-btn')
  const sidebar = document.getElementById('sidebar')
  const overlay = document.getElementById('mobile-overlay')

  menuBtn.addEventListener('click', () => {
    sidebar.classList.add('mobile-open')
    overlay.classList.add('active')
  })

  overlay.addEventListener('click', closeMobileMenu)
}

function closeMobileMenu() {
  const sidebar = document.getElementById('sidebar')
  const overlay = document.getElementById('mobile-overlay')
  sidebar.classList.remove('mobile-open')
  overlay.classList.remove('active')
}

// ── Log panel ─────────────────────────────────────────────────────────────────
const LOG_MAX = 500
const logEntries = []
let logPanelOpen = false
let logHasUnseenError = false

const logToggle    = document.getElementById('log-toggle')
const logPanel     = document.getElementById('log-panel')
const logEntriesEl = document.getElementById('log-entries')
const logErrorDot  = document.getElementById('log-error-dot')
const logClearBtn  = document.getElementById('log-clear-btn')
const logCloseBtn  = document.getElementById('log-close-btn')
const logResize    = document.getElementById('log-panel-resize')

logToggle.addEventListener('click', () => {
  logPanelOpen = !logPanelOpen
  logPanel.classList.toggle('hidden', !logPanelOpen)
  logToggle.classList.toggle('active', logPanelOpen)
  if (logPanelOpen) {
    logHasUnseenError = false
    logErrorDot.classList.add('hidden')
    renderLogEntries()
  }
})

logCloseBtn.addEventListener('click', () => {
  logPanelOpen = false
  logPanel.classList.add('hidden')
  logToggle.classList.remove('active')
})

logClearBtn.addEventListener('click', () => {
  logEntries.length = 0
  logHasUnseenError = false
  logErrorDot.classList.add('hidden')
  renderLogEntries()
})

// Resize by drag
let logResizing = false
logResize.addEventListener('mousedown', (e) => {
  e.preventDefault()
  logResizing = true
  const startY = e.clientY
  const startH = logPanel.offsetHeight

  function onMove(ev) {
    if (!logResizing) return
    const delta = startY - ev.clientY
    const newH = Math.max(100, Math.min(window.innerHeight * 0.7, startH + delta))
    logPanel.style.height = newH + 'px'
  }
  function onUp() {
    logResizing = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
})

function handleLogEvent(payload) {
  const entry = {
    timestamp: payload.timestamp,
    level: payload.level,
    message: payload.message,
  }
  logEntries.push(entry)
  while (logEntries.length > LOG_MAX) logEntries.shift()

  if (entry.level === 'error' && !logPanelOpen) {
    logHasUnseenError = true
    logErrorDot.classList.remove('hidden')
  }

  if (logPanelOpen) {
    appendLogEntry(entry)
    scrollLogToBottom()
  }
}

function renderLogEntries() {
  if (!logEntries.length) {
    logEntriesEl.innerHTML = '<div class="log-empty">No log entries yet</div>'
    return
  }
  logEntriesEl.innerHTML = logEntries.map(formatLogEntry).join('')
  scrollLogToBottom()
}

function appendLogEntry(entry) {
  // Remove empty placeholder if present
  const empty = logEntriesEl.querySelector('.log-empty')
  if (empty) empty.remove()

  const div = document.createElement('div')
  div.innerHTML = formatLogEntry(entry)
  logEntriesEl.appendChild(div.firstElementChild)
}

function formatLogEntry(entry) {
  const ts = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return `<div class="log-entry ${escHtml(entry.level)}">
    <span class="log-ts">${ts}</span>
    <span class="log-level ${escHtml(entry.level)}">${escHtml(entry.level)}</span>
    <span class="log-msg">${escHtml(entry.message)}</span>
  </div>`
}

function scrollLogToBottom() {
  requestAnimationFrame(() => {
    logEntriesEl.scrollTop = logEntriesEl.scrollHeight
  })
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init)
