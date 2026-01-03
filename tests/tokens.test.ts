import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAccessToken, buildTokenPayload, extractWebAuthUrls, parseOtp } from '../src/core/npm/tokens.js'
import { createLogger } from '../src/core/logger.js'

const childProcessMock = vi.hoisted(() => ({
  execSync: vi.fn(),
  spawn: vi.fn()
}))

vi.mock('node:child_process', () => ({
  execSync: childProcessMock.execSync,
  spawn: childProcessMock.spawn
}))

describe('npm token helpers', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    childProcessMock.spawn.mockReset()
    childProcessMock.execSync.mockReset()
    childProcessMock.spawn.mockReturnValue({ unref() {} } as any)
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('builds token payload with optional fields', () => {
    const payload = buildTokenPayload('pass', {
      name: 'trustme',
      description: 'bootstrap',
      bypass2fa: true,
      packages: ['pkg'],
      packagesPermission: 'read-write',
      orgs: ['org'],
      orgsPermission: 'read-only'
    })
    expect(payload).toMatchObject({
      password: 'pass',
      name: 'trustme',
      token_description: 'bootstrap',
      bypass_2fa: true,
      packages: ['pkg'],
      packages_and_scopes_permission: 'read-write',
      orgs: ['org'],
      orgs_permission: 'read-only'
    })
  })

  it('extracts WebAuthn URLs from responses', () => {
    const challenge = extractWebAuthUrls({ authUrl: 'https://example.com/auth', doneUrl: 'https://example.com/done' })
    expect(challenge).toEqual({
      authUrl: 'https://example.com/auth',
      doneUrl: 'https://example.com/done'
    })
  })

  it('parses OTP from text and JSON', () => {
    expect(parseOtp('otp=123456')).toBe('123456')
    expect(parseOtp({ otp: '987654' })).toBe('987654')
  })

  it('creates token via WebAuthn flow', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as any

    const authUrl = 'https://example.com/auth'
    const doneUrl = 'https://example.com/done'

    fetchMock.mockImplementation((url: string, options?: any) => {
      const headers = options?.headers ?? {}
      if (url === 'https://registry.npmjs.org/-/npm/v1/tokens' && !headers['npm-otp']) {
        return Promise.resolve(
          new Response(JSON.stringify({ authUrl, doneUrl }), {
            status: 401,
            headers: { 'content-type': 'application/json' }
          })
        )
      }
      if (url === doneUrl) {
        return Promise.resolve(
          new Response(JSON.stringify({ otp: '123456' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
      }
      if (url === 'https://registry.npmjs.org/-/npm/v1/tokens' && headers['npm-otp']) {
        return Promise.resolve(
          new Response(JSON.stringify({ token: 'npm_123' }), {
            status: 201,
            headers: { 'content-type': 'application/json' }
          })
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const result = await createAccessToken(
      'session-token',
      'password',
      { name: 'trustme', timeoutMs: 2000, pollIntervalMs: 5 },
      createLogger(false)
    )

    expect(result.token).toBe('npm_123')
    expect(childProcessMock.spawn).toHaveBeenCalled()
  })
})
