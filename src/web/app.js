// Turing Cloud — SPA Application
// Complete rewrite based on new UI design

const API = ''  // same origin
const AUTH_TOKEN_KEY = 'turing-jwt'
const THEME_KEY = 'turing-theme'

const MODEL_OPTIONS_BY_ADAPTER = {
  'anthropic-api': [
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 snapshot' },
  ],
  'openai-api': [
    { value: 'gpt-5.5', label: 'GPT-5.5' },
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
    { value: 'gpt-5.4-nano', label: 'GPT-5.4 nano' },
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
  ],
  'zhipu-api': [
    { value: 'glm-5.1', label: 'GLM-5.1' },
    { value: 'glm-5', label: 'GLM-5' },
    { value: 'glm-5-turbo', label: 'GLM-5-Turbo' },
    { value: 'glm-4.7', label: 'GLM-4.7' },
    { value: 'glm-4.7-flashx', label: 'GLM-4.7-FlashX' },
    { value: 'glm-4.7-flash', label: 'GLM-4.7-Flash' },
    { value: 'glm-4.6', label: 'GLM-4.6' },
    { value: 'glm-4.5-air', label: 'GLM-4.5-Air' },
    { value: 'glm-4.5-airx', label: 'GLM-4.5-AirX' },
  ],
  'custom-api': [
    { value: '', label: 'Provider default' },
    { value: 'gpt-5.5', label: 'GPT-5.5 compatible' },
    { value: 'gpt-5.4', label: 'GPT-5.4 compatible' },
    { value: 'gpt-4.1', label: 'GPT-4.1 compatible' },
  ],
}

// ── Global State ──────────────────────────────────────────────────────────────
const state = {
  user: null,
  sessions: [],
  pipelines: [],
  agents: [],
  templates: [],
  apiKeys: [],
  stats: null,
  config: null,
  currentView: 'sessions',
  currentSessionId: null,
  currentSession: null,
  currentPipelineId: null,
  currentPipeline: null,
  expandedWorkflowStep: null,
  currentMessages: [],
  currentSnapshots: [],
  ws: null,
  heartbeats: new Map(),
  streamDeltas: new Map(),
  streamRaw: new Map(),
  streamSteps: new Map(),
  streamStatus: new Map(),
  expandedStepDetails: new Set(),
  expandedArtifactFiles: new Set(),
  autoFollowMessages: true,
  artifactFullDiffVisible: false,
  rawOutputVisible: false,
  streamFrame: null,
}

// ── Router ────────────────────────────────────────────────────────────────────
const routes = {
  '/': 'landing',
  '/sessions': 'sessions',
  '/session/:id': 'session',
  '/workflows': 'workflows',
  '/workflow/:id': 'workflow',
  '/settings': 'settings',
  '/login': 'login',
}

function navigate(path) {
  history.pushState(null, '', path)
  render()
}

function render() {
  const path = location.pathname

  // Auth check
  if (path !== '/' && path !== '/login' && !getValidAuthToken()) {
    return navigate('/login')
  }

  // Route matching
  if (path === '/' || path === '/landing') {
    renderLanding()
  } else if (path === '/login') {
    renderLogin()
  } else if (path === '/sessions') {
    renderSessions()
  } else if (path.startsWith('/session/')) {
    const id = path.split('/')[2]
    renderSession(id)
  } else if (path === '/workflows') {
    renderWorkflows()
  } else if (path.startsWith('/workflow/')) {
    const id = path.split('/')[2]
    renderWorkflow(id)
  } else if (path === '/settings') {
    renderSettings()
  } else {
    navigate('/sessions')
  }
}

window.addEventListener('popstate', render)

// ── API Helpers ───────────────────────────────────────────────────────────────
function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

function getValidAuthToken() {
  const token = getAuthToken()
  if (!token) return null
  if (isJwtExpired(token)) {
    clearAuthToken()
    return null
  }
  return token
}

function getCurrentUser() {
  const token = getValidAuthToken()
  if (!token) return null
  try {
    const [, payload] = token.split('.')
    const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return {
      id: data.sub || '',
      email: data.email || 'unknown',
      initials: initialsFromEmail(data.email || 'U'),
    }
  } catch {
    return null
  }
}

function isJwtExpired(token) {
  try {
    const [, payload] = token.split('.')
    if (!payload) return true
    const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof data.exp === 'number' && data.exp * 1000 <= Date.now()
  } catch {
    return true
  }
}

function setAuthToken(token) {
  localStorage.setItem(AUTH_TOKEN_KEY, token)
  connectWs()
}

function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY)
  if (state.ws) {
    state.ws.close()
    state.ws = null
  }
}

async function api(path, method = 'GET', body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  const token = getValidAuthToken()
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
      clearAuthToken()
      navigate('/login')
    }
    throw new Error(data?.error || `HTTP ${r.status}`)
  }

  return data
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || 'dark'
  document.documentElement.setAttribute('data-theme', saved)
}

function toggleTheme() {
  const html = document.documentElement
  const current = html.getAttribute('data-theme')
  const next = current === 'dark' ? 'light' : 'dark'
  html.setAttribute('data-theme', next)
  localStorage.setItem(THEME_KEY, next)
  updateThemeButton()
}

function updateThemeButton() {
  const btn = document.querySelector('.theme-toggle')
  if (!btn) return
  const theme = document.documentElement.getAttribute('data-theme')
  btn.textContent = theme === 'dark' ? '🌙' : '☀️'
}

function renderUserMenu() {
  const user = getCurrentUser()
  return `
    <div class="user-menu">
      <button class="avatar" onclick="window.toggleUserMenu()" title="${escapeAttr(user?.email || 'Account')}">${escapeHtml(user?.initials || 'U')}</button>
      <div class="user-menu-popover" id="user-menu-popover">
        <div class="user-menu-email">${escapeHtml(user?.email || 'unknown')}</div>
        <button onclick="window.logout()">Logout</button>
      </div>
    </div>
  `
}

