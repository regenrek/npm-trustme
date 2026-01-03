import { describe, it, expect } from 'vitest'
import { buildScreenshotPath } from '../src/core/browser/session.js'

describe('artifact paths', () => {
  it('keeps screenshots under the configured directory', () => {
    const dir = '/tmp/npm-trustme-artifacts'
    const path = buildScreenshotPath(dir, 'error', 1234)
    expect(path).toBe('/tmp/npm-trustme-artifacts/error-1234.png')
  })

  it('sanitizes labels to avoid path traversal', () => {
    const dir = '/tmp/npm-trustme-artifacts'
    const path = buildScreenshotPath(dir, '../secret', 1234)
    expect(path).toBe('/tmp/npm-trustme-artifacts/..-secret-1234.png')
  })
})

