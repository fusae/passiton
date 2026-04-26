// Turing Web UI — vanilla JS

const API = ''  // same origin
const AUTH_TOKEN_KEY = 'turing-jwt'

// ── State ─────────────────────────────────────────────────────────────────────
let sessions = []
let pipelines = []
let agents = []
let apiKeys = []
let templates = []
let stats = null
let activeSessionId = null
let activePipelineId = null
let ws = null
let currentMessages = []
let currentSnapshots = []
let activeSession = null
let activePipeline = null
let sessionFilter = 'all'
let appConfig = null
let editingAgentName = null
const heartbeats = new Map()
const AGENT_COMMAND_DEFAULTS = {
  'claude-code': 'claude',
  codex: 'codex',
  opencode: 'opencode',
}
const UI_PREFS_KEY = 'turing-ui-prefs'

// ── DOM refs ──────────────────────────────────────────────────────────────────
const sessionList      = document.getElementById('session-list')
const pipelineList     = document.getElementById('pipeline-list')
const pipelineSidebarSection = document.getElementById('pipeline-sidebar-section')
const pipelineToggle   = document.getElementById('pipeline-toggle')
const pipelineToggleIcon = document.getElementById('pipeline-toggle-icon')
const agentsList       = document.querySelector('.agents-list')
const statsGrid        = document.getElementById('stats-grid')
const statsPanel       = document.getElementById('stats-panel')
const statsToggle      = document.getElementById('stats-toggle')
const statsToggleIcon  = document.getElementById('stats-toggle-icon')
const emptyState       = document.getElementById('empty-state')
const sessionView      = document.getElementById('session-view')
const pipelineView     = document.getElementById('pipeline-view')
const messagesEl       = document.getElementById('messages')
const sessionTitle     = document.getElementById('session-title')
const sessionBadge     = document.getElementById('session-badge')
const sessionRounds    = document.getElementById('session-rounds')
const pipelineTitle    = document.getElementById('pipeline-title')
const pipelineBadge    = document.getElementById('pipeline-badge')
const pipelineProgress = document.getElementById('pipeline-progress-label')
const pipelineDetail   = document.getElementById('pipeline-detail')
const injectInput      = document.getElementById('inject-input')
const modalOverlay     = document.getElementById('modal-overlay')
const pipelineModalOverlay = document.getElementById('pipeline-modal-overlay')
const pipelineStepList = document.getElementById('pipeline-step-list')
const roundsBanner     = document.getElementById('rounds-banner')
const roundsBannerMsg  = document.getElementById('rounds-banner-msg')
const errorBanner      = document.getElementById('error-banner')
const errorBannerMsg   = document.getElementById('error-banner-msg')
const errorDetail      = document.getElementById('error-detail')
const sessionProgress  = document.getElementById('session-progress')
const progressAgent    = document.getElementById('progress-agent')
const progressElapsed  = document.getElementById('progress-elapsed')
const progressOutput   = document.getElementById('progress-output')
const changesSection   = document.getElementById('changes-section')
const changesCount     = document.getElementById('changes-count')
const changesList      = document.getElementById('changes-list')
const resumeModalOv    = document.getElementById('resume-modal-overlay')
const wsStatusEl       = document.getElementById('ws-status')
const scrollToBottomBtn = document.getElementById('scroll-to-bottom')
const settingsToggle   = document.getElementById('settings-toggle')
const settingsPanel    = document.getElementById('settings-panel')
const settingsClose    = document.getElementById('settings-close')
const agentsConfigList = document.getElementById('agents-config-list')
const agentFormSlot    = document.getElementById('agent-config-form-slot')
const addAgentBtn      = document.getElementById('add-agent-btn')
const saveGlobalBtn    = document.getElementById('save-global-settings-btn')
const sidebarUserEmail = document.getElementById('sidebar-user-email')
const logoutBtn        = document.getElementById('logout-btn')
const apiKeysList      = document.getElementById('api-keys-list')
const apiKeyForm       = document.getElementById('api-key-form')

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  if (!requireAuth()) return
  renderAuthenticatedUser()
  setupLogout()
  await loadAppConfig()
  await loadAgents()
  await loadTemplates()
  await loadStats()
  await loadPipelines()
  await loadSessions()
  connectWs()
  setInterval(() => {
    loadAgents()
    loadStats()
    loadPipelines()
  }, 30_000)
  setupFilterBtns()
  setupMobileMenu()
  setupMarked()
  setupMessageActions()
  setupScrollToBottom()
  setupSettingsPanel()
  setupPipelineUi()
  setupStatsToggle()
  setupPipelineToggle()
  setInterval(tickProgressIndicators, 1000)
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
  const token = getAuthToken()
  if (token) opts.headers.Authorization = `Bearer ${token}`
  if (body !== undefined) opts.body = JSON.stringify(body)
  let r
  try {
    r = await fetch(API + path, opts)
  } catch {
    throw new Error('Cannot reach Turing server')
  }

  const text = await r.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!r.ok) {
    if (r.status === 401) {
      clearAuthAndRedirect()
      throw new Error('Session expired')
    }
    const errorMsg = data?.error || text || `HTTP ${r.status}`
    throw new Error(errorMsg)
  }
  return data
}

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1]
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - base64.length % 4) % 4), '=')
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

function isJwtExpired(token) {
  const payload = decodeJwtPayload(token)
  return !payload?.exp || payload.exp * 1000 <= Date.now()
}

function requireAuth() {
  const token = getAuthToken()
  if (!token || isJwtExpired(token)) {
    clearAuthAndRedirect()
    return false
  }
  return true
}

function clearAuthAndRedirect() {
  localStorage.removeItem(AUTH_TOKEN_KEY)
  window.location.href = 'login.html'
}

function renderAuthenticatedUser() {
  const payload = decodeJwtPayload(getAuthToken() || '')
  if (sidebarUserEmail) sidebarUserEmail.textContent = payload?.email || payload?.sub || 'unknown'
}

function setupLogout() {
  if (!logoutBtn) return
  logoutBtn.addEventListener('click', clearAuthAndRedirect)
}

async function loadAppConfig() {
  try {
    appConfig = await api('/api/config')
    applyConfigDefaultsToNewSession()
  } catch {
    appConfig = null
  }
}

async function loadStats() {
  try {
    stats = await api('/api/stats')
    renderStats()
  } catch { /* server might be down */ }
}

async function loadPipelines() {
  try {
    pipelines = await api('/api/pipelines')
    renderPipelineList()
    if (activePipelineId) {
      const pipeline = pipelines.find((item) => item.id === activePipelineId)
      if (pipeline) {
        await selectPipeline(activePipelineId, false)
      }
    }
  } catch { /* server might be down */ }
}

