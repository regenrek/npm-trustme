#!/usr/bin/env node
import { defineCommand, runMain } from 'citty'
import { config as loadEnv } from 'dotenv'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { createLogger } from '../core/logger.js'
import { launchBrowser, saveStorageState, closeBrowser } from '../core/browser/session.js'
import {
  ensureLoggedIn,
  ensureTrustedPublisher,
  ensurePublishingAccess,
  type TrustedPublisherTarget,
  type PublishingAccess
} from '../core/npm/trustedPublisher.js'
import { resolveCredentials } from '../core/credentials/index.js'

interface CommonOptions {
  package?: string
  owner?: string
  repo?: string
  workflow?: string
  environment?: string
  publisher?: string
  maintainer?: string
  publishingAccess?: string
  headless?: boolean
  slowMo?: number
  timeout?: number
  storage?: string
  screenshotDir?: string
  verbose?: boolean
  autoRepo?: boolean
  username?: string
  password?: string
  otp?: string
  opUsername?: string
  opPassword?: string
  opOtp?: string
  opVault?: string
  opItem?: string
  opUsernameField?: string
  opPasswordField?: string
  opOtpField?: string
  bwItem?: string
  bwSession?: string
  lpassItem?: string
  lpassOtpField?: string
  kpxDb?: string
  kpxEntry?: string
  kpxKeyfile?: string
  kpxPassword?: string
  kpxPwStdin?: boolean
}

preloadEnv()

const commonArgs = {
  package: { type: 'string', description: 'npm package name (e.g., codex-1up)' },
  owner: { type: 'string', description: 'GitHub org/user (e.g., regenrek)' },
  repo: { type: 'string', description: 'GitHub repo name (e.g., codex-1up)' },
  workflow: { type: 'string', description: 'Workflow filename (e.g., npm-release.yml)' },
  environment: { type: 'string', description: 'GitHub environment (optional)' },
  publisher: { type: 'string', description: 'Publisher type: github|gitlab' },
  maintainer: { type: 'string', description: 'Maintainer (optional)' },
  'publishing-access': { type: 'string', description: 'disallow-tokens|allow-bypass-token|skip' },
  headless: { type: 'boolean', description: 'Run browser headless' },
  'slow-mo': { type: 'string', description: 'Slow down Playwright actions (ms)' },
  timeout: { type: 'string', description: 'Timeout in ms for actions' },
  storage: { type: 'string', description: 'Path to Playwright storage state JSON' },
  'screenshot-dir': { type: 'string', description: 'Directory for error screenshots' },
  verbose: { type: 'boolean', description: 'Verbose output' },
  'auto-repo': { type: 'boolean', description: 'Infer owner/repo from git remote' },
  'env-file': { type: 'string', description: 'Path to .env file (default: ./.env)' },
  username: { type: 'string', description: 'npm username/email (discouraged; prefer 1Password)' },
  password: { type: 'string', description: 'npm password (discouraged; prefer 1Password)' },
  otp: { type: 'string', description: 'npm 2FA code' },
  'op-username': { type: 'string', description: '1Password op:// reference for username' },
  'op-password': { type: 'string', description: '1Password op:// reference for password' },
  'op-otp': { type: 'string', description: '1Password op:// reference for OTP' },
  'op-vault': { type: 'string', description: '1Password vault name for item lookup' },
  'op-item': { type: 'string', description: '1Password item name for lookup' },
  'op-username-field': { type: 'string', description: '1Password field for username (default: username)' },
  'op-password-field': { type: 'string', description: '1Password field for password (default: password)' },
  'op-otp-field': { type: 'string', description: '1Password field for OTP (default: one-time password)' },
  'bw-item': { type: 'string', description: 'Bitwarden item id or name' },
  'bw-session': { type: 'string', description: 'Bitwarden session token (optional)' },
  'lpass-item': { type: 'string', description: 'LastPass item name or id' },
  'lpass-otp-field': { type: 'string', description: 'LastPass field name for OTP (optional)' },
  'kpx-db': { type: 'string', description: 'KeePassXC database path' },
  'kpx-entry': { type: 'string', description: 'KeePassXC entry path' },
  'kpx-keyfile': { type: 'string', description: 'KeePassXC key file path' },
  'kpx-password': { type: 'string', description: 'KeePassXC database password' },
  'kpx-pw-stdin': { type: 'boolean', description: 'Use keepassxc-cli --pw-stdin when supported' }
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
        'dry-run': { type: 'boolean', description: 'Show what would change without applying' }
      },
      async run({ args }) {
        await runEnsure({ ...normalizeArgs(args), dryRun: Boolean((args as any)['dry-run']) })
      }
    })
  }
})

