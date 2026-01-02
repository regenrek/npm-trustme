import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CredentialProvider, CredentialOptions, PartialCredentials } from '../types.js'
import type { Logger } from '../../logger.js'

const execFileAsync = promisify(execFile)

export function onePasswordProvider(): CredentialProvider {
  return {
    name: '1password',
    async resolve(options: CredentialOptions, current: PartialCredentials, logger: Logger) {
      const refs = {
        username: options.opUsername,
        password: options.opPassword,
        otp: options.opOtp
      }

      const itemSpec = options.opItem || options.opVault
        ? {
            vault: options.opVault,
            item: options.opItem,
            usernameField: options.opUsernameField,
            passwordField: options.opPasswordField,
            otpField: options.opOtpField
          }
        : undefined

      const needsAny = (!current.username || !current.password || !current.otp) && (refs.username || refs.password || refs.otp || itemSpec)
      if (!needsAny) return {}

      logger.info('Resolving credentials via 1Password CLI...')

      const resolved: PartialCredentials = {}
      if (!current.username) {
        const ref = refs.username || buildOpRef(itemSpec?.vault, itemSpec?.item, itemSpec?.usernameField || 'username')
        if (ref) resolved.username = await readOp(ref)
      }
      if (!current.password) {
        const ref = refs.password || buildOpRef(itemSpec?.vault, itemSpec?.item, itemSpec?.passwordField || 'password')
        if (ref) resolved.password = await readOp(ref)
      }
      if (!current.otp) {
        const ref = refs.otp || buildOpRef(itemSpec?.vault, itemSpec?.item, itemSpec?.otpField || 'one-time password')
        if (ref) resolved.otp = await readOp(ref)
      }

      return resolved
    }
  }
}

function buildOpRef(vault: string | undefined, item: string | undefined, field?: string): string | undefined {
  if (!vault || !item || !field) return undefined
  return `op://${vault}/${item}/${field}`
}

async function readOp(ref: string): Promise<string> {
  const { stdout } = await execFileAsync('op', ['read', ref], {
    env: process.env,
    windowsHide: true
  })
  return stdout.trim()
}
