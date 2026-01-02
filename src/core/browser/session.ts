import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { basename, dirname, resolve } from 'node:path'

export interface BrowserOptions {
  headless: boolean
  slowMo?: number
  storageStatePath?: string
  screenshotDir?: string
  chromeProfile?: string
  chromeProfileDir?: string
  chromeUserDataDir?: string
  chromePath?: string
}

export interface BrowserSession {
  browser: Browser | null
  context: BrowserContext
  page: Page
  isPersistent?: boolean
}

export async function launchBrowser(options: BrowserOptions): Promise<BrowserSession> {
  const persistent = resolvePersistentProfile(options)
  if (persistent) {
    const context = await chromium.launchPersistentContext(persistent.userDataDir, {
      headless: options.headless,
      slowMo: options.slowMo,
      args: persistent.args,
      channel: options.chromePath ? undefined : 'chrome',
      executablePath: options.chromePath
    })
    const page = context.pages()[0] ?? (await context.newPage())
    return {
      browser: context.browser(),
      context,
      page,
      isPersistent: true
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
  return { browser, context, page }
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
  if (session.browser) {
    await session.browser.close().catch(() => undefined)
  }
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

function defaultChromeUserDataDir(): string | undefined {
  const home = os.homedir()
  if (process.platform === 'darwin') {
    return resolve(home, 'Library/Application Support/Google/Chrome')
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || process.env.USERPROFILE
    if (!local) return undefined
    return resolve(local, 'Google/Chrome/User Data')
  }
  const linuxDefault = resolve(home, '.config/google-chrome')
  if (existsSync(linuxDefault)) return linuxDefault
  const chromium = resolve(home, '.config/chromium')
  return existsSync(chromium) ? chromium : linuxDefault
}
