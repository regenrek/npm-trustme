import { describe, it, expect } from 'vitest'
import { buildGitCommitArgs, buildGitTagArgs, validateVersionBump } from '../scripts/release-utils.js'

describe('release utils', () => {
  it('accepts major/minor/patch', () => {
    expect(validateVersionBump('major')).toBe('major')
    expect(validateVersionBump('minor')).toBe('minor')
    expect(validateVersionBump('patch')).toBe('patch')
  })

  it('accepts explicit semver', () => {
    expect(validateVersionBump('1.2.3')).toBe('1.2.3')
  })

  it('rejects unsafe or invalid versions', () => {
    expect(() => validateVersionBump('1.2')).toThrow()
    expect(() => validateVersionBump('1.2.3; rm -rf /')).toThrow()
    expect(() => validateVersionBump('patch && echo nope')).toThrow()
  })

  it('builds safe git args', () => {
    expect(buildGitCommitArgs('1.2.3')).toEqual(['commit', '-m', 'chore: release v1.2.3'])
    expect(buildGitTagArgs('1.2.3')).toEqual(['tag', '-a', 'v1.2.3', '-m', 'Release v1.2.3'])
  })
})

