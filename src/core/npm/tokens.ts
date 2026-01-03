import { execSync } from 'node:child_process'
import { spawn } from 'node:child_process'
import type { Logger } from '../logger.js'

export interface TokenCreateOptions {
  name: string
  description?: string
  expires?: number | string
  bypass2fa?: boolean
  cidr?: string[]
  packages?: string[]
  scopes?: string[]
  orgs?: string[]
  packagesPermission?: 'read-only' | 'read-write' | 'no-access'
  orgsPermission?: 'read-only' | 'read-write' | 'no-access'
  otp?: string
  timeoutMs?: number
  pollIntervalMs?: number
}

export interface TokenCreateResponse {
  key?: string
  name?: string
  description?: string | null
  token?: string
  expiry?: string | null
  cidr?: string[] | null
  bypass_2fa?: boolean
  revoked?: string | null
  created?: string
  updated?: string | null
  accessed?: string | null
  permissions?: Array<{ name?: string; action?: string }>
  scopes?: Array<{ type?: string; name?: string }>
}

export interface WebAuthChallenge {
  authUrl: string
  doneUrl: string
}

const TOKENS_ENDPOINT = 'https://registry.npmjs.org/-/npm/v1/tokens'

export async function createAccessToken(
  sessionToken: string,
  password: string,
  options: TokenCreateOptions,
  logger: Logger
): Promise<TokenCreateResponse> {
  const payload = buildTokenPayload(password, options)
  const headers = baseHeaders(sessionToken)

  if (options.otp) {
    const response = await fetch(TOKENS_ENDPOINT, {
      method: 'POST',
      headers: withOtp(headers, options.otp),
      body: JSON.stringify(payload)
    })
    const body = await readResponseBody(response)
    return handleTokenResponse(response, body)
  }

  const response = await fetch(TOKENS_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  })

  const body = await readResponseBody(response)
  if (response.status !== 401) {
    return handleTokenResponse(response, body)
  }

  const challenge = extractWebAuthUrls(body.json ?? body.text)
  if (!challenge) {
    return handleTokenResponse(response, body)
  }

  logger.info('npm requires WebAuthn approval to create this token.')
  logger.info(`Open this URL to authenticate: ${challenge.authUrl}`)
  openUrl(challenge.authUrl, logger)

  const otp = await pollForOtp(challenge.doneUrl, {
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    logger
  })

  const responseWithOtp = await fetch(TOKENS_ENDPOINT, {
    method: 'POST',
    headers: withOtp(headers, otp),
    body: JSON.stringify(payload)
  })
  const bodyWithOtp = await readResponseBody(responseWithOtp)
  return handleTokenResponse(responseWithOtp, bodyWithOtp)
}

export function buildTokenPayload(password: string, options: TokenCreateOptions) {
  const payload: Record<string, unknown> = {
    password,
    name: options.name,
    token_description: options.description,
    expires: options.expires,
    bypass_2fa: options.bypass2fa ?? false
  }

  if (options.cidr && options.cidr.length) payload.cidr = options.cidr
  if (options.packages && options.packages.length) payload.packages = options.packages
  if (options.scopes && options.scopes.length) payload.scopes = options.scopes
  if (options.orgs && options.orgs.length) payload.orgs = options.orgs
  if (options.packagesPermission) payload.packages_and_scopes_permission = options.packagesPermission
  if (options.orgsPermission) payload.orgs_permission = options.orgsPermission

  return payload
}

export function getNpmSessionToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env.NPM_TRUSTME_SESSION_TOKEN || env.NPM_SESSION_TOKEN
  if (fromEnv) return fromEnv
  try {
    const raw = execSync('npm config get //registry.npmjs.org/:_authToken', {
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim()
    if (raw && raw !== 'undefined' && raw !== 'null') return raw
  } catch {
    return null
  }
  return null
}

export function extractWebAuthUrls(payload: unknown): WebAuthChallenge | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const authUrl = firstString(record, ['authUrl', 'auth_url', 'authURL'])
  const doneUrl = firstString(record, ['doneUrl', 'done_url', 'doneURL'])
  if (authUrl && doneUrl) {
    return { authUrl, doneUrl }
  }
  return null
}

export function parseOtp(payload: unknown): string | null {
  if (typeof payload === 'string') {
    const digits = payload.match(/\b\d{6,20}\b/)
    return digits ? digits[0] : null
  }
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const candidate = firstString(record, ['otp', 'code', 'token'])
  if (candidate && /\d{6,20}/.test(candidate)) return candidate
  return null
}

async function pollForOtp(
  doneUrl: string,
  options: { timeoutMs?: number; pollIntervalMs?: number; logger: Logger }
): Promise<string> {
  const timeout = options.timeoutMs ?? 120000
  const interval = options.pollIntervalMs ?? 2000
  const start = Date.now()

  while (Date.now() - start < timeout) {
    const response = await fetch(doneUrl, { method: 'GET' })
    if (response.ok) {
      const text = await response.text()
      const otp = parseOtp(text)
      if (otp) return otp
      try {
        const json = JSON.parse(text)
        const otpJson = parseOtp(json)
        if (otpJson) return otpJson
      } catch {
        // ignore parse errors
      }
    }
    await sleep(interval)
  }

  throw new Error('Timed out waiting for WebAuthn OTP (doneUrl).')
}

function baseHeaders(sessionToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${sessionToken}`,
    'Content-Type': 'application/json',
    'npm-auth-type': 'web',
    'npm-command': 'token'
  }
}

function withOtp(headers: Record<string, string>, otp: string): Record<string, string> {
  return { ...headers, 'npm-otp': otp }
}

interface ResponseBody {
  text: string
  json: unknown | null
}

async function readResponseBody(response: Response): Promise<ResponseBody> {
  const text = await response.text()
  if (!text) return { text: '', json: null }
  try {
    return { text, json: JSON.parse(text) }
  } catch {
    return { text, json: null }
  }
}

function handleTokenResponse(response: Response, body: ResponseBody): TokenCreateResponse {
  if (response.ok) {
    if (body.json && typeof body.json === 'object') {
      return body.json as TokenCreateResponse
    }
    throw new Error('npm token create failed: invalid JSON response')
  }
  let message = `npm token create failed (HTTP ${response.status})`
  if (body.json && typeof body.json === 'object') {
    const record = body.json as Record<string, unknown>
    const detail = firstString(record, ['error', 'message'])
    if (detail) message = `${message}: ${detail}`
  } else if (body.text) {
    const detail = body.text.trim().slice(0, 160)
    if (detail) message = `${message}: ${detail}`
  }
  throw new Error(message)
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function openUrl(url: string, logger: Logger) {
  try {
    if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
      return
    }
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref()
      return
    }
    spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`Failed to open browser automatically: ${message}`)
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
