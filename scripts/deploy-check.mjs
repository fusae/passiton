import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const port = process.env.PORT || process.env.TURING_PORT || '4590'
const base = process.env.TURING_BASE_URL || `http://127.0.0.1:${port}`

const checks = [
  ['package', () => Boolean(pkg.name && pkg.version)],
  ['dist entry', () => existsSync(new URL('../dist/index.js', import.meta.url))],
]

let failed = false
for (const [name, check] of checks) {
  try {
    if (!check()) throw new Error('failed')
    console.log(`ok ${name}`)
  } catch (err) {
    failed = true
    console.error(`fail ${name}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

try {
  const health = await request(`${base}/health`, 2_000)
  console.log(`ok health ${health.status}`)
} catch (err) {
  console.log(`skip health: ${err instanceof Error ? err.message : String(err)}`)
}

if (failed) process.exit(1)

function request(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume()
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode })
        } else {
          reject(new Error(`HTTP ${res.statusCode}`))
        }
      })
    })
    req.on('timeout', () => {
      req.destroy(new Error('timeout'))
    })
    req.on('error', reject)
  })
}
