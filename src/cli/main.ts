#!/usr/bin/env node
import { defineCommand, runMain } from 'citty'
import { config as loadEnv } from 'dotenv'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { execSync, spawn } from 'node:child_process'
import { createLogger, redact } from '../core/logger.js'
import { launchBrowser, saveStorageState, closeBrowser } from '../core/browser/session.js'
import { resolveChromeProfileAuto, readNpmCookiesForProfile, defaultChromeUserDataDir, type InlineCookieInput } from '../core/browser/chromeProfiles.js'
import { buildCdpUrl, detectCdpUrl, fetchCdpVersion } from '../core/browser/cdp.js'
import { readConfig, writeConfig, defaultTrustmeChromeDir } from '../core/config.js'
import { createAccessToken, getNpmSessionToken, type TokenCreateResponse } from '../core/npm/tokens.js'
import {
  ensureLoggedIn,
  ensureTrustedPublisher,
  ensurePublishingAccess,
  captureTrustedPublisherTemplate,
  applyTrustedPublisherViaToken,
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
  loginMode?: string
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
  authToken?: string
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

interface TokenCliOptions extends CommonOptions {
  tokenName?: string
  tokenDescription?: string
  tokenExpires?: string | number
  tokenBypass2fa?: boolean
  tokenCidr?: string[]
  tokenPackages?: string[]
  tokenScopes?: string[]
  tokenOrgs?: string[]
  tokenPackagesPermission?: string
  tokenOrgsPermission?: string
  sessionToken?: string
  printToken?: boolean
  output?: string
  pollInterval?: number
}

preloadEnv()

const targetArgs = {
  package: { type: 'string', description: 'npm package name (e.g., my-package)' },
  owner: { type: 'string', description: 'GitHub org/user (e.g., my-org)' },
  repo: { type: 'string', description: 'GitHub repo name (e.g., my-repo)' },
  workflow: { type: 'string', description: 'Workflow filename (e.g., npm-release.yml)' },
  environment: { type: 'string', description: 'GitHub environment (optional)' },
  publisher: { type: 'string', description: 'Publisher type: github|gitlab' },
  maintainer: { type: 'string', description: 'Maintainer (optional)' },
  'publishing-access': { type: 'string', description: 'disallow-tokens|allow-bypass-token|skip' },
  'auto-repo': { type: 'boolean', description: 'Infer owner/repo from git remote' }
} as const

const browserArgs = {
  'login-mode': { type: 'string', description: 'Login mode: auto|browser (browser uses existing session/manual login)' },
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
  'inline-cookies-file': { type: 'string', description: 'Path to inline cookie payload file (sweet-cookie format)' },
  'auth-token': { type: 'string', description: 'Granular access token for API-based Trusted Publisher setup' }
} as const

const credentialArgs = {
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

const envArgs = {
  'env-file': { type: 'string', description: 'Path to .env file (default: ./.env)' }
} as const

const commonArgs = {
  ...targetArgs,
  ...browserArgs,
  ...credentialArgs,
  verbose: { type: 'boolean', description: 'Verbose output' },
  ...envArgs
} as const

const tokenArgs = {
  name: { type: 'string', description: 'Token name (required)' },
  description: { type: 'string', description: 'Token description' },
  expires: { type: 'string', description: 'Token expiration (e.g., 30d or 2026-02-01T00:00:00Z)' },
  'bypass-2fa': { type: 'boolean', description: 'Enable bypass 2FA (recommended for automation)' },
  cidr: { type: 'string', description: 'Comma-separated CIDR allowlist' },
  packages: { type: 'string', description: 'Comma-separated package names' },
  scopes: { type: 'string', description: 'Comma-separated scopes' },
  orgs: { type: 'string', description: 'Comma-separated orgs' },
  'packages-permission': { type: 'string', description: 'no-access|read-only|read-write' },
  'orgs-permission': { type: 'string', description: 'no-access|read-only|read-write' },
  'session-token': { type: 'string', description: 'npm session token (from npm login --auth-type=web)' },
  'print-token': { type: 'boolean', description: 'Print the token to stdout' },
  output: { type: 'string', description: 'Write token JSON to this path (0600)' },
  'poll-interval': { type: 'string', description: 'Polling interval for WebAuthn doneUrl (ms)' },
  timeout: { type: 'string', description: 'Timeout for WebAuthn approval (ms)' }
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
    }),
    capture: defineCommand({
      meta: { name: 'capture', description: 'Capture Trusted Publisher form template for API mode' },
      args: commonArgs,
      async run({ args }) {
        await runCaptureTemplate(normalizeArgs(args))
      }
    }),
    token: defineCommand({
      meta: { name: 'token', description: 'Create granular access tokens for npm automation' },
      subCommands: {
        create: defineCommand({
          meta: { name: 'create', description: 'Create a granular access token (WebAuthn-friendly)' },
          args: {
            ...tokenArgs,
            ...credentialArgs,
            verbose: commonArgs.verbose,
            ...envArgs
          },
          async run({ args }) {
            await runTokenCreate(normalizeTokenArgs(args))
          }
        })
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
    })
  }
})

