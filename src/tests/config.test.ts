import test from 'node:test'
import assert from 'node:assert/strict'
import { activeAgents, DEFAULT_CONFIG, LOCAL_CLI_AGENT_DEFAULTS } from '../config.js'

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
