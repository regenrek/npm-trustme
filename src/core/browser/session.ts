import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export interface BrowserOptions {
  headless: boolean
  slowMo?: number
  storageStatePath?: string
  screenshotDir?: string
}

export interface BrowserSession {
  browser: Browser
  context: BrowserContext
  page: Page
}

export async function launchBrowser(options: BrowserOptions): Promise<BrowserSession> {
  const browser = await chromium.launch({ headless: options.headless, slowMo: options.slowMo })
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
  await session.browser.close().catch(() => undefined)
}
