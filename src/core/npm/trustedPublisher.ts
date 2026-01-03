import type { Page } from 'playwright'
import type { Logger } from '../logger.js'
import { captureScreenshot } from '../browser/session.js'

export type PublishingAccess = 'disallow-tokens' | 'allow-bypass-token' | 'skip'

export interface TrustedPublisherTarget {
  packageName: string
  owner: string
  repo: string
  workflow: string
  environment?: string
  maintainer?: string
  publishingAccess: PublishingAccess
}

export interface EnsureOptions {
  dryRun?: boolean
  timeoutMs?: number
  screenshotDir?: string
  headless?: boolean
}

const LOGIN_URL = 'https://www.npmjs.com/login'
const PROFILE_URL = 'https://www.npmjs.com/settings/profile'

export async function ensureLoggedIn(page: Page, logger: Logger, options: EnsureOptions): Promise<void> {
  const loggedIn = await checkLoggedIn(page)
  if (loggedIn) {
    logger.info('Already logged in to npm.')
    return
  }
  if (options.headless) {
    throw new Error('login requires headless=false to complete login manually.')
  }
  logger.info('Please complete npm login in the browser window...')
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' })
  await waitForManualLogin(page, options)
  logger.success('Logged in to npm.')
}

export async function ensureTrustedPublisher(
  page: Page,
  target: TrustedPublisherTarget,
  logger: Logger,
  options: EnsureOptions
): Promise<'exists' | 'added' | 'dry-run'> {
  await page.goto(accessUrl(target.packageName), { waitUntil: 'domcontentloaded' })

  await waitForAccessReady(page, target.packageName, logger, options)
  await focusTrustedPublishersSection(page)

  const exists = await hasTrustedPublisher(page, target)
  if (exists) {
    logger.success('Trusted publisher already exists.')
    return 'exists'
  }

  if (options.dryRun) {
    logger.info('[dry-run] Would add trusted publisher.')
    return 'dry-run'
  }

  logger.info('Adding trusted publisher...')
  await selectGitHubPublisher(page)
  try {
    await waitForTrustedPublisherForm(page, logger, options)
    await fillTrustedPublisherForm(page, target)
  } catch (error) {
    const screenshot = await captureScreenshot(page, options.screenshotDir, 'trusted-publisher-form')
    const hint = screenshot ? ` (screenshot: ${screenshot})` : ''
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${message}${hint}`)
  }
  await clickSetupConnection(page)

  const confirmed = await waitForTrustedPublisher(page, target, options)
  if (!confirmed) {
    const screenshot = await captureScreenshot(page, options.screenshotDir, 'trusted-publisher-failed')
    const hint = screenshot ? ` (screenshot: ${screenshot})` : ''
    throw new Error(`Failed to confirm trusted publisher creation${hint}`)
  }

  logger.success('Trusted publisher added.')
  return 'added'
}


export async function ensurePublishingAccess(
  page: Page,
  target: TrustedPublisherTarget,
  logger: Logger,
  options: EnsureOptions
): Promise<'ok' | 'updated' | 'dry-run' | 'skipped'> {
  if (target.publishingAccess === 'skip') {
    logger.info('Skipping publishing access settings.')
    return 'skipped'
  }

  await page.goto(accessUrl(target.packageName), { waitUntil: 'domcontentloaded' })
  await waitForAccessReady(page, target.packageName, logger, options)

  const desiredLabel = accessLabel(target.publishingAccess)
  const desiredValue = accessValue(target.publishingAccess)
  const radio = await findRadio(page, desiredLabel, desiredValue)
  if (!radio) {
    logger.warn('Unable to locate publishing access option; skipping.')
    return 'skipped'
  }

  const already = await radio.isChecked().catch(() => false)
  if (already) {
    logger.success('Publishing access already set.')
    return 'ok'
  }

  if (options.dryRun) {
    logger.info('[dry-run] Would update publishing access settings.')
    return 'dry-run'
  }

  await radio.scrollIntoViewIfNeeded().catch(() => {})
  await radio.click()
  const save = await findButton(page, [/save/i, /update package settings/i, /update settings/i, /save changes/i])
  await save.click()
  const confirmed = await waitForPublishingAccess(page, desiredValue, logger, options)
  if (!confirmed) {
    const screenshot = await captureScreenshot(page, options.screenshotDir, 'publishing-access-failed')
    const hint = screenshot ? ` (screenshot: ${screenshot})` : ''
    throw new Error(`Failed to confirm publishing access update${hint}`)
  }

  logger.success('Publishing access updated.')
  return 'updated'
}

async function checkLoggedIn(page: Page): Promise<boolean> {
  await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded' })
  if (page.url().includes('/login')) return false

  const loginSelectors = [
    'input[name="username"]',
    'input#username',
    'input[autocomplete="username"]',
    'input[type="password"]'
  ]
  for (const selector of loginSelectors) {
    const locator = page.locator(selector).first()
    if (await locator.isVisible({ timeout: 1000 }).catch(() => false)) return false
  }

  const loginButtons = [
    page.getByRole('button', { name: /sign in|log in/i }).first(),
    page.getByRole('link', { name: /sign in|log in/i }).first()
  ]
  for (const locator of loginButtons) {
    if (await locator.isVisible({ timeout: 1000 }).catch(() => false)) return false
  }

  return true
}

async function waitForManualLogin(page: Page, options: EnsureOptions): Promise<void> {
  const timeout = options.timeoutMs ?? 120000
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (!page.url().includes('/login')) {
      const loggedIn = await checkLoggedIn(page)
      if (loggedIn) return
    }
    await page.waitForTimeout(1000)
  }
  const screenshot = await captureScreenshot(page, options.screenshotDir, 'login-timeout')
  const hint = screenshot ? ` (screenshot: ${screenshot})` : ''
  throw new Error(`Timed out waiting for npm login${hint}`)
}

async function waitForAccessReady(
  page: Page,
  packageName: string,
  logger: Logger,
  options: EnsureOptions
): Promise<void> {
  const timeout = options.timeoutMs ?? 120000
  const start = Date.now()
  let loginPrompted = false
  let twoFactorPrompted = false
  let lastNavigation = 0

  while (Date.now() - start < timeout) {
    if (page.url().includes('/login')) {
      if (!options.headless) {
        if (!loginPrompted) {
          logger.info('Please complete npm login in the browser window...')
          loginPrompted = true
        }
        await page.waitForTimeout(1000)
        continue
      }
      throw new Error('Not logged in (redirected to login).')
    }

    if (await isTwoFactorGate(page)) {
      if (!options.headless) {
        await triggerSecurityKeyIfPresent(page, logger)
        if (!twoFactorPrompted) {
          logger.info('Complete npm 2FA in the browser window (security key or OTP).')
          twoFactorPrompted = true
        }
        await page.waitForTimeout(1000)
        continue
      }
      throw new Error('npm requires 2FA verification; rerun with headless=false.')
    }

    if (await isTrustedPublishersReady(page)) return

    if (!isAccessUrl(page.url(), packageName) && Date.now() - lastNavigation > 5000) {
      lastNavigation = Date.now()
      await page.goto(accessUrl(packageName), { waitUntil: 'domcontentloaded' })
      continue
    }

    await page.waitForTimeout(1000)
  }

  const screenshot = await captureScreenshot(page, options.screenshotDir, 'access-timeout')
  const hint = screenshot ? ` (screenshot: ${screenshot})` : ''
  const current = page.url()
  throw new Error(`Timed out waiting for npm access page (current: ${current})${hint}`)
}

async function waitForTrustedPublisherForm(page: Page, logger: Logger, options: EnsureOptions): Promise<void> {
  const timeout = options.timeoutMs ?? 60000
  const start = Date.now()
  let twoFactorPrompted = false
  while (Date.now() - start < timeout) {
    if (await isTwoFactorGate(page)) {
      if (!options.headless) {
        await triggerSecurityKeyIfPresent(page, logger)
        if (!twoFactorPrompted) {
          logger.info('Waiting for npm 2FA to complete...')
          twoFactorPrompted = true
        }
        await page.waitForTimeout(1000)
        continue
      }
      throw new Error('npm requires 2FA verification; rerun with headless=false.')
    }

    const ownerField = page.getByRole('textbox', { name: /organization|owner|user/i }).first()
    const repoInput = page
      .locator('input[name="repositoryOwner"], input[name="repositoryName"], input[name="workflowName"]')
      .first()
    if (await ownerField.isVisible({ timeout: 1000 }).catch(() => false)) return
    if (await repoInput.isVisible({ timeout: 1000 }).catch(() => false)) return
    await page.waitForTimeout(500)
  }

  const screenshot = await captureScreenshot(page, options.screenshotDir, 'trusted-publisher-form-timeout')
  const hint = screenshot ? ` (screenshot: ${screenshot})` : ''
  throw new Error(`Timed out waiting for trusted publisher form${hint}`)
}


function accessUrl(pkg: string): string {
  return `https://www.npmjs.com/package/${pkg}/access`
}

async function focusTrustedPublishersSection(page: Page): Promise<void> {
  const tab = page.getByRole('tab', { name: /trusted publishers/i })
  try {
    if (await tab.isVisible({ timeout: 1500 })) {
      await tab.click()
      await page.waitForTimeout(500)
      return
    }
  } catch {
    // ignore
  }

  const heading = page.getByRole('heading', { name: /trusted publishers/i })
  if (await heading.count()) {
    await heading.first().scrollIntoViewIfNeeded()
  }
}

async function selectGitHubPublisher(page: Page): Promise<void> {
  const label = /github actions/i
  const selectors: Array<() => ReturnType<Page['getByRole']>> = [
    () => page.getByRole('button', { name: label }).first(),
    () => page.getByRole('radio', { name: label }).first(),
    () => page.getByRole('tab', { name: label }).first()
  ]

  for (const getter of selectors) {
    const locator = getter()
    try {
      if (await locator.isVisible({ timeout: 1000 })) {
        await locator.click()
        await page.waitForTimeout(300)
        return
      }
    } catch {
      // continue
    }
  }

  const ariaSelector = 'button[aria-label*="GitHub"]'
  const fallback = page.locator(ariaSelector).first()
  if (await fallback.isVisible({ timeout: 1000 }).catch(() => false)) {
    await fallback.click()
    await page.waitForTimeout(300)
  }
}

async function clickSetupConnection(page: Page): Promise<void> {
  const button = await findButton(page, [/set up connection/i, /setup connection/i, /connect/i, /create connection/i])
  await button.click()
  await page.waitForTimeout(1000)
}

async function fillTrustedPublisherForm(page: Page, target: TrustedPublisherTarget): Promise<void> {
  const ownerInput = page.locator('input[name="repositoryOwner"], input[name="owner"], input[name="organization"]').first()
  if (await ownerInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await ownerInput.fill(target.owner)
  } else {
    await fillByLabelAny(page, [/organization/i, /owner/i, /user/i], target.owner)
  }

  const repoInput = page.locator('input[name="repositoryName"], input[name="repo"]').first()
  if (await repoInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await repoInput.fill(target.repo)
  } else {
    await fillByLabelAny(page, [/repository/i, /repo/i], target.repo)
  }

  const workflowInput = page.locator('input[name="workflowName"]').first()
  if (await workflowInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await workflowInput.fill(target.workflow)
  } else {
    await fillByLabelAny(page, [/workflow/i, /workflow filename/i], target.workflow)
  }

  const envInput = page.locator('input[name="githubEnvironmentName"]').first()
  if (target.environment) {
    if (await envInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await envInput.fill(target.environment)
    } else {
      await fillByLabelAny(page, [/environment/i], target.environment)
    }
  }

  if (target.maintainer) {
    await fillOptionalByLabel(page, /maintainer/i, target.maintainer)
  }
}

async function hasTrustedPublisher(page: Page, target: TrustedPublisherTarget): Promise<boolean> {
  const slug = `${target.owner}/${target.repo}`
  const slugVisible = await textVisible(page, slug)
  const workflowVisible = await textVisible(page, target.workflow)
  const envVisible = target.environment ? await textVisible(page, target.environment) : true
  return slugVisible && workflowVisible && envVisible
}

async function waitForTrustedPublisher(page: Page, target: TrustedPublisherTarget, options: EnsureOptions): Promise<boolean> {
  const timeout = options.timeoutMs ?? 30000
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await hasTrustedPublisher(page, target)) return true
    await page.waitForTimeout(1000)
  }
  return false
}

