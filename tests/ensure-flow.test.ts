import { describe, it, expect } from 'vitest'
import { ensureAccessThenPublisher, type EnsureStepDeps } from '../src/core/npm/ensureFlow.js'

describe('ensureAccessThenPublisher', () => {
  it('updates publishing access before trusted publishers', async () => {
    const calls: string[] = []
    const deps: EnsureStepDeps = {
      ensurePublishingAccess: async () => {
        calls.push('access')
        return 'ok'
      },
      ensureTrustedPublisher: async () => {
        calls.push('tp')
        return 'added'
      }
    }

    await ensureAccessThenPublisher(
      {} as any,
      {
        packageName: 'demo',
        owner: 'owner',
        repo: 'repo',
        workflow: 'npm-release.yml',
        publishingAccess: 'disallow-tokens'
      },
      {} as any,
      {},
      deps
    )

    expect(calls).toEqual(['access', 'tp'])
  })
})
