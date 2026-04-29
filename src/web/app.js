// Turing Cloud — SPA Application
// Complete rewrite based on new UI design

const API = ''  // same origin
const AUTH_TOKEN_KEY = 'turing-jwt'
const THEME_KEY = 'turing-theme'

// ── Global State ──────────────────────────────────────────────────────────────
const state = {
  user: null,
  sessions: [],
  agents: [],
  templates: [],
  apiKeys: [],
  stats: null,
  config: null,
  currentView: 'sessions',
  currentSessionId: null,
  currentSession: null,
  currentMessages: [],
  currentSnapshots: [],
  ws: null,
  heartbeats: new Map(),
  streamDeltas: new Map(),
  streamFrame: null,
}

// ── Router ────────────────────────────────────────────────────────────────────
const routes = {
  '/': 'landing',
  '/sessions': 'sessions',
  '/session/:id': 'session',
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
    case 'message:delta':
      handleMessageDelta(event.payload)
      break
    case 'message:new':
      if (state.currentSessionId === event.payload.sessionId) {
        clearStreamingDelta(event.payload.sessionId)
        upsertCurrentMessage(event.payload)
        renderSessionMessages()
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
  scheduleStreamingRender()
}

function scheduleStreamingRender() {
  if (state.streamFrame) return
  state.streamFrame = requestAnimationFrame(() => {
    state.streamFrame = null
    renderStreamingDelta()
  })
}

function renderStreamingDelta() {
  const stream = state.streamDeltas.get(state.currentSessionId)
  if (!stream) return
  const container = document.getElementById('messages')
  if (!container) return

  let node = document.getElementById('streaming-message')
  if (!node) {
    if (state.currentMessages.length === 0) container.innerHTML = ''
    node = document.createElement('div')
    node.id = 'streaming-message'
    node.className = 'chat-msg from streaming'
    node.innerHTML = `
      <div class="chat-avatar">${escapeHtml((stream.from || 'A').charAt(0).toUpperCase())}</div>
      <div>
        <div class="chat-bubble"><span class="stream-content"></span><span class="stream-cursor"></span></div>
        <div class="chat-meta"><span>${escapeHtml(stream.from)} · typing</span></div>
      </div>
    `
    container.appendChild(node)
  }

  const content = node.querySelector('.stream-content')
  const meta = node.querySelector('.chat-meta span')
  const avatar = node.querySelector('.chat-avatar')
  if (content) content.textContent = stream.content
  if (meta) meta.textContent = `${stream.from} · typing`
  if (avatar) avatar.textContent = (stream.from || 'A').charAt(0).toUpperCase()

  const messagesContainer = document.getElementById('messages-container')
  if (messagesContainer) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }
}

