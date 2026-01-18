import { describe, it, expect } from 'vitest'
import { normalizeWorkflowName } from '../src/core/targets/normalize.js'

describe('normalizeWorkflowName', () => {
  it('returns basename for paths', () => {
    expect(normalizeWorkflowName('.github/workflows/npm-release.yml')).toBe('npm-release.yml')
  })

  it('throws on empty input', () => {
    expect(() => normalizeWorkflowName('')).toThrow('Workflow filename cannot be empty')
  })
})
