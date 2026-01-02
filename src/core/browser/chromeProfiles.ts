import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import { resolve } from 'node:path'
import type { Logger } from '../logger.js'

export interface ChromeCookie {
  name?: string
  domain?: string
  path?: string
  value?: string
  expires?: number
  httpOnly?: boolean
  HttpOnly?: boolean
  secure?: boolean
  Secure?: boolean
  sameSite?: string
  SameSite?: string
}

export interface ChromeCookieReader {
  getCookies: (url: string, profileOrPath?: string) => Promise<ChromeCookie[]>
}

export interface CookieCandidate {
  profile: string
  cookieCount: number
  authMatches: number
  httpOnlyCount: number
  score: number
}

export interface PlaywrightCookie {
  name: string
  value: string
  url?: string
  domain?: string
  path?: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Lax' | 'Strict' | 'None'
}

const NPM_URLS = ['https://www.npmjs.com', 'https://www.npmjs.com/settings/profile']
const AUTH_PATTERNS = [/session/i, /token/i, /auth/i, /npm/i, /login/i]
const SQLITE_BINDINGS_PATTERNS = [/node_sqlite3\.node/i, /bindings file/i, /self-register/i]

export function defaultChromeUserDataDir(): string | undefined {
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

export function listChromeProfiles(userDataDir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(userDataDir)
  } catch {
    return []
  }
  return entries
    .filter((entry) => {
      const fullPath = resolve(userDataDir, entry)
      try {
        return statSync(fullPath).isDirectory() && (entry === 'Default' || entry.startsWith('Profile'))
      } catch {
        return false
      }
    })
    .sort((a, b) => a.localeCompare(b))
}

export function readLastActiveProfile(userDataDir: string): string | null {
  try {
    const localStatePath = resolve(userDataDir, 'Local State')
    if (!existsSync(localStatePath)) return null
    const raw = readFileSync(localStatePath, 'utf8')
    const data = JSON.parse(raw)
    const profile = data?.profile ?? {}
    const lastUsed = profile?.last_used
    if (typeof lastUsed === 'string') {
      return lastUsed
    }
  } catch {
    return null
  }
  return null
}

export async function loadChromeCookieReader(logger: Logger): Promise<ChromeCookieReader | null> {
  try {
    const imported: unknown = await import('chrome-cookies-secure')
    const module = resolveCookieModule(imported)
    if (!module) {
      logger.warn('chrome-cookies-secure missing getCookiesPromised().')
      return null
    }
    return {
      getCookies: async (url, profileOrPath) => module.getCookiesPromised(url, 'puppeteer', profileOrPath)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (SQLITE_BINDINGS_PATTERNS.some((re) => re.test(message))) {
      logger.warn('chrome-cookies-secure requires sqlite bindings. Try: pnpm rebuild chrome-cookies-secure sqlite3 keytar')
    } else {
      logger.warn(`Unable to load chrome-cookies-secure: ${message}`)
    }
    return null
  }
}

export async function detectProfileByCookies(
  profiles: string[],
  reader: ChromeCookieReader,
  logger: Logger,
  userDataDir?: string
): Promise<CookieCandidate | null> {
  const candidates: CookieCandidate[] = []

  for (const profile of profiles) {
    let cookies: ChromeCookie[] = []
    for (const url of NPM_URLS) {
      try {
        const profileSource = userDataDir ? resolve(userDataDir, profile) : profile
        const found = await reader.getCookies(url, profileSource)
        if (Array.isArray(found)) {
          cookies = cookies.concat(found)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`Cookie read failed for profile ${profile}: ${message}`)
      }
    }

    if (!cookies.length) continue
    const { authMatches, httpOnlyCount } = scoreCookies(cookies)
    const cookieCount = cookies.length
    const score = authMatches * 10 + httpOnlyCount * 3 + Math.min(cookieCount, 50)

    candidates.push({
      profile,
      cookieCount,
      authMatches,
      httpOnlyCount,
      score
    })
  }

  if (!candidates.length) return null
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.authMatches !== a.authMatches) return b.authMatches - a.authMatches
    if (b.httpOnlyCount !== a.httpOnlyCount) return b.httpOnlyCount - a.httpOnlyCount
    return b.cookieCount - a.cookieCount
  })
  return candidates[0] ?? null
}

export async function resolveChromeProfileAuto(options: {
  userDataDir?: string
  logger: Logger
  reader?: ChromeCookieReader | null
}): Promise<{ profile: string | null; reason: 'cookies' | 'last-active' | 'none' }> {
  const userDataDir = options.userDataDir || defaultChromeUserDataDir()
  if (!userDataDir) {
    options.logger.warn('Chrome user data directory not found; pass --chrome-user-data-dir.')
    return { profile: null, reason: 'none' }
  }
  if (!existsSync(userDataDir)) {
    options.logger.warn(`Chrome user data directory not found: ${userDataDir}`)
    return { profile: null, reason: 'none' }
  }
  const profiles = listChromeProfiles(userDataDir)
  if (!profiles.length) {
    options.logger.warn(`No Chrome profiles found under ${userDataDir}`)
    return { profile: null, reason: 'none' }
  }

  const reader = options.reader ?? (await loadChromeCookieReader(options.logger))
  if (reader) {
    const candidate = await detectProfileByCookies(profiles, reader, options.logger, userDataDir)
    if (candidate) {
      return { profile: candidate.profile, reason: 'cookies' }
    }
  }

  const lastActive = readLastActiveProfile(userDataDir)
  if (lastActive && profiles.includes(lastActive)) {
    return { profile: lastActive, reason: 'last-active' }
  }

  return { profile: null, reason: 'none' }
}

