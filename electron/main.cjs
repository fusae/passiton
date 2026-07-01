const { app, BrowserWindow, shell, Menu } = require('electron')
const { spawn } = require('child_process')
const http = require('http')
const path = require('path')
const fs = require('fs')

const PORT = parseInt(process.env.TURING_PORT || process.env.PORT || '4590', 10)
const BASE_URL = `http://localhost:${PORT}`

let serverProcess = null
let mainWindow = null
let loadingWindow = null

function resolveServerScript() {
  const candidates = [
    path.join(__dirname, '..', 'dist', 'index.js'),
    path.join(process.resourcesPath || '', 'dist', 'index.js'),
  ]
  return candidates.find((p) => fs.existsSync(p))
}

function resolveServerCwd(scriptPath) {
  return path.dirname(path.dirname(scriptPath))
}

function healthCheck() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE_URL}/health`, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(2000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitForServer(maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await healthCheck()) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

async function ensureServer() {
  if (await healthCheck()) return true
  const script = resolveServerScript()
  if (!script) {
    console.error('[turing] dist/index.js not found. Run `npm run build` first.')
    return false
  }
  const cwd = resolveServerCwd(script)
  serverProcess = spawn('node', [script], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT) },
  })
  serverProcess.stdout?.on('data', () => {})
  serverProcess.stderr?.on('data', () => {})
  serverProcess.on('exit', () => {
    serverProcess = null
  })
  return waitForServer()
}

function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    resizable: false,
    center: true,
    backgroundColor: '#0d1117',
    show: true,
  })
  loadingWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent([
    '<html><head><meta charset="utf-8"><style>',
    '*{margin:0;padding:0;box-sizing:border-box}',
    'body{background:#0d1117;display:flex;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,system-ui,sans-serif}',
    '.wrap{text-align:center}',
    '.title{color:#e6edf3;font-size:22px;font-weight:600;margin-bottom:16px}',
    '.spin{width:32px;height:32px;border:3px solid #30363d;border-top-color:#58a6ff;border-radius:50%;animation:r .8s linear infinite;margin:0 auto}',
    '@keyframes r{to{transform:rotate(360deg)}}',
    '</style></head><body><div class="wrap"><div class="title">Turing</div><div class="spin"></div></div></body></html>',
  ].join('')))
  loadingWindow.on('closed', () => {
    loadingWindow = null
  })
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0d1117',
    titleBarStyle: 'hiddenInset',
    title: 'Turing',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadURL(BASE_URL)
  mainWindow.once('ready-to-show', () => {
    if (loadingWindow) {
      loadingWindow.close()
      loadingWindow = null
    }
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(BASE_URL)) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function killServer() {
  if (!serverProcess) return
  try {
    serverProcess.kill('SIGTERM')
  } catch {
    // best-effort
  }
  serverProcess = null
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  createLoadingWindow()

  const ok = await ensureServer()
  if (!ok) {
    if (loadingWindow) loadingWindow.close()
    killServer()
    app.quit()
    return
  }
  createMainWindow()
})

app.on('window-all-closed', () => {
  killServer()
  app.quit()
})

app.on('before-quit', () => {
  killServer()
})

app.on('activate', () => {
  if (mainWindow === null && loadingWindow === null) {
    createLoadingWindow()
    ensureServer().then((ok) => {
      if (ok) createMainWindow()
      else app.quit()
    })
  }
})