function accessLabel(access: PublishingAccess): RegExp {
  if (access === 'disallow-tokens') {
    return /require two-factor authentication and disallow tokens/i
  }
  return /require two-factor authentication or a granular access token/i
}

function accessValue(access: PublishingAccess): string {
  if (access === 'disallow-tokens') return 'tfa-always-required'
  return 'tfa-required-unless-automation'
}

async function findRadio(page: Page, label: RegExp, value: string) {
  const selector = `input[type="radio"][name="publishingAccess"][value="${value}"]`
  const byValue = page.locator(selector).first()
  if (await byValue.isVisible({ timeout: 1500 }).catch(() => false)) {
    return byValue
  }
  const byRole = page.getByRole('radio', { name: label }).first()
  if (await byRole.isVisible({ timeout: 1500 }).catch(() => false)) {
    return byRole
  }
  const fallback = page.getByLabel(label).first()
  if (await fallback.isVisible({ timeout: 1500 }).catch(() => false)) {
    return fallback
  }
  return null
}

async function findButton(page: Page, patterns: RegExp[]): Promise<ReturnType<Page['getByRole']>> {
  for (const pattern of patterns) {
    const locator = page.getByRole('button', { name: pattern }).first()
    try {
      if (await locator.isVisible({ timeout: 1500 })) return locator
    } catch {
      // continue
    }
  }
  const submit = page.locator('button[type="submit"]').first()
  if (await submit.isVisible({ timeout: 1500 }).catch(() => false)) return submit
  throw new Error('Unable to locate a submit button')
}

