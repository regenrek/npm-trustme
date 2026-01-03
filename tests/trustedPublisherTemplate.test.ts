import { describe, it, expect } from 'vitest'
import {
  type TrustedPublisherFieldInput,
  buildTrustedPublisherTemplate,
  applyTrustedPublisherViaToken
} from '../src/core/npm/trustedPublisher.js'
import type { TrustedPublisherTemplate } from '../src/core/config.js'
import { createLogger } from '../src/core/logger.js'

const logger = createLogger(false)

describe('trusted publisher template mapping', () => {
  it('maps input names to required fields', () => {
    const inputs: TrustedPublisherFieldInput[] = [
      { name: 'oidc_repositoryOwner', label: 'Organization' },
      { name: 'oidc_repositoryName', label: 'Repository' },
      { name: 'oidc_workflowName', label: 'Workflow filename' },
      { name: 'oidc_githubEnvironmentName', label: 'Environment' }
    ]

    const { fieldMap } = buildTrustedPublisherTemplate('/package/test/access', 'POST', inputs)

    expect(fieldMap.owner).toBe('oidc_repositoryOwner')
    expect(fieldMap.repo).toBe('oidc_repositoryName')
    expect(fieldMap.workflow).toBe('oidc_workflowName')
    expect(fieldMap.environment).toBe('oidc_githubEnvironmentName')
  })
})

// Minimal runtime sanity check for token apply error handling.
describe('trusted publisher token apply', () => {
  it('fails with non-2xx status', async () => {
    const template: TrustedPublisherTemplate = {
      action: '/package/test/access',
      method: 'POST',
      staticFields: {},
      fieldMap: {
        owner: 'oidc_repositoryOwner',
        repo: 'oidc_repositoryName',
        workflow: 'oidc_workflowName'
      }
    }

    const fetchMock = async () => new Response('denied', { status: 403 })
    const originalFetch = global.fetch
    global.fetch = fetchMock as any

    try {
      await expect(
        applyTrustedPublisherViaToken(
          template,
          {
            packageName: 'test',
            owner: 'me',
            repo: 'repo',
            workflow: 'workflow.yml',
            provider: 'github',
            publishingAccess: 'skip'
          },
          'token',
          logger
        )
      ).rejects.toThrow('Token apply failed')
    } finally {
      global.fetch = originalFetch
    }
  })
})
