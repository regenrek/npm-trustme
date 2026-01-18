import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { loadTargetsFile } from '../src/core/wizard/targetsFile.js'

describe('loadTargetsFile', () => {
  it('parses JSON array targets', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'npm-trustme-targets-'))
    const file = resolve(dir, 'targets.json')
    writeFileSync(
      file,
      JSON.stringify([
        {
          packageName: 'demo',
          owner: 'acme',
          repo: 'widgets',
          workflow: 'npm-release.yml',
          publishingAccess: 'disallow-tokens'
        }
      ])
    )

    const entries = await loadTargetsFile(file)
    expect(entries).toHaveLength(1)
    expect(entries[0].packageName).toBe('demo')
    expect(entries[0].owner).toBe('acme')
  })

  it('parses YAML targets wrapper', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'npm-trustme-targets-'))
    const file = resolve(dir, 'targets.yml')
    writeFileSync(
      file,
      [
        'targets:',
        '  - package: demo',
        '    owner: acme',
        '    repo: widgets',
        '    workflow: npm-release.yml',
        '    publishingAccess: disallow-tokens'
      ].join('\n')
    )

    const entries = await loadTargetsFile(file)
    expect(entries).toHaveLength(1)
    expect(entries[0].packageName).toBe('demo')
    expect(entries[0].repo).toBe('widgets')
  })

  it('rejects non-scalar fields', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'npm-trustme-targets-'))
    const file = resolve(dir, 'targets.json')
    writeFileSync(
      file,
      JSON.stringify([
        {
          packageName: 'demo',
          owner: { bad: true }
        }
      ])
    )

    await expect(loadTargetsFile(file)).rejects.toThrow('Invalid owner')
  })

  it('rejects empty files', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'npm-trustme-targets-'))
    const file = resolve(dir, 'empty.yml')
    writeFileSync(file, '')
    await expect(loadTargetsFile(file)).rejects.toThrow('Targets file is empty')
  })

  it('rejects invalid shapes', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'npm-trustme-targets-'))
    const file = resolve(dir, 'invalid.json')
    writeFileSync(file, JSON.stringify({ foo: 'bar' }))
    await expect(loadTargetsFile(file)).rejects.toThrow('Targets file must be an array')
  })

  it('rejects non-object entries', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'npm-trustme-targets-'))
    const file = resolve(dir, 'invalid.json')
    writeFileSync(file, JSON.stringify([1]))
    await expect(loadTargetsFile(file)).rejects.toThrow('Invalid target entry at index 0')
  })

  it('rejects malformed input', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'npm-trustme-targets-'))
    const file = resolve(dir, 'broken.yml')
    writeFileSync(file, '[1, 2')
    await expect(loadTargetsFile(file)).rejects.toThrow()
  })
})
