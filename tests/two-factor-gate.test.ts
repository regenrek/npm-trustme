import { describe, it, expect } from 'vitest'
import type { Page } from 'playwright'
import { isTwoFactorGate } from '../src/core/npm/trustedPublisher.js'

type TimeoutRecord = number | undefined

type StubLocator = {
  first: () => StubLocator
  isVisible: (options?: { timeout?: number }) => Promise<boolean>
}

function makeLocator(timeouts: TimeoutRecord[], visible = false): StubLocator {
  const locator: StubLocator = {
    first: () => locator,
    isVisible: async (options) => {
      timeouts.push(options?.timeout)
      return visible
    }
  }
  return locator
}

function buildPage(timeouts: TimeoutRecord[], visible = false): Page {
  return {
    getByRole: () => makeLocator(timeouts, visible),
    locator: () => makeLocator(timeouts, visible)
  } as unknown as Page
}

describe('isTwoFactorGate', () => {
  it('uses no-wait visibility checks', async () => {
    const timeouts: TimeoutRecord[] = []
    const page = buildPage(timeouts, false)

    await expect(isTwoFactorGate(page)).resolves.toBe(false)

    expect(timeouts.length).toBeGreaterThan(0)
    for (const timeout of timeouts) {
      expect(timeout).toBe(0)
    }
  })
})
