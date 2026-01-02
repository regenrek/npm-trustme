import type { Logger } from '../logger.js'

export interface CredentialOptions {
  username?: string
  password?: string
  otp?: string
  opUsername?: string
  opPassword?: string
  opOtp?: string
  opVault?: string
  opItem?: string
  opUsernameField?: string
  opPasswordField?: string
  opOtpField?: string
  requireOtp?: boolean
}

export interface ResolvedCredentials {
  username: string
  password: string
  otp?: string
}

export type PartialCredentials = Partial<ResolvedCredentials>

export interface CredentialProvider {
  name: string
  resolve: (options: CredentialOptions, current: PartialCredentials, logger: Logger) => Promise<PartialCredentials>
}
