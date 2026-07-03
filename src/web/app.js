// Turing Cloud — SPA Application
// Complete rewrite based on new UI design

const API = ''  // same origin
const AUTH_TOKEN_KEY = 'turing-jwt'
const THEME_KEY = 'turing-theme'

const PROVIDER_PRESETS = {
  anthropic: {
    label: 'Anthropic',
    adapter: 'anthropic-api',
    baseUrl: '',
    models: [
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 snapshot' },
    ],
  },
  openai: {
    label: 'OpenAI',
    adapter: 'openai-api',
    baseUrl: '',
    models: [
    { value: 'gpt-5.5', label: 'GPT-5.5' },
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
    { value: 'gpt-5.4-nano', label: 'GPT-5.4 nano' },
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    ],
  },
  deepseek: {
    label: 'DeepSeek',
    adapter: 'deepseek-api',
    baseUrl: '',
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek Chat' },
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
    ],
  },
  qwen: {
    label: 'Qwen (DashScope)',
    adapter: 'qwen-api',
    baseUrl: '',
    models: [
      { value: 'qwen-plus', label: 'Qwen Plus' },
      { value: 'qwen-max', label: 'Qwen Max' },
      { value: 'qwen-turbo', label: 'Qwen Turbo' },
      { value: 'qwen-long', label: 'Qwen Long' },
    ],
  },
  moonshot: {
    label: 'Moonshot (Kimi)',
    adapter: 'moonshot-api',
    baseUrl: '',
    models: [
      { value: 'moonshot-v1-32k', label: 'Moonshot v1 32k' },
      { value: 'moonshot-v1-128k', label: 'Moonshot v1 128k' },
      { value: 'kimi-k2', label: 'Kimi K2' },
    ],
  },
  zhipu: {
    label: 'Zhipu',
    adapter: 'zhipu-api',
    baseUrl: '',
    models: [
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
  },
  custom: {
    label: 'Custom OpenAI-compatible',
    adapter: 'custom-api',
    baseUrl: '',
    models: [
    { value: '', label: 'Provider default' },
    { value: 'gpt-5.5', label: 'GPT-5.5 compatible' },
    { value: 'gpt-5.4', label: 'GPT-5.4 compatible' },
    { value: 'gpt-4.1', label: 'GPT-4.1 compatible' },
    ],
  },
}