async function fillByLabelAny(page: Page, labels: RegExp[], value: string): Promise<void> {
  for (const label of labels) {
    const candidates: Array<ReturnType<Page['locator']>> = [
      page.getByRole('textbox', { name: label }).first(),
      page.getByRole('combobox', { name: label }).first(),
      page.getByLabel(label).first(),
      page.getByPlaceholder(label).first()
    ]
    for (const locator of candidates) {
      if (await locator.isVisible({ timeout: 1500 }).catch(() => false)) {
        if (!(await isEditableLocator(locator))) {
          continue
        }
        await locator.fill(value)
        return
      }
    }
  }
  throw new Error(`Unable to locate field for ${labels.map((l) => l.source).join(', ')}`)
}

async function fillOptionalByLabel(page: Page, label: RegExp, value: string): Promise<void> {
  const candidates: Array<ReturnType<Page['locator']>> = [
    page.getByRole('textbox', { name: label }).first(),
    page.getByRole('combobox', { name: label }).first(),
    page.getByLabel(label).first(),
    page.getByPlaceholder(label).first()
  ]
  for (const locator of candidates) {
    if (await locator.isVisible({ timeout: 1500 }).catch(() => false)) {
      if (!(await isEditableLocator(locator))) {
        continue
      }
      await locator.fill(value)
      return
    }
  }
}

