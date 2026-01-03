import { execFileSync, type SpawnSyncOptions } from 'node:child_process'

export type VersionBump = 'major' | 'minor' | 'patch'

const SEMVER_RE = /^\d+\.\d+\.\d+$/

export function validateVersionBump(input: string): VersionBump | string {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('Version bump cannot be empty.')
  }
  if (trimmed === 'major' || trimmed === 'minor' || trimmed === 'patch') {
    return trimmed
  }
  if (!SEMVER_RE.test(trimmed)) {
    throw new Error(`Invalid version bump "${input}". Use major|minor|patch or a semver like 1.2.3.`)
  }
  return trimmed
}

export function runCommand(cmd: string, args: string[], options?: SpawnSyncOptions): void {
  console.log(`Executing: ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { stdio: 'inherit', ...(options ?? {}) })
}

export function buildGitCommitArgs(version: string): string[] {
  return ['commit', '-m', `chore: release v${version}`]
}

export function buildGitTagArgs(version: string): string[] {
  return ['tag', '-a', `v${version}`, '-m', `Release v${version}`]
}

