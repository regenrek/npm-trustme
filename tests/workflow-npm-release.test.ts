import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  detectBuildCommand,
  detectPackageManager,
  renderNpmReleaseWorkflow,
  resolveInstallCommand
} from '../src/core/workflow/npmRelease.js'

function createTempProject() {
  const dir = mkdtempSync(resolve(tmpdir(), 'npm-trustme-workflow-'))
  return dir
}

describe('npm release workflow', () => {
  it('renders a release trigger with workflow_dispatch', () => {
    const yaml = renderNpmReleaseWorkflow({
      nodeVersion: '22',
      packageManager: 'pnpm',
      trigger: 'release',
      tagPattern: 'v*',
      workflowDispatch: true,
      installCommand: 'pnpm install --frozen-lockfile',
      buildCommand: 'pnpm build',
      publishCommand: 'npm publish --access public --provenance'
    })
    expect(yaml).toContain('release:')
    expect(yaml).toContain('types: [published]')
    expect(yaml).toContain('workflow_dispatch:')
    expect(yaml).toContain('pnpm install --frozen-lockfile')
    expect(yaml).toContain('pnpm build')
  })

  it('renders a tag trigger when requested', () => {
    const yaml = renderNpmReleaseWorkflow({
      nodeVersion: '22',
      packageManager: 'npm',
      trigger: 'tag',
      tagPattern: 'v*',
      workflowDispatch: false,
      installCommand: 'npm ci',
      publishCommand: 'npm publish --access public --provenance'
    })
    expect(yaml).toContain('push:')
    expect(yaml).toContain("      - 'v*'")
    expect(yaml).not.toContain('workflow_dispatch:')
  })

  it('detects package manager from lockfiles', () => {
    const dir = createTempProject()
    try {
      writeFileSync(resolve(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 6', 'utf8')
      expect(detectPackageManager(dir)).toBe('pnpm')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('detects build command from package.json scripts', () => {
    const dir = createTempProject()
    try {
      writeFileSync(
        resolve(dir, 'package.json'),
        JSON.stringify({ scripts: { build: 'tsup' } }),
        'utf8'
      )
      expect(detectBuildCommand(dir, 'pnpm')).toBe('pnpm build')
      expect(detectBuildCommand(dir, 'npm')).toBe('npm run build')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('chooses install command based on lockfile presence', () => {
    const dir = createTempProject()
    try {
      writeFileSync(resolve(dir, 'package-lock.json'), '{}', 'utf8')
      expect(resolveInstallCommand(dir, 'npm')).toBe('npm ci')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

