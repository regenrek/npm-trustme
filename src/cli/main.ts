#!/usr/bin/env node
import { defineCommand, renderUsage, runMain, type ArgsDef, type CommandDef } from 'citty'
import { config as loadEnv } from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execSync, spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { createLogger } from '../core/logger.js'
import { launchBrowser, saveStorageState, closeBrowser } from '../core/browser/session.js'
import { resolveChromeProfileAuto, readNpmCookiesForProfile, defaultChromeUserDataDir, type InlineCookieInput } from '../core/browser/chromeProfiles.js'
import { buildCdpUrl, detectCdpUrl, fetchCdpVersion } from '../core/browser/cdp.js'
import { readConfig, writeConfig, defaultTrustmeChromeDir } from '../core/config.js'
import {
  ensureLoggedIn,
  ensureTrustedPublisher,
  ensurePublishingAccess,
  type TrustedPublisherTarget,
  type PublishingAccess
} from '../core/npm/trustedPublisher.js'
import {
  detectBuildCommand,
  detectPackageManager,
  normalizePackageManager,
  normalizeTrigger,
  renderNpmReleaseWorkflow,
  resolveInstallCommand,
  resolveTagPattern
} from '../core/workflow/npmRelease.js'
import { inferPackageName, inferWorkflowFile, parseGitHubRemote } from '../core/targets/infer.js'

interface CommonOptions {
  package?: string
  owner?: string
  repo?: string
  workflow?: string
  environment?: string
  maintainer?: string
  publishingAccess?: string
  yes?: boolean
  headless?: boolean
  slowMo?: number
  timeout?: number
  storage?: string
  screenshotDir?: string
  verbose?: boolean
  autoRepo?: boolean
  chromeProfile?: string
  chromeProfileDir?: string
  chromeUserDataDir?: string
  chromePath?: string
  chromeCdpUrl?: string
  chromeDebugPort?: number
  importCookies?: boolean
  inlineCookiesJson?: string
  inlineCookiesBase64?: string
  inlineCookiesFile?: string
}

interface WorkflowInitOptions {
  file?: string
  pm?: string
  node?: string
  trigger?: string
  tagPattern?: string
  workflowDispatch?: boolean
  buildCommand?: string
  skipBuild?: boolean
  publishCommand?: string
  force?: boolean
  verbose?: boolean
}

interface DoctorOptions {
  verbose?: boolean
}

preloadEnv()

const targetArgs = {
  package: { type: 'string', description: 'npm package name (e.g., my-package)' },
  owner: { type: 'string', description: 'GitHub org/user (e.g., my-org)' },
  repo: { type: 'string', description: 'GitHub repo name (e.g., my-repo)' },
  workflow: { type: 'string', description: 'Workflow filename (e.g., npm-release.yml)' },
  environment: { type: 'string', description: 'GitHub environment (optional)' },
  maintainer: { type: 'string', description: 'Maintainer (optional)' },
  'publishing-access': { type: 'string', description: 'disallow-tokens|allow-bypass-token|skip' },
  'auto-repo': { type: 'boolean', description: 'Infer owner/repo from git remote' }
} as const

const browserArgs = {
  headless: { type: 'boolean', description: 'Run browser headless' },
  'slow-mo': { type: 'string', description: 'Slow down Playwright actions (ms)' },
  timeout: { type: 'string', description: 'Timeout in ms for actions' },
  storage: { type: 'string', description: 'Path to Playwright storage state JSON' },
  'screenshot-dir': { type: 'string', description: 'Directory for error screenshots' },
  'chrome-profile': { type: 'string', description: 'Chrome profile name (e.g., Default, Profile 1)' },
  'chrome-profile-dir': { type: 'string', description: 'Full path to Chrome profile directory' },
  'chrome-user-data-dir': { type: 'string', description: 'Chrome user data directory' },
  'chrome-path': { type: 'string', description: 'Path to Chrome/Chromium binary' },
  'chrome-cdp-url': { type: 'string', description: 'Connect to existing Chrome via CDP (e.g., http://127.0.0.1:9222)' },
  'chrome-debug-port': { type: 'string', description: 'Connect to Chrome DevTools port (e.g., 9222)' },
  'import-cookies': { type: 'boolean', description: 'Import npm cookies from Chrome profile into the session (browser mode)' },
  'inline-cookies-json': { type: 'string', description: 'Inline cookie JSON payload (sweet-cookie format)' },
  'inline-cookies-base64': { type: 'string', description: 'Inline cookie base64 payload (sweet-cookie format)' },
  'inline-cookies-file': { type: 'string', description: 'Path to inline cookie payload file (sweet-cookie format)' }
} as const