// ── Toast notifications ───────────────────────────────────────────────────────
function showToast(message, type = 'error') {
  const container = document.getElementById('toast-container')
  if (!container) return

  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.textContent = message
  container.appendChild(toast)

  setTimeout(() => toast.classList.add('show'), 10)

  setTimeout(() => {
    toast.classList.remove('show')
    setTimeout(() => toast.remove(), 300)
  }, 3000)
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

function renderStats() {
  if (!statsGrid || !stats) return
  const cards = [
    {
      label: 'Sessions',
      value: stats.sessions.total,
      sub: `${stats.sessions.active} active · ${stats.sessions.error} error`,
    },
    {
      label: 'Success',
      value: `${Math.round((stats.sessions.successRate || 0) * 100)}%`,
      sub: `${stats.sessions.done} done`,
    },
    {
      label: 'Avg rounds',
      value: stats.sessions.avgRounds.toFixed(1),
      sub: formatDuration(stats.sessions.avgDurationMs || 0),
    },
    {
      label: 'Pipelines',
      value: stats.pipelines.total,
      sub: `${stats.pipelines.active} active · ${stats.pipelines.done} done`,
    },
  ]
  statsGrid.innerHTML = cards.map(card => `
    <div class="stats-card">
      <span class="stats-label">${escHtml(card.label)}</span>
      <div class="stats-value">${escHtml(card.value)}</div>
      <div class="stats-subvalue">${escHtml(card.sub)}</div>
    </div>
  `).join('')
}

function setupStatsToggle() {
  if (!statsToggle || !statsPanel) return
  const prefs = loadUiPrefs()
  if (prefs.statsCollapsed !== false) {
    statsPanel.classList.add('collapsed')
    statsToggle.setAttribute('aria-expanded', 'false')
    if (statsToggleIcon) statsToggleIcon.textContent = '▸'
  }
  statsToggle.addEventListener('click', () => {
    const collapsed = statsPanel.classList.toggle('collapsed')
    statsToggle.setAttribute('aria-expanded', String(!collapsed))
    if (statsToggleIcon) statsToggleIcon.textContent = collapsed ? '▸' : '▾'
    saveUiPrefs({ statsCollapsed: collapsed })
  })
}

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
      <div class="template-name">Custom</div>
      <div class="template-desc">Configure session parameters from scratch</div>
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
    modeSelect.value = appConfig?.defaults?.mode || 'collaborate'
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
function renderPipelineList() {
  if (!pipelineList) return
  if (!pipelines.length) {
    pipelineList.innerHTML = '<div class="session-empty">No pipelines</div>'
    return
  }

  pipelineList.innerHTML = pipelines.map((pipeline) => {
    const doneCount = pipeline.sessions.filter((step) => step.status === 'done').length
    return `
      <div class="pipeline-item ${pipeline.id === activePipelineId ? 'active' : ''}" data-id="${pipeline.id}">
        <div class="pipeline-item-header">
          <span class="pipeline-item-name">${escHtml(pipeline.name)}</span>
          <span class="badge ${pipeline.status}">${escHtml(pipeline.status)}</span>
        </div>
        <div class="pipeline-item-sub">${doneCount}/${pipeline.sessions.length} steps · ${timeAgo(pipeline.updatedAt)}</div>
      </div>
    `
  }).join('')

  pipelineList.querySelectorAll('.pipeline-item').forEach((el) => {
    el.addEventListener('click', () => {
      selectPipeline(el.dataset.id)
      closeMobileMenu()
    })
  })
}

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
    const hb = heartbeats.get(s.id)
    const running = s.status === 'active'
    const progress = running && hb
      ? `<div class="session-progress-line">${escHtml(hb.agent)} · ${formatDuration(currentHeartbeatElapsed(hb))}${hb.lastOutput ? ` · ${escHtml(hb.lastOutput)}` : ''}</div>`
      : ''
    return `
    <div class="session-item ${s.id === activeSessionId ? 'active' : ''} ${running ? 'running' : ''}" data-id="${s.id}">
      <div class="session-agents">${agentLabel(s.from)} → ${agentLabel(s.to)}</div>
      ${preview ? `<div class="session-preview">${escHtml(preview)}</div>` : ''}
      ${progress}
      <div class="session-meta">
        <span class="badge ${s.status}">${s.status}</span>
        ${s.mode && s.mode !== 'freeform' ? `<span class="mode-chip">${s.mode}</span>` : ''}
        <span class="rounds-chip">R${s.currentRound}/${s.maxRounds}</span>
        <span class="time-chip">${timeAgo(s.updatedAt)}</span>
      </div>
      <button class="session-delete-btn" data-id="${s.id}" title="Delete session">🗑</button>
    </div>
  `}).join('')

  sessionList.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', (e) => {
      // Don't select if clicking delete button
      if (e.target.classList.contains('session-delete-btn')) return
      selectSession(el.dataset.id)
      closeMobileMenu()
    })
  })

  sessionList.querySelectorAll('.session-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = btn.dataset.id
      if (!confirm('Delete this session?')) return
      try {
        await api(`/api/sessions/${id}`, 'DELETE')
        sessions = sessions.filter(s => s.id !== id)
        if (activeSessionId === id) {
          activeSessionId = null
          if (emptyState) emptyState.classList.remove('hidden')
          if (sessionView) sessionView.classList.add('hidden')
        }
        renderSessionList()
      } catch (err) {
        showToast(err.message, 'error')
      }
    })
  })

  if (!activeSessionId && !activePipelineId) {
    renderSessionView(null)
  }
}

function agentLabel(ref) {
  return ref?.label || ref?.adapter || '?'
}

async function selectSession(id) {
  activeSessionId = id
  activePipelineId = null
  activePipeline = null
  renderSessionList()
  renderPipelineList()
  try {
    const [data, logs, snapshots] = await Promise.all([
      api(`/api/sessions/${id}`),
      api(`/api/sessions/${id}/logs`),
      api(`/api/sessions/${id}/snapshots`),
    ])
    if (activeSessionId !== id) return
    activeSession = data
    currentMessages = data.messages || []
    currentSnapshots = snapshots || []
    replaceLogEntries(logs || [])
    renderSessionView(data)
  } catch (e) {
    console.error('Failed to load session', e)
  }
}