export async function readNpmCookiesForProfile(options: {
  profile: string
  logger: Logger
  userDataDir?: string
  profileDir?: string
  reader?: ChromeCookieReader | null
}): Promise<PlaywrightCookie[]> {
  const reader = options.reader ?? (await loadChromeCookieReader(options.logger))
  if (!reader) return []

  const profileSource = resolveProfileSource(options.profile, options.userDataDir, options.profileDir)
  const merged: PlaywrightCookie[] = []

  for (const url of NPM_URLS) {
    let cookies: ChromeCookie[] = []
    try {
      cookies = await reader.getCookies(url, profileSource)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      options.logger.warn(`Cookie read failed for ${url}: ${message}`)
      continue
    }
    if (!Array.isArray(cookies)) continue
    for (const cookie of cookies) {
      const normalized = normalizeCookieForPlaywright(cookie, url)
      if (normalized) merged.push(normalized)
    }
  }

  return dedupeCookies(merged)
}

function resolveCookieModule(imported: unknown): { getCookiesPromised: Function } | null {
  if (imported && typeof (imported as any).getCookiesPromised === 'function') {
    return imported as any
  }
  if (imported && typeof imported === 'object') {
    const fallback = (imported as any).default
    if (fallback && typeof fallback.getCookiesPromised === 'function') {
      return fallback as any
    }
  }
  return null
}

function scoreCookies(cookies: ChromeCookie[]) {
  let authMatches = 0
  let httpOnlyCount = 0
  for (const cookie of cookies) {
    const name = (cookie.name || '').toLowerCase()
    if (AUTH_PATTERNS.some((re) => re.test(name))) {
      authMatches += 1
    }
    const httpOnly = typeof cookie.httpOnly === 'boolean' ? cookie.httpOnly : cookie.HttpOnly
    if (httpOnly) {
      httpOnlyCount += 1
    }
  }
  return { authMatches, httpOnlyCount }
}

function resolveProfileSource(profile: string, userDataDir?: string, profileDir?: string): string {
  if (profileDir) return profileDir
  if (userDataDir) return resolve(userDataDir, profile)
  return profile
}

function normalizeCookieForPlaywright(cookie: ChromeCookie, fallbackUrl: string): PlaywrightCookie | null {
  const name = cookie.name?.trim()
  if (!name) return null
  const value = cookie.value ?? ''
  const path = cookie.path ?? '/'
  const domain = cookie.domain
  const httpOnly = typeof cookie.httpOnly === 'boolean' ? cookie.httpOnly : cookie.HttpOnly ?? false
  const secure = typeof cookie.secure === 'boolean' ? cookie.secure : cookie.Secure ?? true
  const expires = normalizeExpires(cookie.expires)
  const sameSite = normalizeSameSite(cookie.sameSite ?? cookie.SameSite)

  const payload: PlaywrightCookie = {
    name,
    value,
    path,
    httpOnly,
    secure
  }
  if (domain) {
    payload.domain = domain
  } else {
    payload.url = fallbackUrl
  }
  if (expires) payload.expires = expires
  if (sameSite) payload.sameSite = sameSite
  return payload
}

function normalizeExpires(expires?: number): number | undefined {
  if (!expires || Number.isNaN(expires)) return undefined
  if (expires > 1_000_000_000_000) {
    return Math.round(expires / 1_000_000 - 11644473600)
  }
  if (expires > 1_000_000_000) {
    return Math.round(expires / 1000)
  }
  return Math.round(expires)
}

function normalizeSameSite(value?: string): 'Lax' | 'Strict' | 'None' | undefined {
  if (!value) return undefined
  const normalized = value.toLowerCase()
  if (normalized.includes('lax')) return 'Lax'
  if (normalized.includes('strict')) return 'Strict'
  if (normalized.includes('none') || normalized.includes('no_restriction')) return 'None'
  return undefined
}

function dedupeCookies(cookies: PlaywrightCookie[]): PlaywrightCookie[] {
  const seen = new Map<string, PlaywrightCookie>()
  for (const cookie of cookies) {
    const domainKey = cookie.domain ?? cookie.url ?? ''
    const key = `${domainKey}:${cookie.name}`
    if (!seen.has(key)) {
      seen.set(key, cookie)
    }
  }
  return Array.from(seen.values())
}