function renderSidebar(active) {
  return `
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="logo-icon">T</div>
        <span>Turing Cloud</span>
      </div>
      <nav class="sidebar-nav">
        <a href="/sessions" class="${active === 'sessions' ? 'active' : ''}">
          <span class="nav-icon">◉</span> Sessions
        </a>
        <a href="/workflows" class="${active === 'workflows' ? 'active' : ''}">
          <span class="nav-icon">⛓</span> Workflows
        </a>
        <a href="/settings" class="${active === 'settings' ? 'active' : ''}">
          <span class="nav-icon">⚙</span> Settings
        </a>
      </nav>
      <div class="sidebar-footer">
        Turing Cloud v0.1.0
      </div>
    </aside>
  `
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWs() {
  if (state.ws) return
  const token = getValidAuthToken()
  if (!token || location.protocol === 'file:') return

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`

  state.ws = new WebSocket(wsUrl)

  state.ws.onopen = () => {
    console.log('[ws] connected')
  }

  state.ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      handleWsEvent(msg)
    } catch (err) {
      console.error('[ws] parse error:', err)
    }
  }

  state.ws.onclose = () => {
    console.log('[ws] disconnected')
    state.ws = null
    setTimeout(connectWs, 3000)
  }

  state.ws.onerror = (err) => {
    console.error('[ws] error:', err)
  }
}

function handleWsEvent(event) {
  console.log('[ws] event:', event.type)

  switch (event.type) {
    case 'init':
      state.sessions = event.payload || []
      renderSessionStats()
      renderSessionCards()
      break
    case 'session:created':
    case 'session:updated':
    case 'session:error':
    case 'session:done':
    case 'session:paused':
    case 'session:resumed':
      applySessionUpdate(event.payload)
      break
    case 'session:deleted':
      removeSessionFromList(event.payload.id)
      if (state.currentSessionId === event.payload.id) {
        navigate('/sessions')
      }
      break
    case 'pipeline:created':
    case 'pipeline:updated':
      applyPipelineUpdate(event.payload)
      break
    case 'message:delta':
      handleMessageDelta(event.payload)
      break
    case 'message:step':
      handleMessageStep(event.payload)
      break
    case 'message:new':
      if (state.currentSessionId === event.payload.sessionId) {
        clearStreamingDelta(event.payload.sessionId)
        setStreamStatus(event.payload.sessionId, '已完成本轮输出')
        upsertCurrentMessage(event.payload)
        renderSessionMessages()
        renderSessionPanel(state.currentSession)
      }
      break
    case 'heartbeat':
      state.heartbeats.set(event.sessionId, event)
      updateHeartbeat(event)
      break
  }
}

function applySessionUpdate(session) {
  if (!session?.id) return
  const index = state.sessions.findIndex(item => item.id === session.id)
  if (index >= 0) {
    state.sessions[index] = { ...state.sessions[index], ...session }
  } else {
    state.sessions.unshift(session)
  }

  if (state.currentSessionId === session.id) {
    state.currentSession = { ...(state.currentSession || {}), ...session }
    renderSessionHeader(state.currentSession)
    renderSessionPanel(state.currentSession)
  }

  renderSessionStats()
  renderSessionCards()
}

function applyPipelineUpdate(pipeline) {
  if (!pipeline?.id) return
  const index = state.pipelines.findIndex(item => item.id === pipeline.id)
  if (index >= 0) {
    state.pipelines[index] = { ...state.pipelines[index], ...pipeline }
  } else {
    state.pipelines.unshift(pipeline)
  }

  if (state.currentPipelineId === pipeline.id) {
    state.currentPipeline = { ...(state.currentPipeline || {}), ...pipeline }
    renderWorkflowHeader(state.currentPipeline)
    renderWorkflowSteps(state.currentPipeline)
    renderWorkflowTimeline(state.currentPipeline)
  }

  renderPipelineCards()
}

function removeSessionFromList(id) {
  if (!id) return
  state.sessions = state.sessions.filter(session => session.id !== id)
  renderSessionStats()
  renderSessionCards()
}

function handleMessageDelta(payload) {
  if (!payload?.sessionId || !payload.content) return
  if (state.currentSessionId !== payload.sessionId) return

  const existing = state.streamDeltas.get(payload.sessionId) || {
    sessionId: payload.sessionId,
    content: '',
    from: payload.from || 'assistant',
  }
  existing.content += payload.content
  existing.from = payload.from || existing.from
  state.streamDeltas.set(payload.sessionId, existing)
  state.streamRaw.set(payload.sessionId, (state.streamRaw.get(payload.sessionId) || '') + payload.content)
  setStreamStatus(payload.sessionId, summarizeRawStatus(payload.content))
  scheduleStreamingRender()
}

function handleMessageStep(payload) {
  if (!payload?.sessionId || !payload.step) return
  const steps = state.streamSteps.get(payload.sessionId) || []
  const last = steps[steps.length - 1]
  const step = {
    ...payload.step,
    id: `${Date.now()}-${steps.length}`,
    detail: payload.step.detail || '',
  }
  if (last && last.type === step.type && last.summary === step.summary) return
  steps.push(step)
  state.streamSteps.set(payload.sessionId, steps)
  setStreamStatus(payload.sessionId, step.summary)
  if (state.currentSessionId === payload.sessionId) renderSessionMessages()
}

function setStreamStatus(sessionId, status) {
  if (!sessionId || !status) return
  state.streamStatus.set(sessionId, status)
  if (state.currentSessionId === sessionId) updateSessionStatusLine()
}

function scheduleStreamingRender() {
  if (state.streamFrame) return
  state.streamFrame = requestAnimationFrame(() => {
    state.streamFrame = null
    renderStreamingDelta()
  })
}

function renderStreamingDelta() {
  updateSessionStatusLine()
  updateRawOutput()

  const messagesContainer = document.getElementById('messages-container')
  if (messagesContainer && state.autoFollowMessages) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }
}

function clearStreamingDelta(sessionId) {
  state.streamDeltas.delete(sessionId)
  const node = document.getElementById('streaming-message')
  if (node) node.remove()
}

function resetSessionStream(sessionId) {
  state.streamDeltas.delete(sessionId)
  state.streamRaw.delete(sessionId)
  state.streamSteps.delete(sessionId)
  state.streamStatus.delete(sessionId)
  state.expandedStepDetails = new Set([...state.expandedStepDetails].filter(key => !key.startsWith(`${sessionId}:`)))
  state.expandedArtifactFiles = new Set()
  state.artifactFullDiffVisible = false
}

function upsertCurrentMessage(message) {
  const index = state.currentMessages.findIndex(item => item.id === message.id)
  if (index >= 0) {
    state.currentMessages[index] = message
  } else {
    state.currentMessages.push(message)
  }
}

function updateHeartbeat(hb) {
  // Update progress indicators if on session page
  if (state.currentSessionId === hb.sessionId) {
    setStreamStatus(hb.sessionId, summarizeRawStatus(hb.lastOutput || 'Processing...'))
    const progressAgent = document.getElementById('progress-agent')
    const progressElapsed = document.getElementById('progress-elapsed')
    const progressOutput = document.getElementById('progress-output')

    if (progressAgent) progressAgent.textContent = hb.agent
    if (progressElapsed) progressElapsed.textContent = `${Math.floor(hb.elapsed / 1000)}s`
    if (progressOutput) progressOutput.textContent = hb.lastOutput || 'Processing...'
  }
}

// ── Data Loading ──────────────────────────────────────────────────────────────
async function loadSessions() {
  try {
    state.sessions = await api('/api/sessions')
  } catch (err) {
    console.error('Failed to load sessions:', err)
  }
}

async function loadPipelines() {
  try {
    state.pipelines = await api('/api/pipelines')
  } catch (err) {
    console.error('Failed to load pipelines:', err)
    state.pipelines = []
  }
}

async function loadAgents() {
  try {
    state.agents = await api('/api/agents')
  } catch (err) {
    console.error('Failed to load agents:', err)
  }
}

async function loadTemplates() {
  try {
    state.templates = await api('/api/templates')
  } catch (err) {
    console.error('Failed to load templates:', err)
    state.templates = []
  }
}

async function loadApiKeys() {
  try {
    state.apiKeys = await api('/api/keys')
  } catch (err) {
    console.error('Failed to load API keys:', err)
    state.apiKeys = []
  }
}

async function loadStats() {
  try {
    state.stats = await api('/api/stats')
  } catch (err) {
    console.error('Failed to load stats:', err)
  }
}

async function loadConfig() {
  try {
    state.config = await api('/api/config')
  } catch (err) {
    console.error('Failed to load config:', err)
  }
}

async function loadSessionDetail(id) {
  try {
    const session = await api(`/api/sessions/${id}`)
    state.currentSession = session
    state.currentMessages = session.messages || []
    resetSessionStream(id)
    renderSessionMessages()
    renderSessionPanel(session)
    renderSessionHeader(session)
  } catch (err) {
    console.error('Failed to load session detail:', err)
  }
}

// ── Render Functions ──────────────────────────────────────────────────────────
function renderLanding() {
  document.body.innerHTML = `
    <nav class="landing-nav">
      <div class="landing-brand">
        <div class="logo-icon">T</div>
        <span>Turing Cloud</span>
      </div>
      <div class="landing-nav-links">
        <a href="#features">Features</a>
        <a href="#architecture">Architecture</a>
        <a href="/sessions">Sessions</a>
        <a href="/sessions" class="btn btn-primary btn-sm">Get Started</a>
        <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
      </div>
    </nav>

    <section class="hero">
      <div class="hero-badge fade-in-up">
        <span>✦</span> Agent Sessions Platform
      </div>

      <h1 class="fade-in-up delay-1">
        让你的 AI 助手<br><span class="grad-text">协同工作</span>
      </h1>

      <p class="hero-sub fade-in-up delay-2">
        Turing Cloud 是一个 AI 助手协作平台。自带 API Key，灵活路由，
        用任务和工作流让多个 AI 模型协作完成复杂任务。
      </p>

      <div class="hero-cta fade-in-up delay-3">
        <a href="/sessions" class="btn btn-primary pulse-glow">
          Get Started
          <span>→</span>
        </a>
        <a href="/login" class="btn btn-secondary">
          Sign In
        </a>
      </div>
    </section>

    <section class="arch-section" id="architecture">
      <h2 class="fade-in-up">工作原理</h2>
      <p class="section-sub fade-in-up delay-1">Agent A ↔ Turing ↔ Agent B —— 简洁而强大的任务编排</p>

      <div class="arch-diagram fade-in-up delay-2">
        <div class="arch-col">
          <div class="arch-node">
            <div class="arch-icon" style="background: rgba(99,102,241,0.15);">🤖</div>
            <div class="arch-label">Claude</div>
            <div class="arch-sub">Anthropic API</div>
          </div>
          <div class="arch-node">
            <div class="arch-icon" style="background: rgba(34,197,94,0.15);">🧠</div>
            <div class="arch-label">GPT-4o</div>
            <div class="arch-sub">OpenAI API</div>
          </div>
        </div>

        <div class="arch-connector"></div>

        <div class="arch-center">
          <div class="arch-icon">⚡</div>
          <div class="arch-label">Turing Cloud</div>
          <div class="arch-sub" style="color: var(--text-secondary); margin-top: 4px;">路由 · 编排 · 计费</div>
        </div>

        <div class="arch-connector"></div>

        <div class="arch-col">
          <div class="arch-node">
            <div class="arch-icon" style="background: rgba(245,158,11,0.15);">💬</div>
            <div class="arch-label">GLM-4</div>
            <div class="arch-sub">智谱 API</div>
          </div>
          <div class="arch-node">
            <div class="arch-icon" style="background: rgba(139,92,246,0.15);">🔮</div>
            <div class="arch-label">Gemini</div>
            <div class="arch-sub">Google API</div>
          </div>
        </div>
      </div>
    </section>

    <section class="features-section" id="features">
      <h2>为什么选择 Turing Cloud</h2>
      <p class="section-sub">三个核心优势，让助手协作变得简单</p>

      <div class="features-grid">
        <div class="feature-card fade-in-up delay-1">
          <div class="feature-icon" style="background: linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15));">
            🔀
          </div>
          <h3>助手编排</h3>
          <p>
            通过任务和工作流灵活定义助手之间的通信拓扑。
            支持串行、并行、条件分支 —— 像搭积木一样构建复杂工作流。
          </p>
        </div>

        <div class="feature-card fade-in-up delay-2">
          <div class="feature-icon" style="background: linear-gradient(135deg, rgba(245,158,11,0.15), rgba(249,115,22,0.15));">
            🔑
          </div>
          <h3>用自己的 Key</h3>
          <p>
            自带 API Key，直接对接 Anthropic、OpenAI、智谱等主流提供商。
            不锁定供应商，数据不经代理 —— 完全掌控你的 AI 资产。
          </p>
        </div>

        <div class="feature-card fade-in-up delay-3">
          <div class="feature-icon" style="background: linear-gradient(135deg, rgba(34,197,94,0.15), rgba(16,185,129,0.15));">
            📊
          </div>
          <h3>按需计费</h3>
          <p>
            只为实际使用的任务付费。透明的按回合计费模式，
            没有包月、没有隐藏费用。用多少、付多少。
          </p>
        </div>
      </div>
    </section>

    <section class="cta-section">
      <h2 class="fade-in-up" style="margin-bottom: 16px;">
        准备好让助手协作了吗？
      </h2>
      <p class="fade-in-up delay-1" style="color: var(--text-secondary); font-size: 1.05rem; margin-bottom: 36px;">
        免费开始，按需扩展。几分钟内就能创建第一个任务。
      </p>
      <div class="fade-in-up delay-2">
        <a href="/sessions" class="btn btn-primary" style="padding: 14px 36px; font-size: 1rem;">
          开始使用 Turing Cloud
          <span>→</span>
        </a>
      </div>
    </section>

    <footer class="landing-footer">
      <p>© 2026 Turing Cloud. All rights reserved.</p>
    </footer>
  `
  updateThemeButton()
}

function renderLogin() {
  document.body.innerHTML = `
    <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px;">
      <div class="card" style="max-width: 420px; width: 100%;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-flex; align-items: center; gap: 10px; margin-bottom: 16px;">
            <div class="logo-icon" style="width: 36px; height: 36px; font-size: 1rem;">T</div>
            <h2 style="margin: 0;">Turing Cloud</h2>
          </div>
          <p style="color: var(--text-secondary); font-size: 0.9rem;">Agent Sessions Platform</p>
        </div>

        <div style="margin-bottom: 24px; color: var(--text-secondary); font-size: 0.9rem;">
          Sign in with your existing local account.
        </div>

        <form id="login-form" class="tab-panel active" onsubmit="window.handleLogin(event)">
          <div class="form-group">
            <label>Email</label>
            <input type="email" class="input" name="email" required autocomplete="email">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" class="input" name="password" required minlength="8" autocomplete="current-password">
          </div>
          <button type="submit" class="btn btn-primary" style="width: 100%; justify-content: center;">
            Login
          </button>
        </form>
        <button class="btn btn-secondary" style="width: 100%; justify-content: center; margin-top: 12px;" onclick="window.handleLocalLogin()">
          Continue as Local User
        </button>
      </div>
    </div>
  `
  updateThemeButton()
}

window.handleLogin = async function(e) {
  e.preventDefault()
  const form = e.target
  const fd = new FormData(form)
  const email = fd.get('email')
  const password = fd.get('password')

  try {
    const data = await api('/api/auth/login', 'POST', { email, password })
    setAuthToken(data.token)
    state.user = data.user
    navigate('/sessions')
  } catch (err) {
    showToast(err.message)
  }
}

window.handleLocalLogin = async function() {
  try {
    const data = await api('/api/auth/local', 'POST', {})
    setAuthToken(data.token)
    state.user = data.user
    navigate('/sessions')
  } catch (err) {
    showToast(err.message)
  }
}

function renderSessions() {
  document.body.innerHTML = `
    <div class="app-layout">
      ${renderSidebar('sessions')}

      <div class="main">
        <header class="topbar">
          <div class="topbar-left">
            <h2>Sessions</h2>
          </div>
          <div class="topbar-right">
            <button class="btn btn-primary btn-sm" onclick="window.showTemplateGalleryModal()">+ New Session</button>
            <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
            ${renderUserMenu()}
          </div>
        </header>

        <div class="content">
          <div class="stats-row">
            <div class="stat-card">
              <div class="label">Active Sessions</div>
              <div class="stat-value grad-text" id="stat-active">0</div>
              <div class="stat-sub">running right now</div>
            </div>
            <div class="stat-card">
              <div class="label">Completed Today</div>
              <div class="stat-value" id="stat-done">0</div>
              <div class="stat-sub">↑ vs yesterday</div>
            </div>
            <div class="stat-card">
              <div class="label">Avg Turns</div>
              <div class="stat-value" id="stat-rounds">0</div>
              <div class="stat-sub">across all sessions</div>
            </div>
            <div class="stat-card">
              <div class="label">Active Agents</div>
              <div class="stat-value" id="stat-agents">0</div>
              <div class="stat-sub">providers configured</div>
            </div>
          </div>

          <div id="view-sessions">
            <div class="flex-between mb-24">
              <h3>Recent Sessions</h3>
              <input type="text" class="input" placeholder="Search sessions..." style="width: 240px;">
            </div>
            <div id="session-cards" class="session-cards"></div>
          </div>
        </div>
      </div>
    </div>
  `

  updateThemeButton()
  loadSessionsData()
}

async function loadSessionsData() {
  await Promise.all([
    loadSessions(),
    loadAgents(),
    loadStats()
  ])

  renderSessionStats()
  renderSessionCards()
}

function renderSessionStats() {
  const statActive = document.getElementById('stat-active')
  const statDone = document.getElementById('stat-done')
  const statRounds = document.getElementById('stat-rounds')
  const statAgents = document.getElementById('stat-agents')
  const active = state.sessions.filter(session => session.status === 'active').length
  const done = state.sessions.filter(session => session.status === 'done').length
  const avgRounds = state.sessions.length
    ? state.sessions.reduce((sum, session) => sum + (Number(session.currentRound) || 0), 0) / state.sessions.length
    : 0

  if (statActive) statActive.textContent = active
  if (statDone) statDone.textContent = done
  if (statRounds) statRounds.textContent = formatStatNumber(avgRounds)
  if (statAgents) statAgents.textContent = state.agents.length || 0
}

function renderSessionCards() {
  const container = document.getElementById('session-cards')
  if (!container) return

  if (state.sessions.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px;">No sessions yet. Create your first one!</p>'
    return
  }

  container.innerHTML = state.sessions.map(session => `
    <a href="/session/${session.id}" class="card session-card">
      <div class="session-card-header">
        <span class="session-card-title">${escapeHtml(session.from.label || session.from.adapter)} → ${escapeHtml(session.to.label || session.to.adapter)}</span>
        <span class="badge badge-${session.status}">${session.status}</span>
      </div>
      <div class="session-card-route">
        <span>${escapeHtml(session.from.label || session.from.adapter)}</span>
        <span class="route-arrow">→</span>
        <span>${escapeHtml(session.to.label || session.to.adapter)}</span>
      </div>
      <div class="session-card-meta">
        <span>⟳ ${session.currentRound} turns</span>
        <span>⏱ ${formatTime(session.updatedAt)}</span>
      </div>
    </a>
  `).join('')
}

function renderWorkflows() {
  state.currentSessionId = null
  state.currentSession = null
  state.currentPipelineId = null
  state.currentPipeline = null
  document.body.innerHTML = `
    <div class="app-layout">
      ${renderSidebar('workflows')}

      <div class="main">
        <header class="topbar">
          <div class="topbar-left">
            <h2>Workflows</h2>
          </div>
          <div class="topbar-right">
            <button class="btn btn-primary btn-sm" onclick="window.showNewWorkflowModal()">+ New Workflow</button>
            <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
            ${renderUserMenu()}
          </div>
        </header>

        <div class="content">
          <div class="flex-between mb-24">
            <h3>Recent Workflows</h3>
          </div>
          <div id="pipeline-cards" class="session-cards workflow-cards"></div>
        </div>
      </div>
    </div>
  `

  updateThemeButton()
  loadWorkflowsData()
}

async function loadWorkflowsData() {
  await loadPipelines()
  renderPipelineCards()
}

function renderPipelineCards() {
  const container = document.getElementById('pipeline-cards')
  if (!container) return

  if (state.pipelines.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px;">No workflows yet. Create your first one!</p>'
    return
  }

  container.innerHTML = state.pipelines.map(pipeline => `
    <a href="/workflow/${pipeline.id}" class="card session-card workflow-card">
      <div class="session-card-header">
        <span class="session-card-title">${escapeHtml(pipeline.name || 'Untitled workflow')}</span>
        <span class="badge badge-${pipeline.status}">${escapeHtml(pipeline.status)}</span>
      </div>
      ${renderStepRail(pipeline.sessions || [])}
      <div class="session-card-meta">
        <span>${(pipeline.sessions || []).length} steps</span>
        <span>Created ${formatTime(pipeline.createdAt)}</span>
      </div>
    </a>
  `).join('')
}

async function renderWorkflow(id) {
  state.currentSessionId = null
  state.currentSession = null
  state.currentPipelineId = id
  state.expandedWorkflowStep = state.expandedWorkflowStep || null

  let pipeline = null
  try {
    pipeline = await api(`/api/pipelines/${id}`)
  } catch (err) {
    document.body.innerHTML = '<div>Workflow not found</div>'
    return
  }
  state.currentPipeline = pipeline

  document.body.innerHTML = `
    <div class="app-layout">
      ${renderSidebar('workflows')}

      <div class="main">
        <header class="topbar">
          <div class="topbar-left">
            <a href="/workflows" class="btn btn-ghost btn-sm">← Back</a>
            <h2 id="workflow-title">${escapeHtml(pipeline.name || 'Untitled workflow')}</h2>
            <span id="workflow-status-badge" class="badge badge-${pipeline.status}">${escapeHtml(pipeline.status)}</span>
          </div>
          <div class="topbar-right" id="workflow-actions">
            ${renderWorkflowActions(pipeline)}
            <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
            ${renderUserMenu()}
          </div>
        </header>

        <div class="content workflow-detail">
          <div class="workflow-map" id="workflow-steps"></div>
          <div class="workflow-timeline card" id="workflow-timeline"></div>
        </div>
      </div>
    </div>
  `

  renderWorkflowSteps(pipeline)
  renderWorkflowTimeline(pipeline)
  updateThemeButton()
}

function renderWorkflowActions(pipeline) {
  return `
    ${pipeline.status === 'active' ? '<button class="btn btn-secondary btn-sm" onclick="window.pauseWorkflow()">⏸ Pause</button>' : ''}
    ${pipeline.status === 'paused' ? '<button class="btn btn-primary btn-sm" onclick="window.resumeWorkflow()">▶ Resume</button>' : ''}
    <button class="btn btn-ghost btn-sm" onclick="window.deleteCurrentWorkflow()">Delete</button>
  `
}

function renderWorkflowHeader(pipeline) {
  const title = document.getElementById('workflow-title')
  if (title) title.textContent = pipeline.name || 'Untitled workflow'

  const badge = document.getElementById('workflow-status-badge')
  if (badge) {
    badge.className = `badge badge-${pipeline.status}`
    badge.textContent = pipeline.status
  }

  const actions = document.getElementById('workflow-actions')
  if (actions) {
    actions.innerHTML = `
      ${renderWorkflowActions(pipeline)}
      <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
      ${renderUserMenu()}
    `
    updateThemeButton()
  }
}

function renderWorkflowSteps(pipeline) {
  const container = document.getElementById('workflow-steps')
  if (!container || !pipeline) return
  const steps = pipeline.sessions || []
  const details = pipeline.sessionDetails || []
  container.innerHTML = `
    <div class="workflow-rail-large">${renderStepRail(steps)}</div>
    <div class="workflow-step-grid">
      ${steps.map((step, index) => renderWorkflowStepCard(step, details[index], index)).join('')}
    </div>
  `
}

function renderWorkflowStepCard(step, session, index) {
  const expanded = state.expandedWorkflowStep === step.sessionId
  const dependsOn = step.dependsOn || []
  const from = agentLabel(session?.from) || 'Agent A'
  const to = agentLabel(session?.to) || 'Agent B'
  const currentRound = Number(session?.currentRound) || 0
  const maxRounds = Number(session?.maxRounds) || 0
  return `
    <div class="workflow-step-wrap">
      <button class="workflow-step-card ${expanded ? 'expanded' : ''}" onclick='window.toggleWorkflowStep(${jsString(step.sessionId)})'>
        <div class="workflow-step-top">
          <span class="workflow-step-index">Step ${index + 1}</span>
          <span class="badge badge-${step.status}">${escapeHtml(step.status)}</span>
        </div>
        <div class="workflow-step-route">${escapeHtml(from)} <span>→</span> ${escapeHtml(to)}</div>
        <div class="workflow-step-meta">
          <span>${currentRound}${maxRounds ? ` / ${maxRounds}` : ''} turns</span>
          <span>${dependsOn.length ? `Depends on ${dependsOn.length}` : 'No dependency'}</span>
        </div>
      </button>
      ${dependsOn.length ? `<div class="workflow-deps">← ${dependsOn.map(id => `Step ${stepIndexBySessionId(id) + 1 || '?'}`).join(', ')}</div>` : ''}
      ${expanded ? renderWorkflowStepMessages(session) : ''}
    </div>
  `
}

function renderWorkflowStepMessages(session) {
  const messages = session?.messages || []
  if (!messages.length) {
    return '<div class="workflow-step-messages"><p style="color: var(--text-muted); text-align: center;">No messages yet</p></div>'
  }
  return `
    <div class="workflow-step-messages">
      <div class="chat-stream">
        ${messages.map(msg => {
          const isFrom = msg.from !== 'human'
          const avatar = isFrom ? (msg.from || 'A').charAt(0).toUpperCase() : 'H'
          return `
            <div class="chat-msg ${isFrom ? 'from' : 'to'}">
              <div class="chat-avatar">${escapeHtml(avatar)}</div>
              <div>
                <div class="chat-bubble">${renderMarkdown(msg.content || '')}</div>
                <div class="chat-meta">
                  <span>${escapeHtml(msg.from || '')} · Turn ${escapeHtml(msg.round ?? '')}</span>
                </div>
              </div>
            </div>
          `
        }).join('')}
      </div>
    </div>
  `
}

function renderWorkflowTimeline(pipeline) {
  const container = document.getElementById('workflow-timeline')
  if (!container || !pipeline) return
  const steps = pipeline.sessions || []
  container.innerHTML = `
    <div class="flex-between mb-16">
      <h3>Timeline</h3>
      <span class="badge badge-${pipeline.status}">${escapeHtml(pipeline.status)}</span>
    </div>
    <div class="workflow-log">
      <div><span>Created</span><strong>${new Date(pipeline.createdAt).toLocaleString()}</strong></div>
      <div><span>Updated</span><strong>${new Date(pipeline.updatedAt).toLocaleString()}</strong></div>
      ${steps.map((step, index) => `<div><span>Step ${index + 1}</span><strong>${escapeHtml(step.status)}</strong></div>`).join('')}
    </div>
  `
}

function renderStepRail(steps) {
  const items = steps.length ? steps : [{ status: 'pending' }]
  return `
    <div class="step-rail">
      ${items.map((step, index) => `
        <span class="step-node step-${step.status}" title="Step ${index + 1}: ${escapeAttr(step.status)}"></span>
        ${index < items.length - 1 ? '<span class="step-arrow">→</span>' : ''}
      `).join('')}
    </div>
  `
}

function stepIndexBySessionId(sessionId) {
  return (state.currentPipeline?.sessions || []).findIndex(step => step.sessionId === sessionId)
}

function formatStatNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0'
  if (Number.isInteger(number)) return String(number)
  return number.toFixed(1)
}

async function renderSession(id) {
  state.currentSessionId = id
  state.currentPipelineId = null
  state.currentPipeline = null

  // Load session data
  let session = null
  try {
    session = await api(`/api/sessions/${id}`)
  } catch (err) {
    document.body.innerHTML = '<div>Session not found</div>'
    return
  }
  state.currentSession = session
  resetSessionStream(id)
  state.autoFollowMessages = true

  document.body.innerHTML = `
    <div class="app-layout">
      ${renderSidebar('sessions')}

      <div class="main">
        <header class="topbar">
          <div class="topbar-left">
            <a href="/sessions" class="btn btn-ghost btn-sm">← Back</a>
            <h2>${escapeHtml(session.from.label || session.from.adapter)} → ${escapeHtml(session.to.label || session.to.adapter)}</h2>
            <span id="session-status-badge" class="badge badge-${session.status}">${session.status}</span>
          </div>
          <div class="topbar-right" id="session-actions">
            ${renderSessionActions(session)}
            <button class="btn btn-ghost btn-sm" onclick="window.deleteCurrentSession()">Delete</button>
            <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
            ${renderUserMenu()}
          </div>
        </header>

        <div class="session-layout">
          <div class="session-chat">
            <div class="session-status-line" id="session-status-line">
              <span class="status-spinner"></span>
              <span id="session-live-status">${session.status === 'active' ? '等待输出...' : escapeHtml(session.status)}</span>
            </div>
            <div class="session-chat-messages" id="messages-container">
              <div class="chat-stream" id="messages"></div>
            </div>
            <div class="message-scroll-controls" aria-label="Message navigation">
              <button class="scroll-jump-btn" onclick="window.scrollSessionMessages('top')" title="跳到开头">↑</button>
              <button class="scroll-jump-btn" onclick="window.scrollSessionMessages('bottom')" title="跳到结尾">↓</button>
            </div>
            <div class="raw-output-panel">
              <button class="raw-output-toggle" onclick="window.toggleRawOutput()">
                <span id="raw-output-toggle-label">${state.rawOutputVisible ? '隐藏原始输出' : '显示原始输出'}</span>
              </button>
              <pre class="raw-output ${state.rawOutputVisible ? 'visible' : ''}" id="raw-output"></pre>
            </div>
            <div class="session-chat-input">
              <div class="inject-bar">
                <input type="text" class="input" id="inject-input" placeholder="Inject a message into this session...">
                <button class="btn btn-primary btn-sm" onclick="window.injectMessage()">Send</button>
              </div>
            </div>
          </div>

          <div class="session-panel" id="session-panel-content"></div>
        </div>
      </div>
    </div>
  `

  state.currentMessages = session.messages || []
  renderSessionMessages()
  bindMessageScrollTracking()
  renderSessionPanel(session)
  updateThemeButton()
}

function renderSessionActions(session) {
  return `
    <button class="btn btn-secondary btn-sm" onclick="window.exportCurrentSession()">Export</button>
    ${session.status === 'active' ? '<button class="btn btn-secondary btn-sm" onclick="window.extendSessionTimeout()">+5m</button>' : ''}
    ${session.status === 'active' ? '<button class="btn btn-secondary btn-sm" onclick="window.pauseSession()">⏸ Pause</button>' : ''}
    ${session.status === 'paused' ? '<button class="btn btn-primary btn-sm" onclick="window.resumeSession()">▶ Resume</button>' : ''}
    ${session.status === 'active' || session.status === 'paused' ? '<button class="btn btn-danger btn-sm" onclick="window.stopSession()">■ Stop</button>' : ''}
  `
}

function renderSessionHeader(session) {
  const badge = document.getElementById('session-status-badge')
  if (badge) {
    badge.className = `badge badge-${session.status}`
    badge.textContent = session.status
  }

  const actions = document.getElementById('session-actions')
  if (actions) {
    actions.innerHTML = `
      ${renderSessionActions(session)}
      <button class="btn btn-ghost btn-sm" onclick="window.deleteCurrentSession()">Delete</button>
      <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
      ${renderUserMenu()}
    `
    updateThemeButton()
  }
}

function renderSessionPanel(session) {
  const panel = document.getElementById('session-panel-content')
  if (!panel || !session) return
  const progress = session.maxRounds ? Math.min(100, session.currentRound / session.maxRounds * 100) : 0
  panel.innerHTML = `
    <div class="panel-section">
      <div class="label mb-16">Session Info</div>
      <div class="panel-kv">
        <div class="panel-kv-row">
          <span class="kv-label">Session ID</span>
          <span class="kv-value mono" style="font-size: 0.78rem;">${escapeHtml(session.id.slice(0, 12))}</span>
        </div>
        <div class="panel-kv-row">
          <span class="kv-label">Agent A</span>
          <span class="kv-value">${escapeHtml(agentLabel(session.from))}</span>
        </div>
        <div class="panel-kv-row">
          <span class="kv-label">Agent B</span>
          <span class="kv-value">${escapeHtml(agentLabel(session.to))}</span>
        </div>
        <div class="panel-kv-row">
          <span class="kv-label">Mode</span>
          <span class="kv-value">${escapeHtml(session.mode)}</span>
        </div>
        ${session.templateId ? `<div class="panel-kv-row"><span class="kv-label">Template</span><span class="kv-value">${escapeHtml(session.templateId)}</span></div>` : ''}
        <div class="panel-kv-row">
          <span class="kv-label">Turns</span>
          <span class="kv-value">${session.currentRound} / ${session.maxRounds}</span>
        </div>
        <div class="panel-kv-row">
          <span class="kv-label">Status</span>
          <span class="badge badge-${session.status}" style="margin: 0;">${session.status}</span>
        </div>
        <div class="panel-kv-row">
          <span class="kv-label">Created</span>
          <span class="kv-value">${new Date(session.createdAt).toLocaleString()}</span>
        </div>
        ${session.cwd ? `<div class="panel-kv-row"><span class="kv-label">CWD</span><span class="kv-value mono">${escapeHtml(session.cwd)}</span></div>` : ''}
      </div>
    </div>

    <div class="divider"></div>

    <div class="panel-section">
      <div class="label mb-8">Progress</div>
      <p style="font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 8px;">Turn ${session.currentRound} of ${session.maxRounds}</p>
      <div class="progress-bar">
        <div class="progress-bar-fill" style="width: ${progress}%;"></div>
      </div>
      ${renderRoundJumpList()}
    </div>

    ${session.errorMessage ? `
      <div class="divider"></div>
      <div class="error-box">
        <div class="error-title">${escapeHtml(session.errorType || 'Session error')}</div>
        <div class="error-detail">${escapeHtml(session.errorMessage)}</div>
      </div>
    ` : ''}

    ${session.lastAgentOutput ? `
      <div class="divider"></div>
      <div class="panel-section">
        <div class="label mb-8">Last Agent Output</div>
        <pre class="code-block">${escapeHtml(session.lastAgentOutput)}</pre>
      </div>
    ` : ''}
  `
}

function renderSessionMessages(options = {}) {
  const container = document.getElementById('messages')
  if (!container) return
  const { preserveScroll = false, forceScrollBottom = false } = options
  const messagesContainer = document.getElementById('messages-container')
  const previousScrollTop = messagesContainer?.scrollTop ?? 0
  const steps = state.streamSteps.get(state.currentSessionId) || []
  const artifactHtml = renderSessionArtifacts(state.currentSession)

  if (state.currentMessages.length === 0 && steps.length === 0 && !artifactHtml) {
    container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px;">No messages yet</p>'
    updateSessionStatusLine()
    updateRawOutput()
    return
  }

  const messagesHtml = state.currentMessages.map(msg => {
    const isFrom = msg.from !== 'human'
    const avatar = isFrom ? (msg.from.charAt(0).toUpperCase()) : 'H'
    return `
      <div class="chat-msg ${isFrom ? 'from' : 'to'}" id="message-${escapeAttr(msg.id)}" data-round="${escapeAttr(String(msg.round))}">
        <div class="chat-avatar">${avatar}</div>
        <div class="chat-content">
          <div class="chat-bubble">${renderMarkdown(msg.content)}</div>
          <div class="chat-meta">
            <span>${escapeHtml(msg.from)} · Turn ${msg.round} · ${new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          <button class="msg-copy-btn" onclick='window.copyMessage(${jsString(msg.id)})' title="Copy">Copy</button>
          </div>
        </div>
      </div>
    `
  }).join('')

  const stepsHtml = steps.length ? `
    <div class="step-stream">
      ${steps.map((step, index) => renderStepCard(step, index, steps.length)).join('')}
    </div>
  ` : ''

  container.innerHTML = artifactHtml + messagesHtml + stepsHtml

  renderStreamingDelta()

  if (!messagesContainer) return
  if (preserveScroll) {
    messagesContainer.scrollTop = previousScrollTop
    return
  }
  if (forceScrollBottom || state.autoFollowMessages) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }
}

function renderSessionArtifacts(session) {
  if (!session || session.status !== 'done' || !session.artifacts) return ''
  const artifacts = session.artifacts
  const files = Array.isArray(artifacts.filesChanged) ? artifacts.filesChanged : []
  const totalAdditions = files.reduce((sum, file) => sum + (Number(file.additions) || 0), 0)
  const totalDeletions = files.reduce((sum, file) => sum + (Number(file.deletions) || 0), 0)
  const hasGit = Boolean(artifacts.gitDiffFull || artifacts.gitDiffStat || files.length)
  const summary = artifacts.summary || '暂无摘要'
  return `
    <section class="artifact-card">
      <div class="artifact-title">产出</div>
      ${hasGit ? `
        <div class="artifact-section">
          <div class="artifact-section-title">📄 文件变更 <span>(${files.length} files, +${totalAdditions} -${totalDeletions})</span></div>
          <div class="artifact-files">
            ${files.map(file => renderArtifactFile(file, artifacts.gitDiffFull || '')).join('')}
          </div>
        </div>
      ` : ''}
      <div class="artifact-section">
        <div class="artifact-section-title">📋 摘要</div>
        <div class="artifact-summary">${escapeHtml(summary)}</div>
      </div>
      <div class="artifact-actions">
        <button class="btn btn-secondary btn-sm" onclick="window.copyArtifactSummary()">复制摘要</button>
        ${artifacts.gitDiffFull ? `<button class="btn btn-secondary btn-sm" onclick="window.toggleFullDiff()">${state.artifactFullDiffVisible ? '收起完整 Diff' : '查看完整 Diff'}</button>` : ''}
      </div>
      ${state.artifactFullDiffVisible && artifacts.gitDiffFull ? `
        <pre class="artifact-diff"><code>${renderHighlightedDiff(artifacts.gitDiffFull)}</code></pre>
      ` : ''}
    </section>
  `
}

function renderArtifactFile(file, fullDiff) {
  const key = file.path || ''
  const expanded = state.expandedArtifactFiles.has(key)
  const fileDiff = expanded ? extractFileDiff(fullDiff, key) : ''
  return `
    <div class="artifact-file">
      <button class="artifact-file-row" onclick='window.toggleArtifactFile(${jsString(key)})'>
        <span class="artifact-file-path">${escapeHtml(file.path)}</span>
        <span class="artifact-file-counts"><span class="additions">+${Number(file.additions) || 0}</span> <span class="deletions">-${Number(file.deletions) || 0}</span></span>
      </button>
      ${expanded ? `<pre class="artifact-diff"><code>${renderHighlightedDiff(fileDiff || 'No diff for this file.')}</code></pre>` : ''}
    </div>
  `
}

function renderHighlightedDiff(diff) {
  if (typeof hljs !== 'undefined') {
    try {
      return hljs.highlight(diff, { language: 'diff', ignoreIllegals: true }).value
    } catch {
      return escapeHtml(diff)
    }
  }
  return escapeHtml(diff)
}

function extractFileDiff(fullDiff, path) {
  if (!fullDiff || !path) return ''
  const blocks = fullDiff.split(/^diff --git /m).filter(Boolean).map(block => `diff --git ${block}`)
  return blocks.find(block => block.startsWith(`diff --git a/${path} b/${path}`) || block.includes(` b/${path}\n`)) || ''
}

function renderStepCard(step, index, total) {
  const isLast = index === total - 1
  const isDone = step.type === 'done' || !isLast || state.currentSession?.status !== 'active'
  const stateClass = step.type === 'done' ? 'done' : isDone ? 'complete' : 'active'
  const icon = isDone ? '✅' : stepIcon(step.type)
  const detailKey = `${state.currentSessionId}:${index}`
  const expanded = state.expandedStepDetails.has(detailKey)
  return `
    <div class="step-card ${stateClass} type-${escapeAttr(step.type)}" data-step-key="${escapeAttr(detailKey)}">
      <div class="step-icon">${icon}</div>
      <div class="step-body">
        <div class="step-summary">${escapeHtml(step.summary || '')}</div>
        ${step.detail ? `
          <button type="button" class="step-detail-toggle" data-step-toggle="${escapeAttr(detailKey)}" onclick="window.toggleStepDetail(${jsString(detailKey)})">${expanded ? '收起详情' : '展开详情'}</button>
          <pre class="step-detail ${expanded ? 'visible' : ''}" data-step-detail="${escapeAttr(detailKey)}">${escapeHtml(step.detail)}</pre>
        ` : ''}
      </div>
    </div>
  `
}

function renderRoundJumpList() {
  const rounds = Array.from(new Set(state.currentMessages.map(msg => Number(msg.round)).filter(Number.isFinite))).sort((a, b) => a - b)
  if (!rounds.length) return ''
  return `
    <div class="round-jump-list">
      ${rounds.map(round => `<button type="button" class="round-jump-btn" onclick="window.scrollSessionRound(${round})">${round === 0 ? 'Start' : `Turn ${round}`}</button>`).join('')}
    </div>
  `
}

function stepIcon(type) {
  if (type === 'done') return '✅'
  if (type === 'read') return '📖'
  if (type === 'write') return '✏️'
  if (type === 'exec') return '⚡'
  if (type === 'think') return '🤔'
  return '•'
}

function summarizeRawStatus(content) {
  const text = (content || '').replace(/\s+/g, ' ').trim()
  if (!text) return '处理中...'
  const file = extractUiFile(text)
  const command = extractUiCommand(text)
  if (/\b(read file|read_file|reading|read|cat|sed|rg|grep)\b/i.test(text)) return `正在读取 ${file || command || '文件'}...`
  if (/\b(write|edit|apply_patch|patch|wrote|modified|update file|create file|save)\b/i.test(text)) return `正在修改 ${file || '文件'}...`
  if (/\b(bash|shell|exec|execute|run command|npm|pnpm|yarn|git|node|tsc|pytest|vitest|make)\b/i.test(text)) return `正在执行 ${command || text.slice(0, 50)}...`
  if (/thinking|analysis|plan|分析|计划/i.test(text)) return '正在分析...'
  return text.slice(0, 50)
}

function extractUiFile(text) {
  const quoted = text.match(/[`'"]([^`'"]+\.[\w.-]+)[`'"]/)
  if (quoted?.[1]) return quoted[1]
  const pathMatch = text.match(/(?:^|\s)((?:\.{1,2}\/|\/)?[\w@.-]+(?:\/[\w@.-]+)+\.[\w.-]+)/)
  if (pathMatch?.[1]) return pathMatch[1]
  const simple = text.match(/\b([\w@.-]+\.[A-Za-z0-9_-]{1,8})\b/)
  return simple?.[1]
}