async function selectPipeline(id, renderList = true) {
  activePipelineId = id
  activeSessionId = null
  activeSession = null
  currentMessages = []
  currentSnapshots = []
  replaceLogEntries([])
  if (renderList) {
    renderPipelineList()
    renderSessionList()
  }
  try {
    const pipeline = await api(`/api/pipelines/${id}`)
    if (activePipelineId !== id) return
    activePipeline = pipeline
    renderPipelineView(pipeline)
  } catch (e) {
    console.error('Failed to load pipeline', e)
  }
}

function renderSessionView(session) {
  if (!session) {
    if (pipelineView) pipelineView.classList.add('hidden')
    if (emptyState) emptyState.classList.remove('hidden')
    if (sessionView) sessionView.classList.add('hidden')
    if (sessionProgress) sessionProgress.classList.add('hidden')
    if (errorBanner) errorBanner.classList.add('hidden')
    if (errorDetail) errorDetail.classList.add('hidden')
    if (changesSection) changesSection.classList.add('hidden')
    replaceLogEntries([])
    return
  }

  if (emptyState) {
    emptyState.classList.add('hidden')
  }
  if (pipelineView) {
    pipelineView.classList.add('hidden')
  }
  if (sessionView) {
    sessionView.classList.remove('hidden')
  }

  sessionTitle.textContent = `${agentLabel(session.from)} → ${agentLabel(session.to)}`
  sessionBadge.className   = `badge ${session.status}`
  sessionBadge.textContent = session.status
  sessionRounds.textContent = `R${session.currentRound}/${session.maxRounds}`

  updateToolbar(session)
  updateProgressIndicator()
  renderMessages(currentMessages, session)
  renderChanges(currentSnapshots)
}

function renderPipelineView(pipeline) {
  if (!pipeline) {
    if (pipelineView) pipelineView.classList.add('hidden')
    if (emptyState) emptyState.classList.remove('hidden')
    return
  }

  if (emptyState) emptyState.classList.add('hidden')
  if (sessionView) sessionView.classList.add('hidden')
  if (pipelineView) pipelineView.classList.remove('hidden')

  const doneCount = pipeline.sessions.filter((step) => step.status === 'done').length
  pipelineTitle.textContent = pipeline.name
  pipelineBadge.className = `badge ${pipeline.status}`
  pipelineBadge.textContent = pipeline.status
  pipelineProgress.textContent = `${doneCount}/${pipeline.sessions.length} steps`

  document.getElementById('btn-pipeline-pause').classList.toggle('hidden', pipeline.status !== 'active')
  document.getElementById('btn-pipeline-resume').classList.toggle('hidden', pipeline.status !== 'paused' && pipeline.status !== 'error')

  const sessionMap = new Map((pipeline.sessionDetails || []).map((session) => [session.id, session]))
  pipelineDetail.innerHTML = `
    <div class="pipeline-detail-header">
      <div class="pipeline-detail-grid">
        <div class="pipeline-detail-card">
          <span>Status</span>
          <strong>${escHtml(pipeline.status)}</strong>
        </div>
        <div class="pipeline-detail-card">
          <span>Steps</span>
          <strong>${escHtml(String(pipeline.sessions.length))}</strong>
        </div>
        <div class="pipeline-detail-card">
          <span>Finished</span>
          <strong>${escHtml(String(doneCount))}</strong>
        </div>
        <div class="pipeline-detail-card">
          <span>Updated</span>
          <strong>${escHtml(timeAgo(pipeline.updatedAt))}</strong>
        </div>
      </div>
    </div>
    <div class="pipeline-steps">
      ${pipeline.sessions.map((step, index) => {
        const session = sessionMap.get(step.sessionId)
        const prompt = session?.messages?.[0]?.content || ''
        const dependsOn = (step.dependsOn || [])
          .map((id) => pipeline.sessions.findIndex((item) => item.sessionId === id) + 1)
          .filter((n) => n > 0)
        return `
          <div class="pipeline-step-card">
            <div class="pipeline-step-head">
              <div>
                <div class="pipeline-step-index">Step ${index + 1}</div>
                <div class="pipeline-step-title">${escHtml(agentLabel(session?.from))} → ${escHtml(agentLabel(session?.to))}</div>
              </div>
              <span class="badge ${step.status === 'pending' ? 'paused' : step.status === 'active' ? 'active' : step.status === 'done' ? 'done' : 'error'}">${escHtml(step.status)}</span>
            </div>
            <div class="pipeline-step-body">
              <div class="pipeline-step-meta">
                <span>${escHtml(session?.mode || 'freeform')}</span>
                <span>R${escHtml(String(session?.currentRound || 0))}/${escHtml(String(session?.maxRounds || 0))}</span>
              </div>
              ${dependsOn.length ? `<div class="pipeline-step-meta"><span>Depends on</span><span>Step ${dependsOn.join(', Step ')}</span></div>` : ''}
              ${prompt ? `<div style="margin-top:8px;">${escHtml(prompt.slice(0, 220))}${prompt.length > 220 ? '…' : ''}</div>` : ''}
            </div>
            <div class="pipeline-step-actions">
              <button type="button" class="pipeline-open-btn" data-session-id="${step.sessionId}">Open session</button>
            </div>
          </div>
        `
      }).join('')}
    </div>
  `

  pipelineDetail.querySelectorAll('[data-session-id]').forEach((btn) => {
    btn.addEventListener('click', () => selectSession(btn.dataset.sessionId))
  })
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

  if (isError) {
    const round = session.errorRound ? `Round ${session.errorRound}: ` : ''
    errorBannerMsg.textContent = `${round}${session.errorMessage || 'Session failed'}`
    errorBanner.classList.remove('hidden')
    renderErrorDetail(session)
  } else {
    errorBanner.classList.add('hidden')
    errorDetail.classList.add('hidden')
  }

  // Allow inject for done sessions (triggers reopen), disable only for error
  injectInput.disabled = isError
  document.getElementById('inject-btn').disabled = isError

  // Update placeholder to hint reopen behavior
  if (isDone) {
    injectInput.placeholder = 'Send a message to reopen...'
  } else {
    injectInput.placeholder = 'Inject a message… (⌘+Enter to send)'
  }
}

function renderErrorDetail(session) {
  if (!errorDetail) return
  const fields = [
    ['Type', session.errorType || 'unknown'],
    ['Round', session.errorRound ?? 'unknown'],
    ['Message', session.errorMessage || 'Session failed'],
  ]
  const lastOutput = session.lastAgentOutput
    ? `<pre>${escHtml(session.lastAgentOutput)}</pre>`
    : '<div class="error-empty">No partial output captured</div>'
  errorDetail.innerHTML = `
    <div class="error-detail-grid">
      ${fields.map(([label, value]) => `
        <div class="error-detail-field">
          <span>${escHtml(label)}</span>
          <strong>${escHtml(value)}</strong>
        </div>
      `).join('')}
    </div>
    <div class="error-last-output">
      <span>Last output</span>
      ${lastOutput}
    </div>
  `
  errorDetail.classList.remove('hidden')
}

