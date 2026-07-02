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

test('AgentCatalog discovers bundled CLI agents and ignores unknown binaries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-discover-'))
  writeExecutable(join(dir, 'codex'), 'echo codex-test')
  // An agent without a bundled adapter (aider) should NOT be auto-discovered —
  // only the four shipped CLI presets are. Users can still register custom
  // adapters explicitly. See docs/community-adapters.md.
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
    assert.equal(aider, undefined)
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

test('configured local agents require a successful smoke run to be healthy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-smoke-'))
  const command = join(dir, 'codex')
  writeExecutable(command, `
if [ "$1" = "--version" ]; then echo codex-test; exit 0; fi
echo TURING_READY
`)

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

    assert.equal(codex?.source, 'configured')
    assert.equal(codex?.healthy, true)
    assert.equal(codex?.version, 'codex-test')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('configured local agents reflect installed (version probe) health without refresh', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-no-probe-'))
  const command = join(dir, 'codex')
  writeExecutable(command, `
if [ "$1" = "--version" ]; then exit 2; fi
exit 2
`)

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

    // --version exits 2 → version probe fails → not healthy (not installed),
    // and without refresh there is no smoke run, so verified stays false.
    assert.equal(codex?.source, 'configured')
    assert.equal(codex?.healthy, false)
    assert.equal(codex?.verified, false)
    assert.equal(codex?.version, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('configured local agents stay healthy-but-unverified when smoke run fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turing-agent-smoke-fail-'))
  const command = join(dir, 'codex')
  writeExecutable(command, `
if [ "$1" = "--version" ]; then echo codex-test; exit 0; fi
exit 2
`)

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

function writeExecutable(path: string, body = 'echo test-version'): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}