function clearStreamingDelta(sessionId) {
  state.streamDeltas.delete(sessionId)
  const node = document.getElementById('streaming-message')
  if (node) node.remove()
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
    clearStreamingDelta(id)
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

        <div class="tabs" style="margin-bottom: 24px;">
          <button class="tab-btn active" onclick="window.switchAuthTab('login')">Login</button>
          <button class="tab-btn" onclick="window.switchAuthTab('register')">Register</button>
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

        <form id="register-form" class="tab-panel" onsubmit="window.handleRegister(event)">
          <div class="form-group">
            <label>Email</label>
            <input type="email" class="input" name="email" required autocomplete="email">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" class="input" name="password" required minlength="8" autocomplete="new-password">
          </div>
          <div class="form-group">
            <label>Confirm Password</label>
            <input type="password" class="input" name="confirmPassword" required minlength="8" autocomplete="new-password">
          </div>
          <button type="submit" class="btn btn-primary" style="width: 100%; justify-content: center;">
            Create Account
          </button>
        </form>
      </div>
    </div>
  `
  updateThemeButton()
}

window.switchAuthTab = function(tab) {
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'))
  })
  document.querySelectorAll('.tab-panel').forEach((panel, i) => {
    panel.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'))
  })
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

window.handleRegister = async function(e) {
  e.preventDefault()
  const form = e.target
  const fd = new FormData(form)
  const email = fd.get('email')
  const password = fd.get('password')
  const confirmPassword = fd.get('confirmPassword')

  if (password !== confirmPassword) {
    showToast('Passwords do not match')
    return
  }

  try {
    const data = await api('/api/auth/register', 'POST', { email, password })
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
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="logo-icon">T</div>
          <span>Turing Cloud</span>
        </div>
        <nav class="sidebar-nav">
          <a href="/sessions" class="active">
            <span class="nav-icon">◉</span> Sessions
          </a>
          <a href="/settings">
            <span class="nav-icon">⚙</span> Settings
          </a>
        </nav>
        <div class="sidebar-footer">
          Turing Cloud v0.1.0
        </div>
      </aside>

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

function formatStatNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0'
  if (Number.isInteger(number)) return String(number)
  return number.toFixed(1)
}

async function renderSession(id) {
  state.currentSessionId = id

  // Load session data
  let session = null
  try {
    session = await api(`/api/sessions/${id}`)
  } catch (err) {
    document.body.innerHTML = '<div>Session not found</div>'
    return
  }
  state.currentSession = session

  document.body.innerHTML = `
    <div class="app-layout">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="logo-icon">T</div>
          <span>Turing Cloud</span>
        </div>
        <nav class="sidebar-nav">
          <a href="/sessions">
            <span class="nav-icon">◉</span> Sessions
          </a>
          <a href="/settings">
            <span class="nav-icon">⚙</span> Settings
          </a>
        </nav>
        <div class="sidebar-footer">
          Turing Cloud v0.1.0
        </div>
      </aside>

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
            <div class="session-chat-messages" id="messages-container">
              <div class="chat-stream" id="messages"></div>
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
  renderSessionPanel(session)
  updateThemeButton()
}