function updateProgressIndicator() {
  if (!activeSession || activeSession.status !== 'active') {
    sessionProgress.classList.add('hidden')
    return
  }
  const hb = heartbeats.get(activeSession.id)
  if (!hb) {
    sessionProgress.classList.add('hidden')
    return
  }

  progressAgent.textContent = hb.agent
  progressElapsed.textContent = formatDuration(currentHeartbeatElapsed(hb))
  progressOutput.textContent = hb.lastOutput || 'Running...'
  sessionProgress.classList.remove('hidden')
}

function tickProgressIndicators() {
  updateProgressIndicator()
  if (sessions.some(s => s.status === 'active')) {
    renderSessionList()
  }
}

function currentHeartbeatElapsed(hb) {
  return hb.elapsed + Math.max(0, Date.now() - hb.receivedAt)
}

function renderMessages(msgs, session) {
  let lastRound = -1
  messagesEl.innerHTML = msgs.map(m => {
    const divider = m.round !== lastRound && m.round > 0
      ? `<div class="round-divider"><span>Round ${m.round}</span></div>`
      : ''
    lastRound = m.round
    return divider + buildMessageMarkup(m, session, { noAnimate: true })
  }).join('')
  scrollToBottom()
  updateScrollToBottomButton()
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight
}

function isScrolledToBottom() {
  const threshold = 100
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < threshold
}

function setupScrollToBottom() {
  messagesEl.addEventListener('scroll', updateScrollToBottomButton)

  scrollToBottomBtn.addEventListener('click', () => {
    scrollToBottom()
    updateScrollToBottomButton()
  })
}

function updateScrollToBottomButton() {
  scrollToBottomBtn.classList.toggle('hidden', isScrolledToBottom())
}

// ── Session controls ──────────────────────────────────────────────────────────
document.getElementById('btn-pause').addEventListener('click', async () => {
  if (!activeSessionId) return
  const btn = document.getElementById('btn-pause')
  const originalText = btn.textContent
  btn.disabled = true
  btn.textContent = '⏸ Pausing...'
  try {
    await api(`/api/sessions/${activeSessionId}/pause`, 'POST')
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = originalText
  }
})

document.getElementById('btn-resume').addEventListener('click', async () => {
  if (!activeSessionId) return
  const btn = document.getElementById('btn-resume')
  const originalText = btn.textContent
  btn.disabled = true
  btn.textContent = '▶ Resuming...'
  try {
    await api(`/api/sessions/${activeSessionId}/resume`, 'POST')
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = originalText
  }
})

document.getElementById('btn-error-resume').addEventListener('click', async () => {
  if (!activeSessionId) return
  const btn = document.getElementById('btn-error-resume')
  const originalText = btn.textContent
  btn.disabled = true
  btn.textContent = 'Resuming...'
  try {
    const session = await api(`/api/sessions/${activeSessionId}/resume`, 'POST')
    activeSession = { ...activeSession, ...session }
    upsertSession(session)
    updateToolbar(activeSession)
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = originalText
  }
})

document.getElementById('btn-stop').addEventListener('click', async () => {
  if (!activeSessionId) return
  if (!confirm('Stop this session permanently?')) return
  const btn = document.getElementById('btn-stop')
  const originalText = btn.textContent
  btn.disabled = true
  btn.textContent = '⏹ Stopping...'
  try {
    await api(`/api/sessions/${activeSessionId}/stop`, 'POST')
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = originalText
  }
})

document.getElementById('btn-export').addEventListener('click', () => {
  exportSession()
})

// Rounds banner buttons
document.getElementById('btn-continue-10').addEventListener('click', async () => {
  if (!activeSessionId) return
  try {
    await api(`/api/sessions/${activeSessionId}/resume`, 'POST', { extraRounds: 10 })
    roundsBanner.classList.add('hidden')
  } catch (err) {
    showToast(err.message, 'error')
  }
})

document.getElementById('btn-continue-custom').addEventListener('click', () => {
  resumeModalOv.classList.remove('hidden')
})

document.getElementById('btn-end-session').addEventListener('click', async () => {
  if (!activeSessionId) return
  try {
    await api(`/api/sessions/${activeSessionId}/stop`, 'POST')
    roundsBanner.classList.add('hidden')
  } catch (err) {
    showToast(err.message, 'error')
  }
})

// Resume +N modal
document.getElementById('resume-modal-cancel').addEventListener('click', () => {
  closeResumeModal()
})

function closeResumeModal() {
  resumeModalOv.classList.add('hidden')
}

document.getElementById('resume-modal-ok').addEventListener('click', async () => {
  const n = parseInt(document.getElementById('resume-rounds-input').value)
  if (!n || n < 1) return
  const btn = document.getElementById('resume-modal-ok')
  const originalText = btn.textContent
  btn.disabled = true
  btn.textContent = 'Continuing...'
  try {
    if (!activeSessionId) return
    await api(`/api/sessions/${activeSessionId}/resume`, 'POST', { extraRounds: n })
    roundsBanner.classList.add('hidden')
    closeResumeModal()
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = originalText
  }
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
  const btn = document.getElementById('inject-btn')
  const originalText = btn.textContent
  injectInput.value = ''
  injectInput.disabled = true
  btn.disabled = true
  btn.textContent = 'Sending...'
  try {
    await api(`/api/sessions/${activeSessionId}/message`, 'POST', { content })
    // If session was done, refresh to pick up reopened state
    if (wasDone) {
      await selectSession(activeSessionId)
    }
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    injectInput.disabled = false
    btn.disabled = false
    btn.textContent = originalText
  }
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
  applyConfigDefaultsToNewSession()
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

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return
  if (!modalOverlay.classList.contains('hidden')) closeModal()
  if (!resumeModalOv.classList.contains('hidden')) closeResumeModal()
  if (!settingsPanel.classList.contains('hidden')) closeSettingsPanel()
})

function closeModal() {
  modalOverlay.classList.add('hidden')
}