runMain(main)

async function runCheck(options: CommonOptions): Promise<void> {
  const logger = createLogger(Boolean(options.verbose))
  const target = resolveTarget(options)
  const credentialOptions = resolveCredentialOptions(options)
  const loginMode = resolveLoginMode(options, credentialOptions)
  const creds = await resolveCredentials(credentialOptions, false, logger, loginMode !== 'auto')
  const browserOptions = await resolveBrowserOptions(options, loginMode, logger)
  const session = await launchBrowser(browserOptions)
  await applyBrowserCookies(session, browserOptions, loginMode, options, logger)

  try {
    await ensureLoggedIn(session.page, creds, logger, buildEnsureOptions(options, loginMode))
    const status = await ensureTrustedPublisher(session.page, target, logger, {
      ...buildEnsureOptions(options, loginMode),
      dryRun: true
    })
    const accessStatus = await ensurePublishingAccess(session.page, target, logger, {
      ...buildEnsureOptions(options, loginMode),
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
  const authToken = resolveAuthToken(options, process.env)

  if (authToken) {
    const config = await readConfig(process.env)
    const template = config.trustedPublisherTemplate
    if (!template) {
      throw new Error('No trusted publisher template found. Run `npm-trustme capture --login-mode browser` first.')
    }
    await applyTrustedPublisherViaToken(template, target, authToken, logger)
    if (target.publishingAccess !== 'skip') {
      logger.warn('Publishing access update skipped in token mode. Rerun with --publishing-access skip or use browser mode.')
    }
    return
  }

  const credentialOptions = resolveCredentialOptions(options)
  const loginMode = resolveLoginMode(options, credentialOptions)
  const creds = await resolveCredentials(credentialOptions, loginMode === 'auto', logger, loginMode !== 'auto')
  const browserOptions = await resolveBrowserOptions(options, loginMode, logger)
  const session = await launchBrowser(browserOptions)
  await applyBrowserCookies(session, browserOptions, loginMode, options, logger)

  try {
    await ensureLoggedIn(session.page, creds, logger, buildEnsureOptions(options, loginMode))
    const status = await ensureTrustedPublisher(session.page, target, logger, {
      ...buildEnsureOptions(options, loginMode),
      dryRun: options.dryRun
    })
    const accessStatus = await ensurePublishingAccess(session.page, target, logger, {
      ...buildEnsureOptions(options, loginMode),
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

async function runCaptureTemplate(options: CommonOptions): Promise<void> {
  const logger = createLogger(Boolean(options.verbose))
  const target = resolveTarget(options)
  const credentialOptions = resolveCredentialOptions(options)
  const loginMode = resolveLoginMode(options, credentialOptions)
  const creds = await resolveCredentials(credentialOptions, loginMode === 'auto', logger, loginMode !== 'auto')
  const browserOptions = await resolveBrowserOptions(options, loginMode, logger)
  const session = await launchBrowser(browserOptions)
  await applyBrowserCookies(session, browserOptions, loginMode, options, logger)

  try {
    await ensureLoggedIn(session.page, creds, logger, buildEnsureOptions(options, loginMode))
    const template = await captureTrustedPublisherTemplate(session.page, target, logger, buildEnsureOptions(options, loginMode))
    await writeConfig({ trustedPublisherTemplate: template }, process.env)
    logger.success('Trusted publisher template saved to config.')
  } finally {
    await saveStorageState(session.context, options.storage)
    await closeBrowser(session)
  }
}

async function runTokenCreate(options: TokenCliOptions): Promise<void> {
  const logger = createLogger(Boolean(options.verbose))
  const credentialOptions = resolveCredentialOptions(options)
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
  const creds = await resolveCredentials(credentialOptions, interactive, logger)
  if (!creds) {
    throw new Error('Missing npm password (provide --password/--op-* or env vars).')
  }

  const tokenName = options.tokenName
  if (!tokenName) {
    throw new Error('Missing required --name for token create.')
  }

  const sessionToken = options.sessionToken || getNpmSessionToken()
  if (!sessionToken) {
    throw new Error('Missing npm session token. Run `npm login --auth-type=web` or set NPM_TRUSTME_SESSION_TOKEN.')
  }

  const bypass2fa = options.tokenBypass2fa ?? true
  const tokenOptions = {
    name: tokenName,
    description: options.tokenDescription,
    expires: options.tokenExpires,
    bypass2fa,
    cidr: options.tokenCidr,
    packages: options.tokenPackages,
    scopes: options.tokenScopes,
    orgs: options.tokenOrgs,
    packagesPermission: normalizePermission(options.tokenPackagesPermission, 'packages'),
    orgsPermission: normalizePermission(options.tokenOrgsPermission, 'orgs'),
    otp: options.otp || creds.otp,
    timeoutMs: options.timeout,
    pollIntervalMs: options.pollInterval
  }

  const result = await createAccessToken(sessionToken, creds.password, tokenOptions, logger)
  const tokenValue = result.token || result.key

  if (tokenValue) {
    logger.success(`Token created: ${redact(tokenValue)}`)
  } else {
    logger.success('Token created.')
  }

  const outputPath = resolveTokenOutput(options, process.env)
  if (outputPath && tokenValue) {
    await writeTokenOutput(outputPath, result, tokenValue, logger)
  } else if (outputPath && !tokenValue) {
    logger.warn(`Token created but npm did not return the token value; not writing to ${outputPath}.`)
  }

  const shouldPrint = resolvePrintToken(options, process.env)
  if (shouldPrint) {
    if (!tokenValue) {
      logger.warn('Token created but npm did not return the token value.')
    } else {
      process.stdout.write(`${tokenValue}\n`)
    }
  } else if (!outputPath) {
    logger.warn('Token created but not printed or stored. Use --print-token or --output <path>.')
  }
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
  logger.info('Install the 1Password extension and sign in to npm once in this Chrome profile.')
  logger.info('Then run: npm-trustme ensure --login-mode browser')
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
    loginMode: stringArg((raw as any)['login-mode']),
    headless: Boolean(raw.headless),
    slowMo: numberArg((raw as any)['slow-mo']),
    timeout: numberArg(raw.timeout),
    storage: stringArg(raw.storage),
    screenshotDir: stringArg((raw as any)['screenshot-dir']),
    verbose: Boolean(raw.verbose),
    autoRepo: Boolean((raw as any)['auto-repo']),
    chromeProfile: stringArg((raw as any)['chrome-profile']),
    chromeProfileDir: stringArg((raw as any)['chrome-profile-dir']),
    chromeUserDataDir: stringArg((raw as any)['chrome-user-data-dir']),
    chromePath: stringArg((raw as any)['chrome-path']),
    chromeCdpUrl: stringArg((raw as any)['chrome-cdp-url']),
    chromeDebugPort: numberArg((raw as any)['chrome-debug-port']),
    importCookies: Boolean((raw as any)['import-cookies']),
    inlineCookiesJson: stringArg((raw as any)['inline-cookies-json']),
    inlineCookiesBase64: stringArg((raw as any)['inline-cookies-base64']),
    inlineCookiesFile: stringArg((raw as any)['inline-cookies-file']),
    authToken: stringArg((raw as any)['auth-token']),
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

function normalizeTokenArgs(raw: Record<string, unknown>): TokenCliOptions {
  const base = normalizeArgs(raw)
  const expiresRaw = stringArg((raw as any).expires)
  const expires = expiresRaw ? toNumericOrString(expiresRaw) : undefined
  const bypassRaw = (raw as any)['bypass-2fa']
  return {
    ...base,
    tokenName: stringArg((raw as any).name),
    tokenDescription: stringArg((raw as any).description),
    tokenExpires: expires,
    tokenBypass2fa: bypassRaw === undefined ? undefined : Boolean(bypassRaw),
    tokenCidr: splitList(stringArg((raw as any).cidr)),
    tokenPackages: splitList(stringArg((raw as any).packages)),
    tokenScopes: splitList(stringArg((raw as any).scopes)),
    tokenOrgs: splitList(stringArg((raw as any).orgs)),
    tokenPackagesPermission: stringArg((raw as any)['packages-permission']),
    tokenOrgsPermission: stringArg((raw as any)['orgs-permission']),
    sessionToken: stringArg((raw as any)['session-token']),
    printToken: (raw as any)['print-token'] === undefined ? undefined : Boolean((raw as any)['print-token']),
    output: stringArg((raw as any).output),
    pollInterval: numberArg((raw as any)['poll-interval'])
  }
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const items = value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
  return items.length ? items : undefined
}

function toNumericOrString(value: string): string | number {
  const num = Number(value)
  if (!Number.isNaN(num) && value.trim() !== '') {
    if (String(num) === value.trim()) {
      return num
    }
  }
  return value
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

function buildEnsureOptions(options: CommonOptions, loginMode: LoginMode) {
  return {
    timeoutMs: options.timeout,
    screenshotDir: options.screenshotDir,
    loginMode,
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

type TokenPermission = 'read-only' | 'read-write' | 'no-access'

function normalizePermission(value: string | undefined, label: 'packages' | 'orgs'): TokenPermission | undefined {
  if (!value) return undefined
  const normalized = value.toLowerCase()
  if (normalized === 'read-only' || normalized === 'read-write' || normalized === 'no-access') {
    return normalized as TokenPermission
  }
  throw new Error(`Invalid ${label} permission "${value}". Use read-only|read-write|no-access.`)
}

function resolveTokenOutput(options: TokenCliOptions, env: NodeJS.ProcessEnv): string | undefined {
  return options.output || env.NPM_TRUSTME_TOKEN_PATH || undefined
}

function resolvePrintToken(options: TokenCliOptions, env: NodeJS.ProcessEnv): boolean {
  if (options.printToken !== undefined) return options.printToken
  if (env.NPM_TRUSTME_PRINT_TOKEN !== undefined) {
    return ['1', 'true', 'yes', 'on'].includes(env.NPM_TRUSTME_PRINT_TOKEN.toLowerCase())
  }
  return false
}

function resolveAuthToken(options: CommonOptions, env: NodeJS.ProcessEnv): string | undefined {
  return options.authToken || env.NPM_TRUSTME_AUTH_TOKEN || env.NPM_TRUSTME_TOKEN
}

async function writeTokenOutput(
  outputPath: string,
  result: TokenCreateResponse,
  tokenValue: string,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true })
  const payload = { ...result, token: tokenValue }
  await writeFile(outputPath, JSON.stringify(payload, null, 2), { mode: 0o600 })
  try {
    await chmod(outputPath, 0o600)
  } catch {
    // ignore chmod failures
  }
  logger.success(`Saved token to ${outputPath}`)
}

type LoginMode = 'auto' | 'browser'

function resolveLoginMode(options: CommonOptions, credentialOptions: ReturnType<typeof resolveCredentialOptions>): LoginMode {
  const env = process.env
  const raw = (options.loginMode || env.NPM_TRUSTME_LOGIN_MODE || '').toLowerCase()
  if (raw === 'browser' || raw === 'manual') return 'browser'

  if (hasBrowserProfile(options) && !hasCredentialConfig(credentialOptions)) {
    return 'browser'
  }
  return 'auto'
}

function hasBrowserProfile(options: CommonOptions): boolean {
  const env = process.env
  return Boolean(
    options.chromeProfile ||
    options.chromeProfileDir ||
    options.chromeUserDataDir ||
    options.chromeCdpUrl ||
    options.chromeDebugPort ||
    env.NPM_TRUSTME_CHROME_PROFILE ||
    env.NPM_TRUSTME_CHROME_PROFILE_DIR ||
    env.NPM_TRUSTME_CHROME_USER_DATA_DIR ||
    env.NPM_TRUSTME_CHROME_CDP_URL ||
    env.NPM_TRUSTME_CHROME_DEBUG_PORT
  )
}

function hasCredentialConfig(options: ReturnType<typeof resolveCredentialOptions>): boolean {
  return Boolean(
    options.username ||
      options.password ||
      options.otp ||
      options.opUsername ||
      options.opPassword ||
      options.opOtp ||
      options.opVault ||
      options.opItem ||
      options.bwItem ||
      options.bwSession ||
      options.lpassItem ||
      options.lpassOtpField ||
      options.kpxDb ||
      options.kpxEntry ||
      options.kpxKeyfile ||
      options.kpxPassword
  )
}

async function resolveBrowserOptions(options: CommonOptions, loginMode: LoginMode, logger: ReturnType<typeof createLogger>) {
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
    usePersistentProfile: loginMode !== 'browser'
  }

  if (loginMode !== 'browser') {
    return resolved
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
  loginMode: LoginMode,
  options: CommonOptions,
  logger: ReturnType<typeof createLogger>
) {
  if (loginMode !== 'browser') return
  if (session.isPersistent) return
  const inlineCookies = resolveInlineCookies(options, process.env)
  if (!resolveImportCookies(options, process.env, inlineCookies)) return

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
  const usingCdp = Boolean(browserOptions.chromeCdpUrl || browserOptions.chromeDebugPort)
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
