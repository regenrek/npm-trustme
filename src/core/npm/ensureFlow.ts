import type { Page } from 'playwright'
import type { Logger } from '../logger.js'
import {
  ensurePublishingAccess,
  ensureTrustedPublisher,
  type EnsureOptions,
  type TrustedPublisherTarget
} from './trustedPublisher.js'

export interface EnsureStepDeps {
  ensurePublishingAccess: typeof ensurePublishingAccess
  ensureTrustedPublisher: typeof ensureTrustedPublisher
}

export interface EnsureFlowResult {
  publishingAccess: Awaited<ReturnType<typeof ensurePublishingAccess>>
  trustedPublisher: Awaited<ReturnType<typeof ensureTrustedPublisher>>
}

const defaultDeps: EnsureStepDeps = {
  ensurePublishingAccess,
  ensureTrustedPublisher
}

export async function ensureAccessThenPublisher(
  page: Page,
  target: TrustedPublisherTarget,
  logger: Logger,
  options: EnsureOptions,
  deps: EnsureStepDeps = defaultDeps
): Promise<EnsureFlowResult> {
  const publishingAccess = await deps.ensurePublishingAccess(page, target, logger, options)
  const trustedPublisher = await deps.ensureTrustedPublisher(page, target, logger, options)
  return { publishingAccess, trustedPublisher }
}