// ── Global State ──────────────────────────────────────────────────────────────
const state = {
  user: null,
  sessions: [],
  tasks: [],
  pipelines: [],
  agents: [],
  templates: [],
  pipelineTemplates: [],
  apiKeys: [],
  apiDocs: null,
  deployCheck: null,
  stats: null,
  config: null,
  currentView: 'sessions',
  currentSessionId: null,
  currentSession: null,
  currentTaskId: null,
  currentTask: null,
  currentPipelineId: null,
  currentPipeline: null,
  expandedWorkflowStep: null,
  liveReviewStep: null,
  liveReviewDrafts: new Map(),
  liveReviewPending: new Set(),
  liveReviewArtifacts: new Map(),
  liveReviewArtifactLoading: new Set(),
  workflowSpeechRecognition: null,
  workflowSpeechSessionId: null,
  currentMessages: [],
  currentSnapshots: [],
  ws: null,
  heartbeats: new Map(),
  streamDeltas: new Map(),
  streamRaw: new Map(),
  streamSteps: new Map(),
  streamStatus: new Map(),
  workflowFileAliases: new Map(),
  workflowNestedFiles: new Map(),
  workflowFileResolution: new Map(),
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
  '/tasks': 'tasks',
  '/task/:id': 'task',
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
  // Authenticated local users skip the marketing landing page and go straight
  // to their sessions, where the onboarding panel guides first-time setup.
  if ((path === '/' || path === '/landing') && getValidAuthToken()) {
    return navigate('/sessions')
  }
  if (path === '/' || path === '/landing') {
    renderLanding()
  } else if (path === '/login') {
    renderLogin()
  } else if (path === '/sessions') {
    renderSessions()
  } else if (path.startsWith('/session/')) {
    const id = path.split('/')[2]
    renderSession(id)
  } else if (path === '/tasks') {
    renderTasks()
  } else if (path.startsWith('/task/')) {
    const id = path.split('/')[2]
    renderTask(id)
  } else if (path === '/workflows') {
    renderWorkflows()
  } else if (path.startsWith('/workflow/') || path.startsWith('/workflows/')) {
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
        <a href="/tasks" class="${active === 'tasks' ? 'active' : ''}">
          <span class="nav-icon">▣</span> Tasks
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
    case 'task:created':
    case 'task:updated':
    case 'task:error':
    case 'task:done':
      applyTaskUpdate(event.payload)
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
      if (event.payload.from !== 'human') {
        state.liveReviewPending.delete(event.payload.sessionId)
        state.streamDeltas.delete(event.payload.sessionId)
      }
      if (state.currentSessionId === event.payload.sessionId) {
        clearStreamingDelta(event.payload.sessionId)
        setStreamStatus(event.payload.sessionId, '已完成本轮输出')
        upsertCurrentMessage(event.payload)
        renderSessionMessages()
        renderSessionPanel(state.currentSession)
      }
      {
        const workflowDetail = findCurrentWorkflowSessionDetail(event.payload.sessionId)
        if (workflowDetail) {
          workflowDetail.messages = workflowDetail.messages || []
          const index = workflowDetail.messages.findIndex(message => message.id === event.payload.id)
          if (index >= 0) {
            workflowDetail.messages[index] = event.payload
          } else {
            workflowDetail.messages.push(event.payload)
          }
          renderWorkflowSteps(state.currentPipeline)
          renderWorkflowTimeline(state.currentPipeline)
        }
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

  const workflowDetail = findCurrentWorkflowSessionDetail(session.id)
  if (workflowDetail) {
    Object.assign(workflowDetail, session)
    renderWorkflowSteps(state.currentPipeline)
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
    state.workflowFileAliases = new Map()
    state.workflowNestedFiles = new Map()
    state.workflowFileResolution = new Map()
    renderWorkflowHeader(state.currentPipeline)
    renderWorkflowSteps(state.currentPipeline)
    renderWorkflowTimeline(state.currentPipeline)
    hydrateWorkflowFileReferences(state.currentPipeline)
  }

  renderPipelineCards()
}

function applyTaskUpdate(task) {
  if (!task?.id) return
  const index = state.tasks.findIndex(item => item.id === task.id)
  if (index >= 0) {
    state.tasks[index] = { ...state.tasks[index], ...task }
  } else {
    state.tasks.unshift(task)
  }

  if (state.currentTaskId === task.id) {
    state.currentTask = { ...(state.currentTask || {}), ...task }
    renderTaskHeader(state.currentTask)
    renderTaskContent(state.currentTask)
  }

  renderTaskStats()
  renderTaskCards()
}

function removeSessionFromList(id) {
  if (!id) return
  state.sessions = state.sessions.filter(session => session.id !== id)
  renderSessionStats()
  renderSessionCards()
}

function handleMessageDelta(payload) {
  if (!payload?.sessionId || !payload.content) return

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
  if (state.currentSessionId === payload.sessionId) scheduleStreamingRender()
  if (isCurrentWorkflowSession(payload.sessionId)) {
    if (state.liveReviewStep === payload.sessionId) {
      updateWorkflowLiveReviewStream(payload.sessionId)
    } else {
      renderWorkflowSteps(state.currentPipeline)
    }
  }
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
  if (isCurrentWorkflowSession(payload.sessionId)) {
    if (state.liveReviewStep === payload.sessionId) {
      updateWorkflowLiveReviewStream(payload.sessionId)
    } else {
      renderWorkflowSteps(state.currentPipeline)
    }
  }
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
  if (isCurrentWorkflowSession(hb.sessionId)) {
    setStreamStatus(hb.sessionId, summarizeRawStatus(hb.lastOutput || '运行中...'))
    if (state.liveReviewStep === hb.sessionId) {
      updateWorkflowLiveReviewStream(hb.sessionId)
    } else {
      renderWorkflowSteps(state.currentPipeline)
    }
  }
}

function isCurrentWorkflowSession(sessionId) {
  return Boolean(state.currentPipeline?.sessions?.some(step => step.sessionId === sessionId))
}

function findCurrentWorkflowSessionDetail(sessionId) {
  return state.currentPipeline?.sessionDetails?.find(session => session.id === sessionId)
}

// ── Data Loading ──────────────────────────────────────────────────────────────
async function loadSessions() {
  try {
    state.sessions = await api('/api/sessions?limit=60')
  } catch (err) {
    console.error('Failed to load sessions:', err)
  }
}

async function loadTasks() {
  try {
    state.tasks = await api('/api/tasks')
  } catch (err) {
    console.error('Failed to load tasks:', err)
    state.tasks = []
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

async function loadPipelineTemplates() {
  try {
    state.pipelineTemplates = await api('/api/pipeline-templates')
  } catch (err) {
    console.error('Failed to load pipeline templates:', err)
    state.pipelineTemplates = []
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

async function loadApiDocs() {
  try {
    state.apiDocs = await api('/api/docs')
  } catch (err) {
    console.error('Failed to load API docs:', err)
    state.apiDocs = null
  }
}

async function loadDeployCheck() {
  try {
    state.deployCheck = await api('/api/deploy/check')
  } catch (err) {
    console.error('Failed to load deploy check:', err)
    state.deployCheck = null
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
  setTimeout(() => {
    if (!getValidAuthToken() && typeof window.handleLocalLogin === 'function') {
      window.handleLocalLogin()
    }
  }, 0)
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
  state.currentTaskId = null
  state.currentTask = null
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

function renderTasks() {
  state.currentSessionId = null
  state.currentSession = null
  state.currentTaskId = null
  state.currentTask = null
  state.currentPipelineId = null
  state.currentPipeline = null
  document.body.innerHTML = `
    <div class="app-layout">
      ${renderSidebar('tasks')}

      <div class="main">
        <header class="topbar">
          <div class="topbar-left">
            <h2>Tasks</h2>
          </div>
          <div class="topbar-right">
            <button class="btn btn-primary btn-sm" onclick="window.showNewTaskModal()">+ New Task</button>
            <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
            ${renderUserMenu()}
          </div>
        </header>

        <div class="content">
          <div class="stats-row">
            <div class="stat-card">
              <div class="label">Running Tasks</div>
              <div class="stat-value grad-text" id="task-stat-running">0</div>
              <div class="stat-sub">running right now</div>
            </div>
            <div class="stat-card">
              <div class="label">Queued</div>
              <div class="stat-value" id="task-stat-queued">0</div>
              <div class="stat-sub">waiting to start</div>
            </div>
            <div class="stat-card">
              <div class="label">Completed</div>
              <div class="stat-value" id="task-stat-done">0</div>
              <div class="stat-sub">lead-agent tasks</div>
            </div>
            <div class="stat-card">
              <div class="label">Failed</div>
              <div class="stat-value" id="task-stat-error">0</div>
              <div class="stat-sub">need attention</div>
            </div>
          </div>

          <div class="flex-between mb-24">
            <h3>Recent Tasks</h3>
          </div>
          <div id="task-cards" class="session-cards task-cards"></div>
        </div>
      </div>
    </div>
  `

  updateThemeButton()
  loadTasksData()
}

async function loadTasksData() {
  await Promise.all([
    loadTasks(),
    loadAgents(),
  ])
  renderTaskStats()
  renderTaskCards()
}

function renderTaskStats() {
  const running = document.getElementById('task-stat-running')
  const queued = document.getElementById('task-stat-queued')
  const done = document.getElementById('task-stat-done')
  const error = document.getElementById('task-stat-error')
  if (running) running.textContent = state.tasks.filter(task => task.status === 'running').length
  if (queued) queued.textContent = state.tasks.filter(task => task.status === 'queued').length
  if (done) done.textContent = state.tasks.filter(task => task.status === 'done').length
  if (error) error.textContent = state.tasks.filter(task => task.status === 'error').length
}

function renderTaskCards() {
  const container = document.getElementById('task-cards')
  if (!container) return
  if (state.tasks.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px;">No tasks yet. Create your first one!</p>'
    return
  }
  container.innerHTML = state.tasks.map(task => `
    <a href="/task/${task.id}" class="card session-card task-card">
      <div class="session-card-header">
        <span class="session-card-title">${escapeHtml(taskTitle(task))}</span>
        <span class="badge ${taskBadgeClass(task.status)}">${escapeHtml(task.status)}</span>
      </div>
      <div class="task-card-agent">${escapeHtml(agentLabel(task.agent))}</div>
      <div class="task-card-prompt">${escapeHtml(taskSubtitle(task))}</div>
      <div class="session-card-meta">
        <span>⏱ ${formatTime(task.updatedAt)}</span>
        ${task.cwd ? `<span>⌂ ${escapeHtml(task.cwd)}</span>` : ''}
      </div>
    </a>
  `).join('')
}

async function loadSessionsData() {
  await Promise.all([
    loadSessions(),
    loadAgents(),
    loadStats()
  ])

  state.sessionsLoaded = true
  renderSessionStats()
  renderSessionCards()
}

function renderSessionStats() {
  const statActive = document.getElementById('stat-active')
  const statDone = document.getElementById('stat-done')
  const statRounds = document.getElementById('stat-rounds')
  const statAgents = document.getElementById('stat-agents')
  const sessionStats = state.stats?.sessions || {}
  const active = Number(sessionStats.active) || 0
  const doneToday = Number(sessionStats.completedToday) || 0
  const avgRounds = Number(sessionStats.avgRounds) || 0
  const readyAgents = (state.agents || []).filter(agent => agent.status === 'ready').length

  if (statActive) statActive.textContent = active
  if (statDone) statDone.textContent = doneToday
  if (statRounds) statRounds.textContent = formatStatNumber(avgRounds)
  if (statAgents) statAgents.textContent = readyAgents
}

/**
 * First-run onboarding. Shown in place of the empty sessions list. Adapts to the
 * agent landscape so a new user always has an obvious next step:
 *   - no agents at all       → "connect a model" (API key or CLI)
 *   - agents but none ready  → "verify your agents" (run diagnostics)
 *   - at least one ready     → "you're all set, start a session"
 * No backend endpoint is needed — it derives state from the existing /api/agents
 * status field (ready / unverified / discovered / invalid / no_key).
 */
function renderOnboardingPanel() {
  const agents = state.agents || []
  const ready = agents.filter((a) => a.status === 'ready')
  const present = agents.filter((a) => a.status !== 'invalid')
  const apiAgents = present.filter((a) => a.kind === 'api')
  const cliAgents = present.filter((a) => a.kind === 'local')

  if (ready.length > 0) {
    return `
      <div class="onboarding-panel">
        <div class="onboarding-icon">✓</div>
        <h3>一切就绪</h3>
        <p>已有 <strong>${ready.length}</strong> 个可用的 Agent。开始你的第一个会话吧。</p>
        <div class="onboarding-actions">
          <button class="btn btn-primary" onclick="window.showTemplateGalleryModal()">新建会话</button>
          <a class="btn btn-ghost" href="/settings">管理 Agent</a>
        </div>
      </div>
    `
  }

  if (present.length === 0) {
    return `
      <div class="onboarding-panel">
        <div class="onboarding-icon">→</div>
        <h3>欢迎使用 Turing</h3>
        <p>开始前需要先连接一个 AI 模型。下面两条路任选其一：</p>
        <div class="onboarding-tiles">
          <div class="onboarding-tile">
            <div class="onboarding-tile-icon">🔑</div>
            <h4>用 API 模型（最快）</h4>
            <p>填一个 Provider Key 即可，无需安装任何东西。支持 Anthropic、OpenAI、智谱、DeepSeek、Qwen、Moonshot。</p>
            <button class="btn btn-primary btn-sm" onclick="window.navigate('/settings')">添加 API Key</button>
          </div>
          <div class="onboarding-tile">
            <div class="onboarding-tile-icon">⌨️</div>
            <h4>用本地 CLI Agent</h4>
            <p>已装好 Codex / Claude Code / Gemini CLI / OpenCode？确认它们在 PATH 里，系统会自动发现。</p>
            <a class="btn btn-secondary btn-sm" href="/settings">查看已发现的 Agent</a>
          </div>
        </div>
        <p class="onboarding-hint">在 Settings 页可以随时增删 Agent 和 Key。</p>
      </div>
    `
  }

  // Agents exist but none verified-ready.
  const unverified = present.filter((a) => a.status === 'unverified' || a.status === 'discovered')
  const unverifiedList = unverified.length
    ? unverified.map((a) => `<li><span class="onboarding-agent-name">${escapeHtml(a.name)}</span><span class="onboarding-agent-status onboarding-agent-status--${a.status}">${statusLabel(a.status)}</span></li>`).join('')
    : ''
  return `
    <div class="onboarding-panel">
      <div class="onboarding-icon">!</div>
      <h3>Agent 尚未验证可用</h3>
      <p>检测到 <strong>${apiAgents.length}</strong> 个 API Agent、<strong>${cliAgents.length}</strong> 个 CLI Agent，但没有一个确认能调通模型。</p>
      ${unverifiedList ? `<ul class="onboarding-agent-list">${unverifiedList}</ul>` : ''}
      <p class="onboarding-hint">常见原因：未登录、凭证失效、订阅过期或二进制路径不对。重新检测或去 Settings 检查配置。</p>
      <div class="onboarding-actions">
        <button class="btn btn-primary" onclick="window.refreshAgentsAndRender()">重新检测</button>
        <a class="btn btn-ghost" href="/settings">去 Settings 检查</a>
      </div>
    </div>
  `
}

function statusLabel(status) {
  switch (status) {
    case 'ready': return '可用'
    case 'unverified': return '未验证'
    case 'discovered': return '已发现'
    case 'no_key': return '缺 Key'
    case 'invalid': return '不可用'
    default: return status
  }
}

/**
 * Map an agent status to a badge color class. `unverified` (installed but not
 * confirmed callable — e.g. a lapsed subscription) is a warning, NOT an error:
 * the binary is there, it just hasn't passed a smoke test. Only `invalid`
 * (broken / misconfigured) is red.
 */
function statusBadgeClass(status) {
  switch (status) {
    case 'ready': return 'active'
    case 'unverified':
    case 'discovered':
    case 'no_key': return 'paused'
    default: return 'error'
  }
}

window.refreshAgentsAndRender = async function () {
  try {
    state.agents = await api('/api/agents?refresh=1')
  } catch (err) {
    console.error('refresh failed', err)
  }
  render()
}

function renderSessionCards() {
  const container = document.getElementById('session-cards')
  if (!container) return

  if (state.sessions.length === 0) {
    // Distinguish "still loading" from "genuinely empty". Only show the
    // onboarding panel once we've actually fetched the (empty) list — otherwise
    // users with existing sessions see a flash of onboarding on every load.
    container.innerHTML = state.sessionsLoaded
      ? renderOnboardingPanel()
      : '<p style="color: var(--text-muted); text-align: center; padding: 40px;">加载中…</p>'
    return
  }

  container.innerHTML = state.sessions.map(session => `
    <a href="/session/${session.id}" class="card session-card">
      <div class="session-card-header">
        <span class="session-card-title">${escapeHtml(sessionTitle(session))}</span>
        <span class="badge badge-${session.status}">${session.status}</span>
      </div>
      <div class="session-card-route">
        <span>${escapeHtml(session.mode || 'session')}</span>
        ${session.cwd ? `<span class="route-arrow">·</span><span>${escapeHtml(session.cwd)}</span>` : ''}
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
  state.currentTaskId = null
  state.currentTask = null
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

async function renderTask(id) {
  state.currentSessionId = null
  state.currentSession = null
  state.currentTaskId = id
  state.currentPipelineId = null
  state.currentPipeline = null

  let task = null
  try {
    task = await api(`/api/tasks/${id}`)
  } catch {
    document.body.innerHTML = '<div>Task not found</div>'
    return
  }
  state.currentTask = task

  document.body.innerHTML = `
    <div class="app-layout">
      ${renderSidebar('tasks')}

      <div class="main">
        <header class="topbar">
          <div class="topbar-left">
            <a href="/tasks" class="btn btn-ghost btn-sm">← Back</a>
            <h2>${escapeHtml(taskTitle(task))}</h2>
            <span id="task-status-badge" class="badge ${taskBadgeClass(task.status)}">${escapeHtml(task.status)}</span>
          </div>
          <div class="topbar-right" id="task-actions">
            ${renderTaskActions(task)}
            <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
            ${renderUserMenu()}
          </div>
        </header>

        <div class="content task-detail" id="task-content"></div>
      </div>
    </div>
  `

  renderTaskContent(task)
  updateThemeButton()
}

function renderTaskActions(task) {
  if (task.status === 'queued' || task.status === 'running') {
    return '<button class="btn btn-danger btn-sm" onclick="window.stopCurrentTask()">■ Stop</button>'
  }
  return `<button class="btn btn-primary btn-sm" onclick="window.showTaskFeedbackModal()">✎ Feedback & Rerun</button>`
}

function renderTaskHeader(task) {
  const badge = document.getElementById('task-status-badge')
  if (badge) {
    badge.className = `badge ${taskBadgeClass(task.status)}`
    badge.textContent = task.status
  }
  const actions = document.getElementById('task-actions')
  if (actions) {
    actions.innerHTML = `
      ${renderTaskActions(task)}
      <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
      ${renderUserMenu()}
    `
    updateThemeButton()
  }
}

function renderTaskContent(task) {
  const container = document.getElementById('task-content')
  if (!container || !task) return
  container.innerHTML = `
    <div class="task-main">
      <section class="card task-section">
        <div class="label mb-8">Prompt</div>
        <div class="task-copy">${renderMarkdown(task.prompt || '')}</div>
      </section>
      ${task.result ? `
        <section class="card task-section">
          <div class="label mb-8">Result</div>
          <div class="task-copy">${renderMarkdown(task.result)}</div>
        </section>
      ` : ''}
      ${task.output ? `
        <section class="card task-section">
          <div class="label mb-8">Full Output</div>
          <div class="task-copy">${renderMarkdown(task.output)}</div>
        </section>
      ` : ''}
      ${task.errorMessage ? `
        <section class="error-box">
          <div class="error-title">Task error</div>
          <div class="error-detail">${escapeHtml(task.errorMessage)}</div>
        </section>
      ` : ''}
    </div>
    <aside class="card task-meta">
      <div class="label mb-16">Task Info</div>
      <div class="panel-kv">
        <div class="panel-kv-row"><span class="kv-label">Task ID</span><span class="kv-value mono">${escapeHtml(task.id.slice(0, 12))}</span></div>
        <div class="panel-kv-row"><span class="kv-label">Agent</span><span class="kv-value">${escapeHtml(agentLabel(task.agent))}</span></div>
        <div class="panel-kv-row"><span class="kv-label">Status</span><span class="badge ${taskBadgeClass(task.status)}">${escapeHtml(task.status)}</span></div>
        <div class="panel-kv-row"><span class="kv-label">Created</span><span class="kv-value">${new Date(task.createdAt).toLocaleString()}</span></div>
        ${task.startedAt ? `<div class="panel-kv-row"><span class="kv-label">Started</span><span class="kv-value">${new Date(task.startedAt).toLocaleString()}</span></div>` : ''}
        ${task.finishedAt ? `<div class="panel-kv-row"><span class="kv-label">Finished</span><span class="kv-value">${new Date(task.finishedAt).toLocaleString()}</span></div>` : ''}
        ${task.cwd ? `<div class="panel-kv-row"><span class="kv-label">CWD</span><span class="kv-value mono">${escapeHtml(task.cwd)}</span></div>` : ''}
      </div>
      ${renderTaskCreationDetails(task)}
      ${task.status !== 'queued' && task.status !== 'running' ? `
        <div class="divider"></div>
        <button class="btn btn-primary btn-sm" style="width: 100%;" onclick="window.showTaskFeedbackModal()">✎ Feedback & Rerun</button>
      ` : ''}
      ${task.lastAgentOutput ? `
        <div class="divider"></div>
        <div class="label mb-8">Last Agent Output</div>
        <pre class="code-block">${escapeHtml(task.lastAgentOutput)}</pre>
      ` : ''}
    </aside>
  `
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
  if (state.currentPipelineId && state.currentPipelineId !== id) {
    stopWorkflowSpeechRecognition()
    state.liveReviewStep = null
  }
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
  state.workflowFileAliases = new Map()
  state.workflowNestedFiles = new Map()
  state.workflowFileResolution = new Map()

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
  hydrateWorkflowFileReferences(pipeline)
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
  const detailsById = new Map(details.map(session => [session.id, session]))
  container.innerHTML = `
    <div class="workflow-timeline-view">
      ${steps.map((step, index) => renderWorkflowTimelineStep(step, detailsById.get(step.sessionId), index, steps.length)).join('')}
    </div>
  `
}

function renderWorkflowTimelineStep(step, session, index, totalSteps) {
  const expanded = state.expandedWorkflowStep === step.sessionId
  const dependsOn = step.dependsOn || []
  const title = step.title || inferWorkflowStepTitle(session, index)
  const currentRound = Number(session?.currentRound) || 0
  const maxRounds = Number(session?.maxRounds) || 0
  const status = step.status === 'pending' ? 'pending' : (session?.status || step.status)
  const approvalDependencies = dependsOn.map(id => ({ id, index: stepIndexBySessionId(id) }))
  const messages = session?.messages || []
  const output = workflowOutputMessage(messages)
  const cleaned = output ? output.replace(/\[DONE\]/gi, '').trim() : ''
  const hostImageRequired = step.nodeType === 'image_generate' && /HOST_IMAGE_GENERATION_REQUIRED/.test(cleaned)
  const canResumeStep = step.status === 'active' && !hostImageRequired && (session?.status === 'paused' || session?.status === 'error' || session?.status === 'stopped')
  const canRequestChanges = step.status === 'active' && (session?.status === 'paused' || session?.status === 'stopped') && approvalDependencies.length > 0
  const canManualArtifacts = step.nodeType === 'image_generate' && status !== 'done'
  const runningStatus = status === 'active'
    ? (state.streamStatus.get(step.sessionId) || summarizeRawStatus(state.heartbeats.get(step.sessionId)?.lastOutput || '运行中...'))
    : ''
  const errorTitle = session?.errorType || (status === 'error' ? 'step_error' : '')
  const errorDetail = status === 'error' ? (session?.errorMessage || step.errorMessage || '') : ''
  const isLast = index === totalSteps - 1

  const waitingForHumanApproval = /等待人工(?:确认|审核|回复|输入)|请回复[“"'` ]*(?:OK|通过|确认保存)/i.test(cleaned)
  const files = session ? workflowSessionArtifactFiles(session, cleaned, step) : cleaned ? workflowArtifactFiles(cleaned) : []
  const liveReviewOpen = state.liveReviewStep === step.sessionId

  return `
    <div class="timeline-step ${status}" data-step-id="${step.sessionId}">
      <div class="timeline-axis">
        <div class="timeline-node ${status}">
          <span class="node-number">${index + 1}</span>
        </div>
        ${!isLast ? '<div class="timeline-connector"></div>' : ''}
      </div>

      <div class="timeline-content">
        <div class="step-header">
          <div class="step-header-main">
            <h3 class="step-title">${escapeHtml(title)}</h3>
            <span class="step-badge status-${status}">${escapeHtml(status)}</span>
          </div>
          <div class="step-meta">
            <span class="meta-item">
              <span class="meta-icon">#</span>
              Step ${index + 1}: ${escapeHtml(title)}
            </span>
            <span class="meta-item">
              <span class="meta-icon">🔄</span>
              ${currentRound}${maxRounds ? ` / ${maxRounds}` : ''} rounds
            </span>
            <span class="meta-item ${session?.permissionMode === 'trusted' ? 'permission-trusted' : ''}">
              <span class="meta-icon">⚠</span>
              ${escapeHtml(session?.permissionMode || 'safe')}
            </span>
            ${step.nodeType ? `
              <span class="meta-item">
                <span class="meta-icon">◆</span>
                ${escapeHtml(WORKFLOW_NODE_TYPES[step.nodeType]?.label || step.nodeType)}
              </span>
            ` : ''}
            ${step.contract?.outputs?.length ? `
              <span class="meta-item">
                <span class="meta-icon">↳</span>
                ${escapeHtml(step.contract.outputs.map(output => output.fileName).join(', '))}
              </span>
            ` : ''}
            ${dependsOn.length ? `
              <span class="meta-item">
                <span class="meta-icon">⛓</span>
                Depends on Step ${dependsOn.map(id => stepIndexBySessionId(id) + 1).join(', ')}
              </span>
            ` : ''}
          </div>
        </div>

        ${runningStatus ? `
          <div class="step-running-status">
            <span class="running-spinner"></span>
            <span class="running-text">${escapeHtml(runningStatus)}</span>
          </div>
        ` : ''}

        ${errorDetail ? `
          <div class="step-error-status">
            <div class="step-error-title">⚠ ${escapeHtml(errorTitle)}</div>
            <div class="step-error-detail">${escapeHtml(errorDetail)}</div>
            ${session?.lastAgentOutput ? `<div class="step-error-last-output">最后输出：${escapeHtml(summarizeRawStatus(session.lastAgentOutput))}</div>` : ''}
          </div>
        ` : ''}

        ${canResumeStep || canRequestChanges || step.sessionId ? `
          <div class="step-actions">
            ${canResumeStep ? `<button class="action-btn primary" onclick='window.approveWorkflowStep(${jsString(step.sessionId)}, ${waitingForHumanApproval})'>${waitingForHumanApproval ? '✓ 通过，确认保存' : `✓ 执行 Step ${index + 1}`}</button>` : ''}
            <button class="action-btn secondary" onclick='window.rerunWorkflowStep(${jsString(step.sessionId)}, ${jsString(`Step ${index + 1}：${title}`)})'>↻ 重跑本步骤</button>
            ${canManualArtifacts ? `<button class="action-btn secondary" onclick='window.openManualArtifactsModal(${jsString(step.sessionId)}, ${jsString(`Step ${index + 1}：${title}`)})'>◎ 主进程补图回填</button>` : ''}
            ${canRequestChanges ? `<button class="action-btn secondary" onclick='window.requestWorkflowStepChanges(${jsString(step.sessionId)}, ${jsString(`Step ${index + 1}`)})'>✎ 要求修改上游产物</button>` : ''}
            <button class="action-btn live-review-trigger ${liveReviewOpen ? 'active' : ''}" onclick='window.toggleWorkflowLiveReview(${jsString(step.sessionId)})'>◉ Live Review</button>
          </div>
        ` : ''}

        ${liveReviewOpen ? renderWorkflowLiveReview(step, session, index, cleaned, waitingForHumanApproval, canResumeStep) : ''}

        ${cleaned ? `
          <div class="step-output">
            <div class="output-header">
              <span class="output-label">
                <span class="output-icon">▸</span>
                OUTPUT
              </span>
              <div class="output-actions">
                ${session?.versions?.length ? `<button class="output-copy" onclick='window.showWorkflowStepVersions(${jsString(session.id)})'>Versions ${session.versions.length}</button>` : ''}
                <button class="output-copy" onclick='window.copyWorkflowStepArtifact(${jsString(cleaned)})'>
                  <span>⎘</span> Copy
                </button>
              </div>
            </div>

            ${files.length ? `
              <div class="output-files">
                <div class="files-label">Generated Files [${files.length}]</div>
                <div class="files-list">
                  ${files.map((file, idx) => renderWorkflowFileItem(file, session?.cwd || '', idx === files.length - 1 ? '└─' : '├─')).join('')}
                </div>
              </div>
            ` : ''}

            <div class="output-content">
              ${renderWorkflowMarkdown(cleaned, session?.cwd || '')}
            </div>
          </div>
        ` : ''}

        ${expanded ? `
          <div class="step-messages">
            <button class="messages-toggle" onclick='window.toggleWorkflowStep(${jsString(step.sessionId)})'>
              ▾ Hide Conversation
            </button>
            ${renderWorkflowStepMessages(session)}
          </div>
        ` : `
          <button class="messages-toggle collapsed" onclick='window.toggleWorkflowStep(${jsString(step.sessionId)})'>
            ▸ View Full Conversation
          </button>
        `}
      </div>
    </div>
  `
}

function renderWorkflowLiveReview(step, session, index, currentOutput, waitingForHumanApproval, canResumeStep) {
  const sessionId = step.sessionId
  const messages = session?.messages || []
  const reviewMessages = messages.filter(message => message.round > 0).slice(-10)
  const artifact = state.liveReviewArtifacts.get(sessionId)
  const reviewContent = artifact?.content || currentOutput
  const draft = state.liveReviewDrafts.get(sessionId) || ''
  const pending = state.liveReviewPending.has(sessionId)
  const busy = pending || session?.status === 'active'
  const stream = state.streamDeltas.get(sessionId)?.content || ''
  const status = state.streamStatus.get(sessionId) || (busy ? 'AI 正在处理...' : '可以继续反馈')
  const speechSupported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)

  return `
    <section class="live-review" data-live-review="${escapeAttr(sessionId)}">
      <div class="live-review-head">
        <div>
          <div class="live-review-kicker">LIVE REVIEW · STEP ${index + 1}</div>
          <h4>围绕当前产物连续修改</h4>
        </div>
        <div class="live-review-status ${busy ? 'busy' : ''}">
          <span class="live-review-status-dot"></span>
          <span data-live-review-status="${escapeAttr(sessionId)}">${escapeHtml(status)}</span>
        </div>
      </div>

      <div class="live-review-grid">
        <div class="live-review-draft">
          <div class="live-review-section-head">
            <span>当前草稿${artifact?.path ? ` · ${escapeHtml(workflowFileName(artifact.path))}` : ''}</span>
            ${session?.versions?.length ? `<button type="button" onclick='window.showWorkflowStepVersions(${jsString(sessionId)})'>${session.versions.length} 个历史版本</button>` : ''}
          </div>
          <div class="live-review-draft-body" data-live-review-output="${escapeAttr(sessionId)}">
            ${reviewContent
              ? renderWorkflowMarkdown(reviewContent, session?.cwd || '')
              : '<p class="live-review-empty">本步骤还没有可审阅的输出。</p>'}
          </div>
        </div>

        <div class="live-review-chat">
          <div class="live-review-thread">
            ${reviewMessages.length ? reviewMessages.map(message => `
              <div class="live-review-message ${message.from === 'human' ? 'human' : 'agent'}">
                <div class="live-review-message-label">${message.from === 'human' ? '你' : escapeHtml(message.from || 'AI')}</div>
                <div class="live-review-message-body">${renderWorkflowMarkdown(message.content || '', session?.cwd || '')}</div>
              </div>
            `).join('') : '<p class="live-review-empty">说出你希望修改的地方，AI 会更新当前草稿。</p>'}
            <div class="live-review-stream ${stream ? 'visible' : ''}" data-live-review-stream="${escapeAttr(sessionId)}">${escapeHtml(stream)}</div>
          </div>

          <form class="live-review-composer" onsubmit='window.submitWorkflowLiveReview(event, ${jsString(sessionId)})'>
            <textarea
              class="live-review-input"
              rows="3"
              placeholder="例如：开头再快一点，第三句换成更生活化的表达..."
              oninput='window.updateWorkflowLiveReviewDraft(${jsString(sessionId)}, this.value)'
              onkeydown='window.handleWorkflowLiveReviewKeydown(event, ${jsString(sessionId)})'
            >${escapeHtml(draft)}</textarea>
            <div class="live-review-composer-actions">
              <button
                type="button"
                class="live-review-voice"
                onclick='window.toggleWorkflowVoice(${jsString(sessionId)})'
                ${speechSupported ? '' : 'disabled title="当前浏览器不支持语音识别"'}
              >
                <span data-live-review-mic="${escapeAttr(sessionId)}">●</span>
                语音输入
              </button>
              <button type="submit" class="action-btn primary" ${pending ? 'disabled' : ''}>发送并修改</button>
            </div>
          </form>
        </div>
      </div>

      <div class="live-review-footer">
        <span>每次发送前会自动保存当前版本；后续步骤会在产物变化后重置。</span>
        <div>
          <button type="button" class="action-btn secondary" onclick="window.closeWorkflowLiveReview()">结束审阅</button>
          ${canResumeStep ? `<button type="button" class="action-btn primary" onclick='window.approveWorkflowStep(${jsString(sessionId)}, ${waitingForHumanApproval})'>${waitingForHumanApproval ? '通过当前版本' : '执行当前步骤'}</button>` : ''}
        </div>
      </div>
    </section>
  `
}

function updateWorkflowLiveReviewStream(sessionId) {
  const status = document.querySelector(`[data-live-review-status="${CSS.escape(sessionId)}"]`)
  const stream = document.querySelector(`[data-live-review-stream="${CSS.escape(sessionId)}"]`)
  const content = state.streamDeltas.get(sessionId)?.content || ''
  if (status) status.textContent = state.streamStatus.get(sessionId) || 'AI 正在修改...'
  if (stream) {
    stream.textContent = content
    stream.classList.toggle('visible', Boolean(content))
  }
}

function renderWorkflowStepCard(step, session, index) {
  // Keep old function for compatibility, redirect to timeline
  return renderWorkflowTimelineStep(step, session, index, 999)
}

function renderWorkflowStepArtifact(session) {
  const messages = session?.messages || []
  const output = workflowOutputMessage(messages)
  if (!output) return ''
  const cleaned = output.replace(/\[DONE\]/gi, '').trim()
  if (!cleaned) return ''
  const files = workflowSessionArtifactFiles(session, cleaned)
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false })
  return `
    <div class="workflow-step-artifact">
      <div class="artifact-terminal-header">
        <div class="terminal-status">
          <span class="status-dot"></span>
          <span class="status-text">OUTPUT</span>
          <span class="status-time">${timestamp}</span>
        </div>
        <button class="terminal-action" onclick='window.copyWorkflowStepArtifact(${jsString(cleaned)})'>
          <span class="action-icon">⎘</span>
          <span class="action-label">COPY</span>
        </button>
      </div>
      ${files.length ? `
        <div class="artifact-files-panel">
          <div class="files-panel-header">
            <span class="panel-indicator">▸</span>
            <span class="panel-title">GENERATED_FILES</span>
            <span class="panel-count">[${files.length}]</span>
          </div>
          <div class="files-tree">
            ${files.map((file, idx) => renderWorkflowFileItem(file, session?.cwd || '', idx === files.length - 1 ? '└─' : '├─')).join('')}
          </div>
        </div>
      ` : ''}
      <div class="artifact-content-panel">
        <div class="content-panel-header">
          <span class="panel-indicator">▸</span>
          <span class="panel-title">CONTENT</span>
        </div>
        <div class="content-display">${renderWorkflowMarkdown(cleaned, session?.cwd || '')}</div>
      </div>
    </div>
  `
}

function workflowOutputMessage(messages) {
  const outputs = [...messages].reverse().filter(msg => msg.from !== 'human' && msg.content)
  return outputs.find(msg => extractWorkflowArtifactFiles(msg.content).length)?.content || outputs[0]?.content
}

function extractWorkflowArtifactFiles(content) {
  const files = new Set()
  const extensions = 'md|txt|log|json|yaml|yml|csv|tsv|png|jpe?g|webp|gif|svg|mp4|mov|webm|wav|mp3|m4a|aac|flac|pdf|docx|xlsx|pptx|zip'
  const fileExtensionPattern = new RegExp('\\.(' + extensions + ')$', 'i')
  const patterns = [
    new RegExp('`([^`]+\\.(' + extensions + '))`', 'gi'),
    new RegExp('(^|[\\s(（"\\\',])(/[^\\s`\'"<>，。；：；、)）,=\\\\]+?\\.(' + extensions + '))(?=$|[\\s`\'"<>，。；：；、)）,=\\\\])', 'gim'),
    new RegExp('(^|[\\s(（"\\\'])([\\w.\\-/\\u4e00-\\u9fa5]+/[^\\s`\'"<>，。；：；、)）]+\\.(' + extensions + '))(?=$|[\\s`\'"<>，。；：；、)）])', 'gim'),
  ]
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const file = match.slice(1).map(value => (value || '').trim()).find(value => fileExtensionPattern.test(value))
      if (file && !/^https?:\/\//i.test(file)) files.add(file)
    }
  }
  const directories = []
  for (const match of String(content || '').matchAll(/(?:目录|路径|文件夹|输出目录|保存目录)\s*[：:]\s*`?([^`\n]+\/)`?/gi)) {
    const dir = String(match[1] || '').trim()
    if (dir && !/^https?:\/\//i.test(dir)) directories.push(dir)
  }
  for (const dir of directories) {
    for (const file of [...files]) {
      if (!file.includes('/') && fileExtensionPattern.test(file)) files.add(`${dir}${file}`)
    }
  }
  const extracted = [...files]
  const absoluteNames = new Set(extracted.filter(file => file.startsWith('/')).map(file => workflowFileName(file)))
  return extracted.filter(file => file.startsWith('/') || file.includes('/') || !absoluteNames.has(file))
}

function workflowArtifactFiles(content) {
  const files = extractWorkflowArtifactFiles(content)
  const expanded = new Set(files)
  for (const file of files) {
    for (const nested of state.workflowNestedFiles.get(resolveWorkflowFilePath(file)) || []) expanded.add(nested)
  }
  return [...expanded]
}

function workflowSessionArtifactFiles(session, selectedContent = '', step = undefined) {
  const files = []
  const add = value => {
    const file = String(value || '').trim()
    if (!file) return
    if (!files.includes(file)) files.push(file)
  }
  const directFiles = content => extractWorkflowArtifactFiles(content || '')
  for (const file of directFiles(selectedContent || '')) add(file)
  const lastHumanTimestamp = Math.max(0, ...(session?.messages || []).filter(message => message.from === 'human').map(message => Number(message.timestamp) || 0))
  for (const message of session?.messages || []) {
    if (message.from === 'human') continue
    if ((Number(message.timestamp) || 0) < lastHumanTimestamp) continue
    for (const file of directFiles(message.content || '')) add(file)
  }
  const artifacts = session?.artifacts || {}
  for (const file of artifacts.generatedFiles || []) {
    add(file)
  }
  for (const changed of artifacts.filesChanged || []) {
    if (changed?.path) add(changed.path)
  }
  if (step?.nodeType === 'video_parse') {
    for (const file of [...files]) {
      for (const nested of state.workflowNestedFiles.get(resolveWorkflowFilePath(file)) || []) add(nested)
    }
  }
  const qualifiedNames = new Set(files.filter(file => String(file).startsWith('/') || String(file).includes('/')).map(file => workflowFileName(file)))
  const deduped = []
  const seen = new Set()
  const outputs = step?.contract?.outputs || []
  for (const file of files) {
    if (!String(file).startsWith('/') && !String(file).includes('/') && qualifiedNames.has(workflowFileName(file))) continue
    const resolved = resolveWorkflowFilePath(file)
    const resolution = state.workflowFileResolution.get(resolved) || state.workflowFileResolution.get(String(file))
    if (outputs.length && step?.nodeType !== 'video_parse' && !outputs.some(output => workflowFileMatchesOutput(resolved, output.fileName))) continue
    const key = resolution === 'exists' ? resolved : String(file)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(resolved)
  }
  return deduped
}

function workflowFileMatchesOutput(file, pattern) {
  const name = workflowFileName(file)
  const expected = String(pattern || '').trim()
  if (!expected) return true
  if (expected.startsWith('*.')) return name.toLowerCase().endsWith(expected.slice(1).toLowerCase())
  return name === expected || String(file).endsWith(`/${expected}`)
}

function workflowLiveReviewArtifactFile(step, session, selectedContent = '') {
  const textFilePattern = /\.(md|txt|log|json|ya?ml|csv|tsv)$/i
  const files = workflowSessionArtifactFiles(session, selectedContent, step).filter(file => textFilePattern.test(file))
  const outputs = step?.contract?.outputs || []
  return files.find(file => outputs.some(output => workflowFileMatchesOutput(file, output.fileName))) || files[0] || ''
}

async function hydrateWorkflowLiveReviewArtifact(step, session, selectedContent = '', force = false) {
  const sessionId = step?.sessionId
  if (!sessionId || state.liveReviewArtifactLoading.has(sessionId)) return
  if (!force && state.liveReviewArtifacts.has(sessionId)) return
  const file = workflowLiveReviewArtifactFile(step, session, selectedContent)
  if (!file) return

  state.liveReviewArtifactLoading.add(sessionId)
  try {
    const preview = await api('/api/files/preview', 'POST', {
      path: resolveWorkflowFilePath(file),
      cwd: session?.cwd || undefined,
    })
    state.liveReviewArtifacts.set(sessionId, {
      path: preview.path || resolveWorkflowFilePath(file),
      content: preview.content || '',
    })
    if (state.liveReviewStep === sessionId) renderWorkflowSteps(state.currentPipeline)
  } catch {
    state.liveReviewArtifacts.delete(sessionId)
  } finally {
    state.liveReviewArtifactLoading.delete(sessionId)
  }
}

async function hydrateWorkflowFileReferences(pipeline) {
  const sessionFiles = new Map()
  for (const session of pipeline.sessionDetails || []) {
    const files = new Set()
    for (const message of session.messages || []) {
      for (const file of extractWorkflowArtifactFiles(message.content || '')) {
        files.add(file)
      }
    }
    for (const changed of session.artifacts?.filesChanged || []) {
      if (changed?.path) files.add(changed.path)
    }
    for (const file of session.artifacts?.generatedFiles || []) {
      if (file) files.add(file)
    }
    if (files.size) sessionFiles.set(session, [...files])
  }

  let changed = false
  const markdownFiles = []
  await Promise.all([...sessionFiles].map(async ([session, files]) => {
    const cwd = session.cwd || ''
    try {
      const resolvedFiles = await api('/api/files/resolve', 'POST', { paths: files, cwd: cwd || undefined })
      const resolvedByName = new Map()
      for (const result of resolvedFiles) {
        state.workflowFileResolution.set(result.source, result.exists ? 'exists' : 'missing')
        if (!result.exists || !result.path) continue
        if (String(result.source).startsWith('/') || String(result.source).includes('/')) {
          state.workflowFileAliases.set(result.source, result.path)
        }
        state.workflowFileResolution.set(result.path, 'exists')
        const name = workflowFileName(result.path)
        const matches = resolvedByName.get(name) || []
        matches.push(result.path)
        resolvedByName.set(name, matches)
        if (/\.md$/i.test(result.path)) markdownFiles.push({ file: result.path, cwd })
      }
      for (const result of resolvedFiles) {
        if (result.exists || String(result.source).includes('/')) continue
        const matches = [...new Set(resolvedByName.get(workflowFileName(result.source)) || [])]
        if (matches.length !== 1) continue
        state.workflowFileAliases.set(result.source, matches[0])
        state.workflowFileResolution.set(result.source, 'exists')
      }
      changed = true
    } catch {
      for (const file of files) state.workflowFileResolution.set(file, 'missing')
    }
  }))

  await Promise.all(markdownFiles.map(async ({ file, cwd }) => {
    try {
      const preview = await api('/api/files/preview', 'POST', { path: file, cwd: cwd || undefined })
      const nestedSources = extractWorkflowArtifactFiles(preview.content || '')
      const resolvedNested = nestedSources.length
        ? await api('/api/files/resolve', 'POST', { paths: nestedSources, cwd: cwd || undefined, baseFile: file })
        : []
      const nested = []
      for (const result of resolvedNested) {
        state.workflowFileResolution.set(result.source, result.exists ? 'exists' : 'missing')
        if (!result.exists || !result.path) continue
        state.workflowFileAliases.set(result.source, result.path)
        state.workflowFileResolution.set(result.path, 'exists')
        nested.push(result.path)
      }
      state.workflowNestedFiles.set(file, nested)
      for (const match of String(preview.content || '').matchAll(/([^,\s\\]+)=([\w.-]+)/g)) {
        if (/\.(png|jpe?g|webp|gif|svg)$/i.test(match[1])) state.workflowFileAliases.set(match[2], match[1])
      }
      changed = true
    } catch {}
  }))
  if (changed && state.currentPipelineId === pipeline.id) {
    renderWorkflowSteps(state.currentPipeline)
    const openStep = pipeline.sessions?.find(step => step.sessionId === state.liveReviewStep)
    const openSession = pipeline.sessionDetails?.find(session => session.id === state.liveReviewStep)
    if (openStep && openSession) {
      const output = workflowOutputMessage(openSession.messages || '') || ''
      hydrateWorkflowLiveReviewArtifact(openStep, openSession, output, true)
    }
  }
}

function workflowFileName(file) {
  return String(file).split('/').pop() || String(file)
}

function workflowFileMeta(file) {
  const name = workflowFileName(file)
  const ext = (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase()
  let role = '文件'
  if (/storyboard/i.test(name)) role = '故事板分镜图'
  else if (/三视图|角色|同事|人物/.test(file) && /^(png|jpe?g|webp|gif)$/i.test(ext)) role = '角色参考图'
  else if (/prompt/i.test(name)) role = '生成提示词'
  else if (/script/i.test(name)) role = '拍摄脚本'
  else if (/reference/i.test(name)) role = '参考素材'
  else if (/commands?|命令/i.test(file)) role = '视频生成命令'
  else if (/^(png|jpe?g|webp|gif|svg)$/i.test(ext)) role = '图片素材'
  else if (/^(mp4|mov|webm)$/i.test(ext)) role = '视频文件'
  else if (/^(md|txt|log|json|ya?ml)$/i.test(ext)) role = '文本文件'
  return { name, role }
}

function resolveWorkflowFilePath(file) {
  const value = String(file)
  const aliased = state.workflowFileAliases.get(value)
  if (aliased) return aliased
  if (value.includes('/')) return value
  const matches = new Set()
  for (const session of state.currentPipeline?.sessionDetails || []) {
    for (const message of session.messages || []) {
      for (const candidate of extractWorkflowArtifactFiles(message.content || '')) {
        if (candidate.includes('/') && workflowFileName(candidate) === value) matches.add(candidate)
      }
    }
  }
  return matches.size === 1 ? [...matches][0] : value
}

function renderWorkflowFileItem(file, cwd, prefix = '├─') {
  const resolvedFile = resolveWorkflowFilePath(file)
  const meta = workflowFileMeta(resolvedFile)
  const resolution = state.workflowFileResolution.get(resolvedFile) || state.workflowFileResolution.get(String(file))
  const clickable = resolution !== 'missing'
  return `
    <button class="file-item ${clickable ? '' : 'file-item-unavailable'}" ${clickable ? `onclick='window.previewWorkflowFile(${jsString(resolvedFile)}, ${jsString(cwd || '')})'` : 'disabled'}>
      <span class="file-tree">${prefix}</span>
      <span class="file-info">
        <span class="file-name">${escapeHtml(meta.name)}</span>
        <span class="file-role">${escapeHtml(clickable ? meta.role : resolution === 'missing' ? '文件不存在' : '正在检查')}</span>
        <span class="file-location">${escapeHtml(resolvedFile)}</span>
      </span>
      <span class="file-arrow">${clickable ? '→' : '—'}</span>
    </button>
  `
}

function inferWorkflowStepTitle(session, index) {
  const initial = (session?.messages || []).find(msg => msg.from === 'human' && Number(msg.round) === 0)?.content || ''
  const quoted = initial.match(/“([^”]{2,24})”/)
  if (quoted?.[1]) return quoted[1]
  const firstLine = initial.split('\n').map(line => line.trim()).find(Boolean)
  if (firstLine) return firstLine.slice(0, 24)
  return `Step ${index + 1}`
}

function sessionTitle(session) {
  const provided = String(session?.displayTitle || '').trim()
  if (provided) return provided
  const initial = (session?.messages || []).find(msg => msg.from === 'human' && Number(msg.round) === 0)?.content || ''
  const firstLine = initial.split('\n').map(line => line.trim()).find(Boolean)
  if (firstLine) return firstLine.length > 56 ? `${firstLine.slice(0, 56)}...` : firstLine
  const mode = session?.mode ? `${session.mode} session` : 'Untitled session'
  return session?.cwd ? `${mode} · ${session.cwd}` : mode
}

function taskTitle(task) {
  const firstLine = String(task?.prompt || '').split('\n').map(line => line.trim()).find(Boolean)
  if (!firstLine) return 'Untitled task'
  return firstLine.length > 72 ? `${firstLine.slice(0, 72)}...` : firstLine
}

function taskSubtitle(task) {
  const lines = String(task?.prompt || '').split('\n').map(line => line.trim()).filter(Boolean)
  const rest = lines.slice(1).join(' ')
  if (rest) return rest.length > 120 ? `${rest.slice(0, 120)}...` : rest
  return task?.result || task?.lastAgentOutput || ''
}

window.copyWorkflowStepArtifact = async function(content) {
  const ok = await copyText(content)
  showToast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error')
}

window.showWorkflowStepVersions = function(sessionId) {
  const session = findCurrentWorkflowSessionDetail(sessionId)
  const versions = session?.versions || []
  showModal(`
    <div class="modal-card file-preview-modal">
      <div class="modal-head">
        <h3>版本记录</h3>
        <button class="icon-btn" onclick="window.closeModal()">×</button>
      </div>
      ${versions.length ? versions.map((version, index) => `
        <div class="version-card">
          <div class="version-title">v${versions.length - index} · Round ${escapeHtml(version.round ?? '')} · ${escapeHtml(new Date(version.timestamp).toLocaleString())}</div>
          <div class="version-reason">${escapeHtml(version.reason || '')}</div>
          ${version.output ? `<div class="version-output">${renderWorkflowMarkdown(String(version.output).replace(/\[DONE\]/gi, '').trim(), session?.cwd || '')}</div>` : ''}
        </div>
      `).join('') : '<p class="muted">暂无版本记录</p>'}
    </div>
  `)
}

window.previewWorkflowFile = async function(filePath, cwd) {
  try {
    const file = await api('/api/files/preview', 'POST', { path: filePath, cwd: cwd || undefined })
    const isMarkdown = /\.md$/i.test(file.name || file.path || '')
    const isImage = /^image\//i.test(file.mimeType || '') && file.encoding === 'base64'
    const isVideo = /^video\//i.test(file.mimeType || '') && file.encoding === 'stream'
    const isAudio = /^audio\//i.test(file.mimeType || '') && file.encoding === 'stream'
    const nestedFiles = isMarkdown ? extractWorkflowArtifactFiles(file.content || '').filter(path => path !== file.path) : []
    const body = isImage
      ? `<img class="file-preview-image" src="data:${escapeAttr(file.mimeType)};base64,${escapeAttr(file.content || '')}" alt="${escapeAttr(file.name || filePath)}">`
      : isVideo
        ? `<video class="file-preview-video" src="${escapeAttr(file.streamUrl || '')}" controls preload="metadata"></video>`
      : isAudio
        ? `<audio class="file-preview-audio" src="${escapeAttr(file.streamUrl || '')}" controls preload="metadata"></audio>`
      : isMarkdown
        ? renderWorkflowMarkdown(file.content || '', cwd || '')
        : `<pre>${escapeHtml(file.content || '')}</pre>`
    showModal(`
      <div class="modal-card file-preview-modal">
        <div class="modal-head">
          <h3>${escapeHtml(file.name || filePath)}</h3>
          <button class="icon-btn" onclick="window.closeModal()">×</button>
        </div>
        <div class="file-preview-path">${escapeHtml(file.path || filePath)}</div>
        ${nestedFiles.length ? `
          <div class="output-files">
            <div class="files-label">Referenced Files [${nestedFiles.length}]</div>
            <div class="files-list">
              ${nestedFiles.map((path, idx) => renderWorkflowFileItem(path, cwd || '', idx === nestedFiles.length - 1 ? '└─' : '├─')).join('')}
            </div>
          </div>
        ` : ''}
        <div class="file-preview-body">
          ${body}
        </div>
      </div>
    `)
  } catch (err) {
    showToast(err.message)
  }
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
                <div class="chat-bubble">${renderWorkflowMarkdown(msg.content || '', session?.cwd || '')}</div>
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

function workflowRevisionTargets(currentStepIndex) {
  const steps = state.currentPipeline?.sessions || []
  return steps
    .slice(0, Math.max(0, currentStepIndex))
    .map((step, index) => ({ id: step.sessionId, index, title: step.title || `Step ${index + 1}` }))
    .filter(target => target.id)
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
            <h2>${escapeHtml(sessionTitle(session))}</h2>
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
    ${session.status === 'error' ? '<button class="btn btn-primary btn-sm" onclick="window.resumeSession()">↻ Retry from Error</button>' : ''}
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
          <span class="kv-label">Permission</span>
          <span class="kv-value ${session.permissionMode === 'trusted' ? 'permission-trusted' : ''}">${escapeHtml(session.permissionMode || 'safe')}</span>
        </div>
        <div class="panel-kv-row">
          <span class="kv-label">Created</span>
          <span class="kv-value">${new Date(session.createdAt).toLocaleString()}</span>
        </div>
        ${session.cwd ? `<div class="panel-kv-row"><span class="kv-label">CWD</span><span class="kv-value mono">${escapeHtml(session.cwd)}</span></div>` : ''}
      </div>
      ${renderSessionCreationDetails(session)}
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
  await loadApiDocs()
  await loadDeployCheck()
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
              <button class="tab-btn" data-tab="diagnostics" onclick="window.switchSettingsTab('diagnostics')">Diagnostics</button>
              <button class="tab-btn" data-tab="api-docs" onclick="window.switchSettingsTab('api-docs')">API Docs</button>
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

            <div id="tab-diagnostics" class="tab-panel" data-tab="diagnostics">
              <div class="flex-between mb-24">
                <div>
                  <h3>Diagnostics</h3>
                  <p style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px;">Check deployment and CLI agent runtime status</p>
                </div>
                <button class="btn btn-secondary btn-sm" onclick="window.refreshDiagnostics()">Refresh</button>
              </div>
              <div id="diagnostics-panel"></div>
            </div>

            <div id="tab-api-docs" class="tab-panel" data-tab="api-docs">
              <h3 class="mb-24">Session HTTP API</h3>
              <pre class="code-block" style="white-space: pre-wrap;">${escapeHtml(JSON.stringify(state.apiDocs || {}, null, 2))}</pre>
            </div>

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

              <div class="form-group">
                <label>Allowed Workspaces</label>
                <textarea class="input" id="allowed-workspaces-input" rows="4" placeholder="/home/turing/projects&#10;/Users/me/Projects">${escapeHtml((state.config?.policy?.allowedWorkspaces || []).join('\n'))}</textarea>
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
  renderDiagnosticsPanel()
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
        <span class="badge badge-${statusBadgeClass(agent.status)}">${escapeHtml(statusLabel(agent.status))}</span>
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
    const badgeClass = statusBadgeClass(agent.status)
    return `
    <div class="agent-item">
      <div class="agent-icon">${escapeHtml(agent.name.charAt(0).toUpperCase())}</div>
      <div class="agent-info">
        <div class="agent-name">${escapeHtml(agent.name)}</div>
        <div class="agent-model">${escapeHtml(agent.adapter)} · ${escapeHtml(agent.command || '')}${agent.version ? ` · ${escapeHtml(agent.version)}` : ''}</div>
      </div>
      <span class="badge badge-${badgeClass}">${escapeHtml(statusLabel(agent.status))}</span>
      <div class="agent-actions">
        ${canAdd ? `<button class="btn btn-primary btn-sm" onclick='window.addLocalCliAgent(${jsString(agent.name)})'>Add</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick='window.showLocalCliAgentDiagnostics(${jsString(agent.name)})'>Diagnose</button>
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
      args: agent.args,
      timeout: agent.timeout,
      env: agent.env,
    })
    await loadAgents()
    renderAgentsList()
    renderLocalCliAgentsList()
    const saved = state.agents.find(item => item.kind === 'local' && item.name === name)
    if (saved?.status === 'invalid') {
      window.showLocalCliAgentDiagnostics(name, 'Agent was saved but validation failed.')
    }
  } catch (err) {
    showToast(err.message)
    window.showLocalCliAgentDiagnostics(name, err.message)
  }
}

function renderDiagnosticsPanel() {
  const container = document.getElementById('diagnostics-panel')
  if (!container) return
  const localAgents = state.agents.filter(agent => agent.kind === 'local')
  container.innerHTML = `
    <div class="agent-list">
      <div class="agent-item">
        <div class="agent-icon">D</div>
        <div class="agent-info">
          <div class="agent-name">Deployment</div>
          <div class="agent-model">${state.deployCheck ? `pid ${escapeHtml(state.deployCheck.pid)} · ${escapeHtml(state.deployCheck.node)} · ${escapeHtml(state.deployCheck.durationMs)}ms` : 'not checked'}</div>
        </div>
        <span class="badge badge-${state.deployCheck?.ok ? 'active' : 'error'}">${state.deployCheck?.ok ? 'ok' : 'unknown'}</span>
      </div>
      ${localAgents.map(agent => `
        <div class="agent-item">
          <div class="agent-icon">${escapeHtml(agent.name.charAt(0).toUpperCase())}</div>
          <div class="agent-info">
            <div class="agent-name">${escapeHtml(agent.name)}</div>
            <div class="agent-model">${escapeHtml(agent.command || agent.adapter)}</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick='window.showLocalCliAgentDiagnostics(${jsString(agent.name)})'>Run</button>
        </div>
      `).join('')}
    </div>
  `
}

window.refreshDiagnostics = async function() {
  await loadDeployCheck()
  await loadAgents()
  renderDiagnosticsPanel()
  renderLocalCliAgentsList()
}

window.showLocalCliAgentDiagnostics = async function(name, preface = '') {
  try {
    const diagnostic = await api(`/api/agents/${encodeURIComponent(name)}/diagnostics?refresh=1`)
    showModal(`
      <div class="modal-card">
        <div class="modal-head">
          <div>
            <h3>Agent Diagnostics</h3>
            <p>${escapeHtml(name)}</p>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">Close</button>
        </div>
        ${preface ? `<p style="color: var(--red); margin-bottom: 12px;">${escapeHtml(preface)}</p>` : ''}
        <pre class="code-block" style="white-space: pre-wrap;">${escapeHtml(JSON.stringify(diagnostic, null, 2))}</pre>
      </div>
    `)
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
    state.agents = state.agents.map(agent => agent.name === name && agent.kind === 'local'
      ? { ...agent, source: 'discovered', status: 'discovered', args: undefined, timeout: undefined, env: undefined }
      : agent
    )
    renderAgentsList()
    renderLocalCliAgentsList()
    loadAgents().then(() => {
      renderAgentsList()
      renderLocalCliAgentsList()
    }).catch((err) => showToast(err.message))
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
  const allowedWorkspaces = String(document.getElementById('allowed-workspaces-input')?.value || '')
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean)

  try {
    await api('/api/config', 'PUT', {
      defaults: { maxRounds, mode },
      policy: { allowedWorkspaces },
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
  const defaultFrom = preferredAgentName(agents, template?.config?.preferredAdapters?.from)
  const defaultTo = preferredAgentName(agents, template?.config?.preferredAdapters?.to, defaultFrom)
  const optionHtml = (selected) => agentOptionHtml(agents, selected)
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
            <select class="input" name="from" required ${noAgents ? 'disabled' : ''}>${optionHtml(defaultFrom)}</select>
          </div>
          <div class="form-group">
            <label>Agent B <span class="field-hint">executor; needs filesystem for cwd</span></label>
            <select class="input" name="to" required ${noAgents ? 'disabled' : ''}>${optionHtml(defaultTo)}</select>
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
          <label>Permission mode</label>
          <select class="input" name="permissionMode">
            <option value="safe">Safe</option>
            <option value="trusted">Trusted · skip CLI approvals</option>
          </select>
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
  const cwd = String(fd.get('cwd') || '').trim()
  const toName = String(fd.get('to') || '')
  if (cwd && !agentHasFilesystem(toName)) {
    showToast('Sessions with cwd require Agent B to be a filesystem-capable local CLI agent')
    return
  }
  const body = {
    from: { adapter: fd.get('from') },
    to: { adapter: fd.get('to') },
    initialPrompt: String(fd.get('prompt') || '').trim(),
    template_id: String(fd.get('templateId') || '').trim() || undefined,
    mode: fd.get('mode') || state.config?.defaults?.mode || 'collaborate',
    maxRounds: parseInt(fd.get('maxRounds')) || state.config?.defaults?.maxRounds || 5,
    approveMode: fd.get('approveMode') === 'on',
    permissionMode: fd.get('permissionMode') || 'safe',
    cwd: cwd || undefined,
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

window.showNewTaskModal = async function() {
  if (!state.agents.length) await loadAgents()
  const readyAgents = state.agents.filter(agent => agent.status === 'ready')
  const agents = readyAgents.length ? readyAgents : state.agents
  const noAgents = agents.length === 0
  const options = agentOptionHtml(agents)

  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <h3>New Task</h3>
          <p>Assign one lead agent to run the workflow.</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">Close</button>
      </div>
      ${noAgents ? `
        <div class="template-empty-agents" style="margin-bottom: 20px;">
          <span>No assistants configured yet.</span>
          <button class="btn btn-secondary btn-sm" onclick="window.closeModal(); window.navigate('/settings')">Add one first</button>
        </div>
      ` : ''}
      <form onsubmit="window.createTask(event)">
        <div class="form-group">
          <label>Agent</label>
          <select class="input" name="agent" required ${noAgents ? 'disabled' : ''}>${options}</select>
        </div>
        <div class="form-group">
          <label>Working Directory</label>
          <input class="input" name="cwd" placeholder="/path/to/project">
        </div>
        <div class="form-group">
          <label>Prompt</label>
          <textarea class="input" name="prompt" rows="6" required placeholder="Describe the task..."></textarea>
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
            <textarea class="input" name="contextFiles" rows="2" placeholder="docs/brief.md, src/index.ts"></textarea>
          </div>
        </details>
        <div class="form-group">
          <label>System Prompt</label>
          <textarea class="input" name="systemPrompt" rows="4" placeholder="Optional override"></textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" ${noAgents ? 'disabled' : ''}>Create</button>
        </div>
      </form>
    </div>
  `)
}

window.createTask = async function(e) {
  e.preventDefault()
  const fd = new FormData(e.target)
  const cwd = String(fd.get('cwd') || '').trim()
  const agentName = String(fd.get('agent') || '')
  if (cwd && !agentHasFilesystem(agentName)) {
    showToast('Tasks with cwd require a filesystem-capable local CLI agent')
    return
  }
  const body = {
    agent: { adapter: fd.get('agent') },
    prompt: String(fd.get('prompt') || '').trim(),
    cwd: cwd || undefined,
    context: buildContextFromForm(fd),
    systemPrompt: String(fd.get('systemPrompt') || '').trim() || undefined,
  }
  try {
    const task = await api('/api/tasks', 'POST', compactObject(body))
    closeModal()
    navigate(`/task/${task.id}`)
  } catch (err) {
    showToast(err.message)
  }
}

window.showTaskFeedbackModal = function() {
  const task = state.currentTask
  if (!task) return
  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <h3>Feedback & Rerun</h3>
          <p>基于当前 Task 的 prompt 和结果创建一个新 Task。</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">Close</button>
      </div>
      <form onsubmit="window.rerunTaskWithFeedback(event)">
        <div class="form-group">
          <label>反馈意见</label>
          <textarea class="input" name="feedback" rows="7" required placeholder="哪里不满意？希望怎么改？"></textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" data-submit>Create New Task</button>
        </div>
      </form>
    </div>
  `)
}

window.rerunTaskWithFeedback = async function(e) {
  e.preventDefault()
  const task = state.currentTask
  if (!task) return
  const submit = e.target.querySelector('[data-submit]')
  const fd = new FormData(e.target)
  const feedback = String(fd.get('feedback') || '').trim()
  if (!feedback) return
  const previous = task.result || task.output || task.lastAgentOutput || task.errorMessage || ''
  const prompt = [
    '请基于下面的原始任务、上次输出和人工反馈，重新完成任务。',
    '',
    '## 原始任务',
    task.prompt || '',
    '',
    previous ? `## 上次输出\n${previous}\n` : '',
    '## 人工反馈',
    feedback,
  ].filter(Boolean).join('\n')
  try {
    if (submit) {
      submit.disabled = true
      submit.textContent = 'Creating...'
    }
    const created = await api('/api/tasks', 'POST', compactObject({
      agent: { adapter: task.agent?.adapter },
      prompt,
      context: taskRerunContext(task.context),
      systemPrompt: task.systemPrompt,
      cwd: task.cwd,
    }))
    closeModal()
    state.tasks.unshift(created)
    navigate(`/task/${created.id}`)
  } catch (err) {
    showToast(err.message)
    if (submit) {
      submit.disabled = false
      submit.textContent = 'Create New Task'
    }
  }
}

function taskRerunContext(context) {
  if (!context) return undefined
  const files = Array.isArray(context.files)
    ? context.files
      .map(file => typeof file === 'string' ? file : file?.path)
      .filter(Boolean)
    : undefined
  return compactObject({
    rules: context.rules,
    text: context.text,
    files: files?.length ? files : undefined,
  })
}

window.stopCurrentTask = async function() {
  if (!state.currentTaskId) return
  try {
    const task = await api(`/api/tasks/${state.currentTaskId}/stop`, 'POST')
    applyTaskUpdate(task)
  } catch (err) {
    showToast(err.message)
  }
}

window.showNewWorkflowModal = async function() {
  if (!state.config) await loadConfig()
  if (!state.agents.length) await loadAgents()
  if (!state.pipelineTemplates.length) await loadPipelineTemplates()
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
          <label>Template</label>
          <select class="input" name="templateId" onchange="window.applyWorkflowTemplate(this.value)">
            <option value="">Custom workflow</option>
            ${state.pipelineTemplates.map(template => `
              <option value="${escapeAttr(template.id)}">${escapeHtml(template.nameEn || template.name)}${template.source === 'user' ? ' · mine' : ''}</option>
            `).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Pipeline name</label>
          <input class="input" name="name" required placeholder="Release workflow">
        </div>
        <div class="form-group">
          <label>Workflow input</label>
          <textarea class="input" name="workflowInput" rows="4" placeholder="Paste the reference video notes, source copy, or brief for this run..."></textarea>
        </div>
        <div class="form-group">
          <label>Start from step</label>
          <input class="input" name="startAtStep" type="number" min="1" value="1">
          <small>Steps before this number are kept in the workflow and marked as manually completed.</small>
        </div>
        <div class="workflow-editor-head">
          <h3>Steps</h3>
          <button type="button" class="btn btn-secondary btn-sm" onclick="window.addWorkflowStep()">+ Add Step</button>
        </div>
        <div id="workflow-step-editor" class="workflow-step-editor" data-from="${escapeAttr(defaultFrom)}" data-to="${escapeAttr(defaultTo)}" data-count="0"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Cancel</button>
          <button type="button" class="btn btn-secondary" onclick="window.saveWorkflowTemplate()">Save as Template</button>
          <button type="button" class="btn btn-danger" id="delete-workflow-template" style="display:none" onclick="window.deleteWorkflowTemplate()">Delete Template</button>
          <button type="submit" class="btn btn-primary" ${noAgents ? 'disabled' : ''}>Create</button>
        </div>
      </form>
    </div>
  `)
  const defaultTemplate = state.pipelineTemplates.find(template => /抖音视频生成/.test(template.name))
  if (defaultTemplate) {
    const select = document.querySelector('select[name="templateId"]')
    if (select) select.value = defaultTemplate.id
    window.applyWorkflowTemplate(defaultTemplate.id)
  } else {
    window.addWorkflowStep()
    window.addWorkflowStep()
  }
}

window.addWorkflowStep = function(step = {}, options = {}) {
  const editor = document.getElementById('workflow-step-editor')
  if (!editor) return
  const index = Number(editor.dataset.count || '0')
  editor.dataset.count = String(index + 1)
  const defaultFrom = editor.dataset.from || ''
  const defaultTo = editor.dataset.to || defaultFrom
  const row = document.createElement('div')
  row.className = 'workflow-edit-step'
  row.draggable = true
  row.dataset.autoDefaultDependency = options.autoDefaultDependency === false ? 'false' : 'true'
  if (step.cwd) row.dataset.cwd = step.cwd
  if (step.context) row.dataset.context = JSON.stringify(step.context)
  row.innerHTML = renderWorkflowEditStep(index, step, defaultFrom, defaultTo)
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

const WORKFLOW_NODE_TYPES = {
  video_parse: { label: '解析视频', agent: 'codex', inputs: 'source-video', output: 'reference.md', sections: '视频文案/台词,选题 brief,可复用结构' },
  copy_adapt: { label: '改编文案', agent: 'deepseek', inputs: 'reference.md', output: 'script-adapted.md', sections: '输入来源,改编文案,改编说明,自检' },
  storyboard_script: { label: '生成分镜脚本', agent: 'codex', inputs: 'script-adapted.md', output: 'reference.md, script.md, prompt.txt', sections: '分镜' },
  image_generate: { label: '生成视觉资产', agent: 'codex', inputs: 'script.md,prompt.txt', output: 'storyboard-step4.png, character-hero-turnaround.png, character-director-turnaround.png', sections: '' },
  video_command: { label: '准备视频命令', agent: 'codex', inputs: 'storyboard-step4.png, character-hero-turnaround.png, character-director-turnaround.png, prompt.txt', output: 'video-command.md', sections: '命令,输入文件,输出路径' },
  video_generate: { label: '生成视频', agent: 'codex', inputs: 'video-command.md', output: '*.mp4', sections: '' },
  human_review: { label: '人工审核', agent: 'codex', inputs: '*.mp4', output: '*.mp4', sections: '' },
  custom: { label: '自定义', agent: 'codex', inputs: '', output: '', sections: '' },
}

function workflowNodeTypeForStep(step) {
  if (step.nodeType) return step.nodeType
  const title = String(step.title || '')
  if (/解析.*视频/.test(title)) return 'video_parse'
  if (/改编文案/.test(title)) return 'copy_adapt'
  if (/分镜与 Prompt|分镜脚本/.test(title)) return 'storyboard_script'
  if (/视觉资产|分镜图|角色三视图/.test(title)) return 'image_generate'
  if (/命令/.test(title)) return 'video_command'
  if (/执行视频|生成视频/.test(title)) return 'video_generate'
  if (/审核|保存/.test(title)) return 'human_review'
  return 'custom'
}

function preferredWorkflowAgent(nodeType, fallback = '') {
  const preferred = WORKFLOW_NODE_TYPES[nodeType]?.agent
  return state.agents.find(agent => agent.name.toLowerCase().includes(preferred))?.name || fallback || state.agents[0]?.name || ''
}

function renderWorkflowEditStep(index, step, defaultFrom, defaultTo) {
  const options = state.agents.map(agent => `<option value="${escapeAttr(agent.name)}">${escapeHtml(agent.name)} · ${escapeHtml(agent.model || agent.adapter)}</option>`).join('')
  const from = resolveWorkflowAgentName(step.from, step.fromAdapter, defaultFrom)
  const nodeType = workflowNodeTypeForStep(step)
  const preset = WORKFLOW_NODE_TYPES[nodeType]
  const to = resolveWorkflowAgentName(step.agent || step.to, step.toAdapter, preferredWorkflowAgent(nodeType, defaultTo), from)
  const mode = step.mode || 'collaborate'
  const maxRounds = step.maxRounds || state.config?.defaults?.maxRounds || 5
  const title = step.title || `Step ${index + 1}`
  const prompt = step.initialPrompt || ''
  const permissionMode = step.permissionMode || 'safe'
  const cwd = step.cwd || ''
  const outputDir = step.outputDir || ''
  const inputs = (step.contract?.inputs || (preset.inputs ? preset.inputs.split(',') : [])).join(', ')
  const firstOutput = step.contract?.outputs?.[0]
  const outputFile = step.contract?.outputs?.map(output => output.fileName).join(', ') || preset.output
  const requiredSections = (firstOutput?.requiredSections || (preset.sections ? preset.sections.split(',') : [])).join(', ')
  return `
    <div class="workflow-edit-title">
      <span class="drag-handle">↕</span>
      <strong data-step-label>Step ${index + 1}</strong>
      <button type="button" class="btn btn-ghost btn-sm" onclick="window.removeWorkflowStep(this)">Remove</button>
    </div>
    <div class="form-group">
      <label>Step name</label>
      <input class="input" name="title" required value="${escapeAttr(title)}" placeholder="改编文案">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Node Type</label>
        <select class="input" name="nodeType" onchange="window.applyWorkflowNodeType(this)">
          ${Object.entries(WORKFLOW_NODE_TYPES).map(([value, item]) => `<option value="${value}" ${value === nodeType ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Primary Agent</label>
        <select class="input" name="agent" required>${options.replace(`value="${escapeAttr(to)}"`, `value="${escapeAttr(to)}" selected`)}</select>
      </div>
    </div>
    <input type="hidden" name="from" value="${escapeAttr(from)}">
    <input type="hidden" name="mode" value="${escapeAttr(mode)}">
    <input type="hidden" name="maxRounds" value="${escapeAttr(String(maxRounds))}">
    <input type="hidden" name="permissionMode" value="${escapeAttr(permissionMode)}">
    <div class="form-row">
      <div class="form-group">
        <label>Inputs</label>
        <input class="input" name="contractInputs" value="${escapeAttr(inputs)}" placeholder="reference.md">
      </div>
      <div class="form-group">
        <label>Output Files</label>
        <input class="input" name="contractOutput" value="${escapeAttr(outputFile)}" placeholder="script.md, prompt.txt">
      </div>
    </div>
    <div class="form-group">
      <label>Required Sections</label>
      <input class="input" name="contractSections" value="${escapeAttr(requiredSections)}" placeholder="改编文案, 改编说明, 自检">
    </div>
    <details class="workflow-step-advanced">
      <summary>Advanced</summary>
      <div class="form-group">
        <label>Prompt</label>
        <textarea class="input" name="initialPrompt" rows="3" required placeholder="Describe this step...">${escapeHtml(prompt)}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Working Directory</label>
          <input class="input" name="cwd" value="${escapeAttr(cwd)}" placeholder="/path/to/project">
        </div>
        <div class="form-group">
          <label>Output Directory</label>
          <input class="input" name="outputDir" value="${escapeAttr(outputDir)}" placeholder="/path/to/save/outputs">
        </div>
      </div>
    </details>
    <label class="check-row">
      <input type="checkbox" name="approveMode" ${step.approveMode ? 'checked' : ''}>
      <span>Pause before this step and require manual approval</span>
    </label>
    <div class="form-group">
      <label>Depends on</label>
      <select class="input" name="dependsOn" multiple data-deps></select>
    </div>
  `
}

window.applyWorkflowNodeType = function(select) {
  const row = select.closest('.workflow-edit-step')
  const preset = WORKFLOW_NODE_TYPES[select.value] || WORKFLOW_NODE_TYPES.custom
  const agent = preferredWorkflowAgent(select.value)
  if (agent) row.querySelector('[name="agent"]').value = agent
  row.querySelector('[name="contractInputs"]').value = preset.inputs
  row.querySelector('[name="contractOutput"]').value = preset.output
  row.querySelector('[name="contractSections"]').value = preset.sections
  if (/^Step \d+$/.test(row.querySelector('[name="title"]').value)) row.querySelector('[name="title"]').value = preset.label
}

function resolveWorkflowAgentName(ref, preferredAdapter, fallback, avoidName) {
  if (ref?.adapter && state.agents.some(agent => agent.name === ref.adapter)) return ref.adapter
  return preferredAgentName(state.agents, preferredAdapter || ref?.adapter, avoidName) || fallback
}

window.applyWorkflowTemplate = function(templateId) {
  const template = state.pipelineTemplates.find(item => item.id === templateId)
  const editor = document.getElementById('workflow-step-editor')
  const nameInput = document.querySelector('form [name="name"]')
  const deleteButton = document.getElementById('delete-workflow-template')
  if (!editor) return
  editor.innerHTML = ''
  editor.dataset.count = '0'
  if (!template) {
    window.addWorkflowStep()
    window.addWorkflowStep()
    if (nameInput) nameInput.value = ''
    if (deleteButton) deleteButton.style.display = 'none'
    return
  }
  if (nameInput) nameInput.value = template.name
  template.steps.forEach(step => window.addWorkflowStep(step, { autoDefaultDependency: false }))
  if (deleteButton) deleteButton.style.display = template.source === 'user' ? '' : 'none'
  const rows = [...editor.querySelectorAll('.workflow-edit-step')]
  rows.forEach((row, index) => {
    const deps = row.querySelector('[data-deps]')
    const dependsOn = template.steps[index]?.dependsOn || []
    ;[...deps.options].forEach(option => {
      option.selected = dependsOn.includes(Number(option.value))
    })
  })
}

function collectWorkflowSteps(workflowInput = '') {
  const rows = [...document.querySelectorAll('#workflow-step-editor .workflow-edit-step')]
  return rows.map(row => {
    const dependsOn = [...row.querySelector('[name="dependsOn"]').selectedOptions]
      .map(option => Number(option.value))
      .filter(value => Number.isInteger(value))
    const initialPrompt = row.querySelector('[name="initialPrompt"]').value.trim()
    const inputs = row.querySelector('[name="contractInputs"]').value.split(',').map(value => value.trim()).filter(Boolean)
    const outputFiles = row.querySelector('[name="contractOutput"]').value.split(',').map(value => value.trim()).filter(Boolean)
    const requiredSections = row.querySelector('[name="contractSections"]').value.split(',').map(value => value.trim()).filter(Boolean)
    const promptWithInput = !dependsOn.length && workflowInput
      ? `${initialPrompt}\n\n本次输入：\n${workflowInput}`
      : initialPrompt
    return compactObject({
      from: { adapter: row.querySelector('[name="from"]').value },
      to: { adapter: row.querySelector('[name="agent"]').value },
      agent: { adapter: row.querySelector('[name="agent"]').value },
      title: row.querySelector('[name="title"]').value.trim(),
      nodeType: row.querySelector('[name="nodeType"]').value,
      contract: compactObject({
        inputs: inputs.length ? inputs : undefined,
        outputs: outputFiles.length ? outputFiles.map((fileName, index) => ({
          fileName,
          requiredSections: index === 0 && requiredSections.length ? requiredSections : undefined,
        })) : undefined,
      }),
      initialPrompt: promptWithInput,
      mode: row.querySelector('[name="mode"]').value,
      maxRounds: parseInt(row.querySelector('[name="maxRounds"]').value) || undefined,
      approveMode: row.querySelector('[name="approveMode"]').checked || undefined,
      permissionMode: row.querySelector('[name="permissionMode"]').value,
      cwd: row.querySelector('[name="cwd"]').value.trim() || undefined,
      outputDir: row.querySelector('[name="outputDir"]').value.trim() || undefined,
      context: row.dataset.context ? JSON.parse(row.dataset.context) : undefined,
      dependsOn: dependsOn.length ? dependsOn : undefined,
    })
  })
}

window.saveWorkflowTemplate = async function() {
  const nameInput = document.querySelector('form [name="name"]')
  const name = nameInput?.value.trim()
  if (!name) {
    showToast('Pipeline name is required')
    return
  }
  try {
    const template = await api('/api/pipeline-templates', 'POST', {
      name,
      steps: collectWorkflowSteps(),
    })
    state.pipelineTemplates.unshift(template)
    const select = document.querySelector('select[name="templateId"]')
    if (select) {
      select.insertAdjacentHTML('beforeend', `<option value="${escapeAttr(template.id)}">${escapeHtml(template.name)} · mine</option>`)
      select.value = template.id
    }
    const deleteButton = document.getElementById('delete-workflow-template')
    if (deleteButton) deleteButton.style.display = ''
    showToast('Template saved')
  } catch (err) {
    showToast(err.message)
  }
}

window.deleteWorkflowTemplate = async function() {
  const select = document.querySelector('select[name="templateId"]')
  const id = select?.value
  const template = state.pipelineTemplates.find(item => item.id === id)
  if (!template || template.source !== 'user') return
  try {
    await api(`/api/pipeline-templates/${id}`, 'DELETE')
    state.pipelineTemplates = state.pipelineTemplates.filter(item => item.id !== id)
    select.querySelector(`option[value="${CSS.escape(id)}"]`)?.remove()
    select.value = ''
    window.applyWorkflowTemplate('')
    showToast('Template deleted')
  } catch (err) {
    showToast(err.message)
  }
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
      if (depIndex >= index) return ''
      const shouldAutoDefault = row.dataset.autoDefaultDependency !== 'false'
      const defaultSelected = selected.includes(String(depIndex)) || (shouldAutoDefault && selected.length === 0 && depIndex === index - 1)
      return `<option value="${depIndex}" ${defaultSelected ? 'selected' : ''}>Step ${depIndex + 1}</option>`
    }).join('')
  })
}

window.createWorkflow = async function(e) {
  e.preventDefault()
  const fd = new FormData(e.target)
  const workflowInput = String(fd.get('workflowInput') || '').trim()
  const startAtStep = parseInt(String(fd.get('startAtStep') || '1'), 10)
  const steps = collectWorkflowSteps(workflowInput)

  try {
    const pipeline = await api('/api/pipelines', 'POST', {
      name: String(fd.get('name') || '').trim(),
      steps,
      startAtStep: Number.isInteger(startAtStep) && startAtStep > 1 ? startAtStep : undefined,
      manualOutput: workflowInput || undefined,
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

window.resumeWorkflowStep = async function(sessionId) {
  try {
    await api(`/api/sessions/${sessionId}/resume`, 'POST')
    if (state.currentPipelineId) {
      const pipeline = await api(`/api/pipelines/${state.currentPipelineId}`)
      applyPipelineUpdate(pipeline)
    }
  } catch (err) {
    showToast(err.message)
  }
}

window.approveWorkflowStep = async function(sessionId, waitingForHumanApproval) {
  if (!waitingForHumanApproval) return window.resumeWorkflowStep(sessionId)
  try {
    await api(`/api/sessions/${sessionId}/confirm`, 'POST')
    if (state.currentPipelineId) {
      const pipeline = await api(`/api/pipelines/${state.currentPipelineId}`)
      applyPipelineUpdate(pipeline)
    }
  } catch (err) {
    showToast(err.message)
  }
}

window.rerunWorkflowStep = async function(sessionId, title) {
  if (!await confirmAction({
    title: '重跑步骤',
    message: `重跑 ${title || '当前步骤'}？该步骤之后的产物会被重置。`,
    confirmText: '重跑',
  })) return
  try {
    const pipeline = await api(`/api/sessions/${sessionId}/rerun`, 'POST')
    closeModal()
    applyPipelineUpdate(pipeline)
  } catch (err) {
    showToast(err.message)
  }
}

window.toggleWorkflowLiveReview = async function(sessionId) {
  if (state.liveReviewStep === sessionId) {
    window.closeWorkflowLiveReview()
    return
  }
  stopWorkflowSpeechRecognition()
  state.liveReviewStep = sessionId
  state.expandedWorkflowStep = sessionId
  renderWorkflowSteps(state.currentPipeline)
  const step = state.currentPipeline?.sessions?.find(item => item.sessionId === sessionId)
  const session = state.currentPipeline?.sessionDetails?.find(item => item.id === sessionId)
  if (step && session) {
    await hydrateWorkflowLiveReviewArtifact(step, session, workflowOutputMessage(session.messages || []) || '')
  }
  requestAnimationFrame(() => {
    const panel = document.querySelector(`[data-live-review="${CSS.escape(sessionId)}"]`)
    panel?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    panel?.querySelector('.live-review-input')?.focus()
  })
}

window.closeWorkflowLiveReview = function() {
  stopWorkflowSpeechRecognition()
  state.liveReviewStep = null
  renderWorkflowSteps(state.currentPipeline)
}

window.updateWorkflowLiveReviewDraft = function(sessionId, value) {
  state.liveReviewDrafts.set(sessionId, value)
}

window.handleWorkflowLiveReviewKeydown = function(event, sessionId) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }
}

window.submitWorkflowLiveReview = async function(event, sessionId) {
  event.preventDefault()
  const input = event.currentTarget.querySelector('.live-review-input')
  const content = String(input?.value || state.liveReviewDrafts.get(sessionId) || '').trim()
  if (!content || state.liveReviewPending.has(sessionId)) return

  stopWorkflowSpeechRecognition()
  state.liveReviewPending.add(sessionId)
  state.liveReviewArtifacts.delete(sessionId)
  state.liveReviewDrafts.set(sessionId, '')
  renderWorkflowSteps(state.currentPipeline)

  try {
    await api(`/api/sessions/${sessionId}/message`, 'POST', { content })
    if (state.currentPipelineId) {
      const pipeline = await api(`/api/pipelines/${state.currentPipelineId}`)
      applyPipelineUpdate(pipeline)
      const step = pipeline.sessions?.find(item => item.sessionId === sessionId)
      const session = pipeline.sessionDetails?.find(item => item.id === sessionId)
      if (step && session) {
        await hydrateWorkflowLiveReviewArtifact(step, session, workflowOutputMessage(session.messages || []) || '', true)
      }
    }
  } catch (err) {
    state.liveReviewPending.delete(sessionId)
    state.liveReviewDrafts.set(sessionId, content)
    renderWorkflowSteps(state.currentPipeline)
    showToast(err.message)
  }
}

window.toggleWorkflowVoice = function(sessionId) {
  if (state.workflowSpeechRecognition && state.workflowSpeechSessionId === sessionId) {
    stopWorkflowSpeechRecognition()
    return
  }

  stopWorkflowSpeechRecognition()
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SpeechRecognition) {
    showToast('当前浏览器不支持语音识别')
    return
  }

  const recognition = new SpeechRecognition()
  const base = String(state.liveReviewDrafts.get(sessionId) || '').trim()
  recognition.lang = 'zh-CN'
  recognition.continuous = true
  recognition.interimResults = true

  recognition.onstart = () => {
    state.workflowSpeechRecognition = recognition
    state.workflowSpeechSessionId = sessionId
    updateWorkflowVoiceButton(sessionId, true)
  }
  recognition.onresult = (event) => {
    let finalText = ''
    let interimText = ''
    for (let index = 0; index < event.results.length; index += 1) {
      const text = event.results[index][0]?.transcript || ''
      if (event.results[index].isFinal) finalText += text
      else interimText += text
    }
    const value = [base, finalText, interimText].filter(Boolean).join(' ').trim()
    state.liveReviewDrafts.set(sessionId, value)
    const input = document.querySelector(`[data-live-review="${CSS.escape(sessionId)}"] .live-review-input`)
    if (input) input.value = value
  }
  recognition.onerror = (event) => {
    if (event.error !== 'aborted' && event.error !== 'no-speech') {
      showToast(`语音识别失败：${event.error}`)
    }
  }
  recognition.onend = () => {
    if (state.workflowSpeechRecognition === recognition) {
      state.workflowSpeechRecognition = null
      state.workflowSpeechSessionId = null
    }
    updateWorkflowVoiceButton(sessionId, false)
  }
  recognition.start()
}

function updateWorkflowVoiceButton(sessionId, listening) {
  const indicator = document.querySelector(`[data-live-review-mic="${CSS.escape(sessionId)}"]`)
  const button = indicator?.closest('.live-review-voice')
  if (indicator) indicator.textContent = listening ? '■' : '●'
  if (button) button.classList.toggle('listening', listening)
}

function stopWorkflowSpeechRecognition() {
  const recognition = state.workflowSpeechRecognition
  const sessionId = state.workflowSpeechSessionId
  state.workflowSpeechRecognition = null
  state.workflowSpeechSessionId = null
  if (recognition) {
    try { recognition.stop() } catch { /* already stopped */ }
  }
  if (sessionId) updateWorkflowVoiceButton(sessionId, false)
}

window.openWorkflowStepMessage = function(sessionId, title) {
  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <h3>插入对话：${escapeHtml(title || '当前步骤')}</h3>
        <button class="icon-btn" onclick="window.closeModal()">×</button>
      </div>
      <form onsubmit='window.submitWorkflowStepMessage(event, ${jsString(sessionId)})'>
        <div class="form-group">
          <label>消息内容</label>
          <textarea class="input" name="content" rows="6" required placeholder="给这个步骤补充指令或修改意见..."></textarea>
          <small class="form-hint">提交后会写入该步骤的人类对话，并触发该步骤继续执行；其后续步骤会按依赖重置。</small>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">发送</button>
        </div>
      </form>
    </div>
  `)
}

window.submitWorkflowStepMessage = async function(event, sessionId) {
  event.preventDefault()
  const fd = new FormData(event.target)
  const content = String(fd.get('content') || '').trim()
  if (!content) return
  try {
    await api(`/api/sessions/${sessionId}/message`, 'POST', { content })
    closeModal()
    if (state.currentPipelineId) {
      const pipeline = await api(`/api/pipelines/${state.currentPipelineId}`)
      applyPipelineUpdate(pipeline)
    }
  } catch (err) {
    showToast(err.message)
  }
}

window.openManualArtifactsModal = function(sessionId, title) {
  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <h3>主进程补图回填：${escapeHtml(title || '当前步骤')}</h3>
        <button class="icon-btn" onclick="window.closeModal()">×</button>
      </div>
      <form onsubmit='window.submitManualArtifacts(event, ${jsString(sessionId)})'>
        <div class="form-group">
          <label>本地文件路径</label>
          <textarea class="input" name="paths" rows="5" required placeholder="/absolute/path/to/image.png&#10;/absolute/path/to/another.png"></textarea>
          <small class="form-hint">在 Codex 主进程生图并保存到本地后，把图片路径粘贴到这里；提交后会校验文件存在、标记本步骤完成，并自动激活下游步骤。</small>
        </div>
        <div class="form-group">
          <label>结果说明</label>
          <input class="input" name="summary" placeholder="例如：已由 Codex 主进程生成分镜图和角色三视图">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">回填并完成本步骤</button>
        </div>
      </form>
    </div>
  `)
}

window.submitManualArtifacts = async function(event, sessionId) {
  event.preventDefault()
  const fd = new FormData(event.target)
  const paths = String(fd.get('paths') || '').split(/\r?\n|,/).map(path => path.trim()).filter(Boolean)
  const summary = String(fd.get('summary') || '').trim()
  if (!paths.length) return
  try {
    await api(`/api/sessions/${sessionId}/manual-artifacts`, 'POST', { paths, summary })
    closeModal()
    if (state.currentPipelineId) {
      const pipeline = await api(`/api/pipelines/${state.currentPipelineId}`)
      applyPipelineUpdate(pipeline)
    }
  } catch (err) {
    showToast(err.message)
  }
}

window.requestWorkflowStepChanges = function(sessionId, title) {
  const stepIndex = stepIndexBySessionId(sessionId)
  const targets = workflowRevisionTargets(stepIndex)
  const defaultTarget = targets.at(-1)?.id || sessionId
  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <h3>要求修改上游产物</h3>
        <button class="icon-btn" onclick="window.closeModal()">×</button>
      </div>
      <form onsubmit='window.submitWorkflowStepChanges(event)'>
        <div class="form-group">
          <label>要修改哪一步</label>
          <select class="input" name="sessionId">
            ${targets.map(target => `
              <option value="${escapeAttr(target.id)}" ${target.id === defaultTarget ? 'selected' : ''}>
                Step ${target.index + 1}：${escapeHtml(target.title)}
              </option>
            `).join('')}
          </select>
          <small class="form-hint">可回退并修改当前步骤之前的任意产物；提交前会自动保存该步骤当前版本。</small>
        </div>
        <div class="form-group">
          <label>修改意见</label>
          <textarea class="input" name="content" rows="6" required placeholder="说明哪里不过、希望怎么改..."></textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">提交修改</button>
        </div>
      </form>
    </div>
  `)
}

window.submitWorkflowStepChanges = async function(event) {
  event.preventDefault()
  const fd = new FormData(event.target)
  const sessionId = String(fd.get('sessionId') || '').trim()
  const content = String(fd.get('content') || '').trim()
  if (!sessionId || !content) return
  try {
    await api(`/api/sessions/${sessionId}/message`, 'POST', { content })
    closeModal()
    if (state.currentPipelineId) {
      const pipeline = await api(`/api/pipelines/${state.currentPipelineId}`)
      applyPipelineUpdate(pipeline)
    }
  } catch (err) {
    showToast(err.message)
  }
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
  const selectedProvider = providerPresetForAgent(existing)
  const selectedPreset = PROVIDER_PRESETS[selectedProvider]
  const selectedModel = existing?.model || defaultModelForProvider(selectedProvider)
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
            <label>Provider</label>
            <select class="input" name="provider" id="agent-provider-select" required onchange="window.updateAgentProviderOptions()">
              ${providerPresetOptions(selectedProvider)}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Model</label>
          <div id="agent-model-control">${modelControl(selectedProvider, selectedModel)}</div>
        </div>
        <div class="form-group">
          <label>Base URL</label>
          <input class="input" name="baseUrl" id="agent-base-url-input" value="${escapeAttr(existing?.baseUrl || selectedPreset.baseUrl)}" placeholder="${selectedProvider === 'custom' ? 'Required' : 'Optional override'}">
        </div>
        <div class="form-group">
          <label>Provider Key</label>
          <select class="input" name="keyId" id="agent-key-select" data-has-current-key="${existing?.hasKey ? 'true' : 'false'}" data-original-adapter="${escapeAttr(existing?.adapter || '')}">
            ${agentKeyOptions(selectedProvider, Boolean(existing?.hasKey))}
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
  const preset = PROVIDER_PRESETS[String(fd.get('provider') || '')] || PROVIDER_PRESETS.custom
  const body = compactObject({
    name: String(fd.get('name') || '').trim(),
    adapter: preset.adapter,
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
              <option value="deepseek">DeepSeek</option>
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

function renderSessionCreationDetails(session) {
  const initialPrompt = sessionInitialPrompt()
  return `
    <div class="divider"></div>
    <details class="creation-details">
      <summary>Creation Params</summary>
      <div class="panel-kv creation-kv">
        <div class="panel-kv-row"><span class="kv-label">Agent A</span><span class="kv-value">${escapeHtml(agentLabel(session.from))}</span></div>
        <div class="panel-kv-row"><span class="kv-label">Agent B</span><span class="kv-value">${escapeHtml(agentLabel(session.to))}</span></div>
        <div class="panel-kv-row"><span class="kv-label">Mode</span><span class="kv-value">${escapeHtml(session.mode)}</span></div>
        <div class="panel-kv-row"><span class="kv-label">Max Turns</span><span class="kv-value">${escapeHtml(session.maxRounds)}</span></div>
        <div class="panel-kv-row"><span class="kv-label">Approve</span><span class="kv-value">${session.approveMode ? 'on' : 'off'}</span></div>
        <div class="panel-kv-row"><span class="kv-label">Permission</span><span class="kv-value">${escapeHtml(session.permissionMode || 'safe')}</span></div>
        ${session.templateId ? `<div class="panel-kv-row"><span class="kv-label">Template</span><span class="kv-value">${escapeHtml(session.templateId)}</span></div>` : ''}
        ${session.cwd ? `<div class="panel-kv-row"><span class="kv-label">CWD</span><span class="kv-value mono">${escapeHtml(session.cwd)}</span></div>` : ''}
      </div>
      ${renderPromptBlock('Initial Prompt', initialPrompt)}
      ${renderPromptBlock('Agent A System Prompt', session.systemPrompts?.from)}
      ${renderPromptBlock('Agent B System Prompt', session.systemPrompts?.to)}
      ${renderContextDetails(session.context)}
    </details>
  `
}

function renderTaskCreationDetails(task) {
  return `
    <div class="divider"></div>
    <details class="creation-details">
      <summary>Creation Params</summary>
      <div class="panel-kv creation-kv">
        <div class="panel-kv-row"><span class="kv-label">Agent</span><span class="kv-value">${escapeHtml(agentLabel(task.agent))}</span></div>
        ${task.cwd ? `<div class="panel-kv-row"><span class="kv-label">CWD</span><span class="kv-value mono">${escapeHtml(task.cwd)}</span></div>` : ''}
      </div>
      ${renderPromptBlock('Prompt', task.prompt)}
      ${renderPromptBlock('System Prompt', task.systemPrompt)}
      ${renderContextDetails(task.context)}
    </details>
  `
}

function renderPromptBlock(label, value) {
  if (!value) return ''
  return `
    <div class="creation-block">
      <div class="label mb-8">${escapeHtml(label)}</div>
      <div class="creation-copy">${renderMarkdown(String(value))}</div>
    </div>
  `
}

function sessionInitialPrompt() {
  return state.currentMessages.find(msg => msg.from === 'human' && Number(msg.round) === 0)?.content || ''
}

function renderContextDetails(context) {
  if (!context || !Object.keys(context).length) return ''
  const files = Array.isArray(context.files) ? context.files : []
  return `
    <details class="context-view" open>
      <summary>Context</summary>
      ${context.rules ? `
        <div class="context-view-block">
          <div class="label mb-8">Rules</div>
          <div class="context-view-copy">${renderMarkdown(context.rules)}</div>
        </div>
      ` : ''}
      ${context.text ? `
        <div class="context-view-block">
          <div class="label mb-8">Text</div>
          <div class="context-view-copy">${renderMarkdown(context.text)}</div>
        </div>
      ` : ''}
      ${files.length ? `
        <div class="context-view-block">
          <div class="label mb-8">Files</div>
          <div class="context-file-list">
            ${files.map(file => renderContextFile(file)).join('')}
          </div>
        </div>
      ` : ''}
    </details>
  `
}

function renderContextFile(file) {
  const path = typeof file === 'string' ? file : file?.path
  const content = typeof file === 'object' && file?.content ? String(file.content) : ''
  return `
    <details class="context-file-item">
      <summary class="mono">${escapeHtml(path || 'unnamed file')}</summary>
      ${content ? `<pre class="context-file-preview">${escapeHtml(content.slice(0, 2000))}${content.length > 2000 ? '\n...' : ''}</pre>` : ''}
    </details>
  `
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

function renderWorkflowMarkdown(content, cwd) {
  const html = renderMarkdown(content)
  const template = document.createElement('template')
  template.innerHTML = html
  const previewCode = file => {
    const resolved = resolveWorkflowFilePath(file)
    const resolution = state.workflowFileResolution.get(resolved) || state.workflowFileResolution.get(String(file))
    return resolution !== 'missing'
      ? `window.previewWorkflowFile(${jsString(resolved)}, ${jsString(cwd || '')}); return false`
      : ''
  }

  for (const anchor of template.content.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href') || ''
    let file = ''
    try {
      const url = new URL(href, window.location.origin)
      file = decodeURIComponent(url.pathname)
    } catch {
      file = href
    }
    if (extractWorkflowArtifactFiles(file).length) {
      anchor.setAttribute('href', '#')
      anchor.removeAttribute('target')
      anchor.removeAttribute('rel')
      const handler = previewCode(file)
      if (handler) {
        anchor.setAttribute('onclick', handler)
        anchor.classList.add('workflow-inline-file')
      } else {
        anchor.removeAttribute('onclick')
        anchor.classList.add('workflow-inline-file-unavailable')
      }
    }
  }

  const references = extractWorkflowArtifactFiles(content)
    .map(file => ({ source: file, resolved: resolveWorkflowFilePath(file) }))
    .concat([...state.workflowFileAliases].map(([source, resolved]) => ({ source, resolved })))
    .sort((a, b) => b.source.length - a.source.length)
  if (!references.length) return template.innerHTML
  const referenceBySource = new Map(references.map(item => [item.source, item]))
  const referencePattern = new RegExp(references.map(item => item.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT)
  const textNodes = []
  while (walker.nextNode()) textNodes.push(walker.currentNode)
  for (const node of textNodes) {
    if (node.parentElement?.closest('a, .workflow-inline-file')) continue
    const text = String(node.nodeValue)
    const matches = [...text.matchAll(referencePattern)]
    if (!matches.length) continue
    const fragment = document.createDocumentFragment()
    let offset = 0
    for (const match of matches) {
      if (match.index > offset) fragment.appendChild(document.createTextNode(text.slice(offset, match.index)))
      const reference = referenceBySource.get(match[0])
      const link = document.createElement('span')
      const handler = previewCode(reference?.resolved || match[0])
      link.className = handler ? 'workflow-inline-file' : 'workflow-inline-file-unavailable'
      if (handler) {
        link.setAttribute('role', 'button')
        link.setAttribute('tabindex', '0')
        link.setAttribute('onclick', handler)
      }
      link.textContent = match[0]
      fragment.appendChild(link)
      offset = match.index + match[0].length
    }
    if (offset < text.length) fragment.appendChild(document.createTextNode(text.slice(offset)))
    node.replaceWith(fragment)
  }
  return template.innerHTML
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

function agentHasFilesystem(name) {
  const agent = state.agents.find(item => item.name === name || item.adapter === name)
  return agent ? agent.kind === 'local' : false
}

function agentCapabilityLabel(agent) {
  return agent.kind === 'local' ? 'Filesystem' : 'No filesystem'
}

function agentOptionHtml(agents, selected = '') {
  return agents.map(agent => `
    <option value="${escapeAttr(agent.name)}" ${agent.name === selected ? 'selected' : ''}>
      ${escapeHtml(agent.name)} · ${escapeHtml(agent.model || agent.adapter)} · ${agentCapabilityLabel(agent)}
    </option>
  `).join('')
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

function providerPresetOptions(selected) {
  return Object.entries(PROVIDER_PRESETS)
    .map(([value, preset]) => `<option value="${escapeAttr(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(preset.label)}</option>`)
    .join('')
}

function modelControl(provider, selected) {
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom
  if (provider === 'custom') {
    return `<input class="input" name="model" value="${escapeAttr(selected || '')}" placeholder="Enter model name">`
  }
  const selectedValue = preset.models.some(option => option.value === selected)
    ? selected
    : defaultModelForProvider(provider)
  return `
    <select class="input" name="model">
      ${preset.models.map(option => `<option value="${escapeAttr(option.value)}" ${option.value === selectedValue ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
    </select>
  `
}

function defaultModelForProvider(provider) {
  return (PROVIDER_PRESETS[provider]?.models || [])[0]?.value || ''
}

function providerPresetForAgent(agent) {
  if (!agent) return 'anthropic'
  if (agent.baseUrl?.includes('api.deepseek.com')) return 'deepseek'
  if (agent.baseUrl?.includes('dashscope.aliyuncs.com')) return 'qwen'
  if (agent.baseUrl?.includes('api.moonshot.cn')) return 'moonshot'
  if (agent.adapter === 'anthropic-api') return 'anthropic'
  if (agent.adapter === 'openai-api') return 'openai'
  if (agent.adapter === 'zhipu-api') return 'zhipu'
  if (agent.adapter === 'deepseek-api') return 'deepseek'
  if (agent.adapter === 'qwen-api') return 'qwen'
  if (agent.adapter === 'moonshot-api') return 'moonshot'
  return 'custom'
}

function agentKeyOptions(provider, hasCurrentKey) {
  const defaultOption = hasCurrentKey
    ? '<option value="">Keep current key</option>'
    : '<option value="">Select a saved Provider Key</option>'
  return defaultOption + providerKeyOptionsForProvider(provider)
}

function providerKeyOptionsForProvider(provider) {
  return state.apiKeys
    .filter(key => !key.readOnly && providerMatchesPreset(key.provider, provider))
    .map(key => `<option value="${escapeAttr(key.id)}">${escapeHtml(key.name)} · ${escapeHtml(providerLabel(key.provider))} · ${escapeHtml(key.maskedKey)}</option>`)
    .join('')
}

window.updateAgentProviderOptions = function() {
  const providerSelect = document.getElementById('agent-provider-select')
  const modelControlContainer = document.getElementById('agent-model-control')
  const baseUrlInput = document.getElementById('agent-base-url-input')
  const keySelect = document.getElementById('agent-key-select')
  const provider = providerSelect?.value || 'anthropic'
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom
  if (modelControlContainer) modelControlContainer.innerHTML = modelControl(provider, defaultModelForProvider(provider))
  if (baseUrlInput) {
    baseUrlInput.value = preset.baseUrl
    baseUrlInput.placeholder = provider === 'custom' ? 'Required' : 'Optional override'
  }
  if (keySelect) {
    const canKeepCurrentKey = keySelect.dataset.hasCurrentKey === 'true' && preset.adapter === keySelect.dataset.originalAdapter
    keySelect.innerHTML = agentKeyOptions(provider, canKeepCurrentKey)
  }
}

function providerMatchesPreset(keyProvider, provider) {
  if (provider === 'custom') return keyProvider === 'openai'
  return keyProvider === provider
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

function taskBadgeClass(status) {
  if (status === 'running') return 'badge-running'
  if (status === 'queued') return 'badge-queued'
  return `badge-${status}`
}

function providerIcon(provider) {
  return ({ anthropic: 'A', openai: 'O', deepseek: 'D', zhipu: 'Z' })[provider] || '?'
}

function providerLabel(provider) {
  return ({ anthropic: 'Anthropic', openai: 'OpenAI', deepseek: 'DeepSeek', zhipu: 'Zhipu' })[provider] || provider
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
