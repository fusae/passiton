import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPermissionModeArgs } from '../adapters/command-args.js'

test('safe permission mode strips CLI auto-approval flags', () => {
  assert.deepEqual(
    applyPermissionModeArgs('opencode', ['run', '{prompt}', '--dangerously-skip-permissions'], 'safe'),
    ['run', '{prompt}']
  )
  assert.deepEqual(
    applyPermissionModeArgs('codex', ['exec', '--full-auto', '--ephemeral', '{prompt}'], 'safe'),
    ['exec', '--ephemeral', '{prompt}']
  )
})

test('trusted permission mode injects adapter-specific auto-approval flags', () => {
  assert.deepEqual(
    applyPermissionModeArgs('claude-code', ['-p', '{prompt}'], 'trusted'),
    ['-p', '{prompt}', '--dangerously-skip-permissions']
  )
  assert.deepEqual(
    applyPermissionModeArgs('codex', ['exec', '--ephemeral', '{prompt}'], 'trusted'),
    ['exec', '--ephemeral', '--dangerously-bypass-approvals-and-sandbox', '{prompt}']
  )
})
