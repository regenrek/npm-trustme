import type { Logger } from '../logger.js'
import type { CredentialOptions, ResolvedCredentials, PartialCredentials, CredentialProvider } from './types.js'
import { directProvider } from './providers/direct.js'
import { onePasswordProvider } from './providers/onepassword.js'
import { bitwardenProvider } from './providers/bitwarden.js'
import { lastPassProvider } from './providers/lastpass.js'
import { keepassxcProvider } from './providers/keepassxc.js'
import { promptProvider } from './providers/prompt.js'

export type { CredentialOptions, ResolvedCredentials }

export async function resolveCredentials(
  options: CredentialOptions,
  interactive: boolean,
  logger: Logger,
  allowMissing: boolean = false
): Promise<ResolvedCredentials | null> {
  const providers: CredentialProvider[] = [
    directProvider(),
    onePasswordProvider(),
    bitwardenProvider(),
    lastPassProvider(),
    keepassxcProvider()
  ]

  if (interactive) {
    providers.push(promptProvider())
  }

  let current: PartialCredentials = {}
  for (const provider of providers) {
    const next = await provider.resolve(options, current, logger)
    current = mergeCredentials(current, next)
  }

  if (!current.username || !current.password) {
    if (allowMissing) {
      return null
    }
    throw new Error('Missing npm username/password (use --op-* refs, --username/--password, or env vars).')
  }

  return {
    username: current.username,
    password: current.password,
    otp: current.otp
  }
}

function mergeCredentials(current: PartialCredentials, next: PartialCredentials): PartialCredentials {
  return {
    username: current.username || next.username,
    password: current.password || next.password,
    otp: current.otp || next.otp
  }
}