function extractUiCommand(text) {
  const quoted = text.match(/(?:cmd|command|bash|exec|执行|运行)[^`'"]*[`'"]([^`'"]+)[`'"]/i)
  if (quoted?.[1]) return quoted[1].slice(0, 80)
  const match = text.match(/\b((?:npm|pnpm|yarn|git|node|npx|tsc|pytest|vitest|make|bash|sh|rg|sed|cat)\s+[^.;\n]{1,80})/i)
  return match?.[1]?.trim()
}

function updateSessionStatusLine() {
  const text = document.getElementById('session-live-status')
  const line = document.getElementById('session-status-line')
  if (!text || !line) return
  const status = state.streamStatus.get(state.currentSessionId)
    || (state.currentSession?.status === 'active' ? '等待输出...' : state.currentSession?.status || '空闲')
  text.textContent = status
  line.classList.toggle('idle', state.currentSession?.status !== 'active')
}

function updateRawOutput() {
  const raw = document.getElementById('raw-output')
  if (!raw) return
  raw.textContent = state.streamRaw.get(state.currentSessionId) || ''
}

function bindMessageScrollTracking() {
  const messagesContainer = document.getElementById('messages-container')
  if (!messagesContainer) return
  messagesContainer.addEventListener('scroll', () => {
    state.autoFollowMessages = isNearMessageBottom(messagesContainer)
  }, { passive: true })
}

