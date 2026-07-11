import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path, { join } from 'node:path'
import { checkSessionTimeout } from '../policy.js'
import { resolveWorkspacePath, WorkspaceAccessError, setWorkspacePlatformForTesting, normalizePathForComparison, isPathInsideRoot, validateAllowedWorkspaces } from '../workspace.js'
import type { Session } from '../types.js'

test('session timeout uses last update time so approval waits can resume', () => {
  const now = Date.now()
  const session = {
    createdAt: now - 24 * 60 * 60 * 1000,
    updatedAt: now,
  } as Session

  assert.deepEqual(checkSessionTimeout(session, {
    maxRounds: 20,
    messageTimeout: 1000,
    messageRetentionMs: 1000,
    sessionTimeout: 2 * 60 * 60 * 1000,
    retries: 0,
  }), { allowed: true })
})

test('workspace resolver allows normal child paths', () => {
  withTempDirs((root) => {
    const project = join(root, 'project')
    mkdirSync(project)
    const file = join(project, 'README.md')
    writeFileSync(file, 'ok')

    assert.equal(resolveWorkspacePath('README.md', {
      baseDir: project,
      allowedRoots: [root],
      mustExist: true,
      requireFile: true,
    }), realpathSync.native(file))
  })
})

test('workspace resolver blocks parent traversal and absolute escapes', () => {
  withTempDirs((root, outside) => {
    const project = join(root, 'project')
    mkdirSync(project)
    writeFileSync(join(outside, 'secret.txt'), 'secret')

    assert.throws(() => resolveWorkspacePath('../outside/secret.txt', {
      baseDir: project,
      allowedRoots: [project],
      mustExist: true,
    }), WorkspaceAccessError)

    assert.throws(() => resolveWorkspacePath(join(outside, 'secret.txt'), {
      allowedRoots: [project],
      mustExist: true,
    }), WorkspaceAccessError)
  })
})

test('workspace resolver blocks symlink escapes when platform supports symlinks', () => {
  withTempDirs((root, outside) => {
    const project = join(root, 'project')
    mkdirSync(project)
    const secret = join(outside, 'secret.txt')
    writeFileSync(secret, 'secret')
    try {
      symlinkSync(secret, join(project, 'linked-secret.txt'))
    } catch {
      return
    }

    assert.throws(() => resolveWorkspacePath('linked-secret.txt', {
      baseDir: project,
      allowedRoots: [project],
      mustExist: true,
      requireFile: true,
    }), WorkspaceAccessError)
  })
})

test('workspace resolver defaults empty allowed roots to process cwd', () => {
  const originalCwd = process.cwd()
  withTempDirs((root, outside) => {
    const file = join(root, 'ok.txt')
    const secret = join(outside, 'secret.txt')
    writeFileSync(file, 'ok')
    writeFileSync(secret, 'secret')
    process.chdir(root)
    try {
      assert.equal(resolveWorkspacePath('ok.txt', { allowedRoots: [], mustExist: true, requireFile: true }), realpathSync.native(file))
      assert.throws(() => resolveWorkspacePath(secret, { allowedRoots: [], mustExist: true }), WorkspaceAccessError)
    } finally {
      process.chdir(originalCwd)
    }
  })
})

test('validateAllowedWorkspaces rejects dangerous entries and accepts a normal project dir', () => {
  const project = path.join(process.cwd(), 'example-project')
  const result = validateAllowedWorkspaces([
    'relative-project',
    path.parse(process.cwd()).root,
    homedir(),
    tmpdir(),
    project,
    `${project}${path.sep}`,
  ])

  assert.deepEqual(result.ok, [project])
  assert.ok(result.rejected.some((item) => item.path === 'relative-project' && /absolute/.test(item.reason)))
  assert.ok(result.rejected.some((item) => item.path === path.parse(process.cwd()).root && /OS root/.test(item.reason)))
  assert.ok(result.rejected.some((item) => item.path === path.normalize(homedir()) && /home directory root/.test(item.reason)))
  assert.ok(result.rejected.some((item) => item.path === path.normalize(tmpdir()) && /temp directory/.test(item.reason)))
})

function withTempDirs(fn: (root: string, outside: string) => void): void {
  const parent = mkdtempSync(join(tmpdir(), 'turing-workspace-test-'))
  const root = join(parent, 'root')
  const outside = join(parent, 'outside')
  mkdirSync(root)
  mkdirSync(outside)
  try {
    fn(root, outside)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
}

// --- win32 path normalization tests ---

test.afterEach(() => {
  setWorkspacePlatformForTesting(undefined)
})

test('win32: normalizePathForComparison replaces separators and lowercases', () => {
  assert.equal(
    normalizePathForComparison('C:/Users/X/Projects', 'win32'),
    'c:\\users\\x\\projects'
  )
  assert.equal(
    normalizePathForComparison('C:\\Users\\X\\Projects', 'win32'),
    'c:\\users\\x\\projects'
  )
  assert.equal(
    normalizePathForComparison('/home/user/proj', 'linux'),
    '/home/user/proj'
  )
})

test('win32: isPathInsideRoot matches case-insensitively and across separators', () => {
  const root = 'C:\\Users\\James\\Projects'
  const target = 'c:/users/james/projects/myapp'
  assert.ok(isPathInsideRoot(target, root, 'win32'))
  assert.ok(isPathInsideRoot(root, root, 'win32'))
})

test('win32: isPathInsideRoot rejects paths outside root', () => {
  const root = 'C:\\Users\\James\\Projects'
  const target = 'D:\\Users\\James\\Projects'
  assert.ok(!isPathInsideRoot(target, root, 'win32'))
})

test('win32: isPathInsideRoot does not false-positive on prefix matches', () => {
  const root = 'C:\\Users\\James\\Projects'
  // "Projects-2" should NOT match inside "Projects"
  const target = 'c:/users/james/projects-2/app'
  assert.ok(!isPathInsideRoot(target, root, 'win32'))
})
