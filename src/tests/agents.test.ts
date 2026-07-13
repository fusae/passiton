import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, win32 } from 'node:path'
import { AgentCatalog, findExecutable, getBundledClaudeCandidates, getBundledCodexCandidates, getBundledOpenCodeCandidates, setExtraAgentSearchPathsForTesting, setPlatformForTesting } from '../agents.js'
import { registerConfiguredAdapters } from '../adapters/factory.js'
import { Router } from '../router.js'
import { DEFAULT_CONFIG, getConfigPath, loadConfig, writeConfig } from '../config.js'

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

test.afterEach(() => {
  setExtraAgentSearchPathsForTesting([])
  setPlatformForTesting(undefined)
  delete process.env.PASSITON_CODEX_COMMAND
})

test('findExecutable prefers explicit env command paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-env-'))
  const command = writeExecutable(join(dir, 'my-codex'))
  process.env.PASSITON_CODEX_COMMAND = command

  try {
    assert.equal(await findExecutable(['codex'], ['PASSITON_CODEX_COMMAND']), command)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findExecutable searches fallback bin paths outside PATH', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-bin-'))
  const command = writeExecutable(join(dir, 'codex'))
  setExtraAgentSearchPathsForTesting([dir])

  try {
    assert.equal(await findExecutable(['codex']), command)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Codex discovery includes the executable bundled with ChatGPT on macOS', () => {
  const candidates = getBundledCodexCandidates('darwin', '/Users/test', {})
  assert.equal(candidates[0], '/Applications/ChatGPT.app/Contents/Resources/codex')
  assert.ok(candidates.includes('/Users/test/Applications/ChatGPT.app/Contents/Resources/codex'))
})

test('Codex discovery includes common ChatGPT locations on Windows', () => {
  const candidates = getBundledCodexCandidates('win32', 'C:\\Users\\test', {
    LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
    ProgramFiles: 'C:\\Program Files',
  })
  assert.ok(candidates.some((candidate) => candidate.endsWith(win32.join('Microsoft', 'WindowsApps', 'codex.exe'))))
  assert.ok(candidates.some((candidate) => candidate.endsWith(win32.join('Programs', 'ChatGPT', 'resources', 'codex.exe'))))
  assert.ok(candidates.some((candidate) => candidate.endsWith(win32.join('ChatGPT', 'resources', 'codex.exe'))))
})