function isNearMessageBottom(container) {
  return container.scrollHeight - container.scrollTop - container.clientHeight < 80
}

window.scrollSessionMessages = function(position) {
  const messagesContainer = document.getElementById('messages-container')
  if (!messagesContainer) return
  if (position === 'top') {
    state.autoFollowMessages = false
    messagesContainer.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  state.autoFollowMessages = true
  messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' })
}

window.scrollSessionRound = function(round) {
  const messagesContainer = document.getElementById('messages-container')
  const target = document.querySelector(`.chat-msg[data-round="${round}"]`)
  if (!messagesContainer || !target) return
  state.autoFollowMessages = false
  messagesContainer.scrollTo({
    top: target.offsetTop - messagesContainer.offsetTop - 16,
    behavior: 'smooth',
  })
}

window.toggleStepDetail = function(key) {
  state.autoFollowMessages = false
  if (state.expandedStepDetails.has(key)) {
    state.expandedStepDetails.delete(key)
  } else {
    state.expandedStepDetails.add(key)
  }
  const expanded = state.expandedStepDetails.has(key)
  document.querySelectorAll('[data-step-detail]').forEach(node => {
    if (node.dataset.stepDetail === key) node.classList.toggle('visible', expanded)
  })
  document.querySelectorAll('[data-step-toggle]').forEach(node => {
    if (node.dataset.stepToggle === key) node.textContent = expanded ? '收起详情' : '展开详情'
  })
}

window.toggleRawOutput = function() {
  state.rawOutputVisible = !state.rawOutputVisible
  const raw = document.getElementById('raw-output')
  const label = document.getElementById('raw-output-toggle-label')
  if (raw) raw.classList.toggle('visible', state.rawOutputVisible)
  if (label) label.textContent = state.rawOutputVisible ? '隐藏原始输出' : '显示原始输出'
  updateRawOutput()
}

window.toggleArtifactFile = function(path) {
  if (state.expandedArtifactFiles.has(path)) {
    state.expandedArtifactFiles.delete(path)
  } else {
    state.expandedArtifactFiles.add(path)
  }
  renderSessionMessages()
}

window.toggleFullDiff = function() {
  state.artifactFullDiffVisible = !state.artifactFullDiffVisible
  renderSessionMessages()
}

window.copyArtifactSummary = async function() {
  const summary = state.currentSession?.artifacts?.summary || ''
  if (!summary) return
  const ok = await copyText(summary)
  showToast(ok ? '摘要已复制' : '复制失败', ok ? 'success' : 'error')
}

window.pauseSession = async function() {
  if (!state.currentSessionId) return
  try {
    await api(`/api/sessions/${state.currentSessionId}/pause`, 'POST')
    renderSession(state.currentSessionId)
  } catch (err) {
    showToast(err.message)
  }
}

window.resumeSession = async function() {
  if (!state.currentSessionId) return
  try {
    await api(`/api/sessions/${state.currentSessionId}/resume`, 'POST')
    renderSession(state.currentSessionId)
  } catch (err) {
    showToast(err.message)
  }
}

window.stopSession = async function() {
  if (!state.currentSessionId) return
  if (!await confirmAction({
    title: 'Stop Session',
    message: 'Stop this session now?',
    confirmText: 'Stop',
    danger: true,
  })) return
  try {
    await api(`/api/sessions/${state.currentSessionId}/stop`, 'POST')
    navigate('/sessions')
  } catch (err) {
    showToast(err.message)
  }
}

window.injectMessage = async function() {
  if (!state.currentSessionId) return
  const input = document.getElementById('inject-input')
  if (!input || !input.value.trim()) return

  try {
    await api(`/api/sessions/${state.currentSessionId}/message`, 'POST', {
      content: input.value.trim()
    })
    input.value = ''
    loadSessionDetail(state.currentSessionId)
  } catch (err) {
    showToast(err.message)
  }
}

window.extendSessionTimeout = async function() {
  if (!state.currentSessionId) return
  try {
    const result = await api(`/api/sessions/${state.currentSessionId}/extend-timeout`, 'POST')
    showToast(`Timeout extended +${Math.round(result.extensionMs / 60000)}m`, 'success')
  } catch (err) {
    showToast(err.message)
  }
}

window.deleteCurrentSession = async function() {
  if (!state.currentSessionId) return
  if (!await confirmAction({
    title: 'Delete Session',
    message: 'Delete this session permanently?',
    confirmText: 'Delete',
    danger: true,
  })) return
  try {
    await api(`/api/sessions/${state.currentSessionId}`, 'DELETE')
    navigate('/sessions')
  } catch (err) {
    showToast(err.message)
  }
}

window.copyMessage = async function(id) {
  const msg = state.currentMessages.find(item => item.id === id)
  if (!msg) return
  await copyText(msg.content || '')
}

window.exportCurrentSession = function() {
  if (!state.currentSession) return
  const content = buildSessionExport(state.currentSession, state.currentMessages)
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `turing-session-${state.currentSession.id}.md`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

async function renderSettings() {
  await loadConfig()
  await loadAgents()
  await loadApiKeys()
  const localCliTab = '<button class="tab-btn" data-tab="local-cli" onclick="window.switchSettingsTab(\'local-cli\')">Local CLI Agents</button>'
  const localCliPanel = `
            <div id="tab-local-cli" class="tab-panel" data-tab="local-cli">
              <div class="flex-between mb-24">
                <div>
                  <h3>Local CLI Agents</h3>
                  <p style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px;">Discovered on this machine; add the ones you want to use in sessions</p>
                </div>
              </div>
              <div class="agent-list" id="local-cli-list"></div>
            </div>
  `

  document.body.innerHTML = `
    <div class="app-layout">
      ${renderSidebar('settings')}

      <div class="main">
        <header class="topbar">
          <div class="topbar-left">
            <h2>Settings</h2>
          </div>
          <div class="topbar-right">
            <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
            ${renderUserMenu()}
          </div>
        </header>

        <div class="content">
          <div style="max-width: 860px;">
            <div class="tabs">
              <button class="tab-btn active" data-tab="agents" onclick="window.switchSettingsTab('agents')">API Assistants</button>
              <button class="tab-btn" data-tab="apikeys" onclick="window.switchSettingsTab('apikeys')">Provider Keys</button>
              ${localCliTab}
              <button class="tab-btn" data-tab="general" onclick="window.switchSettingsTab('general')">General</button>
            </div>

            <div id="tab-agents" class="tab-panel active" data-tab="agents">
              <div class="flex-between mb-24">
                <div>
                  <h3>API Assistants</h3>
                  <p style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px;">Manage your AI model connections</p>
                </div>
                <button class="btn btn-primary btn-sm" onclick="window.showAgentModal()">+ Add Assistant</button>
              </div>

              <div class="agent-list" id="agents-list"></div>
            </div>

            <div id="tab-apikeys" class="tab-panel" data-tab="apikeys">
              <div class="flex-between mb-24">
                <div>
                  <h3>Provider Keys</h3>
                  <p style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px;">Manage keys used by API assistants and sessions</p>
                </div>
                <button class="btn btn-primary btn-sm" onclick="window.showApiKeyModal()">+ Add Key</button>
              </div>
              <div class="agent-list" id="api-keys-list"></div>
            </div>

            ${localCliPanel}

            <div id="tab-general" class="tab-panel" data-tab="general">
              <h3 class="mb-24">General Settings</h3>

              <div class="form-group">
                <label>Default Max Turns</label>
                <input type="number" class="input" value="${state.config?.defaults?.maxRounds || 20}" id="max-rounds-input">
              </div>

              <div class="form-group">
                <label>Default Mode</label>
                <select class="input" id="mode-input">
                  <option value="collaborate" ${state.config?.defaults?.mode === 'collaborate' ? 'selected' : ''}>Collaboration</option>
                  <option value="discuss" ${state.config?.defaults?.mode === 'discuss' ? 'selected' : ''}>Discuss</option>
                  <option value="review" ${state.config?.defaults?.mode === 'review' ? 'selected' : ''}>Review</option>
                  <option value="freeform" ${state.config?.defaults?.mode === 'freeform' ? 'selected' : ''}>Freeform</option>
                </select>
              </div>

              <button class="btn btn-primary" onclick="window.saveGeneralSettings()">Save Settings</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `

  renderAgentsList()
  renderApiKeysList()
  renderLocalCliAgentsList()
  updateThemeButton()
}

function renderAgentsList() {
  const container = document.getElementById('agents-list')
  if (!container) return
  const apiAgents = state.agents.filter(agent => agent.kind !== 'local')

  if (apiAgents.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px;">No API assistants configured</p>'
    return
  }

  container.innerHTML = apiAgents.map(agent => {
    const colors = ['#6366f1', '#22c55e', '#f59e0b', '#3b82f6', '#8b5cf6']
    const color = colors[Math.floor(Math.random() * colors.length)]
    const initial = agent.name.charAt(0).toUpperCase()

    return `
      <div class="agent-item">
        <div class="agent-icon" style="background: linear-gradient(135deg, ${color}, ${color}dd);">${initial}</div>
        <div class="agent-info">
          <div class="agent-name">${escapeHtml(agent.name)}</div>
          <div class="agent-model">${escapeHtml(agent.provider)} · ${escapeHtml(agent.model || agent.adapter)}${agent.keyMasked ? ` · ${escapeHtml(agent.keyMasked)}` : ''}</div>
        </div>
        <span class="badge badge-${agent.status === 'ready' ? 'active' : agent.status === 'no_key' ? 'paused' : 'error'}">${escapeHtml(agent.status)}</span>
        <div class="agent-actions">
          <button class="btn btn-ghost btn-sm" onclick='window.showAgentModal(${jsString(agent.name)})'>Edit</button>
          <button class="btn btn-ghost btn-sm" style="color: var(--red);" onclick='window.deleteAgent(${jsString(agent.name)})'>Delete</button>
        </div>
      </div>
    `
  }).join('')
}

function renderApiKeysList() {
  const container = document.getElementById('api-keys-list')
  if (!container) return

  if (state.apiKeys.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px;">No provider keys stored</p>'
    return
  }

  container.innerHTML = state.apiKeys.map(key => `
    <div class="agent-item">
      <div class="agent-icon">${escapeHtml(providerIcon(key.provider))}</div>
      <div class="agent-info">
        <div class="agent-name">${escapeHtml(key.name)}</div>
        <div class="agent-model">
          ${escapeHtml(providerLabel(key.provider))} · <span class="key-masked">${escapeHtml(key.maskedKey)}</span>
          ${key.usedBy?.length ? ` · used by ${escapeHtml(key.usedBy.join(', '))}` : ''}
          ${key.source ? ` · ${escapeHtml(keySourceLabel(key.source))}` : ''}
        </div>
      </div>
      ${key.readOnly ? '<span class="badge badge-paused">linked</span>' : `<button class="btn btn-ghost btn-sm" style="color: var(--red);" onclick='window.deleteApiKey(${jsString(key.id)})'>Delete</button>`}
    </div>
  `).join('')
}

function renderLocalCliAgentsList() {
  const container = document.getElementById('local-cli-list')
  if (!container) return
  const agents = state.agents.filter(agent => agent.kind === 'local')
  if (agents.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px;">No local CLI agents available</p>'
    return
  }
  container.innerHTML = agents.map(agent => {
    const canAdd = agent.source === 'discovered'
    const canDelete = agent.source === 'configured'
    const badgeClass = agent.status === 'ready' ? 'active' : agent.status === 'discovered' ? 'paused' : 'error'
    return `
    <div class="agent-item">
      <div class="agent-icon">${escapeHtml(agent.name.charAt(0).toUpperCase())}</div>
      <div class="agent-info">
        <div class="agent-name">${escapeHtml(agent.name)}</div>
        <div class="agent-model">${escapeHtml(agent.adapter)} · ${escapeHtml(agent.command || '')}${agent.version ? ` · ${escapeHtml(agent.version)}` : ''}</div>
      </div>
      <span class="badge badge-${badgeClass}">${escapeHtml(agent.status)}</span>
      <div class="agent-actions">
        ${canAdd ? `<button class="btn btn-primary btn-sm" onclick='window.addLocalCliAgent(${jsString(agent.name)})'>Add</button>` : ''}
        ${canDelete ? `<button class="btn btn-ghost btn-sm" onclick='window.showLocalCliAgentModal(${jsString(agent.name)})'>Edit</button>` : ''}
        ${canDelete ? `<button class="btn btn-ghost btn-sm" style="color: var(--red);" onclick='window.deleteLocalCliAgent(${jsString(agent.name)})'>Delete</button>` : ''}
      </div>
    </div>
  `}).join('')
}

window.addLocalCliAgent = async function(name) {
  const agent = state.agents.find(item => item.kind === 'local' && item.name === name)
  if (!agent?.command) return
  try {
    state.config = await api('/api/config/agents', 'POST', {
      name: agent.name,
      adapter: agent.adapter,
      command: agent.command,
    })
    await loadAgents()
    renderAgentsList()
    renderLocalCliAgentsList()
  } catch (err) {
    showToast(err.message)
  }
}

window.showLocalCliAgentModal = function(name) {
  const agent = state.agents.find(item => item.kind === 'local' && item.name === name)
  if (!agent) return
  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <h3>Edit Local CLI Agent</h3>
          <p>${escapeHtml(agent.name)} · ${escapeHtml(agent.adapter)}</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">Close</button>
      </div>
      <form onsubmit='window.saveLocalCliAgent(event, ${jsString(agent.name)})'>
        <div class="form-row">
          <div class="form-group">
            <label>Name</label>
            <input class="input" name="name" required value="${escapeAttr(agent.name)}">
          </div>
          <div class="form-group">
            <label>Adapter</label>
            <input class="input" name="adapter" required value="${escapeAttr(agent.adapter)}">
          </div>
        </div>
        <div class="form-group">
          <label>Command</label>
          <input class="input" name="command" required value="${escapeAttr(agent.command || '')}">
        </div>
        <div class="form-group">
          <label>Args</label>
          <textarea class="input" name="args" rows="3">${escapeHtml((agent.args || []).join('\\n'))}</textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Timeout (ms)</label>
            <input class="input" name="timeout" type="number" min="1" value="${escapeAttr(agent.timeout || '')}">
          </div>
          <div></div>
        </div>
        <div class="form-group">
          <label>Environment</label>
          <textarea class="input" name="env" rows="3" placeholder="KEY=value">${escapeHtml(envToLines(agent.env))}</textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
    </div>
  `)
}

window.saveLocalCliAgent = async function(e, originalName) {
  e.preventDefault()
  const fd = new FormData(e.target)
  const args = String(fd.get('args') || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean)
  const body = compactObject({
    name: String(fd.get('name') || '').trim(),
    adapter: String(fd.get('adapter') || '').trim(),
    command: String(fd.get('command') || '').trim(),
    args,
    timeout: parseInt(fd.get('timeout')) || undefined,
    env: parseEnvLines(String(fd.get('env') || '')),
  })
  try {
    state.config = await api(`/api/config/agents/${encodeURIComponent(originalName)}`, 'PUT', body)
    await loadAgents()
    closeModal()
    renderLocalCliAgentsList()
  } catch (err) {
    showToast(err.message)
  }
}

window.deleteLocalCliAgent = async function(name) {
  if (!await confirmAction({
    title: 'Remove Local CLI Agent',
    message: `Remove local CLI agent "${name}" from sessions?`,
    confirmText: 'Remove',
    danger: true,
  })) return
  try {
    state.config = await api(`/api/config/agents/${encodeURIComponent(name)}`, 'DELETE')
    await loadAgents()
    renderAgentsList()
    renderLocalCliAgentsList()
  } catch (err) {
    showToast(err.message)
  }
}

window.switchSettingsTab = function(tab) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab)
  })
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.tab === tab)
  })
}

window.saveGeneralSettings = async function() {
  const maxRounds = parseInt(document.getElementById('max-rounds-input').value)
  const mode = document.getElementById('mode-input').value

  try {
    await api('/api/config', 'PUT', {
      defaults: { maxRounds, mode }
    })
    showToast('Settings saved successfully', 'success')
  } catch (err) {
    showToast(err.message)
  }
}

window.showTemplateGalleryModal = async function() {
  if (!state.templates.length) await loadTemplates()
  if (!state.agents.length) await loadAgents()

  const templates = [...state.templates].sort((a, b) => {
    if (a.id === 'custom') return 1
    if (b.id === 'custom') return -1
    return 0
  })
  const agentNotice = state.agents.length ? '' : `
    <div class="template-empty-agents">
      <span>No API assistants configured yet.</span>
      <button class="btn btn-secondary btn-sm" onclick="window.closeModal(); window.navigate('/settings')">Add one first</button>
    </div>
  `

  showModal(`
    <div class="modal-card template-modal">
      <div class="modal-head">
        <div>
          <h3>New Session</h3>
          <p>Choose a scenario preset.</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">Close</button>
      </div>
      ${agentNotice}
      <div class="template-grid">
        ${templates.map(template => `
          <button class="card template-card" type="button" onclick='window.showNewSessionModal(${jsString(template.id)})'>
            <div class="template-icon">${escapeHtml(template.icon || '⚙️')}</div>
            <div class="template-body">
              <div class="template-title">${escapeHtml(template.nameEn || template.name)}</div>
              <p>${escapeHtml(template.description || '')}</p>
              <div class="template-tags">${(template.tags || template.config?.tags || []).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
            </div>
          </button>
        `).join('')}
      </div>
    </div>
  `)
}

window.showNewSessionModal = async function(templateId = 'custom') {
  if (!state.templates.length) await loadTemplates()
  if (!state.agents.length) await loadAgents()
  const template = state.templates.find(item => item.id === templateId) || state.templates.find(item => item.id === 'custom')
  const readyAgents = state.agents.filter(agent => agent.status === 'ready')
  const agents = readyAgents.length ? readyAgents : state.agents
  const options = agents.map(agent => `<option value="${escapeAttr(agent.name)}">${escapeHtml(agent.name)} · ${escapeHtml(agent.model || agent.adapter)}</option>`).join('')
  const defaultFrom = preferredAgentName(agents, template?.config?.preferredAdapters?.from)
  const defaultTo = preferredAgentName(agents, template?.config?.preferredAdapters?.to, defaultFrom)
  const optionHtml = (selected) => agents.map(agent => `<option value="${escapeAttr(agent.name)}" ${agent.name === selected ? 'selected' : ''}>${escapeHtml(agent.name)} · ${escapeHtml(agent.model || agent.adapter)}</option>`).join('')
  const mode = template?.config?.mode || state.config?.defaults?.mode || 'collaborate'
  const maxRounds = template?.config?.maxRounds || state.config?.defaults?.maxRounds || 5
  const prompts = template?.config?.systemPrompts || { from: '', to: '' }
  const templateBadge = template && template.id !== 'custom'
    ? `<div class="template-selected-badge">Template: ${escapeHtml(template.nameEn || template.name)}</div>`
    : ''
  const noAgents = state.agents.length === 0

  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <h3>New Session</h3>
          <p>Create an assistant collaboration session.</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">Close</button>
      </div>
      ${templateBadge}
      ${noAgents ? `
        <div class="template-empty-agents" style="margin-bottom: 20px;">
          <span>No API assistants configured yet.</span>
          <button class="btn btn-secondary btn-sm" onclick="window.closeModal(); window.navigate('/settings')">Add one first</button>
        </div>
      ` : ''}
      <form onsubmit="window.createSession(event)">
        <input type="hidden" name="templateId" value="${escapeAttr(template?.id || 'custom')}">
        <div class="form-row">
          <div class="form-group">
            <label>Agent A</label>
            <select class="input" name="from" required ${noAgents ? 'disabled' : ''}>${optionHtml(defaultFrom) || options}</select>
          </div>
          <div class="form-group">
            <label>Agent B</label>
            <select class="input" name="to" required ${noAgents ? 'disabled' : ''}>${optionHtml(defaultTo) || options}</select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Mode</label>
            <select class="input" name="mode">
              <option value="collaborate" ${mode === 'collaborate' ? 'selected' : ''}>Collaboration</option>
              <option value="discuss" ${mode === 'discuss' ? 'selected' : ''}>Discuss</option>
              <option value="review" ${mode === 'review' ? 'selected' : ''}>Review</option>
              <option value="freeform" ${mode === 'freeform' ? 'selected' : ''}>Freeform</option>
            </select>
          </div>
          <div class="form-group">
            <label>Max Turns</label>
            <input class="input" type="number" name="maxRounds" min="1" value="${maxRounds}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Agent A System Prompt</label>
            <textarea class="input" name="systemPromptFrom" rows="4">${escapeHtml(prompts.from)}</textarea>
          </div>
          <div class="form-group">
            <label>Agent B System Prompt</label>
            <textarea class="input" name="systemPromptTo" rows="4">${escapeHtml(prompts.to)}</textarea>
          </div>
        </div>
        <div class="form-group">
          <label>Working Directory</label>
          <input class="input" name="cwd" placeholder="/path/to/project">
        </div>
        <div class="form-group">
          <label>Prompt</label>
          <textarea class="input" name="prompt" rows="5" required placeholder="Describe the session..."></textarea>
        </div>
        <details class="context-details">
          <summary>Context</summary>
          <div class="form-group">
            <label>Rules / Constraints</label>
            <textarea class="input" name="contextRules" rows="3"></textarea>
          </div>
          <div class="form-group">
            <label>Background</label>
            <textarea class="input" name="contextText" rows="3"></textarea>
          </div>
          <div class="form-group">
            <label>Files</label>
            <textarea class="input" name="contextFiles" rows="2" placeholder="src/web/app.js, src/web/style.css"></textarea>
          </div>
        </details>
        <label class="check-row">
          <input type="checkbox" name="approveMode">
          <span>Approve mode</span>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.showTemplateGalleryModal()">Back</button>
          <button type="submit" class="btn btn-primary" ${noAgents ? 'disabled' : ''}>Create</button>
        </div>
      </form>
    </div>
  `)
}

window.createSession = async function(e) {
  e.preventDefault()
  const fd = new FormData(e.target)
  const context = buildContextFromForm(fd)
  const systemPromptFrom = String(fd.get('systemPromptFrom') || '').trim()
  const systemPromptTo = String(fd.get('systemPromptTo') || '').trim()
  const body = {
    from: { adapter: fd.get('from') },
    to: { adapter: fd.get('to') },
    initialPrompt: String(fd.get('prompt') || '').trim(),
    template_id: String(fd.get('templateId') || '').trim() || undefined,
    mode: fd.get('mode') || state.config?.defaults?.mode || 'collaborate',
    maxRounds: parseInt(fd.get('maxRounds')) || state.config?.defaults?.maxRounds || 5,
    approveMode: fd.get('approveMode') === 'on',
    cwd: String(fd.get('cwd') || '').trim() || undefined,
    context,
  }
  if (systemPromptFrom && systemPromptTo) {
    body.systemPrompts = { from: systemPromptFrom, to: systemPromptTo }
  }

  try {
    const session = await api('/api/sessions', 'POST', body)
    closeModal()
    navigate(`/session/${session.id}`)
  } catch (err) {
    showToast(err.message)
  }
}

window.showNewWorkflowModal = async function() {
  if (!state.config) await loadConfig()
  if (!state.agents.length) await loadAgents()
  const readyAgents = state.agents.filter(agent => agent.status === 'ready')
  const agents = readyAgents.length ? readyAgents : state.agents
  const noAgents = agents.length === 0
  const defaultFrom = agents[0]?.name || ''
  const defaultTo = agents[1]?.name || agents[0]?.name || ''

  showModal(`
    <div class="modal-card workflow-modal">
      <div class="modal-head">
        <div>
          <h3>New Workflow</h3>
          <p>Create a multi-step agent pipeline.</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">Close</button>
      </div>
      ${noAgents ? `
        <div class="template-empty-agents" style="margin-bottom: 20px;">
          <span>No API assistants configured yet.</span>
          <button class="btn btn-secondary btn-sm" onclick="window.closeModal(); window.navigate('/settings')">Add one first</button>
        </div>
      ` : ''}
      <form onsubmit="window.createWorkflow(event)">
        <div class="form-group">
          <label>Pipeline name</label>
          <input class="input" name="name" required placeholder="Release workflow">
        </div>
        <div class="workflow-editor-head">
          <h3>Steps</h3>
          <button type="button" class="btn btn-secondary btn-sm" onclick="window.addWorkflowStep()">+ Add Step</button>
        </div>
        <div id="workflow-step-editor" class="workflow-step-editor" data-from="${escapeAttr(defaultFrom)}" data-to="${escapeAttr(defaultTo)}" data-count="0"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" ${noAgents ? 'disabled' : ''}>Create</button>
        </div>
      </form>
    </div>
  `)
  window.addWorkflowStep()
  window.addWorkflowStep()
}

window.addWorkflowStep = function() {
  const editor = document.getElementById('workflow-step-editor')
  if (!editor) return
  const index = Number(editor.dataset.count || '0')
  editor.dataset.count = String(index + 1)
  const defaultFrom = editor.dataset.from || ''
  const defaultTo = editor.dataset.to || defaultFrom
  const row = document.createElement('div')
  row.className = 'workflow-edit-step'
  row.draggable = true
  row.innerHTML = renderWorkflowEditStep(index, defaultFrom, defaultTo)
  row.addEventListener('dragstart', event => {
    event.dataTransfer.setData('text/plain', String([...editor.children].indexOf(row)))
  })
  row.addEventListener('dragover', event => event.preventDefault())
  row.addEventListener('drop', event => {
    event.preventDefault()
    const from = Number(event.dataTransfer.getData('text/plain'))
    const rows = [...editor.children]
    const source = rows[from]
    if (!source || source === row) return
    editor.insertBefore(source, rows.indexOf(row) > from ? row.nextSibling : row)
    refreshWorkflowStepEditor()
  })
  editor.appendChild(row)
  refreshWorkflowStepEditor()
}

function renderWorkflowEditStep(index, defaultFrom, defaultTo) {
  const options = state.agents.map(agent => `<option value="${escapeAttr(agent.name)}">${escapeHtml(agent.name)} · ${escapeHtml(agent.model || agent.adapter)}</option>`).join('')
  return `
    <div class="workflow-edit-title">
      <span class="drag-handle">↕</span>
      <strong data-step-label>Step ${index + 1}</strong>
      <button type="button" class="btn btn-ghost btn-sm" onclick="window.removeWorkflowStep(this)">Remove</button>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Agent A</label>
        <select class="input" name="from" required>${options.replace(`value="${escapeAttr(defaultFrom)}"`, `value="${escapeAttr(defaultFrom)}" selected`)}</select>
      </div>
      <div class="form-group">
        <label>Agent B</label>
        <select class="input" name="to" required>${options.replace(`value="${escapeAttr(defaultTo)}"`, `value="${escapeAttr(defaultTo)}" selected`)}</select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Mode</label>
        <select class="input" name="mode">
          <option value="collaborate">Collaboration</option>
          <option value="discuss">Discuss</option>
          <option value="review">Review</option>
          <option value="freeform">Freeform</option>
        </select>
      </div>
      <div class="form-group">
        <label>Max Turns</label>
        <input class="input" type="number" name="maxRounds" min="1" value="${state.config?.defaults?.maxRounds || 5}">
      </div>
    </div>
    <div class="form-group">
      <label>Prompt</label>
      <textarea class="input" name="initialPrompt" rows="3" required placeholder="Describe this step..."></textarea>
    </div>
    <div class="form-group">
      <label>Depends on</label>
      <select class="input" name="dependsOn" multiple data-deps></select>
    </div>
  `
}

window.removeWorkflowStep = function(button) {
  const row = button.closest('.workflow-edit-step')
  if (row) row.remove()
  refreshWorkflowStepEditor()
}

function refreshWorkflowStepEditor() {
  const editor = document.getElementById('workflow-step-editor')
  if (!editor) return
  const rows = [...editor.querySelectorAll('.workflow-edit-step')]
  rows.forEach((row, index) => {
    row.querySelector('[data-step-label]').textContent = `Step ${index + 1}`
    const deps = row.querySelector('[data-deps]')
    const selected = [...deps.selectedOptions].map(option => option.value)
    deps.innerHTML = rows.map((_, depIndex) => {
      if (depIndex === index) return ''
      const defaultSelected = selected.includes(String(depIndex)) || (selected.length === 0 && depIndex === index - 1)
      return `<option value="${depIndex}" ${defaultSelected ? 'selected' : ''}>Step ${depIndex + 1}</option>`
    }).join('')
  })
}

window.createWorkflow = async function(e) {
  e.preventDefault()
  const fd = new FormData(e.target)
  const rows = [...document.querySelectorAll('#workflow-step-editor .workflow-edit-step')]
  const steps = rows.map(row => {
    const dependsOn = [...row.querySelector('[name="dependsOn"]').selectedOptions]
      .map(option => Number(option.value))
      .filter(value => Number.isInteger(value))
    return compactObject({
      from: { adapter: row.querySelector('[name="from"]').value },
      to: { adapter: row.querySelector('[name="to"]').value },
      initialPrompt: row.querySelector('[name="initialPrompt"]').value.trim(),
      mode: row.querySelector('[name="mode"]').value,
      maxRounds: parseInt(row.querySelector('[name="maxRounds"]').value) || undefined,
      dependsOn: dependsOn.length ? dependsOn : undefined,
    })
  })

  try {
    const pipeline = await api('/api/pipelines', 'POST', {
      name: String(fd.get('name') || '').trim(),
      steps,
    })
    closeModal()
    navigate(`/workflow/${pipeline.id}`)
  } catch (err) {
    showToast(err.message)
  }
}

window.toggleWorkflowStep = function(sessionId) {
  state.expandedWorkflowStep = state.expandedWorkflowStep === sessionId ? null : sessionId
  renderWorkflowSteps(state.currentPipeline)
}

window.pauseWorkflow = async function() {
  if (!state.currentPipelineId) return
  try {
    const pipeline = await api(`/api/pipelines/${state.currentPipelineId}/pause`, 'POST')
    applyPipelineUpdate(pipeline)
  } catch (err) {
    showToast(err.message)
  }
}

window.resumeWorkflow = async function() {
  if (!state.currentPipelineId) return
  try {
    const pipeline = await api(`/api/pipelines/${state.currentPipelineId}/resume`, 'POST')
    applyPipelineUpdate(pipeline)
  } catch (err) {
    showToast(err.message)
  }
}

window.deleteCurrentWorkflow = async function() {
  if (!state.currentPipelineId) return
  if (!await confirmAction({
    title: 'Delete Workflow',
    message: 'Delete this workflow permanently?',
    confirmText: 'Delete',
    danger: true,
  })) return
  try {
    await api(`/api/pipelines/${state.currentPipelineId}`, 'DELETE')
    state.pipelines = state.pipelines.filter(pipeline => pipeline.id !== state.currentPipelineId)
    navigate('/workflows')
  } catch (err) {
    showToast(err.message)
  }
}

window.showAgentModal = async function(name) {
  if (!state.apiKeys.length) await loadApiKeys()
  const existing = state.agents.find(agent => agent.name === name)
  const selectedAdapter = existing?.adapter || 'anthropic-api'
  const selectedModel = existing?.model || defaultModelForAdapter(selectedAdapter)
  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <h3>${existing ? 'Edit Assistant' : 'Add Assistant'}</h3>
          <p>Configure an API-backed model.</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">Close</button>
      </div>
      <form onsubmit='window.saveAgent(event, ${existing ? jsString(existing.name) : 'null'})'>
        <div class="form-row">
          <div class="form-group">
            <label>Name</label>
            <input class="input" name="name" required value="${escapeAttr(existing?.name || '')}">
          </div>
          <div class="form-group">
            <label>Adapter</label>
            <select class="input" name="adapter" id="agent-adapter-select" required onchange="window.updateAgentModelOptions()">
              ${adapterOption('anthropic-api', selectedAdapter)}
              ${adapterOption('openai-api', selectedAdapter)}
              ${adapterOption('zhipu-api', selectedAdapter)}
              ${adapterOption('custom-api', selectedAdapter)}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Model</label>
          <select class="input" name="model" id="agent-model-select">
            ${modelOptions(selectedAdapter, selectedModel)}
          </select>
        </div>
        <div class="form-group">
          <label>Base URL</label>
          <input class="input" name="baseUrl" value="${escapeAttr(existing?.baseUrl || '')}" placeholder="Optional">
        </div>
        <div class="form-group">
          <label>Provider Key</label>
          <select class="input" name="keyId" id="agent-key-select" data-has-current-key="${existing?.hasKey ? 'true' : 'false'}" data-original-adapter="${escapeAttr(existing?.adapter || '')}">
            ${agentKeyOptions(selectedAdapter, Boolean(existing?.hasKey))}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Timeout (ms)</label>
            <input class="input" name="timeout" type="number" min="1" value="">
          </div>
          <div></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
    </div>
  `)
}

window.saveAgent = async function(e, originalName) {
  e.preventDefault()
  const fd = new FormData(e.target)
  const body = compactObject({
    name: String(fd.get('name') || '').trim(),
    adapter: fd.get('adapter'),
    model: String(fd.get('model') || '').trim() || undefined,
    baseUrl: String(fd.get('baseUrl') || '').trim() || undefined,
    keyId: String(fd.get('keyId') || '').trim() || undefined,
    timeout: parseInt(fd.get('timeout')) || undefined,
  })

  try {
    state.agents = await api(originalName ? `/api/agents/${encodeURIComponent(originalName)}` : '/api/agents', originalName ? 'PUT' : 'POST', body)
    await loadApiKeys()
    closeModal()
    renderAgentsList()
  } catch (err) {
    showToast(err.message)
  }
}

window.deleteAgent = async function(name) {
  if (!await confirmAction({
    title: 'Delete Assistant',
    message: `Delete assistant "${name}"?`,
    confirmText: 'Delete',
    danger: true,
  })) return
  try {
    state.agents = await api(`/api/agents/${encodeURIComponent(name)}`, 'DELETE')
    await loadApiKeys()
    renderAgentsList()
  } catch (err) {
    showToast(err.message)
  }
}

window.showApiKeyModal = function() {
  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <h3>Add Provider Key</h3>
          <p>Stored encrypted in the local key vault.</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">Close</button>
      </div>
      <form onsubmit="window.saveApiKey(event)">
        <div class="form-row">
          <div class="form-group">
            <label>Provider</label>
            <select class="input" name="provider">
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="zhipu">Zhipu</option>
            </select>
          </div>
          <div class="form-group">
            <label>Name</label>
            <input class="input" name="name" placeholder="Work key">
          </div>
        </div>
        <div class="form-group">
          <label>API Key</label>
          <input class="input" name="key" type="password" required autocomplete="new-password">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
    </div>
  `)
}

