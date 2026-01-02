import type { CredentialProvider, CredentialOptions, PartialCredentials } from '../types.js'
import type { Logger } from '../../logger.js'

export function directProvider(): CredentialProvider {
  return {
    name: 'direct',
    async resolve(options: CredentialOptions, _current: PartialCredentials, _logger: Logger) {
      return {
        username: options.username?.trim() || undefined,
        password: options.password || undefined,
        otp: options.otp?.trim() || undefined
      }
    }
  }
}