test('Claude discovery includes the latest CLI bundled by Claude App on macOS', async () => {
  const home = mkdtempSync(join(tmpdir(), 'passiton-claude-home-'))
  const older = join(home, 'Library', 'Application Support', 'Claude', 'claude-code', '2.1.92', 'claude.app', 'Contents', 'MacOS')
  const latest = join(home, 'Library', 'Application Support', 'Claude', 'claude-code', '2.1.202', 'claude.app', 'Contents', 'MacOS')
  mkdirSync(older, { recursive: true })
  mkdirSync(latest, { recursive: true })

  try {
    const candidates = await getBundledClaudeCandidates('darwin', home, {})
    assert.equal(candidates[2], join(latest, 'claude'))
    assert.ok(candidates.includes(join(older, 'claude')))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('OpenCode discovery includes its user-local installer paths', () => {
  assert.deepEqual(
    getBundledOpenCodeCandidates('darwin', '/Users/test', {}),
    ['/Users/test/.opencode/bin/opencode']
  )
  const windows = getBundledOpenCodeCandidates('win32', 'C:\\Users\\test', {
    APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
  })
  assert.ok(windows.includes(win32.join('C:\\Users\\test\\AppData\\Roaming', 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')))
  assert.ok(windows.includes(win32.join('C:\\Users\\test', '.opencode', 'bin', 'opencode.exe')))
  assert.ok(windows.includes(win32.join('C:\\Users\\test\\AppData\\Local', 'opencode', 'bin', 'opencode.exe')))
})

test('win32: OpenCode discovery prefers real exe over npm .cmd shim', async () => {
  const root = mkdtempSync(join(tmpdir(), 'passiton-opencode-win32-'))
  const appData = join(root, 'Roaming')
  const localAppData = join(root, 'Local')
  const npmDir = join(appData, 'npm')
  const exePath = win32.join(appData, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')
  const oldPath = process.env.PATH
  const oldAppData = process.env.APPDATA
  const oldLocalAppData = process.env.LOCALAPPDATA

  mkdirSync(dirname(exePath), { recursive: true })
  mkdirSync(npmDir, { recursive: true })
  writeFileSync(exePath, 'fake exe')
  writeFileSync(join(npmDir, 'opencode.cmd'), 'fake shim')
  setPlatformForTesting('win32')
  process.env.PATH = npmDir
  process.env.APPDATA = appData
  process.env.LOCALAPPDATA = localAppData

  try {
    const catalog = new AgentCatalog({}, true)
    await catalog.discover({ refresh: true })
    const opencode = (await catalog.listAgents()).find((agent) => agent.name === 'opencode')
    assert.equal(opencode?.command, exePath)
  } finally {
    if (oldPath === undefined) delete process.env.PATH
    else process.env.PATH = oldPath
    if (oldAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = oldAppData
    if (oldLocalAppData === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = oldLocalAppData
    rmSync(root, { recursive: true, force: true })
  }
})

test('win32: discovery skips protected Codex AppX package executables', async () => {
  setPlatformForTesting('win32')
  const appxCodex = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.707.8479.0_x64__2p2nqsd0c76g0\\app\\resources\\codex.exe'
  assert.equal(await findExecutable([appxCodex]), undefined)
})

test('win32: refresh removes stale auto-discovered Codex AppX config', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'passiton-codex-appx-'))
  const oldPath = process.env.PATH
  const oldLocalAppData = process.env.LOCALAPPDATA
  const appxCodex = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.707.8479.0_x64__2p2nqsd0c76g0\\app\\resources\\codex.exe'
  setPlatformForTesting('win32')
  process.env.PATH = dir
  process.env.LOCALAPPDATA = join(dir, 'localappdata')

  try {
    await withConfigHome(async () => {
      writeConfig({
        ...DEFAULT_CONFIG,
        agents: {
          codex: {
            adapter: 'codex',
            command: appxCodex,
            args: ['exec', '{prompt}'],
            timeout: 1_000,
            autoDiscovered: true,
          },
        },
      })
      const catalog = new AgentCatalog(loadConfig().agents, true, true)
      await catalog.discover({ refresh: true })

      assert.equal(catalog.configuredAgentConfigs().codex, undefined)
      assert.equal(loadConfig().agents.codex, undefined)
    })
  } finally {
    if (oldPath === undefined) delete process.env.PATH
    else process.env.PATH = oldPath
    if (oldLocalAppData === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = oldLocalAppData
    rmSync(dir, { recursive: true, force: true })
  }
})

test('discovery repairs a configured Codex path after the app executable moves', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'passiton-codex-moved-'))
  const command = writeExecutable(join(dir, 'codex'), 'echo codex-test')
  setExtraAgentSearchPathsForTesting([dir])
  const catalog = new AgentCatalog({
    codex: {
      adapter: 'codex',
      command: join(dir, 'removed-codex'),
      args: ['exec', '{prompt}'],
    },
  }, true)

  try {
    await catalog.discover({ refresh: true })
    assert.equal(catalog.configuredAgentConfigs().codex?.command, command)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('refresh rescans CLI locations changed after Passiton started', async () => {
  const firstDir = mkdtempSync(join(tmpdir(), 'passiton-agent-refresh-old-'))
  const nextDir = mkdtempSync(join(tmpdir(), 'passiton-agent-refresh-new-'))
  const firstCommand = writeExecutable(join(firstDir, 'claude'), 'echo claude-old')
  setExtraAgentSearchPathsForTesting([firstDir])
  const catalog = new AgentCatalog({}, true)

  try {
    await catalog.discover()
    assert.equal((await catalog.listAgents()).find((agent) => agent.name === 'claude-code')?.command, firstCommand)

    rmSync(firstDir, { recursive: true, force: true })
    const nextCommand = writeExecutable(join(nextDir, 'claude'), 'echo claude-new')
    setExtraAgentSearchPathsForTesting([nextDir])
    const refreshed = await catalog.listAgents({ refresh: true })
    assert.equal(refreshed.find((agent) => agent.name === 'claude-code')?.command, nextCommand)
  } finally {
    rmSync(firstDir, { recursive: true, force: true })
    rmSync(nextDir, { recursive: true, force: true })
  }
})

test('AgentCatalog discovers supported CLI agents and ignores unknown binaries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-discover-'))
  writeExecutable(join(dir, 'codex'), 'echo codex-test')
  writeExecutable(join(dir, 'aider'), 'echo aider-test')
  writeExecutable(join(dir, 'unknown-agent'), 'echo unknown-test')
  setExtraAgentSearchPathsForTesting([dir])

  const catalog = new AgentCatalog({}, true)
  await catalog.discover()
  const agents = await catalog.listAgents()
  const codex = agents.find((agent) => agent.name === 'codex')
  const aider = agents.find((agent) => agent.name === 'aider')
  const unknown = agents.find((agent) => agent.name === 'unknown-agent')

  try {
    assert.equal(codex?.source, 'discovered')
    assert.equal(codex?.availableForSessions, true)
    assert.equal(codex?.healthy, true)
    assert.equal(aider?.source, 'discovered')
    assert.deepEqual(aider?.args, ['--message', '{prompt}'])
    assert.equal(unknown, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('production discovery auto-configures and verifies installed agents', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'passiton-agent-auto-config-'))
  const command = writeExecutable(join(dir, 'codex'),
    'if [ "$1" = "--version" ]; then echo codex-test; exit 0; fi\necho TURING_READY',
    'if "%~1"=="--version" (echo codex-test & exit /b 0)\necho TURING_READY'
  )
  setExtraAgentSearchPathsForTesting([dir])

  try {
    await withConfigHome(async () => {
      writeConfig({ ...DEFAULT_CONFIG, agents: {} })
      const catalog = new AgentCatalog({}, true, true)
      await catalog.discover({ refresh: true })
      await catalog.listAgents()
      await waitFor(() => Boolean(loadConfig().agents.codex?.lastVerificationAttemptAt))
      const saved = loadConfig().agents.codex

      assert.equal(saved.command, command)
      assert.equal(saved.autoDiscovered, true)
      assert.equal(saved.lastVerifiedVersion, 'codex-test')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('production discovery migrates previously configured built-ins to automatic management', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'passiton-agent-auto-migrate-'))
  const command = writeExecutable(join(dir, 'codex'), 'echo codex-test')
  setExtraAgentSearchPathsForTesting([dir])

  try {
    await withConfigHome(async () => {
      const codex = { adapter: 'codex' as const, command, args: ['exec', '{prompt}'], timeout: 60_000 }
      writeConfig({ ...DEFAULT_CONFIG, agents: { codex } })
      const catalog = new AgentCatalog({ codex }, true, true)
      await catalog.discover({ refresh: true })

      assert.equal(loadConfig().agents.codex.autoDiscovered, true)
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('discovered local agents are not registered until configured', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-register-'))
  writeExecutable(join(dir, 'codex'), 'echo codex-test')
  setExtraAgentSearchPathsForTesting([dir])

  try {
    const discovered = new AgentCatalog({}, true)
    await discovered.discover()
    const router = new Router()
    try {
      discovered.registerDiscoveredAdapters(router)
      assert.equal(router.getAdapter('codex'), undefined)

      const agents = {
        codex: {
          adapter: 'codex',
          command: join(dir, 'codex'),
          args: ['exec', '{prompt}'],
          timeout: 1_000,
        },
      }
      registerConfiguredAdapters(router, agents)
      assert.equal(router.getAdapter('codex')?.name, 'codex')
    } finally {
      router.dispose()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('configured local agents require a successful smoke run to be healthy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-smoke-'))
  const command = writeExecutable(join(dir, 'codex'),
    'if [ "$1" = "--version" ]; then echo codex-test; exit 0; fi\necho TURING_READY',
    'if "%~1"=="--version" (echo codex-test & exit /b 0)\necho TURING_READY'
  )

  try {
    await withConfigHome(async () => {
      writeConfig({
        ...DEFAULT_CONFIG,
        agents: {
          codex: {
            adapter: 'codex',
            command,
            args: ['{prompt}'],
            timeout: 1_000,
          },
        },
      })
      const catalog = new AgentCatalog(loadConfig().agents, true)
      const diagnostic = await catalog.diagnoseAgent('codex', true)
      const agents = await catalog.listAgents()
      const codex = agents.find((agent) => agent.name === 'codex')

      assert.equal(diagnostic?.smokeOk, true)
      assert.equal(codex?.source, 'configured')
      assert.equal(codex?.healthy, true)
      assert.equal(codex?.verified, true)
      assert.equal(codex?.version, 'codex-test')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('configured local agents use executable existence without refresh', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-no-probe-'))
  const command = writeExecutable(join(dir, 'codex'),
    'if [ "$1" = "--version" ]; then exit 2; fi\nexit 2',
    'if "%~1"=="--version" (exit /b 2)\nexit /b 2'
  )

  try {
    const catalog = new AgentCatalog({
      codex: {
        adapter: 'codex',
        command,
        args: ['{prompt}'],
        timeout: 1_000,
      },
    }, true)
    const agents = await catalog.listAgents()
    const codex = agents.find((agent) => agent.name === 'codex')

    assert.equal(codex?.source, 'configured')
    assert.equal(codex?.healthy, true)
    assert.equal(codex?.verified, false)
    assert.equal(codex?.version, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('listAgents without refresh does not invoke version probe, while refresh does', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-version-probe-'))
  const counter = join(dir, 'counter')
  const noRefreshCommand = writeExecutable(join(dir, 'codex-no-refresh'),
    `if [ "$1" = "--version" ]; then echo hit >> "${counter}"; echo codex-test; exit 0; fi\nexit 0`,
    `if "%~1"=="--version" (echo hit>>"${counter}" & echo codex-test & exit /b 0)\nexit /b 0`
  )
  const refreshCommand = writeExecutable(join(dir, 'codex-refresh'),
    `if [ "$1" = "--version" ]; then echo hit >> "${counter}"; echo codex-test; exit 0; fi\nexit 0`,
    `if "%~1"=="--version" (echo hit>>"${counter}" & echo codex-test & exit /b 0)\nexit /b 0`
  )

  try {
    const noRefreshCatalog = new AgentCatalog({
      codex: {
        adapter: 'codex',
        command: noRefreshCommand,
        args: ['{prompt}'],
        timeout: 1_000,
      },
    }, true)
    const agents = await noRefreshCatalog.listAgents()
    const codex = agents.find((agent) => agent.name === 'codex')
    assert.equal(codex?.healthy, true)
    assert.throws(() => readFileSync(counter, 'utf-8'), /ENOENT/)

    const refreshCatalog = new AgentCatalog({
      codex: {
        adapter: 'codex',
        command: refreshCommand,
        args: ['{prompt}'],
        timeout: 1_000,
      },
    }, true)
    await refreshCatalog.listAgents({ refresh: true })
    assert.match(readFileSync(counter, 'utf-8'), /hit/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('configured local agents stay healthy-but-unverified when smoke run fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-smoke-fail-'))
  const command = writeExecutable(join(dir, 'codex'),
    'if [ "$1" = "--version" ]; then echo codex-test; exit 0; fi\nexit 2',
    'if "%~1"=="--version" (echo codex-test & exit /b 0)\nexit /b 2'
  )

  try {
    const catalog = new AgentCatalog({
      codex: {
        adapter: 'codex',
        command,
        args: ['{prompt}'],
        timeout: 1_000,
      },
    }, true)
    const agents = await catalog.listAgents({ refresh: true })
    const codex = agents.find((agent) => agent.name === 'codex')

    // --version succeeds (binary is installed → healthy: true), but the smoke
    // run exits 2 (model not actually callable → verified: false). This is the
    // signature of a lapsed subscription / bad credentials.
    assert.equal(codex?.source, 'configured')
    assert.equal(codex?.healthy, true)
    assert.equal(codex?.verified, false)
    assert.equal(codex?.version, 'codex-test')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('successful local agent smoke persists verification to config', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-persist-smoke-'))
  const command = writeExecutable(join(dir, 'codex'),
    'if [ "$1" = "--version" ]; then echo codex-test; exit 0; fi\necho TURING_READY',
    'if "%~1"=="--version" (echo codex-test & exit /b 0)\necho TURING_READY'
  )

  await withConfigHome(async () => {
    writeConfig({
      ...DEFAULT_CONFIG,
      agents: {
        codex: {
          adapter: 'codex',
          command,
          args: ['{prompt}'],
          timeout: 1_000,
        },
      },
    })
    const catalog = new AgentCatalog(loadConfig().agents, true)
    const diagnostic = await catalog.diagnoseAgent('codex', true)
    const saved = JSON.parse(readFileSync(getConfigPath(), 'utf-8'))

    assert.equal(diagnostic?.smokeOk, true)
    assert.equal(saved.agents.codex.lastVerifiedVersion, 'codex-test')
    assert.equal(typeof saved.agents.codex.lastVerifiedAt, 'number')
    assert.ok(saved.agents.codex.lastVerifiedAt > 0)
  })

  rmSync(dir, { recursive: true, force: true })
})

test('fresh AgentCatalog trusts persisted verification when binary version still matches', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-persist-restart-'))
  const command = writeExecutable(join(dir, 'codex'),
    'if [ "$1" = "--version" ]; then echo codex-test; exit 0; fi\nexit 2',
    'if "%~1"=="--version" (echo codex-test & exit /b 0)\nexit /b 2'
  )

  await withConfigHome(async () => {
    writeConfig({
      ...DEFAULT_CONFIG,
      agents: {
        codex: {
          adapter: 'codex',
          command,
          args: ['{prompt}'],
          timeout: 1_000,
          lastVerifiedAt: Date.now(),
          lastVerifiedVersion: 'codex-test',
        },
      },
    })
    const restarted = new AgentCatalog(loadConfig().agents, true)
    const codex = (await restarted.listAgents()).find((agent) => agent.name === 'codex')

    assert.equal(codex?.healthy, true)
    assert.equal(codex?.verified, true)
    assert.equal(codex?.version, 'codex-test')
  })

  rmSync(dir, { recursive: true, force: true })
})

test('cold listAgents returns stored verification before background version refresh', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-persist-mismatch-'))
  const command = writeExecutable(join(dir, 'codex'),
    'if [ "$1" = "--version" ]; then echo codex-new; exit 0; fi\nexit 2',
    'if "%~1"=="--version" (echo codex-new & exit /b 0)\nexit /b 2'
  )

  await withConfigHome(async () => {
    writeConfig({
      ...DEFAULT_CONFIG,
      agents: {
        codex: {
          adapter: 'codex',
          command,
          args: ['{prompt}'],
          timeout: 1_000,
          lastVerifiedAt: Date.now(),
          lastVerifiedVersion: 'codex-old',
        },
      },
    })
    const catalog = new AgentCatalog(loadConfig().agents, true)
    const codex = (await catalog.listAgents()).find((agent) => agent.name === 'codex')

    assert.equal(codex?.healthy, true)
    assert.equal(codex?.verified, true)
    assert.equal(codex?.version, 'codex-old')
  })

  rmSync(dir, { recursive: true, force: true })
})

test('configured local agent without persisted verification is unverified', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-no-persist-'))
  const command = writeExecutable(join(dir, 'codex'),
    'if [ "$1" = "--version" ]; then echo codex-test; exit 0; fi\nexit 2',
    'if "%~1"=="--version" (echo codex-test & exit /b 0)\nexit /b 2'
  )

  await withConfigHome(async () => {
    writeConfig({
      ...DEFAULT_CONFIG,
      agents: {
        codex: {
          adapter: 'codex',
          command,
          args: ['{prompt}'],
          timeout: 1_000,
        },
      },
    })
    const catalog = new AgentCatalog(loadConfig().agents, true)
    const codex = (await catalog.listAgents()).find((agent) => agent.name === 'codex')

    assert.equal(codex?.healthy, true)
    assert.equal(codex?.verified, false)
    assert.equal(codex?.version, undefined)
  })

  rmSync(dir, { recursive: true, force: true })
})

// --- win32 extension resolution tests (run on any OS via platform injection) ---

test('win32: discovers the full supported CLI agent set from npm-style .cmd shims', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'passiton-win32-agent-set-'))
  const oldAppData = process.env.APPDATA
  const oldLocalAppData = process.env.LOCALAPPDATA
  const commands = [
    'codex', 'claude', 'gemini', 'opencode', 'copilot', 'cursor-agent',
    'qwen', 'cline', 'aider', 'droid', 'amp', 'openhands', 'vibe',
  ]
  for (const command of commands) {
    const filePath = join(dir, `${command}.cmd`)
    if (process.platform === 'win32') {
      writeFileSync(filePath, '@echo off\r\nif "%~1"=="--version" (echo fake-agent-1.0 & exit /b 0)\r\necho TURING_READY\r\n')
    } else {
      writeFileSync(filePath, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo fake-agent-1.0; exit 0; fi\necho TURING_READY\n')
      chmodSync(filePath, 0o755)
    }
  }
  setExtraAgentSearchPathsForTesting([dir])
  setPlatformForTesting('win32')
  process.env.APPDATA = join(dir, 'appdata')
  process.env.LOCALAPPDATA = join(dir, 'localappdata')

  try {
    const catalog = new AgentCatalog({}, true)
    await catalog.discover({ refresh: true })
    const discovered = await catalog.listAgents({ refresh: true })
    const names = discovered.map((agent) => agent.name).sort()

    assert.deepEqual(names, [
      'aider', 'amp', 'claude-code', 'cline', 'codex', 'copilot',
      'cursor-agent', 'droid', 'gemini-cli', 'mistral-vibe', 'opencode',
      'openhands', 'qwen-code',
    ])
    assert.ok(discovered.every((agent) => agent.source === 'discovered'))
    assert.ok(discovered.every((agent) => agent.healthy))
    assert.ok(discovered.every((agent) => agent.command?.endsWith('.cmd')))
  } finally {
    if (oldAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = oldAppData
    if (oldLocalAppData === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = oldLocalAppData
    rmSync(dir, { recursive: true, force: true })
  }
})

test('win32: resolveCommand prefers .exe over .cmd and bare name', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-win32-exe-'))
  writeFileSync(join(dir, 'claude.exe'), 'fake exe')
  writeFileSync(join(dir, 'claude.cmd'), 'fake cmd')
  writeFileSync(join(dir, 'claude'), 'fake bare')
  setExtraAgentSearchPathsForTesting([dir])
  setPlatformForTesting('win32')

  try {
    const result = await findExecutable(['claude'])
    assert.equal(result, join(dir, 'claude.exe'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('win32: resolveCommand prefers .cmd over bare name when .exe absent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-win32-cmd-'))
  writeFileSync(join(dir, 'codex.cmd'), 'fake cmd')
  writeFileSync(join(dir, 'codex'), 'fake bare')
  setExtraAgentSearchPathsForTesting([dir])
  setPlatformForTesting('win32')

  try {
    const result = await findExecutable(['codex'])
    assert.equal(result, join(dir, 'codex.cmd'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('win32: resolveCommand tries bare name LAST', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-win32-bare-'))
  writeFileSync(join(dir, 'gemini'), 'fake bare')
  setExtraAgentSearchPathsForTesting([dir])
  setPlatformForTesting('win32')

  try {
    const result = await findExecutable(['gemini'])
    assert.equal(result, join(dir, 'gemini'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('win32: resolveCommand with full path adds .exe extension', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-win32-path-'))
  writeFileSync(join(dir, 'claude.exe'), 'fake exe')
  setExtraAgentSearchPathsForTesting([dir])
  setPlatformForTesting('win32')

  try {
    const result = await findExecutable([join(dir, 'claude')])
    assert.equal(result, join(dir, 'claude.exe'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('win32: resolveCommand respects PATHEXT for additional extensions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-win32-pathext-'))
  writeFileSync(join(dir, 'opencode.ps1'), 'fake ps1')
  setExtraAgentSearchPathsForTesting([dir])
  setPlatformForTesting('win32')
  process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD;.PS1'

  try {
    const result = await findExecutable(['opencode'])
    assert.equal(result, join(dir, 'opencode.ps1'))
  } finally {
    delete process.env.PATHEXT
    rmSync(dir, { recursive: true, force: true })
  }
})

test('win32: .cmd found when .exe absent (npm bash shim scenario)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-win32-npm-'))
  // Simulate npm install: bare shim (Git Bash) + .cmd sibling
  writeFileSync(join(dir, 'codex'), '#!/bin/sh\nnode ...')
  writeFileSync(join(dir, 'codex.cmd'), '@echo off\nnode ...')
  setExtraAgentSearchPathsForTesting([dir])
  setPlatformForTesting('win32')

  try {
    const result = await findExecutable(['codex'])
    assert.equal(result, join(dir, 'codex.cmd'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('non-win32: bare name resolution unchanged (no extension appending)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-nowin32-'))
  // This test injects 'linux' platform to verify non-win32 resolution logic.
  // Write a bare executable directly (not via writeExecutable, which would
  // create a .cmd file on real win32).
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'claude'), '#!/bin/sh\necho test\n')
  if (!isWin32) chmodSync(join(dir, 'claude'), 0o755)
  setExtraAgentSearchPathsForTesting([dir])
  setPlatformForTesting('linux')

  try {
    const result = await findExecutable(['claude'])
    assert.equal(result, join(dir, 'claude'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const isWin32 = process.platform === 'win32'

async function withConfigHome(run: () => Promise<void>): Promise<void> {
  const savedHome = process.env.PASSITON_HOME
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-config-'))
  process.env.PASSITON_HOME = dir
  try {
    await run()
  } finally {
    if (savedHome === undefined) delete process.env.PASSITON_HOME
    else process.env.PASSITON_HOME = savedHome
    rmSync(dir, { recursive: true, force: true })
  }
}

function writeExecutable(filePath: string, posixBody = 'echo test-version', win32Body?: string): string {
  mkdirSync(dirname(filePath), { recursive: true })
  if (isWin32) {
    const cmdPath = filePath + '.cmd'
    writeFileSync(cmdPath, `@echo off\n${win32Body ?? posixBody}\n`)
    return cmdPath
  }
  writeFileSync(filePath, `#!/bin/sh\n${posixBody}\n`)
  chmodSync(filePath, 0o755)
  return filePath
}