window.saveApiKey = async function(e) {
  e.preventDefault()
  const fd = new FormData(e.target)
  try {
    const key = await api('/api/keys', 'POST', {
      provider: fd.get('provider'),
      name: String(fd.get('name') || '').trim() || undefined,
      key: String(fd.get('key') || '').trim(),
    })
    state.apiKeys.unshift(key)
    closeModal()
    renderApiKeysList()
  } catch (err) {
    showToast(err.message)
  }
}

window.deleteApiKey = async function(id) {
  if (!await confirmAction({
    title: 'Delete API Key',
    message: 'Delete this API key?',
    confirmText: 'Delete',
    danger: true,
  })) return
  try {
    await api(`/api/keys/${encodeURIComponent(id)}`, 'DELETE')
    state.apiKeys = state.apiKeys.filter(key => key.id !== id)
    renderApiKeysList()
  } catch (err) {
    showToast(err.message)
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function showModal(html) {
  closeModal()
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.id = 'modal-overlay'
  overlay.innerHTML = html
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeModal()
  })
  document.body.appendChild(overlay)
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay')
  if (overlay) overlay.remove()
}

window.closeModal = closeModal

function confirmAction({ title, message, confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    window.__resolveConfirmAction = (value) => {
      closeModal()
      resolve(Boolean(value))
      delete window.__resolveConfirmAction
    }
    showModal(`
      <div class="modal-card confirm-modal">
        <div class="modal-head">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(message)}</p>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.__resolveConfirmAction(false)">Cancel</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" onclick="window.__resolveConfirmAction(true)">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `)
  })
}

