import * as p from '@clack/prompts'
import type { CredentialProvider, CredentialOptions, PartialCredentials } from '../types.js'
import type { Logger } from '../../logger.js'

export function promptProvider(): CredentialProvider {
  return {
    name: 'prompt',
    async resolve(_options: CredentialOptions, current: PartialCredentials, _logger: Logger) {
      const missingUsername = !current.username
      const missingPassword = !current.password
      const needsOtp = !current.otp

      if (!missingUsername && !missingPassword && !needsOtp) return {}

      const username = missingUsername
        ? await p.text({ message: 'npm username or email', validate: (value) => (!value ? 'Required' : undefined) })
        : current.username
      if (missingUsername && p.isCancel(username)) return {}

      const password = missingPassword
        ? await p.password({ message: 'npm password', validate: (value) => (!value ? 'Required' : undefined) })
        : current.password
      if (missingPassword && p.isCancel(password)) return {}

      let otp: string | undefined = current.otp
      if (needsOtp) {
        const otpInput = await p.text({ message: 'npm 2FA code', validate: (value) => (!value ? 'Required' : undefined) })
        if (p.isCancel(otpInput)) return {}
        otp = String(otpInput).trim()
      }

      return {
        username: typeof username === 'string' ? username.trim() : current.username,
        password: typeof password === 'string' ? password : current.password,
        otp
      }
    }
  }
}
