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
  assert.deepEqual(
    applyPermissionModeArgs('copilot-cli', ['-p', '{prompt}'], 'trusted'),
    ['-p', '{prompt}', '--allow-all']
  )
  assert.deepEqual(
    applyPermissionModeArgs('cursor-agent', ['-p', '{prompt}'], 'trusted'),
    ['-p', '{prompt}', '--force']
  )
  assert.deepEqual(
    applyPermissionModeArgs('qwen-code', ['-p', '{prompt}'], 'trusted'),
    ['-p', '{prompt}', '--yolo']
  )
  assert.deepEqual(
    applyPermissionModeArgs('cline', ['{prompt}'], 'trusted'),
    ['-y', '{prompt}']
  )
  assert.deepEqual(
    applyPermissionModeArgs('droid', ['exec', '{prompt}'], 'trusted'),
    ['exec', '--skip-permissions-unsafe', '{prompt}']
  )
  assert.deepEqual(
    applyPermissionModeArgs('mistral-vibe', ['--prompt', '{prompt}'], 'trusted'),
    ['--prompt', '{prompt}', '--agent', 'auto-approve', '--trust']
  )
})

test('safe permission mode makes aider read-only', () => {
  assert.deepEqual(
    applyPermissionModeArgs('aider', ['--message', '{prompt}', '--yes-always'], 'safe'),
    ['--message', '{prompt}', '--dry-run']
  )
})
