import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  resolveNonInteractiveTargets,
  resolveNonInteractiveRunFlags,
  resolveNonInteractiveWorkflow,
  writeWorkflowIfNeeded
} from '../src/cli/nonInteractiveInstall.js'

function writeJson(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2))
}

function setupSinglePackage(): string {
  const root = mkdtempSync(resolve(tmpdir(), 'npm-trustme-single-'))
  writeJson(resolve(root, 'package.json'), { name: 'root-package' })
  return root
}

function setupWorkspace(): { root: string; packages: string[] } {
  const root = mkdtempSync(resolve(tmpdir(), 'npm-trustme-workspace-'))
  writeJson(resolve(root, 'package.json'), { name: 'root-package' })
  writeFileSync(
    resolve(root, 'pnpm-workspace.yaml'),
    ['packages:', '  - "packages/*"'].join('\n')
  )
  const pkgA = resolve(root, 'packages', 'pkg-a')
  const pkgB = resolve(root, 'packages', 'pkg-b')
  mkdirSync(pkgA, { recursive: true })
  mkdirSync(pkgB, { recursive: true })
  writeJson(resolve(pkgA, 'package.json'), { name: 'pkg-a' })
  writeJson(resolve(pkgB, 'package.json'), { name: 'pkg-b' })
  return { root, packages: [pkgA, pkgB] }
}

describe('resolveNonInteractiveTargets', () => {
  it('normalizes workflow paths to basenames', async () => {
    const root = setupSinglePackage()
    const targets = await resolveNonInteractiveTargets(
      {
        workflow: '.github/workflows/npm-release.yml',
        owner: 'acme',
        repo: 'demo'
      },
      root,
      {}
    )
    expect(targets[0].workflow).toBe('npm-release.yml')
  })

  it('uses targets file overrides', async () => {
    const root = setupSinglePackage()
    const targetsFile = resolve(root, 'targets.json')
    writeJson(targetsFile, [
      {
        packageName: 'root-package',
        owner: 'override',
        repo: 'override-repo',
        workflow: 'custom.yml',
        publishingAccess: 'disallow-tokens'
      }
    ])

    const targets = await resolveNonInteractiveTargets(
      {
        targetsFile,
        owner: 'default',
        repo: 'default',
        workflow: 'npm-release.yml'
      },
      root,
      {}
    )

    expect(targets[0].owner).toBe('override')
    expect(targets[0].repo).toBe('override-repo')
    expect(targets[0].workflow).toBe('custom.yml')
  })

  it('errors on duplicate targets', async () => {
    const root = setupSinglePackage()
    const targetsFile = resolve(root, 'targets.json')
    writeJson(targetsFile, [
      { packageName: 'root-package', owner: 'a', repo: 'b', workflow: 'npm-release.yml' },
      { packageName: 'root-package', owner: 'a', repo: 'b', workflow: 'npm-release.yml' }
    ])

    await expect(resolveNonInteractiveTargets({ targetsFile }, root, {})).rejects.toThrow('Duplicate target')
  })

  it('errors when workspace has multiple packages and no selectors', async () => {
    const { root } = setupWorkspace()
    await expect(resolveNonInteractiveTargets({ owner: 'acme', repo: 'demo' }, root, {})).rejects.toThrow(
      'Workspace has'
    )
  })

  it('falls back to root package when --all-packages without workspace', async () => {
    const root = setupSinglePackage()
    const targets = await resolveNonInteractiveTargets(
      {
        allPackages: true,
        owner: 'acme',
        repo: 'demo',
        workflow: 'npm-release.yml'
      },
      root,
      {}
    )
    expect(targets).toHaveLength(1)
    expect(targets[0].packageName).toBe('root-package')
  })

  it('handles mix of --packages and --package-paths', async () => {
    const { root, packages } = setupWorkspace()
    const targets = await resolveNonInteractiveTargets(
      {
        packages: 'pkg-a',
        packagePaths: resolve(root, 'packages', 'pkg-b'),
        owner: 'acme',
        repo: 'demo',
        workflow: 'npm-release.yml'
      },
      root,
      {}
    )
    expect(targets).toHaveLength(2)
    const names = targets.map(t => t.packageName).sort()
    expect(names).toEqual(['pkg-a', 'pkg-b'])
    expect(packages.length).toBe(2)
  })

  it('errors on empty targets file', async () => {
    const root = setupSinglePackage()
    const targetsFile = resolve(root, 'targets.json')
    writeJson(targetsFile, [])
    await expect(resolveNonInteractiveTargets({ targetsFile }, root, {})).rejects.toThrow('Targets file must contain')
  })
})

describe('writeWorkflowIfNeeded', () => {
  it('errors when workflow exists and force is false', async () => {
    const root = setupSinglePackage()
    const workflowsDir = resolve(root, '.github', 'workflows')
    mkdirSync(workflowsDir, { recursive: true })
    const workflowPath = resolve(workflowsDir, 'npm-release.yml')
    writeFileSync(workflowPath, 'old')

    const workflow = resolveNonInteractiveWorkflow({}, root, 'pnpm')
    await expect(writeWorkflowIfNeeded({}, workflow, root)).rejects.toThrow('Workflow already exists')
  })

  it('overwrites workflow when force is true', async () => {
    const root = setupSinglePackage()
    const workflowsDir = resolve(root, '.github', 'workflows')
    mkdirSync(workflowsDir, { recursive: true })
    const workflowPath = resolve(workflowsDir, 'npm-release.yml')
    writeFileSync(workflowPath, 'old')

    const workflow = resolveNonInteractiveWorkflow({}, root, 'pnpm')
    await writeWorkflowIfNeeded({ workflowForce: true }, workflow, root)
    const next = readFileSync(workflowPath, 'utf8')
    expect(next).not.toBe('old')
  })
})

describe('resolveNonInteractiveRunFlags', () => {
  it('defaults to running check and recheck', () => {
    expect(resolveNonInteractiveRunFlags({})).toEqual({ runCheck: true, runRecheck: true })
  })

  it('honors explicit false flags', () => {
    expect(resolveNonInteractiveRunFlags({ runCheck: false, runRecheck: false })).toEqual({
      runCheck: false,
      runRecheck: false
    })
  })
})
