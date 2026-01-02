import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CredentialProvider, CredentialOptions, PartialCredentials } from '../types.js'
import type { Logger } from '../../logger.js'

const execFileAsync = promisify(execFile)

export function bitwardenProvider(): CredentialProvider {
  return {
    name: 'bitwarden',
    async resolve(options: CredentialOptions, current: PartialCredentials, logger: Logger) {
      const item = options.bwItem
      if (!item) return {}

      const resolved: PartialCredentials = {}
      const data = await readItem(item, options.bwSession)
      const login = data?.login || {}

      if (!current.username && login.username) {
        resolved.username = String(login.username)
      }
      if (!current.password && login.password) {
        resolved.password = String(login.password)
      }

      if (!current.otp) {
        const otp = await readTotp(item, options.bwSession, logger)
        if (otp) resolved.otp = otp
      }

      return resolved
    }
  }
}

async function readItem(item: string, session?: string) {
  const args = ['get', 'item', item]
  if (session) args.push('--session', session)
  const { stdout } = await execFileAsync('bw', args, { env: process.env, windowsHide: true })
  try {
    return JSON.parse(stdout)
  } catch (error) {
    throw new Error('Bitwarden CLI returned invalid JSON for item')
  }
}

async function readTotp(item: string, session: string | undefined, logger: Logger): Promise<string | undefined> {
  const args = ['get', 'totp', item]
  if (session) args.push('--session', session)
  try {
    const { stdout } = await execFileAsync('bw', args, { env: process.env, windowsHide: true })
    const value = stdout.trim()
    return value || undefined
  } catch (error) {
    logger.debug('Bitwarden CLI did not return a TOTP value.')
    return undefined
  }
}
