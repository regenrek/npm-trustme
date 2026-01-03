import { describe, it, expect } from 'vitest'
import type { Page } from 'playwright'
import { isLoggedIn } from '../src/core/npm/trustedPublisher.js'

type VisibleOptions = {
  url?: string
  visibleSelectors?: Set<string>
  visibleRoles?: Set<string>
}

function buildPage(options: VisibleOptions = {}): Page {
  const { url = 'https://www.npmjs.com/settings/profile', visibleSelectors, visibleRoles } = options
  const selectors = visibleSelectors ?? new Set<string>()
  const roles = visibleRoles ?? new Set<string>()

  const locatorFor = (visible: boolean) => ({
    first: () => ({
      isVisible: async () => visible
    })
  })

  return {
    url: () => url,
    locator: (selector: string) => locatorFor(selectors.has(selector)),
    getByRole: (role: string) => locatorFor(roles.has(role))
  } as unknown as Page
}

describe('isLoggedIn', () => {
  it('returns false when on login page', async () => {
    const page = buildPage({ url: 'https://www.npmjs.com/login' })
    await expect(isLoggedIn(page)).resolves.toBe(false)
  })

  it('returns false when login fields are visible', async () => {
    const page = buildPage({
      visibleSelectors: new Set(['input[name="username"]'])
    })
    await expect(isLoggedIn(page)).resolves.toBe(false)
  })

  it('returns false when login buttons are visible', async () => {
    const page = buildPage({
      visibleRoles: new Set(['button'])
    })
    await expect(isLoggedIn(page)).resolves.toBe(false)
  })

  it('returns true when no login cues are present', async () => {
    const page = buildPage()
    await expect(isLoggedIn(page)).resolves.toBe(true)
  })
})