runMain(main)

async function runCheck(options: CommonOptions): Promise<void> {
  const logger = createLogger(Boolean(options.verbose))
  const target = resolveTarget(options)
  const creds = await resolveCredentials(resolveCredentialOptions(options), false, logger)
  const session = await launchBrowser({
    headless: Boolean(options.headless),
    slowMo: options.slowMo,
    storageStatePath: options.storage,
    screenshotDir: options.screenshotDir
  })

  try {
    await ensureLoggedIn(session.page, creds, logger, buildEnsureOptions(options))
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
  const creds = await resolveCredentials(resolveCredentialOptions(options), true, logger)
  const session = await launchBrowser({
    headless: Boolean(options.headless),
    slowMo: options.slowMo,
    storageStatePath: options.storage,
    screenshotDir: options.screenshotDir
  })

  try {
    await ensureLoggedIn(session.page, creds, logger, buildEnsureOptions(options))
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

function normalizeArgs(raw: Record<string, unknown>): CommonOptions {
  return {
    package: stringArg(raw.package),
    owner: stringArg(raw.owner),
    repo: stringArg(raw.repo),
    workflow: stringArg(raw.workflow),
    environment: stringArg(raw.environment),
    publisher: stringArg(raw.publisher),
    maintainer: stringArg(raw.maintainer),
    publishingAccess: stringArg((raw as any)['publishing-access']),
    headless: Boolean(raw.headless),
    slowMo: numberArg((raw as any)['slow-mo']),
    timeout: numberArg(raw.timeout),
    storage: stringArg(raw.storage),
    screenshotDir: stringArg((raw as any)['screenshot-dir']),
    verbose: Boolean(raw.verbose),
    autoRepo: Boolean((raw as any)['auto-repo']),
    username: stringArg(raw.username),
    password: stringArg(raw.password),
    otp: stringArg(raw.otp),
    opUsername: stringArg((raw as any)['op-username']),
    opPassword: stringArg((raw as any)['op-password']),
    opOtp: stringArg((raw as any)['op-otp']),
    opVault: stringArg((raw as any)['op-vault']),
    opItem: stringArg((raw as any)['op-item']),
    opUsernameField: stringArg((raw as any)['op-username-field']),
    opPasswordField: stringArg((raw as any)['op-password-field']),
    opOtpField: stringArg((raw as any)['op-otp-field']),
    bwItem: stringArg((raw as any)['bw-item']),
    bwSession: stringArg((raw as any)['bw-session']),
    lpassItem: stringArg((raw as any)['lpass-item']),
    lpassOtpField: stringArg((raw as any)['lpass-otp-field']),
    kpxDb: stringArg((raw as any)['kpx-db']),
    kpxEntry: stringArg((raw as any)['kpx-entry']),
    kpxKeyfile: stringArg((raw as any)['kpx-keyfile']),
    kpxPassword: stringArg((raw as any)['kpx-password']),
    kpxPwStdin: Boolean((raw as any)['kpx-pw-stdin'])
  }
}

function resolveTarget(options: CommonOptions): TrustedPublisherTarget {
  const env = process.env
  const packageName = options.package || env.NPM_TRUSTME_PACKAGE
  let owner = options.owner || env.NPM_TRUSTME_OWNER
  let repo = options.repo || env.NPM_TRUSTME_REPO
  let workflow = options.workflow || env.NPM_TRUSTME_WORKFLOW
  const environment = options.environment || env.NPM_TRUSTME_ENVIRONMENT
  const publisher = (options.publisher || env.NPM_TRUSTME_PUBLISHER || 'github').toLowerCase()
  const maintainer = options.maintainer || env.NPM_TRUSTME_MAINTAINER
  const publishingAccess = normalizePublishingAccess(options.publishingAccess || env.NPM_TRUSTME_PUBLISHING_ACCESS)

  if ((!owner || !repo) && options.autoRepo) {
    const inferred = inferGitHubRepo()
    if (inferred) {
      owner = owner || inferred.owner
      repo = repo || inferred.repo
    }
  }

  if (!packageName || !owner || !repo || !workflow) {
    throw new Error('Missing required fields: --package, --owner, --repo, --workflow (or env equivalents).')
  }

  if (workflow.includes('/')) {
    workflow = path.basename(workflow)
  }

  return {
    packageName,
    owner,
    repo,
    workflow,
    environment,
    provider: publisher === 'gitlab' ? 'gitlab' : 'github',
    maintainer,
    publishingAccess
  }
}

function resolveCredentialOptions(options: CommonOptions) {
  const env = process.env
  return {
    username: options.username || env.NPM_TRUSTME_USERNAME || env.NPM_USERNAME,
    password: options.password || env.NPM_TRUSTME_PASSWORD || env.NPM_PASSWORD,
    otp: options.otp || env.NPM_TRUSTME_OTP || env.NPM_OTP,
    opUsername: options.opUsername || env.NPM_TRUSTME_OP_USERNAME,
    opPassword: options.opPassword || env.NPM_TRUSTME_OP_PASSWORD,
    opOtp: options.opOtp || env.NPM_TRUSTME_OP_OTP,
    opVault: options.opVault || env.NPM_TRUSTME_OP_VAULT,
    opItem: options.opItem || env.NPM_TRUSTME_OP_ITEM,
    opUsernameField: options.opUsernameField || env.NPM_TRUSTME_OP_USERNAME_FIELD,
    opPasswordField: options.opPasswordField || env.NPM_TRUSTME_OP_PASSWORD_FIELD,
    opOtpField: options.opOtpField || env.NPM_TRUSTME_OP_OTP_FIELD,
    bwItem: options.bwItem || env.NPM_TRUSTME_BW_ITEM,
    bwSession: options.bwSession || env.NPM_TRUSTME_BW_SESSION || env.BW_SESSION,
    lpassItem: options.lpassItem || env.NPM_TRUSTME_LPASS_ITEM,
    lpassOtpField: options.lpassOtpField || env.NPM_TRUSTME_LPASS_OTP_FIELD,
    kpxDb: options.kpxDb || env.NPM_TRUSTME_KPX_DB,
    kpxEntry: options.kpxEntry || env.NPM_TRUSTME_KPX_ENTRY,
    kpxKeyfile: options.kpxKeyfile || env.NPM_TRUSTME_KPX_KEYFILE,
    kpxPassword: options.kpxPassword || env.NPM_TRUSTME_KPX_PASSWORD,
    kpxPwStdin: toBool(options.kpxPwStdin, env.NPM_TRUSTME_KPX_PW_STDIN),
    requireOtp: false
  }
}

function buildEnsureOptions(options: CommonOptions) {
  return {
    timeoutMs: options.timeout,
    screenshotDir: options.screenshotDir
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

function toBool(value: boolean | undefined, envValue: string | undefined): boolean {
  if (value !== undefined) return value
  if (!envValue) return false
  return ['1', 'true', 'yes', 'on'].includes(envValue.toLowerCase())
}

function inferGitHubRepo(): { owner: string; repo: string } | null {
  try {
    const url = execSync('git remote get-url origin', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    const match = url.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/)
    if (!match) return null
    return { owner: match[1], repo: match[2] }
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

function preloadEnv() {
  const envArg = findArgValue('--env-file')
  if (envArg) {
    loadEnv({ path: envArg })
  } else {
    loadEnv()
  }
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