document.getElementById('modal-form').addEventListener('submit', async e => {
  e.preventDefault()
  const fd = new FormData(e.target)

  // Build context object if any fields are filled
  const contextRules = fd.get('contextRules')?.trim()
  const contextText = fd.get('contextText')?.trim()
  const contextFilesRaw = fd.get('contextFiles')?.trim()
  const contextFiles = contextFilesRaw
    ? contextFilesRaw.split(/[\n,]/).map(f => f.trim()).filter(Boolean)
    : []

  let context = undefined
  if (contextRules || contextText || contextFiles.length > 0) {
    context = {}
    if (contextRules) context.rules = contextRules
    if (contextText) context.text = contextText
    if (contextFiles.length > 0) context.files = contextFiles
  }

  const body = {
    from: { adapter: fd.get('from') },
    to:   { adapter: fd.get('to') },
    initialPrompt: fd.get('prompt'),
    mode: fd.get('mode') || appConfig?.defaults?.mode || 'freeform',
    context,
    maxRounds: parseInt(fd.get('maxRounds')) || appConfig?.defaults?.maxRounds || 20,
    approveMode: fd.get('approveMode') === 'on',
    cwd: fd.get('cwd') || undefined,
  }

  const submitBtn = e.target.querySelector('.modal-submit')
  const originalText = submitBtn.textContent
  submitBtn.disabled = true
  submitBtn.textContent = 'Creating...'

  try {
    const session = await api('/api/sessions', 'POST', body)
    sessions.unshift(session)
    renderSessionList()
    await selectSession(session.id)
    closeModal()
    e.target.reset()
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    submitBtn.disabled = false
    submitBtn.textContent = originalText
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

function applyConfigDefaultsToNewSession() {
  if (!appConfig?.defaults) return
  const modeSelect = document.getElementById('mode-select')
  const maxRoundsInput = document.querySelector('input[name="maxRounds"]')
  if (modeSelect) modeSelect.value = appConfig.defaults.mode
  if (maxRoundsInput) maxRoundsInput.value = appConfig.defaults.maxRounds
}

function setupPipelineUi() {
  document.getElementById('new-pipeline-btn').addEventListener('click', openPipelineModal)
  document.getElementById('pipeline-modal-cancel').addEventListener('click', closePipelineModal)
  document.getElementById('pipeline-modal-close').addEventListener('click', closePipelineModal)
  document.getElementById('pipeline-add-step').addEventListener('click', () => addPipelineStepEditor())
  pipelineModalOverlay.addEventListener('click', (event) => {
    if (event.target === pipelineModalOverlay) closePipelineModal()
  })
  document.getElementById('pipeline-form').addEventListener('submit', submitPipelineForm)

  document.getElementById('btn-pipeline-pause').addEventListener('click', async () => {
    if (!activePipelineId) return
    try {
      await api(`/api/pipelines/${activePipelineId}/pause`, 'POST')
    } catch (err) {
      showToast(err.message, 'error')
    }
  })
  document.getElementById('btn-pipeline-resume').addEventListener('click', async () => {
    if (!activePipelineId) return
    try {
      await api(`/api/pipelines/${activePipelineId}/resume`, 'POST')
    } catch (err) {
      showToast(err.message, 'error')
    }
  })
  document.getElementById('btn-pipeline-delete').addEventListener('click', async () => {
    if (!activePipelineId || !confirm('Delete this pipeline?')) return
    try {
      await api(`/api/pipelines/${activePipelineId}`, 'DELETE')
      pipelines = pipelines.filter((item) => item.id !== activePipelineId)
      activePipelineId = null
      activePipeline = null
      renderPipelineList()
      renderSessionView(null)
    } catch (err) {
      showToast(err.message, 'error')
    }
  })
}

function openPipelineModal() {
  document.getElementById('pipeline-form').reset()
  pipelineStepList.innerHTML = ''
  addPipelineStepEditor()
  addPipelineStepEditor()
  pipelineModalOverlay.classList.remove('hidden')
}

function closePipelineModal() {
  pipelineModalOverlay.classList.add('hidden')
}

function addPipelineStepEditor() {
  const stepIndex = pipelineStepList.children.length
  const names = agents.filter(a => a.availableForSessions).map(a => a.name)
  const defaultFrom = names[0] || ''
  const defaultTo = names[1] || names[0] || ''
  const defaultMode = appConfig?.defaults?.mode || 'collaborate'
  const wrap = document.createElement('div')
  wrap.className = 'pipeline-step-editor'
  wrap.innerHTML = `
    <div class="pipeline-step-head">
      <div>
        <div class="pipeline-step-index">Step ${stepIndex + 1}</div>
      </div>
      <button type="button" class="pipeline-open-btn" data-step-remove>Remove</button>
    </div>
    <div class="form-row-inline">
      <div class="form-row half">
        <label>From</label>
        <select name="from">${names.map(name => `<option value="${name}" ${name === defaultFrom ? 'selected' : ''}>${name}</option>`).join('')}</select>
      </div>
      <div class="form-row half">
        <label>To</label>
        <select name="to">${names.map(name => `<option value="${name}" ${name === defaultTo ? 'selected' : ''}>${name}</option>`).join('')}</select>
      </div>
    </div>
    <div class="form-row-inline">
      <div class="form-row half">
        <label>Mode</label>
        <select name="mode">
          <option value="collaborate" ${defaultMode === 'collaborate' ? 'selected' : ''}>collaborate</option>
          <option value="discuss" ${defaultMode === 'discuss' ? 'selected' : ''}>discuss</option>
          <option value="review" ${defaultMode === 'review' ? 'selected' : ''}>review</option>
          <option value="freeform" ${defaultMode === 'freeform' ? 'selected' : ''}>freeform</option>
        </select>
      </div>
      <div class="form-row half">
        <label>Depends on</label>
        <input name="dependsOn" type="text" placeholder="e.g. 1,2" />
      </div>
    </div>
    <div class="form-row">
      <label>Initial prompt</label>
      <textarea name="initialPrompt" required placeholder="Describe this step..."></textarea>
    </div>
    <div class="form-row">
      <label>Working directory</label>
      <input name="cwd" type="text" placeholder="/abs/path or leave blank" />
    </div>
  `
  wrap.querySelector('[data-step-remove]').addEventListener('click', () => {
    wrap.remove()
    refreshPipelineStepLabels()
  })
  pipelineStepList.appendChild(wrap)
  refreshPipelineStepLabels()
}

function refreshPipelineStepLabels() {
  Array.from(pipelineStepList.children).forEach((child, index) => {
    const label = child.querySelector('.pipeline-step-index')
    if (label) label.textContent = `Step ${index + 1}`
  })
}

async function submitPipelineForm(event) {
  event.preventDefault()
  const rows = Array.from(pipelineStepList.querySelectorAll('.pipeline-step-editor'))
  if (!rows.length) return

  const steps = rows.map((row, index) => {
    const dependsRaw = row.querySelector('[name="dependsOn"]').value.trim()
    const dependsOn = dependsRaw
      ? dependsRaw.split(',').map(item => Number(item.trim()) - 1).filter(Number.isInteger).filter(n => n >= 0 && n < rows.length && n !== index)
      : undefined
    return {
      from: { adapter: row.querySelector('[name="from"]').value },
      to: { adapter: row.querySelector('[name="to"]').value },
      mode: row.querySelector('[name="mode"]').value,
      initialPrompt: row.querySelector('[name="initialPrompt"]').value.trim(),
      cwd: row.querySelector('[name="cwd"]').value.trim() || undefined,
      ...(dependsOn && dependsOn.length ? { dependsOn } : {}),
    }
  })

  const body = {
    name: document.getElementById('pipeline-name-input').value.trim(),
    steps,
  }

  const submitBtn = event.target.querySelector('.modal-submit')
  const originalText = submitBtn.textContent
  submitBtn.disabled = true
  submitBtn.textContent = 'Creating...'
  try {
    const pipeline = await api('/api/pipelines', 'POST', body)
    pipelines.unshift(pipeline)
    renderPipelineList()
    closePipelineModal()
    await selectPipeline(pipeline.id)
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    submitBtn.disabled = false
    submitBtn.textContent = originalText
  }
}

function setupPipelineToggle() {
  if (!pipelineToggle || !pipelineSidebarSection) return
  const prefs = loadUiPrefs()
  if (prefs.pipelinesCollapsed !== false) {
    pipelineSidebarSection.classList.add('collapsed')
    pipelineToggle.setAttribute('aria-expanded', 'false')
    if (pipelineToggleIcon) pipelineToggleIcon.textContent = '▸'
  }
  pipelineToggle.addEventListener('click', () => {
    const collapsed = pipelineSidebarSection.classList.toggle('collapsed')
    pipelineToggle.setAttribute('aria-expanded', String(!collapsed))
    if (pipelineToggleIcon) pipelineToggleIcon.textContent = collapsed ? '▸' : '▾'
    saveUiPrefs({ pipelinesCollapsed: collapsed })
  })
}

function loadUiPrefs() {
  try {
    return JSON.parse(localStorage.getItem(UI_PREFS_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveUiPrefs(partial) {
  try {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify({
      ...loadUiPrefs(),
      ...partial,
    }))
  } catch {
    // Ignore storage failures.
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
let wsRetryTimer = null
let wsRetryDelay = 1000
let wsRetryCount = 0
const WS_BASE_DELAY = 1000
const WS_MAX_DELAY = 15000

function connectWs() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return
  if (wsRetryTimer) {
    clearTimeout(wsRetryTimer)
    wsRetryTimer = null
  }

  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const token = getAuthToken()
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : ''
  const socket = new WebSocket(`${proto}://${location.host}/ws${tokenQuery}`)
  ws = socket

  socket.addEventListener('open', () => {
    if (socket !== ws) return
    wsStatusEl.textContent = 'live'
    wsStatusEl.className = 'ws-badge connected'
    document.getElementById('server-dot').className = 'dot green'
    wsRetryDelay = WS_BASE_DELAY
    wsRetryCount = 0
  })

  socket.addEventListener('message', ({ data }) => {
    if (socket !== ws) return
    try {
      handleWsEvent(JSON.parse(data))
    } catch {
      showToast('Received invalid WebSocket message', 'error')
    }
  })

  socket.addEventListener('close', () => {
    if (socket !== ws) return
    wsRetryCount++
    const delay = wsRetryDelay
    wsStatusEl.textContent = `reconnecting #${wsRetryCount} (${Math.ceil(delay / 1000)}s)`
    wsStatusEl.className = 'ws-badge disconnected'
    document.getElementById('server-dot').className = 'dot red'

    wsRetryTimer = setTimeout(connectWs, delay)
    wsRetryDelay = Math.min(wsRetryDelay * 2, WS_MAX_DELAY)
  })

  socket.addEventListener('error', () => {
    if (socket !== ws) return
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
      loadStats()
      break
    }

    case 'session:updated':
    case 'session:done':
    case 'session:error':
    case 'session:paused': {
      const s = evt.payload?.session ?? evt.payload
      if (s.status !== 'active') heartbeats.delete(s.id)
      upsertSession(s)
      if (s.id === activeSessionId) {
        activeSession = { ...activeSession, ...s }
        // Re-render toolbar + banner without re-fetching messages
        sessionBadge.className   = `badge ${s.status}`
        sessionBadge.textContent = s.status
        sessionRounds.textContent = `R${s.currentRound}/${s.maxRounds}`
        updateToolbar(s)
        updateProgressIndicator()
      }
      loadStats()
      break
    }

    case 'heartbeat': {
      const hb = { ...evt, receivedAt: Date.now() }
      heartbeats.set(hb.sessionId, hb)
      upsertSessionField(hb.sessionId, 'updatedAt', Date.now())
      if (hb.sessionId === activeSessionId) {
        updateProgressIndicator()
      }
      renderSessionList()
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

    case 'snapshot:new': {
      const snapshot = evt.payload
      if (snapshot.sessionId === activeSessionId) {
        currentSnapshots.push(snapshot)
        renderChanges(currentSnapshots)
      }
      break
    }

    case 'session:deleted': {
      const id = evt.payload?.id
      sessions = sessions.filter(s => s.id !== id)
      heartbeats.delete(id)
      if (id === activeSessionId) {
        activeSessionId = null
        activeSession = null
        currentMessages = []
        replaceLogEntries([])
        if (sessionView) sessionView.classList.add('hidden')
        if (emptyState) emptyState.classList.remove('hidden')
      }
      renderSessionList()
      loadStats()
      break
    }

    case 'pipeline:created':
    case 'pipeline:updated':
    case 'pipeline:done':
    case 'pipeline:error': {
      const pipeline = evt.payload
      if (pipeline?.deleted) {
        pipelines = pipelines.filter((item) => item.id !== pipeline.id)
        if (activePipelineId === pipeline.id) {
          activePipelineId = null
          activePipeline = null
          renderSessionView(null)
        }
      } else {
        const index = pipelines.findIndex((item) => item.id === pipeline.id)
        if (index >= 0) pipelines[index] = { ...pipelines[index], ...pipeline }
        else pipelines.unshift(pipeline)
        if (activePipelineId === pipeline.id) {
          selectPipeline(pipeline.id, false)
        }
      }
      renderPipelineList()
      loadStats()
      break
    }

    case 'log': {
      if (evt.payload?.sessionId === activeSessionId) {
        handleLogEvent(evt.payload)
      }
      break
    }
  }
}

// Append a single new message without re-rendering all (performance)
function appendMessage(msg) {
  const wasAtBottom = isScrolledToBottom()

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

  // Auto-scroll only if already at bottom
  if (wasAtBottom) {
    scrollToBottom()
  }
  updateScrollToBottomButton()

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

function buildMessageMarkup(msg, session, opts = {}) {
  const { side, bubbleClass, senderLabel } = getMessagePresentation(msg, session)
  const animationClass = opts.noAnimate ? ' no-animate' : ''
  const avatarInitial = senderLabel.charAt(0).toUpperCase()
  const renderedContent = renderMarkdown(msg.content)
  return `<div class="msg-wrapper ${side}${animationClass}">
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

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function renderChanges(snapshots) {
  if (!changesSection || !changesList || !changesCount) return
  if (!snapshots.length) {
    changesSection.classList.add('hidden')
    changesList.innerHTML = ''
    changesCount.textContent = ''
    return
  }

  changesCount.textContent = `${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'}`
  changesList.innerHTML = snapshots.map(snapshot => {
    const stat = snapshot.diffStat || 'No changes'
    const full = snapshot.diffFull || 'No diff'
    return `<details class="change-snapshot">
      <summary>
        <span>Round ${escHtml(snapshot.round)}</span>
        <time>${formatMessageTime(snapshot.timestamp)}</time>
      </summary>
      <div class="change-block">
        <div class="change-label">Stat</div>
        <pre>${escHtml(stat)}</pre>
      </div>
      <div class="change-block">
        <div class="change-label">Diff</div>
        <pre>${escHtml(full)}</pre>
      </div>
    </details>`
  }).join('')
  changesSection.classList.remove('hidden')
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

// ── Settings ─────────────────────────────────────────────────────────────────
function setupSettingsPanel() {
  settingsToggle.addEventListener('click', openSettingsPanel)
  settingsClose.addEventListener('click', closeSettingsPanel)
  settingsPanel.querySelector('.settings-overlay').addEventListener('click', closeSettingsPanel)
  addAgentBtn.addEventListener('click', () => showAgentForm())
  saveGlobalBtn.addEventListener('click', saveGlobalSettings)
  apiKeyForm.addEventListener('submit', saveApiKey)

  agentsConfigList.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('[data-agent-edit]')
    const deleteBtn = event.target.closest('[data-agent-delete]')
    if (editBtn) {
      showAgentForm(editBtn.dataset.agentEdit)
      return
    }
    if (deleteBtn) {
      await deleteAgent(deleteBtn.dataset.agentDelete)
    }
  })

  apiKeysList.addEventListener('click', async (event) => {
    const deleteBtn = event.target.closest('[data-key-delete]')
    if (deleteBtn) await deleteApiKey(deleteBtn.dataset.keyDelete)
  })
}

async function openSettingsPanel() {
  await loadAppConfig()
  await loadApiKeys()
  renderSettingsPanel()
  settingsPanel.classList.remove('hidden')
  settingsToggle.classList.add('active')
}

function closeSettingsPanel() {
  settingsPanel.classList.add('hidden')
  settingsToggle.classList.remove('active')
  editingAgentName = null
  agentFormSlot.innerHTML = ''
  addAgentBtn.classList.remove('hidden')
}

function renderSettingsPanel() {
  if (!appConfig) return
  document.getElementById('global-max-rounds').value = appConfig.defaults?.maxRounds ?? 20
  document.getElementById('global-port').value = appConfig.server?.port ?? 4590
  document.getElementById('global-mode').value = appConfig.defaults?.mode ?? 'collaborate'
  renderAgentConfigList()
  renderApiKeys()
}

function renderAgentConfigList() {
  const entries = Object.entries(appConfig?.agents || {})
  if (!entries.length) {
    agentsConfigList.innerHTML = '<div class="settings-empty">No configured agents</div>'
    return
  }

  agentsConfigList.innerHTML = entries.map(([name, cfg]) => {
    const env = Object.entries(cfg.env || {})
    return `<div class="agent-config-item">
      <div class="agent-config-header">
        <div class="agent-config-name">${escHtml(name)}</div>
        <div class="agent-config-actions">
          <button class="agent-config-btn" data-agent-edit="${escHtml(name)}">Edit</button>
          <button class="agent-config-btn danger" data-agent-delete="${escHtml(name)}">Delete</button>
        </div>
      </div>
      <div class="agent-config-details">
        <div><span class="agent-config-label">Adapter</span><span class="agent-config-value">${escHtml(cfg.adapter)}</span></div>
        <div><span class="agent-config-label">Command</span><span class="agent-config-value">${escHtml(cfg.command)}</span></div>
        <div><span class="agent-config-label">Env</span><span class="agent-config-value">${env.length ? env.map(([k, v]) => `${escHtml(k)}=${escHtml(v)}`).join(', ') : 'none'}</span></div>
      </div>
    </div>`
  }).join('')
}

function showAgentForm(agentName) {
  editingAgentName = agentName || null
  const cfg = editingAgentName ? appConfig?.agents?.[editingAgentName] : null
  const selectedAdapter = cfg?.adapter || 'codex'
  const envEntries = Object.entries(cfg?.env || {})
  addAgentBtn.classList.add('hidden')
  agentFormSlot.innerHTML = `<form class="agent-config-form" id="agent-config-form">
    <div class="form-row">
      <label>Name</label>
      <input name="name" type="text" required value="${escHtml(editingAgentName || '')}" />
    </div>
    <div class="form-row">
      <label>Adapter</label>
      <select name="adapter">
        ${['claude-code', 'codex', 'opencode'].map(adapter => `
          <option value="${adapter}" ${selectedAdapter === adapter ? 'selected' : ''}>${adapter}</option>
        `).join('')}
      </select>
    </div>
    <div class="form-row">
      <label>Command Path</label>
      <input name="command" type="text" required value="${escHtml(cfg?.command || AGENT_COMMAND_DEFAULTS[selectedAdapter])}" placeholder="codex" />
    </div>
    <div class="form-row">
      <label>Environment Variables</label>
      <div class="env-vars-list">
        ${envEntries.map(([key, value]) => envRowMarkup(key, value)).join('')}
      </div>
      <button type="button" class="add-env-btn">+ Add env var</button>
    </div>
    <div class="agent-form-actions">
      <button type="button" class="settings-btn" id="agent-form-cancel">Cancel</button>
      <button type="submit" class="settings-btn primary">${editingAgentName ? 'Save Agent' : 'Create Agent'}</button>
    </div>
  </form>`

  const form = document.getElementById('agent-config-form')
  const adapterSelect = form.querySelector('select[name="adapter"]')
  const commandInput = form.querySelector('input[name="command"]')
  form.addEventListener('submit', saveAgent)
  adapterSelect.addEventListener('change', () => {
    const currentDefault = Object.values(AGENT_COMMAND_DEFAULTS).includes(commandInput.value)
    if (!editingAgentName || currentDefault) {
      commandInput.value = AGENT_COMMAND_DEFAULTS[adapterSelect.value] || ''
    }
  })
  form.querySelector('#agent-form-cancel').addEventListener('click', clearAgentForm)
  form.querySelector('.add-env-btn').addEventListener('click', () => {
    form.querySelector('.env-vars-list').insertAdjacentHTML('beforeend', envRowMarkup())
  })
  form.querySelector('.env-vars-list').addEventListener('click', (event) => {
    const btn = event.target.closest('.env-var-remove')
    if (btn) btn.closest('.env-var-row').remove()
  })
  form.querySelector('input[name="name"]').focus()
}

function envRowMarkup(key = '', value = '') {
  return `<div class="env-var-row">
    <input name="envKey" type="text" placeholder="KEY" value="${escHtml(key)}" />
    <input name="envValue" type="text" placeholder="value" value="${escHtml(value)}" />
    <button type="button" class="env-var-remove" title="Remove">✕</button>
  </div>`
}

function clearAgentForm() {
  editingAgentName = null
  agentFormSlot.innerHTML = ''
  addAgentBtn.classList.remove('hidden')
}

function collectEnv(form) {
  const env = {}
  form.querySelectorAll('.env-var-row').forEach(row => {
    const key = row.querySelector('input[name="envKey"]').value.trim()
    const value = row.querySelector('input[name="envValue"]').value
    if (key && value) env[key] = value
  })
  return env
}

async function saveAgent(event) {
  event.preventDefault()
  const form = event.target
  const fd = new FormData(form)
  const body = {
    name: String(fd.get('name') || '').trim(),
    adapter: fd.get('adapter'),
    command: String(fd.get('command') || '').trim(),
    env: collectEnv(form),
  }
  const path = editingAgentName
    ? `/api/config/agents/${encodeURIComponent(editingAgentName)}`
    : '/api/config/agents'
  const method = editingAgentName ? 'PUT' : 'POST'

  try {
    appConfig = await api(path, method, body)
    await loadAgents()
    clearAgentForm()
    renderSettingsPanel()
    showToast('Agent saved', 'success')
  } catch (err) {
    showToast(err.message, 'error')
  }
}

async function deleteAgent(name) {
  if (!name || !confirm(`Delete agent "${name}"?`)) return
  try {
    appConfig = await api(`/api/config/agents/${encodeURIComponent(name)}`, 'DELETE')
    await loadAgents()
    clearAgentForm()
    renderSettingsPanel()
    showToast('Agent deleted', 'success')
  } catch (err) {
    showToast(err.message, 'error')
  }
}

async function saveGlobalSettings() {
  const maxRounds = parseInt(document.getElementById('global-max-rounds').value)
  const port = parseInt(document.getElementById('global-port').value)
  const mode = document.getElementById('global-mode').value
  try {
    appConfig = await api('/api/config', 'PUT', {
      defaults: { maxRounds, mode },
      server: { port },
    })
    applyConfigDefaultsToNewSession()
    renderSettingsPanel()
    showToast('Settings saved. Restart required for port changes.', 'success')
  } catch (err) {
    showToast(err.message, 'error')
  }
}

async function loadApiKeys() {
  try {
    apiKeys = await api('/api/keys')
  } catch (err) {
    apiKeys = []
    showToast(err.message, 'error')
  }
}

function renderApiKeys() {
  if (!apiKeysList) return
  if (!apiKeys.length) {
    apiKeysList.innerHTML = '<div class="settings-empty">No API keys stored</div>'
    return
  }
  apiKeysList.innerHTML = apiKeys.map((key) => `
    <div class="api-key-item">
      <div class="api-key-provider">${providerIcon(key.provider)}</div>
      <div class="api-key-meta">
        <div class="api-key-name">${escHtml(key.name)}</div>
        <div class="api-key-detail">${escHtml(providerLabel(key.provider))} · ${escHtml(key.maskedKey)}</div>
      </div>
      <button type="button" class="agent-config-btn danger" data-key-delete="${escHtml(key.id)}">Delete</button>
    </div>
  `).join('')
}

function providerIcon(provider) {
  const icons = {
    anthropic: 'A',
    openai: 'O',
    zhipu: 'Z',
  }
  return icons[provider] || '?'
}

function providerLabel(provider) {
  const labels = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    zhipu: 'Zhipu',
  }
  return labels[provider] || provider
}

async function saveApiKey(event) {
  event.preventDefault()
  const fd = new FormData(event.target)
  const body = {
    provider: fd.get('provider'),
    name: String(fd.get('name') || '').trim(),
    key: String(fd.get('key') || '').trim(),
  }
  try {
    const saved = await api('/api/keys', 'POST', body)
    apiKeys.unshift(saved)
    event.target.reset()
    renderApiKeys()
    showToast('API key saved', 'success')
  } catch (err) {
    showToast(err.message, 'error')
  }
}

async function deleteApiKey(id) {
  if (!id || !confirm('Delete this API key?')) return
  try {
    await api(`/api/keys/${encodeURIComponent(id)}`, 'DELETE')
    apiKeys = apiKeys.filter((key) => key.id !== id)
    renderApiKeys()
    showToast('API key deleted', 'success')
  } catch (err) {
    showToast(err.message, 'error')
  }
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
    sessionId: payload.sessionId,
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

function replaceLogEntries(entries) {
  logEntries.length = 0
  for (const entry of entries.slice(-LOG_MAX)) {
    logEntries.push(entry)
  }
  logHasUnseenError = false
  logErrorDot.classList.add('hidden')
  if (logPanelOpen) {
    renderLogEntries()
  }
}

function renderLogEntries() {
  if (!activeSessionId) {
    logEntriesEl.innerHTML = '<div class="log-empty">Select a session to view logs</div>'
    return
  }
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