const envArgs = {
  'env-file': { type: 'string', description: 'Path to .env file (default: ./.env)' }
} as const

const commonArgs = {
  ...targetArgs,
  ...browserArgs,
  verbose: { type: 'boolean', description: 'Verbose output' },
  ...envArgs
} as const

const doctorArgs = {
  verbose: commonArgs.verbose,
  'env-file': commonArgs['env-file']
} as const

const workflowArgs = {
  file: { type: 'string', description: 'Workflow filename (default: npm-release.yml)' },
  pm: { type: 'string', description: 'Package manager: pnpm|npm (default: auto)' },
  node: { type: 'string', description: 'Node version (default: 22)' },
  trigger: { type: 'string', description: 'Trigger: release|tag (default: release)' },
  'tag-pattern': { type: 'string', description: 'Tag pattern for tag trigger (default: v*)' },
  'workflow-dispatch': { type: 'string', description: 'Enable workflow_dispatch (default: true)' },
  'build-command': { type: 'string', description: 'Build command (auto-detected when possible)' },
  'skip-build': { type: 'string', description: 'Skip build step (true|false)' },
  'publish-command': { type: 'string', description: 'Publish command (default: npm publish --access public --provenance)' },
  force: { type: 'string', description: 'Overwrite existing workflow file (true|false)' },
  verbose: commonArgs.verbose,
  'env-file': commonArgs['env-file']
} as const

const main = defineCommand({
  meta: {
    name: 'npm-trustme',
    description: 'Automate npm Trusted Publisher setup (GitHub Actions OIDC).'
  },
  subCommands: {
    check: defineCommand({
      meta: { name: 'check', description: 'Check whether a trusted publisher exists' },
      args: commonArgs,
      async run({ args }) {
        await runCheck(normalizeArgs(args))
      }
    }),
    ensure: defineCommand({
      meta: { name: 'ensure', description: 'Ensure a trusted publisher exists (adds if missing)' },
      args: {
        ...commonArgs,
        'dry-run': { type: 'boolean', description: 'Show what would change without applying' },
        yes: { type: 'boolean', description: 'Skip confirmation prompt' }
      },
      async run({ args }) {
        await runEnsure({ ...normalizeArgs(args), dryRun: Boolean((args as any)['dry-run']) })
      }
    }),
    doctor: defineCommand({
      meta: { name: 'doctor', description: 'Check system readiness for npm-trustme' },
      args: doctorArgs,
      async run({ args }) {
        await runDoctor({ verbose: Boolean(args.verbose) })
      }
    }),
    chrome: defineCommand({
      meta: { name: 'chrome', description: 'Manage dedicated Chrome instance for passkey flows' },
      subCommands: {
        start: defineCommand({
          meta: { name: 'start', description: 'Start a dedicated Chrome instance with CDP enabled' },
          args: {
            'chrome-path': commonArgs['chrome-path'],
            'chrome-user-data-dir': commonArgs['chrome-user-data-dir'],
            'chrome-profile': commonArgs['chrome-profile'],
            'chrome-debug-port': commonArgs['chrome-debug-port'],
            verbose: commonArgs.verbose,
            'env-file': commonArgs['env-file']
          },
          async run({ args }) {
            await runChromeStart(normalizeArgs(args))
          }
        }),
        status: defineCommand({
          meta: { name: 'status', description: 'Check if a Chrome CDP endpoint is available' },
          args: {
            'chrome-cdp-url': commonArgs['chrome-cdp-url'],
            'chrome-debug-port': commonArgs['chrome-debug-port'],
            verbose: commonArgs.verbose,
            'env-file': commonArgs['env-file']
          },
          async run({ args }) {
            await runChromeStatus(normalizeArgs(args))
          }
        })
      }
    }),
    workflow: defineCommand({
      meta: { name: 'workflow', description: 'Generate npm release workflows' },
      subCommands: {
        init: defineCommand({
          meta: { name: 'init', description: 'Create a GitHub Actions workflow for npm publishing' },
          args: workflowArgs,
          async run({ args }) {
            await runWorkflowInit(normalizeWorkflowArgs(args))
          }
        })
      }
    })
  }
})

void runCli()

