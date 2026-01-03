import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { defaultChromeUserDataDir } from './chromeProfiles.js'

export interface BrowserOptions {
  headless: boolean
  slowMo?: number
  storageStatePath?: string
  screenshotDir?: string
  chromeProfile?: string
  chromeProfileDir?: string
  chromeUserDataDir?: string
  chromePath?: string
  chromeCdpUrl?: string
  chromeDebugPort?: number
  usePersistentProfile?: boolean
}

export interface BrowserSession {
  browser: Browser | null
  context: BrowserContext
  page: Page
  isPersistent?: boolean
  ownsBrowser?: boolean
}

export async function launchBrowser(options: BrowserOptions): Promise<BrowserSession> {
  const cdpUrl = resolveCdpUrl(options)
  if (cdpUrl) {
    const browser = await chromium.connectOverCDP(cdpUrl)
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const page = await context.newPage()
    return { browser, context, page, ownsBrowser: false }
  }

  const persistent = options.usePersistentProfile === false ? null : resolvePersistentProfile(options)
  if (persistent) {
    let context: BrowserContext
    try {
      context = await chromium.launchPersistentContext(persistent.userDataDir, {
        headless: options.headless,
        slowMo: options.slowMo,
        args: persistent.args,
        channel: options.chromePath ? undefined : 'chrome',
        executablePath: options.chromePath
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('ProcessSingleton')) {
        throw new Error(
          'Chrome profile is already in use. Close Chrome or connect via --chrome-cdp-url/--chrome-debug-port.'
        )
      }
      throw error
    }
    const page = context.pages()[0] ?? (await context.newPage())
    return {
      browser: context.browser(),
      context,
      page,
      isPersistent: true,
      ownsBrowser: true
    }
  }

  const browser = await chromium.launch({
    headless: options.headless,
    slowMo: options.slowMo,
    executablePath: options.chromePath
  })
  const context = await browser.newContext({
    storageState: options.storageStatePath
  })
  const page = await context.newPage()
  return { browser, context, page, ownsBrowser: true }
}

export async function saveStorageState(context: BrowserContext, storageStatePath?: string): Promise<void> {
  if (!storageStatePath) return
  await context.storageState({ path: storageStatePath })
}

export async function captureScreenshot(page: Page, dir: string | undefined, label: string): Promise<string | null> {
  if (!dir) return null
  const file = resolve(dir, `${label}-${Date.now()}.png`)
  await mkdir(dirname(file), { recursive: true })
  const buffer = await page.screenshot({ path: file, fullPage: true })
  if (!buffer) {
    await writeFile(file, '')
  }
  return file
}

export async function closeBrowser(session: BrowserSession): Promise<void> {
  await session.context.close().catch(() => undefined)
  if (session.browser && session.ownsBrowser !== false) {
    await session.browser.close().catch(() => undefined)
  }
}

function resolveCdpUrl(options: BrowserOptions): string | null {
  if (options.chromeCdpUrl) return options.chromeCdpUrl
  if (options.chromeDebugPort) {
    return `http://127.0.0.1:${options.chromeDebugPort}`
  }
  return null
}

function resolvePersistentProfile(options: BrowserOptions): { userDataDir: string; args: string[] } | null {
  if (!options.chromeProfile && !options.chromeProfileDir && !options.chromeUserDataDir) {
    return null
  }

  let profileName = options.chromeProfile || 'Default'
  let userDataDir = options.chromeUserDataDir

  if (options.chromeProfileDir) {
    const profileDir = resolve(options.chromeProfileDir)
    if (!existsSync(profileDir)) {
      throw new Error(`Chrome profile directory not found: ${profileDir}`)
    }
    userDataDir = dirname(profileDir)
    profileName = options.chromeProfile || basename(profileDir)
  } else if (!userDataDir) {
    userDataDir = defaultChromeUserDataDir()
  }

  if (!userDataDir) {
    throw new Error('Unable to determine Chrome user data directory. Pass --chrome-user-data-dir.')
  }

  const resolvedUserDataDir = resolve(userDataDir)
  if (!existsSync(resolvedUserDataDir)) {
    throw new Error(`Chrome user data directory not found: ${resolvedUserDataDir}`)
  }

  const args = profileName ? [`--profile-directory=${profileName}`] : []
  return { userDataDir: resolvedUserDataDir, args }
}

// defaultChromeUserDataDir moved to chromeProfiles.ts
