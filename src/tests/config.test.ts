import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG } from '../config.js'

test('default commands are portable', () => {
  assert.equal(DEFAULT_CONFIG.agents.codex.command, process.env.TURING_CODEX_COMMAND ?? 'codex')
  assert.equal(DEFAULT_CONFIG.agents['claude-code'].command, process.env.TURING_CLAUDE_COMMAND ?? 'claude')
  assert.equal(DEFAULT_CONFIG.agents.opencode.command, process.env.TURING_OPENCODE_COMMAND ?? 'opencode')
})