async function runCheck(options: CommonOptions): Promise<void> {
  const logger = createLogger(Boolean(options.verbose))
  const target = resolveTarget(options)
  const browserOptions = await resolveBrowserOptions(options, logger)
  const session = await launchBrowser(browserOptions)
  await applyBrowserCookies(session, browserOptions, options, logger)

  try {
    await ensureLoggedIn(session.page, logger, buildEnsureOptions(options))
    const status = await ensureTrustedPublisher(session.page, target, logger, {
      ...buildEnsureOptions(options),
      dryRun: true
    })
    const accessStatus = await ensurePublishingAccess(session.page, target, logger, {
      ...buildEnsureOptions(options),
      dryRun: true
    })
    if (status === 'exists' && accessStatus === 'ok') {
      logger.success('Trusted publisher + access settings present.')
      process.exitCode = 0
    } else {
      logger.warn('Trusted publisher or access settings missing/mismatched.')
      process.exitCode = 2
    }
  } finally {
    await saveStorageState(session.context, options.storage)
    await closeBrowser(session)
  }
}

async function runEnsure(options: CommonOptions & { dryRun?: boolean }): Promise<void> {
  const logger = createLogger(Boolean(options.verbose))
  const target = resolveTarget(options)

  const confirmed = await confirmEnsure(target, options, logger)
  if (!confirmed) {
    logger.warn('Aborted by user.')
    process.exitCode = 1
    return
  }

  const browserOptions = await resolveBrowserOptions(options, logger)
  const session = await launchBrowser(browserOptions)
  await applyBrowserCookies(session, browserOptions, options, logger)

  try {
    await ensureLoggedIn(session.page, logger, buildEnsureOptions(options))
    const status = await ensureTrustedPublisher(session.page, target, logger, {
      ...buildEnsureOptions(options),
      dryRun: options.dryRun
    })
    const accessStatus = await ensurePublishingAccess(session.page, target, logger, {
      ...buildEnsureOptions(options),
      dryRun: options.dryRun
    })
    if (status === 'dry-run' || accessStatus === 'dry-run') {
      process.exitCode = 2
    }
  } finally {
    await saveStorageState(session.context, options.storage)
    await closeBrowser(session)
  }
}

async function confirmEnsure(
  target: TrustedPublisherTarget,
  options: CommonOptions,
  logger: ReturnType<typeof createLogger>
): Promise<boolean> {
  if (options.yes) return true
  if (!process.stdin.isTTY) {
    logger.error('Confirmation required. Re-run with --yes to proceed in non-interactive mode.')
    return false
  }

  const lines = [
    'About to ensure npm trusted publisher:',
    `  package: ${target.packageName}`,
    `  repo: ${target.owner}/${target.repo}`,
    `  workflow: ${target.workflow}`,
    target.environment ? `  environment: ${target.environment}` : null,
    target.maintainer ? `  maintainer: ${target.maintainer}` : null,
    `  publishing access: ${describePublishingAccess(target.publishingAccess)}`,
    '',
    'This will open a browser window and may prompt for login/2FA.',
    'Proceed? (y/N): '
  ].filter(Boolean)

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(lines.join('\n'))
    return ['y', 'yes'].includes(answer.trim().toLowerCase())
  } finally {
    rl.close()
  }
}

function describePublishingAccess(value: PublishingAccess): string {
  if (value === 'skip') return 'skip'
  if (value === 'disallow-tokens') return 'require 2FA and disallow tokens'
  return 'require 2FA or bypass token'
}

