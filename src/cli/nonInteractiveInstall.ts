import path from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { normalizePublishingAccess, type PublishingAccess } from '../core/npm/trustedPublisher.js'
import { normalizeWorkflowName } from '../core/targets/normalize.js'
import { inferWorkflowFile } from '../core/targets/infer.js'
import { resolveWorkspaceInfo, resolvePackageTarget } from '../core/targets/workspace.js'
import { detectBuildCommand, detectPackageManager, normalizePackageManager, normalizeTrigger, renderNpmReleaseWorkflow, resolveInstallCommand, resolveTagPattern } from '../core/workflow/npmRelease.js'
import { loadTargetsFile } from '../core/wizard/targetsFile.js'
import type { WizardTargetInput, WizardWorkflowOptions } from '../core/wizard/types.js'

export interface NonInteractiveTargetOptions {
  package?: string
  packagePath?: string
  packages?: string
  packagePaths?: string
  allPackages?: boolean
  targetsFile?: string
  owner?: string
  repo?: string
  workflow?: string
  workflowFile?: string
  environment?: string
  maintainer?: string
  publishingAccess?: string
  autoRepo?: boolean
}

export interface NonInteractiveWorkflowInput {
  workflow?: string
  workflowFile?: string
  workflowPm?: string
  workflowNode?: string
  workflowTrigger?: string
  workflowTagPattern?: string
  workflowDispatch?: boolean
  workflowBuildCommand?: string
  workflowSkipBuild?: boolean
  workflowPublishCommand?: string
  workflowForce?: boolean
}

export interface NonInteractiveRunFlags {
  runCheck?: boolean
  runRecheck?: boolean
}

export function resolveNonInteractiveWorkflow(
  options: NonInteractiveWorkflowInput,
  rootDir: string,
  detectedPm: ReturnType<typeof detectPackageManager>
): WizardWorkflowOptions {
  const fileName = normalizeWorkflowName(options.workflowFile || options.workflow || 'npm-release.yml')
  const packageManager = normalizePackageManager(options.workflowPm, detectedPm)
  const trigger = normalizeTrigger(options.workflowTrigger)
  const tagPattern = resolveTagPattern(options.workflowTagPattern)
  const workflowDispatch = options.workflowDispatch ?? true
  const nodeVersion = (options.workflowNode || '24').trim()

  const buildCommand = options.workflowSkipBuild
    ? undefined
    : options.workflowBuildCommand || detectBuildCommand(rootDir, packageManager)
  const publishCommand = (options.workflowPublishCommand || 'npm publish --access public --provenance').trim()

  return {
    enabled: true,
    fileName,
    packageManager,
    nodeVersion,
    trigger,
    tagPattern,
    workflowDispatch,
    buildCommand,
    publishCommand
  }
}

export async function writeWorkflowIfNeeded(
  options: NonInteractiveWorkflowInput,
  workflowConfig: WizardWorkflowOptions,
  rootDir: string
): Promise<void> {
  const workflowsDir = path.resolve(rootDir, '.github', 'workflows')
  const outputPath = path.resolve(workflowsDir, path.basename(workflowConfig.fileName))
  if (existsSync(outputPath) && !options.workflowForce) {
    throw new Error(`Workflow already exists at ${outputPath}. Use --workflow-force true to overwrite.`)
  }
  await mkdir(workflowsDir, { recursive: true })
  const workflow = renderNpmReleaseWorkflow({
    nodeVersion: workflowConfig.nodeVersion,
    packageManager: workflowConfig.packageManager,
    trigger: workflowConfig.trigger,
    tagPattern: workflowConfig.tagPattern,
    workflowDispatch: workflowConfig.workflowDispatch,
    installCommand: resolveInstallCommand(rootDir, workflowConfig.packageManager),
    buildCommand: workflowConfig.buildCommand,
    publishCommand: workflowConfig.publishCommand
  })
  await writeFile(outputPath, `${workflow}\n`, 'utf8')
}

