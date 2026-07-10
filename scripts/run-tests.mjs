// Cross-platform test runner: shell glob expansion is unavailable on
// Windows (cmd/pwsh pass `dist/tests/*.test.js` through literally), and
// `node --test` with no args also picks up src/tests/*.test.ts sources.
// Enumerate the compiled test files explicitly instead.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'tests')
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => join(dir, f))

if (files.length === 0) {
  console.error('run-tests: no compiled test files found in dist/tests — run `npm run build` first')
  process.exit(1)
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(result.status ?? 1)