function showToast(message, type = 'error') {
  const text = String(message || 'Something went wrong')
  let container = document.getElementById('toast-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'toast-container'
    document.body.appendChild(container)
  }
  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.textContent = text
  container.appendChild(toast)
  requestAnimationFrame(() => toast.classList.add('show'))
  setTimeout(() => {
    toast.classList.remove('show')
    setTimeout(() => toast.remove(), 250)
  }, 3000)
}

function buildContextFromForm(fd) {
  const rules = String(fd.get('contextRules') || '').trim()
  const text = String(fd.get('contextText') || '').trim()
  const filesRaw = String(fd.get('contextFiles') || '').trim()
  const files = filesRaw.split(/[\n,]/).map(item => item.trim()).filter(Boolean)
  const context = {}
  if (rules) context.rules = rules
  if (text) context.text = text
  if (files.length) context.files = files
  return Object.keys(context).length ? context : undefined
}

function renderMarkdown(content) {
  if (typeof marked === 'undefined') {
    return `<pre>${escapeHtml(content)}</pre>`
  }
  try {
    return `<div class="markdown-content">${sanitizeRenderedHtml(marked.parse(content), content)}</div>`
  } catch {
    return `<pre>${escapeHtml(content)}</pre>`
  }
}

function sanitizeRenderedHtml(html, fallbackText) {
  const template = document.createElement('template')
  template.innerHTML = html
  const blockedTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META'])
  let unsafeUrl = false

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
      if ((name === 'href' || name === 'src') && !isSafeUrl(value)) {
        unsafeUrl = true
        break
      }
      if (name === 'href') {
        node.setAttribute('target', '_blank')
        node.setAttribute('rel', 'noopener noreferrer nofollow')
      }
    }
    if (unsafeUrl) break
  }

  return unsafeUrl ? `<pre>${escapeHtml(fallbackText)}</pre>` : template.innerHTML
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
    input.remove()
    return ok
  }
}

