import { mkdirSync, readdirSync, copyFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = join(__dirname, '..', 'src', 'web')
const destDir = join(__dirname, '..', 'dist', 'web')

if (!existsSync(srcDir)) {
  console.error(`copy-web: source directory not found: ${srcDir}`)
  process.exit(1)
}

mkdirSync(destDir, { recursive: true })

const exts = ['.html', '.js', '.css']
let count = 0

for (const file of readdirSync(srcDir)) {
  if (exts.some((ext) => file.endsWith(ext))) {
    copyFileSync(join(srcDir, file), join(destDir, file))
    count++
  }
}

console.log(`copy-web: copied ${count} file(s) to dist/web`)