async function textVisible(page: Page, text: string): Promise<boolean> {
  const locator = page.getByText(text, { exact: false }).first()
  try {
    return await locator.isVisible({ timeout: 1000 })
  } catch {
    return false
  }
}

async function isTwoFactorGate(page: Page): Promise<boolean> {
  const signals: Array<ReturnType<Page['locator']>> = [
    page.getByRole('heading', { name: /two[-\s]?factor/i }).first(),
    page.getByRole('button', { name: /use security key|use passkey|use security/i }).first(),
    page.getByRole('link', { name: /use password|unable to verify/i }).first(),
    page.locator('input[autocomplete="one-time-code"]').first(),
    page.locator('input[name="otp"]').first(),
    page.locator('input#otp').first(),
    page.locator('input[type="tel"]').first()
  ]

  for (const locator of signals) {
    if (await locator.isVisible({ timeout: 800 }).catch(() => false)) return true
  }
  return false
}

async function isTrustedPublishersReady(page: Page): Promise<boolean> {
  const tab = page.getByRole('tab', { name: /trusted publishers/i }).first()
  if (await tab.isVisible({ timeout: 800 }).catch(() => false)) return true
  const heading = page.getByRole('heading', { name: /trusted publishers/i }).first()
  if (await heading.isVisible({ timeout: 800 }).catch(() => false)) return true
  const ownerField = page.getByRole('textbox', { name: /organization|owner|user/i }).first()
  if (await ownerField.isVisible({ timeout: 800 }).catch(() => false)) return true
  return false
}

function isAccessUrl(currentUrl: string, packageName: string): boolean {
  return currentUrl.includes(`/package/${packageName}/access`)
}

async function waitForPublishingAccess(
  page: Page,
  value: string,
  logger: Logger,
  options: EnsureOptions
): Promise<boolean> {
  const timeout = options.timeoutMs ?? 60000
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await isTwoFactorGate(page)) {
      if (!options.headless) {
        await triggerSecurityKeyIfPresent(page, logger)
        await page.waitForTimeout(1000)
        continue
      }
      throw new Error('npm requires 2FA verification; rerun with headless=false.')
    }
    const selector = `input[type="radio"][name="publishingAccess"][value="${value}"]`
    const locator = page.locator(selector).first()
    if (await locator.isVisible({ timeout: 1000 }).catch(() => false)) {
      if (await locator.isChecked().catch(() => false)) return true
    }
    await page.waitForTimeout(1000)
  }
  return false
}

async function isEditableLocator(locator: ReturnType<Page['locator']>): Promise<boolean> {
  try {
    return await locator.evaluate((element) => {
      const el = element as HTMLElement
      const tag = el.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
      if (el.isContentEditable) return true
      const role = el.getAttribute('role')
      if (role === 'textbox' || role === 'combobox') return true
      return false
    })
  } catch {
    return false
  }
}

async function triggerSecurityKeyIfPresent(page: Page, logger: Logger): Promise<void> {
  const button = page.getByRole('button', { name: /use security key|use passkey|use security/i }).first()
  if (await button.isVisible({ timeout: 800 }).catch(() => false)) {
    try {
      await button.click()
      logger.info('Triggered security key prompt.')
    } catch {
      // ignore click failures and keep waiting
    }
  }
}
