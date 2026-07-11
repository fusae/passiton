import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { GitCommitRecord } from './types.js'

export class WorkspaceAccessError extends Error {}
const execFileAsync = promisify(execFile)

// --- Platform injection (for testability) ---
let platformOverride: string | undefined

export function setWorkspacePlatformForTesting(platform: string | undefined): void {
  platformOverride = platform
}

function currentPlatform(): string {
  return platformOverride ?? process.platform
}

export function normalizePathForComparison(p: string, platform: string = currentPlatform()): string {
  if (platform === 'win32') {
    return p.replace(/\//g, '\\').toLowerCase()
  }
  return p
}

export function isPathInsideRoot(target: string, root: string, platform: string = currentPlatform()): boolean {
  const normTarget = normalizePathForComparison(target, platform)
  const normRoot = normalizePathForComparison(root, platform)
  const sep = platform === 'win32' ? '\\' : path.sep
  return normTarget === normRoot || normTarget.startsWith(normRoot + sep)
}

export function validateAllowedWorkspaces(entries: string[]): { ok: string[]; rejected: { path: string; reason: string }[] } {
  const ok: string[] = []
  const seen = new Set<string>()
  const rejected: { path: string; reason: string }[] = []

  for (const entry of entries) {
    const trimmed = entry.trim()
    if (!path.isAbsolute(trimmed)) {
      rejected.push({ path: trimmed, reason: 'workspace path must be absolute' })
      continue
    }

    const normalized = path.resolve(trimmed)
    const reason = unsafeWorkspaceReason(normalized)
    if (reason) {
      rejected.push({ path: normalized, reason })
      continue
    }

    const comparisonKey = normalizePathForComparison(normalized)
    if (!seen.has(comparisonKey)) {
      seen.add(comparisonKey)
      ok.push(normalized)
    }
  }

  return { ok, rejected }
}

function unsafeWorkspaceReason(workspacePath: string): string | undefined {
  const platform = currentPlatform()
  const normalized = path.normalize(workspacePath)
  const root = path.parse(normalized).root
  if (normalizePathForComparison(normalized, platform) === normalizePathForComparison(root, platform)) {
    return 'OS root is not a safe workspace'
  }

  const home = path.normalize(os.homedir())
  if (normalizePathForComparison(normalized, platform) === normalizePathForComparison(home, platform)) {
    return 'home directory root is not a safe workspace'
  }

  const temp = path.normalize(os.tmpdir())
  if (isPathInsideRoot(normalized, temp, platform)) {
    return 'temp directory is not a safe workspace'
  }

  if (platform !== 'win32') {
    for (const dangerousRoot of ['/tmp', '/private/tmp']) {
      if (normalizePathForComparison(normalized, platform) === normalizePathForComparison(path.normalize(dangerousRoot), platform)) {
        return `${dangerousRoot} is not a safe workspace`
      }
    }
    const varFolders = path.normalize('/var/folders')
    if (isPathInsideRoot(normalized, varFolders, platform)) {
      return '/var/folders is not a safe workspace'
    }
  }

  return undefined
}

export function defaultWorkspaceRoots(): string[] {
  return [process.cwd()]
}

export async function collectGitCommitsDuringWindow(cwd: string, startedAt: number, finishedAt: number): Promise<GitCommitRecord[]> {
  try {
    const since = new Date(startedAt).toISOString()
    const until = new Date(finishedAt).toISOString()
    const { stdout } = await execFileAsync('git', [
      'log',
      `--since=${since}`,
      `--until=${until}`,
      '--format=%H%x1f%cI%x1f%s%x1e',
    ], {
      cwd,
      timeout: 500,
      maxBuffer: 1024 * 1024,
    })
    return stdout
      .split('\x1e')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [hash, committedAtRaw, subject = ''] = entry.split('\x1f')
        return {
          hash,
          subject,
          committedAt: Date.parse(committedAtRaw),
        }
      })
      .filter((commit) => commit.hash && Number.isFinite(commit.committedAt))
  } catch {
    return []
  }
}

export function allowedWorkspaceRoots(configured: string[] = []): string[] {
  const roots = configured.length > 0 ? configured : defaultWorkspaceRoots()
  return Array.from(new Set(roots.map((root) => realpathExisting(root))))
}

export function resolveWorkspacePath(
  inputPath: string,
  options: {
    field?: string
    baseDir?: string
    allowedRoots?: string[]
    mustExist?: boolean
    requireDirectory?: boolean
    requireFile?: boolean
  } = {}
): string {
  const field = options.field ?? 'path'
  const trimmed = inputPath.trim()
  if (!trimmed) throw new WorkspaceAccessError(`"${field}" must be a non-empty path`)

  const baseDir = options.baseDir ? realpathExisting(options.baseDir) : process.cwd()
  const resolved = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(baseDir, trimmed)
  const real = options.mustExist ? realpathExisting(resolved) : realpathForPossiblyMissing(resolved)
  assertInsideAllowedRoots(real, options.allowedRoots ?? defaultWorkspaceRoots(), field)

  if (options.requireDirectory && !fs.statSync(real).isDirectory()) {
    throw new WorkspaceAccessError(`"${field}" must be a directory`)
  }
  if (options.requireFile && !fs.statSync(real).isFile()) {
    throw new WorkspaceAccessError(`"${field}" must be a file`)
  }
  return real
}

export function assertInsideAllowedRoots(target: string, roots: string[], field = 'path'): void {
  const realRoots = allowedWorkspaceRoots(roots)
  const matched = realRoots.some((root) => isPathInsideRoot(target, root))
  if (!matched) {
    throw new WorkspaceAccessError(`"${field}" is outside allowed workspaces`)
  }
}

function realpathExisting(filePath: string): string {
  try {
    return fs.realpathSync.native(path.resolve(filePath))
  } catch (err) {
    throw new WorkspaceAccessError(err instanceof Error ? err.message : String(err))
  }
}

function realpathForPossiblyMissing(filePath: string): string {
  let current = path.resolve(filePath)
  const missingParts: string[] = []
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) throw new WorkspaceAccessError(`Path does not exist: ${filePath}`)
    missingParts.unshift(path.basename(current))
    current = parent
  }
  const realParent = realpathExisting(current)
  return path.resolve(realParent, ...missingParts)
}
