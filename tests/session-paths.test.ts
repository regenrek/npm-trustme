import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { buildScreenshotPath } from '../src/core/browser/session.js'

describe('artifact paths', () => {
  it('keeps screenshots under the configured directory', () => {
    const dir = resolve('/tmp/npm-trustme-artifacts')
    const path = buildScreenshotPath(dir, 'error', 1234)
    expect(path).toBe(resolve(dir, 'error-1234.png'))
  })

  it('sanitizes labels to avoid path traversal', () => {
    const dir = resolve('/tmp/npm-trustme-artifacts')
    const path = buildScreenshotPath(dir, '../secret', 1234)
    expect(path).toBe(resolve(dir, '..-secret-1234.png'))
  })
})
