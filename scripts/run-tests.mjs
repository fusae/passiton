// Cross-platform test runner: shell glob expansion is unavailable on
// Windows (cmd/pwsh pass `dist/tests/*.test.js` through literally), and
// `node --test` with no args also picks up src/tests/*.test.ts sources.
// Enumerate the compiled test files explicitly instead.
import { readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'tests')
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => join(dir, f))

if (files.length === 0) {
  console.error('run-tests: no compiled test files found in dist/tests — run `npm run build` first')
  process.exit(1)
}

// Isolate the whole test process from the user's real data directory.
// A test draft that forgets to set PASSITON_HOME once polluted the real
// ~/.turing config (test agents, cleared verification records, a tmpdir
// allowedWorkspaces). Forcing an isolated home here makes that class of
// leak structurally impossible, regardless of individual test discipline.
const isolatedHome = mkdtempSync(join(tmpdir(), 'passiton-test-home-'))
const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  env: { ...process.env, PASSITON_HOME: isolatedHome, TURING_HOME: '' },
})
rmSync(isolatedHome, { recursive: true, force: true })
process.exit(result.status ?? 1)
