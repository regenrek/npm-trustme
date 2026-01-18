import { describe, it, expect } from 'vitest'
import { buildCdpUrl, decideCdpUsage } from '../src/core/browser/cdp.js'

describe('decideCdpUsage', () => {
  it('returns detected CDP url when available', () => {
    const result = decideCdpUsage({
      detectedUrl: 'http://127.0.0.1:9333',
      explicit: false
    })
    expect(result.cdpUrl).toBe('http://127.0.0.1:9333')
    expect(result.shouldError).toBe(false)
    expect(result.shouldFallback).toBe(false)
  })

  it('errors when explicit CDP is missing', () => {
    const result = decideCdpUsage({
      detectedUrl: null,
      explicit: true,
      configuredPort: 9222
    })
    expect(result.shouldError).toBe(true)
    expect(result.attemptedUrl).toBe(buildCdpUrl(9222))
  })

  it('falls back when configured CDP is missing and not explicit', () => {
    const result = decideCdpUsage({
      detectedUrl: undefined,
      explicit: false,
      configuredUrl: 'http://127.0.0.1:9222'
    })
    expect(result.shouldFallback).toBe(true)
    expect(result.shouldError).toBe(false)
  })

  it('does nothing when no CDP is configured or detected', () => {
    const result = decideCdpUsage({
      detectedUrl: undefined,
      explicit: false
    })
    expect(result.cdpUrl).toBeUndefined()
    expect(result.shouldError).toBe(false)
    expect(result.shouldFallback).toBe(false)
  })
})
