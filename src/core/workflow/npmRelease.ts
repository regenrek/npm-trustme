import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type PackageManager = 'pnpm' | 'npm'
export type WorkflowTrigger = 'release' | 'tag'

export interface NpmReleaseWorkflowSpec {
  nodeVersion: string
  packageManager: PackageManager
  trigger: WorkflowTrigger
  tagPattern: string
  workflowDispatch: boolean
  installCommand: string
  buildCommand?: string
  publishCommand: string
}

const DEFAULT_TAG_PATTERN = 'v*'

export function normalizePackageManager(input?: string, fallback: PackageManager = 'pnpm'): PackageManager {
  if (!input) return fallback
  const normalized = input.toLowerCase()
  if (normalized === 'npm') return 'npm'
  return 'pnpm'
}

export function normalizeTrigger(input?: string): WorkflowTrigger {
  if (!input) return 'release'
  return input.toLowerCase() === 'tag' ? 'tag' : 'release'
}

export function resolveTagPattern(input?: string): string {
  const pattern = (input || '').trim()
  return pattern.length ? pattern : DEFAULT_TAG_PATTERN
}

export function detectPackageManager(rootDir: string, fallback: PackageManager = 'pnpm'): PackageManager {
  if (existsSync(resolve(rootDir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(resolve(rootDir, 'package-lock.json'))) return 'npm'
  return fallback
}

export function detectBuildCommand(rootDir: string, packageManager: PackageManager): string | undefined {
  const pkgPath = resolve(rootDir, 'package.json')
  if (!existsSync(pkgPath)) return undefined
  try {
    const raw = readFileSync(pkgPath, 'utf8')
    const data = JSON.parse(raw)
    const scripts = data?.scripts ?? {}
    if (typeof scripts.build === 'string') {
      return runScriptCommand(packageManager, 'build')
    }
  } catch {
    return undefined
  }
  return undefined
}

export function resolveInstallCommand(rootDir: string, packageManager: PackageManager): string {
  if (packageManager === 'npm') {
    return existsSync(resolve(rootDir, 'package-lock.json')) ? 'npm ci' : 'npm install'
  }
  return existsSync(resolve(rootDir, 'pnpm-lock.yaml')) ? 'pnpm install --frozen-lockfile' : 'pnpm install'
}

export function renderNpmReleaseWorkflow(spec: NpmReleaseWorkflowSpec): string {
  const triggerLines: string[] = []
  if (spec.trigger === 'release') {
    triggerLines.push('  release:', '    types: [published]')
  } else {
    triggerLines.push('  push:', '    tags:', `      - '${spec.tagPattern}'`)
  }
  if (spec.workflowDispatch) {
    triggerLines.push('  workflow_dispatch:')
    triggerLines.push('    inputs:')
    triggerLines.push('      tag:')
    triggerLines.push('        description: Release tag to publish (e.g. v1.2.3)')
    triggerLines.push('        required: true')
    triggerLines.push('        type: string')
  }

  const steps: string[] = []
  steps.push('      - name: Checkout')
  steps.push('        uses: actions/checkout@v4')
  if (spec.trigger === 'release') {
    steps.push('        with:')
    steps.push('          ref: ${{ github.event.repository.default_branch }}')
  }
  steps.push('')
  steps.push('      - name: Setup Node')
  steps.push('        uses: actions/setup-node@v4')
  steps.push('        with:')
  steps.push(`          node-version: ${spec.nodeVersion}`)
  steps.push("          registry-url: 'https://registry.npmjs.org'")

  if (spec.packageManager === 'pnpm') {
    steps.push('')
    steps.push('      - name: Enable corepack')
    steps.push('        run: corepack enable')
  }

  steps.push('')
  steps.push('      - name: Resolve release tag')
  steps.push('        id: tag')
  steps.push(
    ...renderRunCommand(
      [
        'set -euo pipefail',
        'if [[ \"${{ github.event_name }}\" == \"release\" ]]; then',
        '  echo \"value=${{ github.event.release.tag_name }}\" >> \"$GITHUB_OUTPUT\"',
        '  exit 0',
        'fi',
        'if [[ \"${{ github.event_name }}\" == \"workflow_dispatch\" ]]; then',
        '  echo \"value=${{ inputs.tag }}\" >> \"$GITHUB_OUTPUT\"',
        '  exit 0',
        'fi',
        'echo \"value=${{ github.ref_name }}\" >> \"$GITHUB_OUTPUT\"'
      ].join('\n')
    )
  )

  steps.push('')
  steps.push('      - name: Install dependencies')
  steps.push(...renderRunCommand(spec.installCommand))

  if (spec.buildCommand) {
    steps.push('')
    steps.push('      - name: Build')
    steps.push(...renderRunCommand(spec.buildCommand))
  }

  steps.push('')
  steps.push('      - name: Publish to npm (Trusted Publishing)')
  steps.push(...renderRunCommand(spec.publishCommand))
  steps.push('        env:')
  steps.push('          VERSION: ${{ steps.tag.outputs.value }}')
  steps.push("          NODE_AUTH_TOKEN: ''")

  return [
    'name: npm Release',
    '',
    'on:',
    ...triggerLines,
    '',
    'concurrency:',
    '  group: npm-release-${{ github.ref }}',
    '  cancel-in-progress: false',
    '',
    'jobs:',
    '  publish:',
    '    runs-on: ubuntu-latest',
    '    permissions:',
    '      contents: read',
    '      id-token: write',
    '    steps:',
    ...steps
  ].join('\n')
}

function renderRunCommand(command: string): string[] {
  const normalized = command.trim()
  if (!normalized) return []
  if (normalized.includes('\n')) {
    const lines = normalized.replace(/\r\n/g, '\n').split('\n')
    return ['        run: |', ...lines.map(line => `          ${line}`)]
  }
  return [`        run: ${normalized}`]
}

function runScriptCommand(packageManager: PackageManager, script: string): string {
  if (packageManager === 'npm') {
    return `npm run ${script}`
  }
  return `${packageManager} ${script}`
}