function renderSessionActions(session) {
  return `
    <button class="btn btn-secondary btn-sm" onclick="window.exportCurrentSession()">Export</button>
    ${session.status === 'active' ? '<button class="btn btn-secondary btn-sm" onclick="window.extendSessionTimeout()">+5m</button>' : ''}
    ${session.status === 'active' ? '<button class="btn btn-secondary btn-sm" onclick="window.pauseSession()">⏸ Pause</button>' : ''}
    ${session.status === 'paused' ? '<button class="btn btn-primary btn-sm" onclick="window.resumeSession()">▶ Resume</button>' : ''}
    ${session.status !== 'done' ? '<button class="btn btn-danger btn-sm" onclick="window.stopSession()">■ Stop</button>' : ''}
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

function renderSessionMessages() {
  const container = document.getElementById('messages')
  if (!container) return

  if (state.currentMessages.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px;">No messages yet</p>'
    return
  }

  container.innerHTML = state.currentMessages.map(msg => {
    const isFrom = msg.from !== 'human'
    const avatar = isFrom ? (msg.from.charAt(0).toUpperCase()) : 'H'
    return `
      <div class="chat-msg ${isFrom ? 'from' : 'to'}">
        <div class="chat-avatar">${avatar}</div>
        <div>
          <div class="chat-bubble">${renderMarkdown(msg.content)}</div>
          <div class="chat-meta">
            <span>${escapeHtml(msg.from)} · Turn ${msg.round} · ${new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          <button class="msg-copy-btn" onclick='window.copyMessage(${jsString(msg.id)})' title="Copy">Copy</button>
          </div>
        </div>
      </div>
    `
  }).join('')

  renderStreamingDelta()

  // Scroll to bottom
  const messagesContainer = document.getElementById('messages-container')
  if (messagesContainer) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }
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

  document.body.innerHTML = `
    <div class="app-layout">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="logo-icon">T</div>
          <span>Turing Cloud</span>
        </div>
        <nav class="sidebar-nav">
          <a href="/sessions">
            <span class="nav-icon">◉</span> Sessions
          </a>
          <a href="/settings" class="active">
            <span class="nav-icon">⚙</span> Settings
          </a>
        </nav>
        <div class="sidebar-footer">
          Turing Cloud v0.1.0
        </div>
      </aside>

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
              <button class="tab-btn active" onclick="window.switchSettingsTab('agents')">Agents</button>
              <button class="tab-btn" onclick="window.switchSettingsTab('apikeys')">Provider Keys</button>
              <button class="tab-btn" onclick="window.switchSettingsTab('general')">General</button>
            </div>

            <div id="tab-agents" class="tab-panel active">
              <div class="flex-between mb-24">
                <div>
                  <h3>Configured Agents</h3>
                  <p style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px;">Manage your AI model connections</p>
                </div>
                <button class="btn btn-primary btn-sm" onclick="window.showAgentModal()">+ Add Agent</button>
              </div>

              <div class="agent-list" id="agents-list"></div>
            </div>

            <div id="tab-apikeys" class="tab-panel">
              <div class="flex-between mb-24">
                <div>
                  <h3>Provider Keys</h3>
                  <p style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px;">Manage keys used by agents and sessions</p>
                </div>
                <button class="btn btn-primary btn-sm" onclick="window.showApiKeyModal()">+ Add Key</button>
              </div>
              <div class="agent-list" id="api-keys-list"></div>
            </div>

            <div id="tab-general" class="tab-panel">
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
  updateThemeButton()
}

function renderAgentsList() {
  const container = document.getElementById('agents-list')
  if (!container) return

  if (state.agents.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px;">No agents configured</p>'
    return
  }

  container.innerHTML = state.agents.map(agent => {
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

window.switchSettingsTab = function(tab) {
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    const tabs = ['agents', 'apikeys', 'general']
    btn.classList.toggle('active', tabs[i] === tab)
  })
  document.querySelectorAll('.tab-panel').forEach((panel, i) => {
    const tabs = ['agents', 'apikeys', 'general']
    panel.classList.toggle('active', tabs[i] === tab)
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
      <span>No agents configured yet.</span>
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
          <p>Create an agent collaboration session.</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">Close</button>
      </div>
      ${templateBadge}
      ${noAgents ? `
        <div class="template-empty-agents" style="margin-bottom: 20px;">
          <span>No agents configured yet.</span>
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

window.showAgentModal = async function(name) {
  if (!state.apiKeys.length) await loadApiKeys()
  const existing = state.agents.find(agent => agent.name === name)
  const keyOptions = providerKeyOptions(existing)
  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <h3>${existing ? 'Edit Agent' : 'Add Agent'}</h3>
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
            <select class="input" name="adapter" required>
              ${adapterOption('anthropic-api', existing?.adapter)}
              ${adapterOption('openai-api', existing?.adapter)}
              ${adapterOption('zhipu-api', existing?.adapter)}
              ${adapterOption('custom-api', existing?.adapter)}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Model</label>
          <input class="input" name="model" value="${escapeAttr(existing?.model || '')}" placeholder="claude-sonnet-4-20250514">
        </div>
        <div class="form-group">
          <label>Base URL</label>
          <input class="input" name="baseUrl" value="${escapeAttr(existing?.baseUrl || '')}" placeholder="Optional">
        </div>
        <div class="form-group">
          <label>Provider Key</label>
          <select class="input" name="keyId">
            ${existing?.hasKey ? '<option value="">Keep current key</option>' : '<option value="">Paste a new key below</option>'}
            ${keyOptions}
          </select>
        </div>
        <div class="form-group">
          <label>New API Key ${existing?.hasKey ? '(optional replacement)' : '(optional)'}</label>
          <input class="input" name="apiKey" type="password" autocomplete="new-password" placeholder="Paste only when adding or rotating a key">
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
    apiKey: String(fd.get('apiKey') || '').trim() || undefined,
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
    title: 'Delete Agent',
    message: `Delete agent "${name}"?`,
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

function adapterOption(value, selected) {
  return `<option value="${escapeAttr(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(value)}</option>`
}

function providerKeyOptions(existing) {
  return state.apiKeys
    .filter(key => !key.readOnly && (!existing || providerMatchesAdapter(key.provider, existing.adapter)))
    .map(key => `<option value="${escapeAttr(key.id)}">${escapeHtml(key.name)} · ${escapeHtml(providerLabel(key.provider))} · ${escapeHtml(key.maskedKey)}</option>`)
    .join('')
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
