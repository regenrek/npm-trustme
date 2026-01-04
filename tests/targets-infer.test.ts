import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { inferPackageName, inferWorkflowFile, parseGitHubRemote } from '../src/core/targets/infer.js'
import { resolvePackageTarget } from '../src/core/targets/workspace.js'

function tempDir(prefix: string) {
  return mkdtempSync(resolve(tmpdir(), prefix))
}

describe('target inference', () => {
  it('parses GitHub remote URLs', () => {
    expect(parseGitHubRemote('git@github.com:regenrek/npm-trustme.git')).toEqual({
      owner: 'regenrek',
      repo: 'npm-trustme'
    })
    expect(parseGitHubRemote('https://github.com/regenrek/npm-trustme')).toEqual({
      owner: 'regenrek',
      repo: 'npm-trustme'
    })
    expect(parseGitHubRemote('git+https://github.com/regenrek/npm-trustme.git')).toEqual({
      owner: 'regenrek',
      repo: 'npm-trustme'
    })
    expect(parseGitHubRemote('github:regenrek/npm-trustme')).toEqual({
      owner: 'regenrek',
      repo: 'npm-trustme'
    })
    expect(parseGitHubRemote('regenrek/npm-trustme')).toEqual({
      owner: 'regenrek',
      repo: 'npm-trustme'
    })
  })

  it('infers package name from package.json', () => {
    const dir = tempDir('npm-trustme-pkg-')
    try {
      writeFileSync(resolve(dir, 'package.json'), JSON.stringify({ name: 'demo-pkg' }), 'utf8')
      expect(inferPackageName(dir)).toBe('demo-pkg')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prefers npm-release.yml and otherwise uses single workflow file', () => {
    const dir = tempDir('npm-trustme-wf-')
    try {
      const workflowsDir = resolve(dir, '.github', 'workflows')
      mkdirSync(workflowsDir, { recursive: true })
      writeFileSync(resolve(workflowsDir, 'npm-release.yml'), 'name: npm Release', 'utf8')
      expect(inferWorkflowFile(dir)).toBe('npm-release.yml')

      rmSync(resolve(workflowsDir, 'npm-release.yml'))
      writeFileSync(resolve(workflowsDir, 'other.yml'), 'name: other', 'utf8')
      expect(inferWorkflowFile(dir)).toBe('other.yml')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves workspace package based on cwd', () => {
    const dir = tempDir('npm-trustme-workspace-')
    try {
      writeFileSync(resolve(dir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n', 'utf8')
      const pkgADir = resolve(dir, 'packages', 'pkg-a')
      const pkgBDir = resolve(dir, 'packages', 'pkg-b')
      mkdirSync(pkgADir, { recursive: true })
      mkdirSync(pkgBDir, { recursive: true })
      writeFileSync(resolve(pkgADir, 'package.json'), JSON.stringify({ name: 'pkg-a' }), 'utf8')
      writeFileSync(resolve(pkgBDir, 'package.json'), JSON.stringify({ name: 'pkg-b' }), 'utf8')

      const resolved = resolvePackageTarget({ cwd: pkgADir, rootDir: dir })
      expect(resolved.packageName).toBe('pkg-a')
      expect(resolved.reason).toBe('workspace-cwd')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('requires explicit selection when multiple workspace packages exist', () => {
    const dir = tempDir('npm-trustme-workspace-multi-')
    try {
      writeFileSync(resolve(dir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n', 'utf8')
      const pkgADir = resolve(dir, 'packages', 'pkg-a')
      const pkgBDir = resolve(dir, 'packages', 'pkg-b')
      mkdirSync(pkgADir, { recursive: true })
      mkdirSync(pkgBDir, { recursive: true })
      writeFileSync(resolve(pkgADir, 'package.json'), JSON.stringify({ name: 'pkg-a' }), 'utf8')
      writeFileSync(resolve(pkgBDir, 'package.json'), JSON.stringify({ name: 'pkg-b' }), 'utf8')

      expect(() => resolvePackageTarget({ cwd: dir, rootDir: dir })).toThrow(/Multiple workspace packages/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
