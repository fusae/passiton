import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { activeAgents, DEFAULT_CONFIG, LOCAL_CLI_AGENT_DEFAULTS, loadConfig, getConfigPath, writeConfig } from '../config.js'
import { resolveDataHome } from '../paths.js'

test('default config keeps local CLI agents available', () => {
  assert.deepEqual(DEFAULT_CONFIG.agents, {})
  assert.equal(LOCAL_CLI_AGENT_DEFAULTS.codex.command, process.env.PASSITON_CODEX_COMMAND ?? process.env.TURING_CODEX_COMMAND ?? 'codex')
  assert.equal(LOCAL_CLI_AGENT_DEFAULTS['claude-code'].command, process.env.PASSITON_CLAUDE_COMMAND ?? process.env.TURING_CLAUDE_COMMAND ?? 'claude')
  assert.equal(LOCAL_CLI_AGENT_DEFAULTS['gemini-cli'].command, process.env.PASSITON_GEMINI_COMMAND ?? process.env.TURING_GEMINI_COMMAND ?? 'gemini')
  assert.deepEqual(LOCAL_CLI_AGENT_DEFAULTS['gemini-cli'].args, ['-p', '{prompt}'])
  assert.deepEqual(LOCAL_CLI_AGENT_DEFAULTS.opencode.args, ['run', '{prompt}'])
  assert.equal(LOCAL_CLI_AGENT_DEFAULTS.opencode.command, process.env.PASSITON_OPENCODE_COMMAND ?? process.env.TURING_OPENCODE_COMMAND ?? 'opencode')
  assert.equal(DEFAULT_CONFIG.policy.messageRetentionMs, 30 * 24 * 60 * 60 * 1000)
  assert.deepEqual(activeAgents({
    ...DEFAULT_CONFIG,
    features: { localCliAgents: false },
    agents: { codex: LOCAL_CLI_AGENT_DEFAULTS.codex },
  }), { codex: LOCAL_CLI_AGENT_DEFAULTS.codex })
})

test('PORT environment variable overrides config port', () => {
  const savedPort = process.env.PORT
  const savedHome = process.env.PASSITON_HOME
  const tempDir = mkdtempSync(join(tmpdir(), 'turing-port-test-'))
  process.env.PORT = '9876'
  process.env.PASSITON_HOME = tempDir
  try {
    const config = loadConfig()
    assert.equal(config.server.port, 9876)
  } finally {
    if (savedPort === undefined) {
      delete process.env.PORT
    } else {
      process.env.PORT = savedPort
    }
    if (savedHome === undefined) {
      delete process.env.PASSITON_HOME
    } else {
      process.env.PASSITON_HOME = savedHome
    }
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('PASSITON_HOME isolates the data directory', () => {
  const savedHome = process.env.PASSITON_HOME
  const tempDir = mkdtempSync(join(tmpdir(), 'turing-home-test-'))
  process.env.PASSITON_HOME = tempDir
  try {
    assert.equal(resolveDataHome(), tempDir)
    assert.equal(getConfigPath(), join(tempDir, 'config.json'))

    const customConfig = {
      ...DEFAULT_CONFIG,
      server: { port: 11111, host: '127.0.0.1' },
    }
    mkdirSync(tempDir, { recursive: true })
    writeConfig(customConfig)

    const loaded = loadConfig()
    assert.equal(loaded.server.port, 11111)
  } finally {
    if (savedHome === undefined) {
      delete process.env.PASSITON_HOME
    } else {
      process.env.PASSITON_HOME = savedHome
    }
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('loadConfig validates local CLI agent priority', () => {
  const savedHome = process.env.PASSITON_HOME
  const tempDir = mkdtempSync(join(tmpdir(), 'turing-priority-test-'))
  process.env.PASSITON_HOME = tempDir
  try {
    mkdirSync(tempDir, { recursive: true })
    writeFileSync(join(tempDir, 'config.json'), JSON.stringify({
      ...DEFAULT_CONFIG,
      agents: {
        codex: {
          ...LOCAL_CLI_AGENT_DEFAULTS.codex,
          priority: 0,
        },
      },
    }))
    assert.throws(() => loadConfig(), /agents\.codex\.priority.*positive integer/)
  } finally {
    if (savedHome === undefined) {
      delete process.env.PASSITON_HOME
    } else {
      process.env.PASSITON_HOME = savedHome
    }
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('TURING_HOME remains a data directory fallback', () => {
  const savedPassitonHome = process.env.PASSITON_HOME
  const savedTuringHome = process.env.TURING_HOME
  const tempDir = mkdtempSync(join(tmpdir(), 'turing-home-fallback-test-'))
  delete process.env.PASSITON_HOME
  process.env.TURING_HOME = tempDir
  try {
    assert.equal(resolveDataHome(), tempDir)
  } finally {
    if (savedPassitonHome === undefined) delete process.env.PASSITON_HOME
    else process.env.PASSITON_HOME = savedPassitonHome
    if (savedTuringHome === undefined) delete process.env.TURING_HOME
    else process.env.TURING_HOME = savedTuringHome
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('first loadConfig persists config.json with jwtSecret before listen', () => {
  const savedHome = process.env.PASSITON_HOME
  const savedJwt = process.env.PASSITON_JWT_SECRET
  const tempDir = mkdtempSync(join(tmpdir(), 'turing-persist-test-'))
  process.env.PASSITON_HOME = tempDir
  delete process.env.PASSITON_JWT_SECRET
  try {
    const configPath = join(tempDir, 'config.json')

    // Before loadConfig, no config.json
    assert.equal(existsSync(configPath), false)

    // First loadConfig should create config.json with secrets
    loadConfig()

    assert.ok(existsSync(configPath), 'config.json should exist after loadConfig')

    const raw = JSON.parse(readFileSync(configPath, 'utf-8'))
    assert.ok(raw.auth?.jwtSecret, 'config.json should contain auth.jwtSecret')
    assert.ok(raw.auth.jwtSecret.length > 0, 'jwtSecret should be non-empty')
    assert.ok(raw.auth?.encryptionKey, 'config.json should contain auth.encryptionKey')

    // Idempotent: second loadConfig must not overwrite secrets
    const firstJwt = raw.auth.jwtSecret
    loadConfig()
    const raw2 = JSON.parse(readFileSync(configPath, 'utf-8'))
    assert.equal(raw2.auth.jwtSecret, firstJwt, 'jwtSecret should not change on second loadConfig')
  } finally {
    if (savedHome === undefined) {
      delete process.env.PASSITON_HOME
    } else {
      process.env.PASSITON_HOME = savedHome
    }
    if (savedJwt === undefined) {
      delete process.env.PASSITON_JWT_SECRET
    } else {
      process.env.PASSITON_JWT_SECRET = savedJwt
    }
    rmSync(tempDir, { recursive: true, force: true })
  }
})
