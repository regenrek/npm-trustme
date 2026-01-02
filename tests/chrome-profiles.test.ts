import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  listChromeProfiles,
  readLastActiveProfile,
  detectProfileByCookies,
  resolveChromeProfileAuto,
  type ChromeCookieReader
} from '../src/core/browser/chromeProfiles.js'
import { createLogger } from '../src/core/logger.js'

function createTempChromeDir() {
  const dir = mkdtempSync(resolve(tmpdir(), 'npm-trustme-chrome-'))
  mkdirSync(resolve(dir, 'Default'))
  mkdirSync(resolve(dir, 'Profile 1'))
  mkdirSync(resolve(dir, 'Other'))
  return dir
}

describe('chrome profile helpers', () => {
  it('lists Default and Profile directories', () => {
    const dir = createTempChromeDir()
    try {
      expect(listChromeProfiles(dir)).toEqual(['Default', 'Profile 1'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads last active profile from Local State', () => {
    const dir = createTempChromeDir()
    try {
      writeFileSync(
        resolve(dir, 'Local State'),
        JSON.stringify({ profile: { last_used: 'Profile 1' } }),
        'utf8'
      )
      expect(readLastActiveProfile(dir)).toBe('Profile 1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('detects profile using cookie scoring', async () => {
    const logger = createLogger(false)
    const profiles = ['Default', 'Profile 1']
    const reader: ChromeCookieReader = {
      async getCookies(_url, profile) {
        if (profile === 'Profile 1') {
          return [{ name: 'npm_session', httpOnly: true }]
        }
        return [{ name: 'ga' }]
      }
    }
    const candidate = await detectProfileByCookies(profiles, reader, logger)
    expect(candidate?.profile).toBe('Profile 1')
  })

  it('resolves profile from cookies before last active fallback', async () => {
    const dir = createTempChromeDir()
    const logger = createLogger(false)
    try {
      writeFileSync(
        resolve(dir, 'Local State'),
        JSON.stringify({ profile: { last_used: 'Default' } }),
        'utf8'
      )
      const reader: ChromeCookieReader = {
        async getCookies(_url, profile) {
          const profileName = typeof profile === 'string' && profile.includes('Profile 1') ? 'Profile 1' : profile
          return profileName === 'Profile 1' ? [{ name: 'npm_token', httpOnly: true }] : []
        }
      }
      const result = await resolveChromeProfileAuto({ userDataDir: dir, logger, reader })
      expect(result.profile).toBe('Profile 1')
      expect(result.reason).toBe('cookies')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
