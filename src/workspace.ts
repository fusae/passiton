import fs from 'fs'
import path from 'path'

export class WorkspaceAccessError extends Error {}

export function defaultWorkspaceRoots(): string[] {
  return [process.cwd()]
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
  const matched = realRoots.some((root) => target === root || target.startsWith(`${root}${path.sep}`))
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