async function runChromeStart(options: CommonOptions): Promise<void> {
  const logger = createLogger(Boolean(options.verbose))
  const env = process.env
  const config = await readConfig(env)

  const chromeDebugPort =
    options.chromeDebugPort || numberArg(env.NPM_TRUSTME_CHROME_DEBUG_PORT) || config.chromeDebugPort || 9222
  const chromeUserDataDir =
    options.chromeUserDataDir ||
    env.NPM_TRUSTME_CHROME_USER_DATA_DIR ||
    config.chromeUserDataDir ||
    defaultTrustmeChromeDir()
  const chromeProfile = options.chromeProfile || env.NPM_TRUSTME_CHROME_PROFILE || config.chromeProfile || 'Default'
  const chromePath =
    options.chromePath || env.NPM_TRUSTME_CHROME_PATH || config.chromePath || resolveChromeBinary()

  if (!chromePath) {
    throw new Error('Unable to locate Chrome. Pass --chrome-path to the Chrome/Chromium binary.')
  }

  const cdpUrl = buildCdpUrl(chromeDebugPort)
  const alreadyRunning = await detectCdpUrl([cdpUrl], 400)
  if (alreadyRunning) {
    logger.info(`Chrome CDP already available at ${cdpUrl}.`)
  } else {
    const args = [
      `--remote-debugging-port=${chromeDebugPort}`,
      `--user-data-dir=${chromeUserDataDir}`,
      `--profile-directory=${chromeProfile}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
    const child = spawn(chromePath, args, { detached: true, stdio: 'ignore' })
    child.unref()
    logger.success(`Started Chrome with CDP at ${cdpUrl}.`)
  }

  await writeConfig(
    {
      chromeCdpUrl: cdpUrl,
      chromeDebugPort,
      chromeUserDataDir,
      chromeProfile,
      chromePath
    },
    env
  )

  logger.info(`Chrome profile directory: ${chromeUserDataDir}`)
  logger.info('Sign in to npm once in this Chrome profile (passkey or security key).')
  logger.info('Then run: npm-trustme ensure')
}

async function runChromeStatus(options: CommonOptions): Promise<void> {
  const logger = createLogger(Boolean(options.verbose))
  const env = process.env
  const config = await readConfig(env)

  const candidates = new Set<string>()
  const fromArgs =
    options.chromeCdpUrl || (options.chromeDebugPort ? buildCdpUrl(options.chromeDebugPort) : undefined)
  if (fromArgs) candidates.add(fromArgs)
  const fromEnv =
    env.NPM_TRUSTME_CHROME_CDP_URL ||
    (env.NPM_TRUSTME_CHROME_DEBUG_PORT ? buildCdpUrl(Number(env.NPM_TRUSTME_CHROME_DEBUG_PORT)) : undefined)
  if (fromEnv) candidates.add(fromEnv)
  if (config.chromeCdpUrl) candidates.add(config.chromeCdpUrl)
  if (config.chromeDebugPort) candidates.add(buildCdpUrl(config.chromeDebugPort))
  candidates.add(buildCdpUrl(9222))

  const found = await detectCdpUrl(Array.from(candidates), 500)
  if (!found) {
    logger.warn('No Chrome CDP endpoint detected. Run `npm-trustme chrome start`.')
    process.exitCode = 2
    return
  }

  const info = await fetchCdpVersion(found, 500)
  logger.success(`Chrome CDP available at ${found}.`)
  if (info?.Browser) {
    logger.info(`Browser: ${info.Browser}`)
  }
}

async function runWorkflowInit(options: WorkflowInitOptions): Promise<void> {
  const logger = createLogger(Boolean(options.verbose))
  const rootDir = process.cwd()
  const fileName = (options.file || 'npm-release.yml').trim()
  if (!fileName) {
    throw new Error('Workflow filename cannot be empty.')
  }

  const detectedPm = detectPackageManager(rootDir)
  const packageManager = normalizePackageManager(options.pm, detectedPm)
  const trigger = normalizeTrigger(options.trigger)
  const tagPattern = resolveTagPattern(options.tagPattern)
  const workflowDispatch = options.workflowDispatch ?? true
  const nodeVersion = (options.node || '22').trim()

  const installCommand = resolveInstallCommand(rootDir, packageManager)
  const buildCommand = options.skipBuild
    ? undefined
    : options.buildCommand || detectBuildCommand(rootDir, packageManager)
  const publishCommand = (options.publishCommand || 'npm publish --access public --provenance').trim()

  const workflow = renderNpmReleaseWorkflow({
    nodeVersion,
    packageManager,
    trigger,
    tagPattern,
    workflowDispatch,
    installCommand,
    buildCommand,
    publishCommand
  })

  const workflowsDir = path.resolve(rootDir, '.github', 'workflows')
  const outputPath = path.resolve(workflowsDir, path.basename(fileName))

  if (existsSync(outputPath) && !options.force) {
    throw new Error(`Workflow already exists at ${outputPath}. Use --force true to overwrite.`)
  }

  await mkdir(workflowsDir, { recursive: true })
  await writeFile(outputPath, `${workflow}\n`, 'utf8')

  logger.success(`Wrote workflow to ${outputPath}.`)
  if (buildCommand) {
    logger.info(`Build step: ${buildCommand}`)
  } else {
    logger.info('Build step skipped.')
  }
  logger.info(`Publish command: ${publishCommand}`)
  if (trigger === 'tag') {
    logger.info(`Tag trigger pattern: ${tagPattern}`)
  }
  if (packageManager !== detectedPm) {
    logger.info(`Package manager override: ${packageManager} (detected ${detectedPm})`)
  }
}

async function runDoctor(options: DoctorOptions): Promise<void> {
  const logger = createLogger(Boolean(options.verbose))
  const env = process.env
  const config = await readConfig(env)
  const warnings: string[] = []

  const nodeVersion = process.versions.node
  const major = Number(nodeVersion.split('.')[0] || 0)
  if (major >= 22) {
    logger.success(`Node.js ${nodeVersion} (>=22)`)
  } else {
    const message = `Node.js ${nodeVersion} is below the supported minimum (>=22).`
    logger.warn(message)
    warnings.push(message)
  }

  try {
    await import('playwright')
    logger.success('Playwright module resolved.')
  } catch {
    const message = 'Playwright module missing. Run `pnpm install` or use `npx npm-trustme ...`.'
    logger.warn(message)
    warnings.push(message)
  }

  const configuredChromePath = env.NPM_TRUSTME_CHROME_PATH || config.chromePath
  const resolvedChromePath = configuredChromePath || resolveChromeBinary()
  if (resolvedChromePath && existsSync(resolvedChromePath)) {
    logger.success(`Chrome detected at ${resolvedChromePath}.`)
  } else {
    const message = 'Chrome binary not found. Set NPM_TRUSTME_CHROME_PATH or install Chrome.'
    logger.warn(message)
    warnings.push(message)
  }

  const cdpCandidates = new Set<string>()
  if (env.NPM_TRUSTME_CHROME_CDP_URL) cdpCandidates.add(env.NPM_TRUSTME_CHROME_CDP_URL)
  if (env.NPM_TRUSTME_CHROME_DEBUG_PORT) {
    cdpCandidates.add(buildCdpUrl(Number(env.NPM_TRUSTME_CHROME_DEBUG_PORT)))
  }
  if (config.chromeCdpUrl) cdpCandidates.add(config.chromeCdpUrl)
  if (config.chromeDebugPort) cdpCandidates.add(buildCdpUrl(config.chromeDebugPort))
  if (cdpCandidates.size) {
    const found = await detectCdpUrl(Array.from(cdpCandidates), 500)
    if (found) {
      logger.success(`Chrome CDP reachable at ${found}.`)
    } else {
      const message = 'Configured Chrome CDP endpoint is not reachable.'
      logger.warn(message)
      warnings.push(message)
    }
  } else {
    logger.info('No Chrome CDP endpoint configured (optional).')
  }

  const missingTargets: string[] = []
  if (!env.NPM_TRUSTME_PACKAGE) missingTargets.push('NPM_TRUSTME_PACKAGE')
  if (!env.NPM_TRUSTME_OWNER) missingTargets.push('NPM_TRUSTME_OWNER')
  if (!env.NPM_TRUSTME_REPO) missingTargets.push('NPM_TRUSTME_REPO')
  if (!env.NPM_TRUSTME_WORKFLOW) missingTargets.push('NPM_TRUSTME_WORKFLOW')

  if (missingTargets.length) {
    const message = `Missing target env vars: ${missingTargets.join(', ')}`
    logger.warn(message)
    warnings.push(message)
  } else {
    logger.success('Target env vars present.')
  }

  if (warnings.length) {
    process.exitCode = 2
  }
}

function normalizeArgs(raw: Record<string, unknown>): CommonOptions {
  return {
    package: stringArg(raw.package),
    owner: stringArg(raw.owner),
    repo: stringArg(raw.repo),
    workflow: stringArg(raw.workflow),
    environment: stringArg(raw.environment),
    maintainer: stringArg(raw.maintainer),
    publishingAccess: stringArg((raw as any)['publishing-access']),
    yes: boolArg((raw as any).yes),
    headless: Boolean(raw.headless),
    slowMo: numberArg((raw as any)['slow-mo']),
    timeout: numberArg(raw.timeout),
    storage: stringArg(raw.storage),
    screenshotDir: stringArg((raw as any)['screenshot-dir']),
    verbose: Boolean(raw.verbose),
    autoRepo: boolArg((raw as any)['auto-repo']) ?? true,
    chromeProfile: stringArg((raw as any)['chrome-profile']),
    chromeProfileDir: stringArg((raw as any)['chrome-profile-dir']),
    chromeUserDataDir: stringArg((raw as any)['chrome-user-data-dir']),
    chromePath: stringArg((raw as any)['chrome-path']),
    chromeCdpUrl: stringArg((raw as any)['chrome-cdp-url']),
    chromeDebugPort: numberArg((raw as any)['chrome-debug-port']),
    importCookies: Boolean((raw as any)['import-cookies']),
    inlineCookiesJson: stringArg((raw as any)['inline-cookies-json']),
    inlineCookiesBase64: stringArg((raw as any)['inline-cookies-base64']),
    inlineCookiesFile: stringArg((raw as any)['inline-cookies-file'])
  }
}

function normalizeWorkflowArgs(raw: Record<string, unknown>): WorkflowInitOptions {
  const workflowDispatch = boolArg((raw as any)['workflow-dispatch'])
  const skipBuild = boolArg((raw as any)['skip-build'])
  const force = boolArg(raw.force)
  return {
    file: stringArg(raw.file),
    pm: stringArg(raw.pm),
    node: stringArg(raw.node),
    trigger: stringArg(raw.trigger),
    tagPattern: stringArg((raw as any)['tag-pattern']),
    workflowDispatch: workflowDispatch === undefined ? undefined : workflowDispatch,
    buildCommand: stringArg((raw as any)['build-command']),
    skipBuild: skipBuild === undefined ? undefined : skipBuild,
    publishCommand: stringArg((raw as any)['publish-command']),
    force: force === undefined ? undefined : force,
    verbose: Boolean(raw.verbose)
  }
}


function resolveTarget(options: CommonOptions): TrustedPublisherTarget {
  const env = process.env
  let packageName = options.package || env.NPM_TRUSTME_PACKAGE
  let owner = options.owner || env.NPM_TRUSTME_OWNER
  let repo = options.repo || env.NPM_TRUSTME_REPO
  let workflow = options.workflow || env.NPM_TRUSTME_WORKFLOW
  const environment = options.environment || env.NPM_TRUSTME_ENVIRONMENT
  const maintainer = options.maintainer || env.NPM_TRUSTME_MAINTAINER
  const publishingAccess = normalizePublishingAccess(options.publishingAccess || env.NPM_TRUSTME_PUBLISHING_ACCESS)

  if (!packageName) {
    packageName = inferPackageName(process.cwd()) ?? undefined
  }

  if ((!owner || !repo) && options.autoRepo) {
    const inferred = inferGitHubRepo()
    if (inferred) {
      owner = owner || inferred.owner
      repo = repo || inferred.repo
    }
  }

  if (!workflow) {
    workflow = inferWorkflowFile(process.cwd()) ?? undefined
  }

  const missing: string[] = []
  if (!packageName) missing.push('--package (or package.json#name)')
  if (!owner) missing.push('--owner (or git remote origin)')
  if (!repo) missing.push('--repo (or git remote origin)')
  if (!workflow) missing.push('--workflow (or .github/workflows/npm-release.yml)')

  if (missing.length) {
    throw new Error(`Missing required fields: ${missing.join(', ')}.`)
  }

  const resolvedPackageName = packageName as string
  const resolvedOwner = owner as string
  const resolvedRepo = repo as string
  let resolvedWorkflow = workflow as string

  if (resolvedWorkflow.includes('/')) {
    resolvedWorkflow = path.basename(resolvedWorkflow)
  }

  return {
    packageName: resolvedPackageName,
    owner: resolvedOwner,
    repo: resolvedRepo,
    workflow: resolvedWorkflow,
    environment,
    maintainer,
    publishingAccess
  }
}

function buildEnsureOptions(options: CommonOptions) {
  return {
    timeoutMs: options.timeout,
    screenshotDir: options.screenshotDir,
    headless: Boolean(options.headless)
  }
}

function stringArg(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const v = String(value).trim()
  return v ? v : undefined
}

function numberArg(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  const num = Number(value)
  return Number.isFinite(num) ? num : undefined
}

function boolArg(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'boolean') return value
  const raw = String(value).trim().toLowerCase()
  if (!raw) return undefined
  if (['false', '0', 'no', 'off'].includes(raw)) return false
  if (['true', '1', 'yes', 'on'].includes(raw)) return true
  return Boolean(value)
}

function inferGitHubRepo(): { owner: string; repo: string } | null {
  try {
    const url = execSync('git remote get-url origin', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    return parseGitHubRemote(url)
  } catch {
    return null
  }
}

function normalizePublishingAccess(value?: string): PublishingAccess {
  const normalized = (value || '').toLowerCase()
  if (normalized === 'allow-bypass-token' || normalized === 'allow-bypass') return 'allow-bypass-token'
  if (normalized === 'skip') return 'skip'
  return 'disallow-tokens'
}

async function resolveBrowserOptions(options: CommonOptions, logger: ReturnType<typeof createLogger>) {
  const env = process.env
  const config = await readConfig(env)
  const resolved = {
    headless: Boolean(options.headless),
    slowMo: options.slowMo,
    storageStatePath: options.storage,
    screenshotDir: options.screenshotDir,
    chromeProfile: options.chromeProfile || env.NPM_TRUSTME_CHROME_PROFILE || config.chromeProfile,
    chromeProfileDir: options.chromeProfileDir || env.NPM_TRUSTME_CHROME_PROFILE_DIR,
    chromeUserDataDir: options.chromeUserDataDir || env.NPM_TRUSTME_CHROME_USER_DATA_DIR || config.chromeUserDataDir,
    chromePath: options.chromePath || env.NPM_TRUSTME_CHROME_PATH || config.chromePath,
    chromeCdpUrl: options.chromeCdpUrl || env.NPM_TRUSTME_CHROME_CDP_URL || config.chromeCdpUrl,
    chromeDebugPort:
      options.chromeDebugPort || numberArg(env.NPM_TRUSTME_CHROME_DEBUG_PORT) || config.chromeDebugPort,
    usePersistentProfile: false
  }

  const cdpDetected = await resolveCdpUrlAuto(resolved, logger)
  if (cdpDetected) {
    resolved.chromeCdpUrl = cdpDetected
    logger.info(`Using Chrome via CDP at ${cdpDetected}.`)
    return resolved
  }

  if (resolved.chromeProfile || resolved.chromeProfileDir) {
    return resolved
  }

  const detection = await resolveChromeProfileAuto({
    userDataDir: resolved.chromeUserDataDir,
    logger
  })
  if (detection.profile) {
    resolved.chromeProfile = detection.profile
    if (detection.reason === 'cookies') {
      logger.info(`Auto-selected Chrome profile "${detection.profile}" based on npm cookies.`)
    } else {
      logger.info(`Using last active Chrome profile "${detection.profile}".`)
    }
  } else {
    logger.warn('Unable to auto-detect Chrome profile; pass --chrome-profile or --chrome-profile-dir.')
  }

  return resolved
}

async function applyBrowserCookies(
  session: Awaited<ReturnType<typeof launchBrowser>>,
  browserOptions: Awaited<ReturnType<typeof resolveBrowserOptions>>,
  options: CommonOptions,
  logger: ReturnType<typeof createLogger>
) {
  if (session.isPersistent) return
  const inlineCookies = resolveInlineCookies(options, process.env)
  if (!resolveImportCookies(options, process.env, inlineCookies)) return
  const usingCdp = Boolean(browserOptions.chromeCdpUrl || browserOptions.chromeDebugPort)

  if (usingCdp && !inlineCookies) {
    logger.info('Skipping cookie import for CDP session (using existing Chrome profile).')
    return
  }

  if (inlineCookies) {
    const cookies = await readNpmCookiesForProfile({
      profile: browserOptions.chromeProfile,
      logger,
      userDataDir: browserOptions.chromeUserDataDir,
      profileDir: browserOptions.chromeProfileDir,
      inlineCookies
    })
    if (cookies.length) {
      await session.context.addCookies(cookies)
      logger.info(`Applied ${cookies.length} cookies from inline payload.`)
      return
    }
    logger.warn('Inline cookie payload provided but no matching npm cookies found.')
  }

  const cookieSources: Array<{ userDataDir?: string; profileDir?: string }> = []
  const defaultDir = defaultChromeUserDataDir()

  if (usingCdp && defaultDir) {
    cookieSources.push({ userDataDir: defaultDir })
  }
  if (browserOptions.chromeProfileDir) {
    cookieSources.push({ profileDir: browserOptions.chromeProfileDir })
  } else if (browserOptions.chromeUserDataDir) {
    cookieSources.push({ userDataDir: browserOptions.chromeUserDataDir })
  }
  if (!usingCdp && defaultDir && defaultDir !== browserOptions.chromeUserDataDir) {
    cookieSources.push({ userDataDir: defaultDir })
  }

  if (!cookieSources.length) {
    cookieSources.push({})
  }

  for (const source of cookieSources) {
    const preferConfiguredProfile = !source.userDataDir || source.userDataDir === browserOptions.chromeUserDataDir
    const profile =
      (preferConfiguredProfile ? browserOptions.chromeProfile : undefined) ||
      (await resolveProfileForCookies(source.userDataDir, logger))
    if (!profile) continue

    const cookies = await readNpmCookiesForProfile({
      profile,
      logger,
      userDataDir: source.userDataDir,
      profileDir: source.profileDir,
      inlineCookies
    })
    if (!cookies.length) {
      continue
    }
    await session.context.addCookies(cookies)
    logger.info(`Applied ${cookies.length} cookies from Chrome profile "${profile}".`)
    return
  }

  logger.warn('No npm cookies found to import. Proceeding without cookie sync.')
}

function preloadEnv() {
  const envArg = findArgValue('--env-file')
  if (envArg) {
    loadEnv({ path: envArg })
  } else {
    loadEnv()
  }
}

async function runCli(): Promise<void> {
  if (await handleSkillFlag()) {
    return
  }
  await runMain(main, { showUsage: showUsageWithSkills })
}

async function showUsageWithSkills<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<T>
): Promise<void> {
  const usage = await renderUsage(cmd, parent)
  const extra = [
    '',
    'GLOBAL OPTIONS',
    '  --skills  Show the npm-trustme Codex skill (AI agent workflows).',
    '            Alias: --skill.'
  ].join('\n')
  process.stdout.write(`${usage}${extra}\n`)
}

async function handleSkillFlag(): Promise<boolean> {
  if (!hasFlag('--skills') && !hasFlag('--skill')) {
    return false
  }

  const skillPath = resolveSkillPath()
  if (!existsSync(skillPath)) {
    console.error(`Skill file not found at ${skillPath}.`)
    process.exitCode = 1
    return true
  }
  const contents = await readFile(skillPath, 'utf8')
  process.stdout.write(contents.endsWith('\n') ? contents : `${contents}\n`)
  return true
}

function findArgValue(flag: string): string | undefined {
  const argv = process.argv.slice(2)
  const direct = argv.find(arg => arg.startsWith(`${flag}=`))
  if (direct) {
    const value = direct.split('=')[1]
    return value ? value.trim() : undefined
  }
  const idx = argv.indexOf(flag)
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1]
  return undefined
}

function hasFlag(flag: string): boolean {
  const argv = process.argv.slice(2)
  const direct = argv.find(arg => arg.startsWith(`${flag}=`))
  if (direct) {
    const value = direct.split('=')[1]
    if (!value) return false
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
  }
  return argv.includes(flag)
}

function resolveSkillPath(): string {
  const root = resolvePackageRoot()
  return path.resolve(root, '.codex', 'skills', 'npm-trustme', 'SKILL.md')
}

function resolvePackageRoot(): string {
  const startDir = path.dirname(fileURLToPath(import.meta.url))
  let current = startDir
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.resolve(current, 'package.json')
    if (existsSync(candidate)) {
      return current
    }
    const next = path.dirname(current)
    if (next === current) break
    current = next
  }
  return process.cwd()
}

function resolveImportCookies(options: CommonOptions, env: NodeJS.ProcessEnv, inlineCookies?: InlineCookieInput): boolean {
  if (inlineCookies) return true
  if (options.importCookies !== undefined) return options.importCookies
  if (env.NPM_TRUSTME_IMPORT_COOKIES !== undefined) {
    return ['1', 'true', 'yes', 'on'].includes(env.NPM_TRUSTME_IMPORT_COOKIES.toLowerCase())
  }
  return true
}

function resolveInlineCookies(options: CommonOptions, env: NodeJS.ProcessEnv): InlineCookieInput | undefined {
  const inlineCookiesJson = options.inlineCookiesJson || env.NPM_TRUSTME_INLINE_COOKIES_JSON
  const inlineCookiesBase64 = options.inlineCookiesBase64 || env.NPM_TRUSTME_INLINE_COOKIES_BASE64
  const inlineCookiesFile = options.inlineCookiesFile || env.NPM_TRUSTME_INLINE_COOKIES_FILE
  if (!inlineCookiesJson && !inlineCookiesBase64 && !inlineCookiesFile) return undefined
  return {
    inlineCookiesJson,
    inlineCookiesBase64,
    inlineCookiesFile
  }
}

async function resolveProfileForCookies(userDataDir: string | undefined, logger: ReturnType<typeof createLogger>) {
  const detection = await resolveChromeProfileAuto({
    userDataDir,
    logger
  })
  return detection.profile ?? null
}

async function resolveCdpUrlAuto(
  resolved: Awaited<ReturnType<typeof resolveBrowserOptions>>,
  logger: ReturnType<typeof createLogger>
): Promise<string | undefined> {
  const candidates = new Set<string>()
  if (resolved.chromeCdpUrl) candidates.add(resolved.chromeCdpUrl)
  if (resolved.chromeDebugPort) candidates.add(buildCdpUrl(resolved.chromeDebugPort))
  candidates.add(buildCdpUrl(9222))

  const found = await detectCdpUrl(Array.from(candidates), 500)
  if (!found) return undefined
  if (!resolved.chromeCdpUrl) {
    logger.info(`Detected Chrome CDP at ${found}.`)
  }
  return found
}

function resolveChromeBinary(): string | null {
  const candidates: string[] = []
  if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium')
  } else if (process.platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] || 'C:\\\\Program Files'
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\\\Program Files (x86)'
    candidates.push(`${programFiles}\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe`)
    candidates.push(`${programFilesX86}\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe`)
  } else {
    const pathMatch = findOnPath(['google-chrome', 'chromium', 'chromium-browser', 'google-chrome-stable'])
    if (pathMatch) return pathMatch
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function findOnPath(binaries: string[]): string | null {
  for (const binary of binaries) {
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'command'
      const args = process.platform === 'win32' ? [binary] : ['-v', binary]
      const result = execSync([cmd, ...args].join(' '), { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
      if (result) return result.split('\n')[0]
    } catch {
      // continue
    }
  }
  return null
}