function buildSessionExport(session, messages) {
  const lines = [
    `# ${agentLabel(session.from)} -> ${agentLabel(session.to)}`,
    '',
    `- Session ID: ${session.id}`,
    `- Status: ${session.status}`,
    `- Mode: ${session.mode}`,
    `- Turns: ${session.currentRound}/${session.maxRounds}`,
    `- Exported At: ${new Date().toLocaleString()}`,
    '',
  ]

  let lastRound = null
  for (const msg of messages) {
    if (msg.round !== lastRound) {
      lines.push(`## Turn ${msg.round}`, '')
      lastRound = msg.round
    }
    lines.push(`### ${msg.from === 'human' ? 'you' : msg.from} · ${new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, '')
    lines.push(msg.content || '_empty_', '')
  }
  return lines.join('\n')
}

function agentLabel(agent) {
  return agent?.label || agent?.adapter || ''
}

function compactObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== ''))
}

function envToLines(env) {
  return Object.entries(env || {}).map(([key, value]) => `${key}=${value}`).join('\n')
}

function parseEnvLines(value) {
  const env = {}
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const index = trimmed.indexOf('=')
    if (index <= 0) continue
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
  }
  return Object.keys(env).length ? env : undefined
}

function adapterOption(value, selected) {
  return `<option value="${escapeAttr(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(value)}</option>`
}

function modelOptions(adapter, selected) {
  const options = MODEL_OPTIONS_BY_ADAPTER[adapter] || []
  const selectedValue = selected ?? ''
  const known = options.some(option => option.value === selectedValue)
  const current = selectedValue && !known
    ? `<option value="${escapeAttr(selectedValue)}" selected>${escapeHtml(selectedValue)} · current</option>`
    : ''
  return current + options
    .map(option => `<option value="${escapeAttr(option.value)}" ${option.value === selectedValue ? 'selected' : ''}>${escapeHtml(option.label)}</option>`)
    .join('')
}

function defaultModelForAdapter(adapter) {
  return (MODEL_OPTIONS_BY_ADAPTER[adapter] || [])[0]?.value || ''
}

function agentKeyOptions(adapter, hasCurrentKey) {
  const defaultOption = hasCurrentKey
    ? '<option value="">Keep current key</option>'
    : '<option value="">Select a saved Provider Key</option>'
  return defaultOption + providerKeyOptionsForAdapter(adapter)
}

function providerKeyOptionsForAdapter(adapter) {
  return state.apiKeys
    .filter(key => !key.readOnly && providerMatchesAdapter(key.provider, adapter))
    .map(key => `<option value="${escapeAttr(key.id)}">${escapeHtml(key.name)} · ${escapeHtml(providerLabel(key.provider))} · ${escapeHtml(key.maskedKey)}</option>`)
    .join('')
}

window.updateAgentModelOptions = function() {
  const adapterSelect = document.getElementById('agent-adapter-select')
  const modelSelect = document.getElementById('agent-model-select')
  const keySelect = document.getElementById('agent-key-select')
  const adapter = adapterSelect?.value || 'anthropic-api'
  if (modelSelect) modelSelect.innerHTML = modelOptions(adapter, defaultModelForAdapter(adapter))
  if (keySelect) {
    const canKeepCurrentKey = keySelect.dataset.hasCurrentKey === 'true' && adapter === keySelect.dataset.originalAdapter
    keySelect.innerHTML = agentKeyOptions(adapter, canKeepCurrentKey)
  }
}

function providerMatchesAdapter(provider, adapter) {
  if (adapter === 'anthropic-api') return provider === 'anthropic'
  if (adapter === 'openai-api' || adapter === 'custom-api') return provider === 'openai'
  if (adapter === 'zhipu-api') return provider === 'zhipu'
  return true
}

function keySourceLabel(source) {
  return ({ vault: 'saved key', assistant: 'agent key', global: 'global config' })[source] || source
}

function preferredAgentName(agents, preferredAdapter, avoidName) {
  if (!agents.length) return ''
  const preferred = preferredAdapter ? agents.find(agent => agent.adapter === preferredAdapter && agent.name !== avoidName) : null
  if (preferred) return preferred.name
  const firstDifferent = agents.find(agent => agent.name !== avoidName)
  return (firstDifferent || agents[0]).name
}

function providerIcon(provider) {
  return ({ anthropic: 'A', openai: 'O', zhipu: 'Z' })[provider] || '?'
}

function providerLabel(provider) {
  return ({ anthropic: 'Anthropic', openai: 'OpenAI', zhipu: 'Zhipu' })[provider] || provider
}

function initialsFromEmail(email) {
  const name = String(email).split('@')[0] || 'U'
  return name.split(/[._-]/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U'
}

function jsString(value) {
  return JSON.stringify(String(value))
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;')
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str == null ? '' : String(str)
  return div.innerHTML
}

function formatTime(timestamp) {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (hours < 24) return `${hours} hr ago`
  return `${days} day${days > 1 ? 's' : ''} ago`
}

// ── Init ──────────────────────────────────────────────────────────────────────
window.toggleTheme = toggleTheme
window.navigate = navigate
window.toggleUserMenu = function() {
  document.getElementById('user-menu-popover')?.classList.toggle('open')
}
window.logout = function() {
  clearAuthToken()
  navigate('/login')
}

document.addEventListener('click', event => {
  if (!event.target.closest?.('.user-menu')) {
    document.getElementById('user-menu-popover')?.classList.remove('open')
  }
})

document.addEventListener('DOMContentLoaded', () => {
  initTheme()
  render()

  if (getAuthToken()) {
    connectWs()
  }
})
