import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { activeAgents, DEFAULT_CONFIG, LOCAL_CLI_AGENT_DEFAULTS, loadConfig, getConfigPath, writeConfig } from '../config.js'
import { resolveTuringHome } from '../paths.js'

test('default config keeps local CLI agents available', () => {
  assert.deepEqual(DEFAULT_CONFIG.agents, {})
  assert.equal(LOCAL_CLI_AGENT_DEFAULTS.codex.command, process.env.TURING_CODEX_COMMAND ?? 'codex')
  assert.equal(LOCAL_CLI_AGENT_DEFAULTS['claude-code'].command, process.env.TURING_CLAUDE_COMMAND ?? 'claude')
  assert.equal(LOCAL_CLI_AGENT_DEFAULTS['gemini-cli'].command, process.env.TURING_GEMINI_COMMAND ?? 'gemini')
  assert.deepEqual(LOCAL_CLI_AGENT_DEFAULTS['gemini-cli'].args, ['-p', '{prompt}'])
  assert.deepEqual(LOCAL_CLI_AGENT_DEFAULTS.opencode.args, ['run', '{prompt}'])
  assert.equal(LOCAL_CLI_AGENT_DEFAULTS.opencode.command, process.env.TURING_OPENCODE_COMMAND ?? 'opencode')
  assert.equal(DEFAULT_CONFIG.policy.messageRetentionMs, 30 * 24 * 60 * 60 * 1000)
  assert.deepEqual(activeAgents({
    ...DEFAULT_CONFIG,
    features: { localCliAgents: false },
    agents: { codex: LOCAL_CLI_AGENT_DEFAULTS.codex },
  }), { codex: LOCAL_CLI_AGENT_DEFAULTS.codex })
})

test('PORT environment variable overrides config port', () => {
  const savedPort = process.env.PORT
  process.env.PORT = '9876'
  try {
    const config = loadConfig()
    assert.equal(config.server.port, 9876)
  } finally {
    if (savedPort === undefined) {
      delete process.env.PORT
    } else {
      process.env.PORT = savedPort
    }
  }
})

test('TURING_HOME isolates the data directory', () => {
  const savedHome = process.env.TURING_HOME
  const tempDir = mkdtempSync(join(tmpdir(), 'turing-home-test-'))
  process.env.TURING_HOME = tempDir
  try {
    assert.equal(resolveTuringHome(), tempDir)
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
      delete process.env.TURING_HOME
    } else {
      process.env.TURING_HOME = savedHome
    }
    rmSync(tempDir, { recursive: true, force: true })
  }
})
