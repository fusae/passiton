import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { AgentCatalog, findExecutable, setExtraAgentSearchPathsForTesting } from '../agents.js'
import { registerConfiguredAdapters } from '../adapters/factory.js'
import { Router } from '../router.js'

test.afterEach(() => {
  setExtraAgentSearchPathsForTesting([])
  delete process.env.TURING_CODEX_COMMAND
})

test('findExecutable prefers explicit env command paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-env-'))
  const command = join(dir, 'my-codex')
  writeExecutable(command)
  process.env.TURING_CODEX_COMMAND = command

  try {
    assert.equal(await findExecutable(['codex'], ['TURING_CODEX_COMMAND']), command)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findExecutable searches fallback bin paths outside PATH', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-bin-'))
  const command = join(dir, 'codex')
  writeExecutable(command)
  setExtraAgentSearchPathsForTesting([dir])

  try {
    assert.equal(await findExecutable(['codex']), command)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('AgentCatalog discovers supported and unsupported local agents', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-discover-'))
  writeExecutable(join(dir, 'codex'), 'echo codex-test')
  writeExecutable(join(dir, 'aider'), 'echo aider-test')
  setExtraAgentSearchPathsForTesting([dir])

  const catalog = new AgentCatalog({}, true)
  await catalog.discover()
  const agents = await catalog.listAgents()
  const codex = agents.find((agent) => agent.name === 'codex')
  const aider = agents.find((agent) => agent.name === 'aider')

  try {
    assert.equal(codex?.source, 'discovered')
    assert.equal(codex?.availableForSessions, true)
    assert.equal(codex?.healthy, true)
    assert.equal(aider?.availableForSessions, false)
    assert.equal(aider?.healthy, true)
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
    rmSync(dir, { recursive: true, force: true })
  }
})

function writeExecutable(path: string, body = 'echo test-version'): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}