export async function resolveNonInteractiveTargets(
  options: NonInteractiveTargetOptions,
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env,
  inferredRepo: { owner: string; repo: string } | null = null
): Promise<WizardTargetInput[]> {
  const workspace = resolveWorkspaceInfo(rootDir)
  const workspacePackages = workspace?.packages ?? []

  const workflowDefault = normalizeWorkflowName(
    options.workflow || env.NPM_TRUSTME_WORKFLOW || options.workflowFile || inferWorkflowFile(rootDir) || 'npm-release.yml'
  )
  const defaults = {
    owner: options.owner || env.NPM_TRUSTME_OWNER || inferredRepo?.owner || '',
    repo: options.repo || env.NPM_TRUSTME_REPO || inferredRepo?.repo || '',
    workflow: workflowDefault,
    environment: options.environment || env.NPM_TRUSTME_ENVIRONMENT || 'npm',
    maintainer: options.maintainer || env.NPM_TRUSTME_MAINTAINER,
    publishingAccess: normalizePublishingAccess(options.publishingAccess || env.NPM_TRUSTME_PUBLISHING_ACCESS)
  }

  const targets: WizardTargetInput[] = []
  const seen = new Set<string>()

  if (options.targetsFile) {
    const entries = await loadTargetsFile(options.targetsFile)
    if (!entries.length) {
      throw new Error('Targets file must contain at least one target.')
    }
    for (const entry of entries) {
      const resolved = resolvePackageTarget({
        cwd: rootDir,
        rootDir,
        packageName: entry.packageName,
        packagePath: entry.packagePath
      })
      const target = buildWizardTargetInput(rootDir, resolved.packageName, resolved.packageDir, {
        owner: entry.owner ?? defaults.owner,
        repo: entry.repo ?? defaults.repo,
        workflow: normalizeWorkflowName(entry.workflow ?? defaults.workflow),
        environment: entry.environment ?? defaults.environment,
        maintainer: entry.maintainer ?? defaults.maintainer,
        publishingAccess: normalizePublishingAccess(entry.publishingAccess ?? defaults.publishingAccess)
      })
      assertTargetFields(target)
      addTarget(targets, seen, target)
    }
    return targets
  }

  const packageNames = toList(options.packages)
  if (options.package) packageNames.push(options.package)
  const packagePaths = toList(options.packagePaths)
  if (options.packagePath) packagePaths.push(options.packagePath)

  if (options.allPackages) {
    if (workspacePackages.length) {
      for (const pkg of workspacePackages) {
        const target = buildWizardTargetInput(rootDir, pkg.name, pkg.dir, defaults)
        assertTargetFields(target)
        addTarget(targets, seen, target)
      }
    } else {
      const resolved = resolvePackageTarget({ cwd: rootDir, rootDir })
      const target = buildWizardTargetInput(rootDir, resolved.packageName, resolved.packageDir, defaults)
      assertTargetFields(target)
      addTarget(targets, seen, target)
    }
    return targets
  }

  if (packageNames.length || packagePaths.length) {
    for (const name of packageNames) {
      const match = workspacePackages.find(pkg => pkg.name === name)
      if (match) {
        const target = buildWizardTargetInput(rootDir, match.name, match.dir, defaults)
        assertTargetFields(target)
        addTarget(targets, seen, target)
        continue
      }
      const resolved = resolvePackageTarget({ cwd: rootDir, rootDir, packageName: name })
      const target = buildWizardTargetInput(rootDir, resolved.packageName, resolved.packageDir, defaults)
      assertTargetFields(target)
      addTarget(targets, seen, target)
    }
    for (const pkgPath of packagePaths) {
      const resolved = resolvePackageTarget({ cwd: rootDir, rootDir, packagePath: pkgPath })
      const target = buildWizardTargetInput(rootDir, resolved.packageName, resolved.packageDir, defaults)
      assertTargetFields(target)
      addTarget(targets, seen, target)
    }
    return targets
  }

  if (workspacePackages.length > 1) {
    throw new Error(
      `Workspace has ${workspacePackages.length} packages. Use --all-packages, --packages, --package-paths, or --targets-file.`
    )
  }

  if (workspacePackages.length === 1) {
    const pkg = workspacePackages[0]
    const target = buildWizardTargetInput(rootDir, pkg.name, pkg.dir, defaults)
    assertTargetFields(target)
    addTarget(targets, seen, target)
    return targets
  }

  const resolved = resolvePackageTarget({ cwd: rootDir, rootDir })
  const target = buildWizardTargetInput(rootDir, resolved.packageName, resolved.packageDir, defaults)
  assertTargetFields(target)
  addTarget(targets, seen, target)
  return targets
}

export function resolveNonInteractiveRunFlags(options: NonInteractiveRunFlags): { runCheck: boolean; runRecheck: boolean } {
  return {
    runCheck: options.runCheck ?? true,
    runRecheck: options.runRecheck ?? true
  }
}

export function resolveDetectedPackageManager(rootDir: string): ReturnType<typeof detectPackageManager> {
  return detectPackageManager(rootDir)
}

export function buildWizardTargetInput(
  rootDir: string,
  packageName: string,
  packageDir: string,
  overrides: {
    owner: string
    repo: string
    workflow: string
    environment: string
    maintainer?: string
    publishingAccess: PublishingAccess
  }
): WizardTargetInput {
  return {
    packageName,
    packagePath: path.relative(rootDir, packageDir) || '.',
    owner: overrides.owner,
    repo: overrides.repo,
    workflow: overrides.workflow,
    environment: overrides.environment,
    maintainer: overrides.maintainer,
    publishingAccess: overrides.publishingAccess
  }
}

export function assertTargetFields(target: WizardTargetInput): void {
  const missing: string[] = []
  if (!target.owner) missing.push('owner')
  if (!target.repo) missing.push('repo')
  if (!target.workflow) missing.push('workflow')
  if (missing.length) {
    throw new Error(`Missing required target fields: ${missing.join(', ')} for package ${target.packageName}.`)
  }
}

export function addTarget(targets: WizardTargetInput[], seen: Set<string>, target: WizardTargetInput): void {
  if (seen.has(target.packageName)) {
    throw new Error(`Duplicate target detected for package ${target.packageName}.`)
  }
  seen.add(target.packageName)
  targets.push(target)
}

export function toList(value?: string): string[] {
  if (!value) return []
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}
