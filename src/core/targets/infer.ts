import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

export function inferPackageName(rootDir: string): string | null {
  const pkgPath = resolve(rootDir, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    const raw = readFileSync(pkgPath, 'utf8')
    const data = JSON.parse(raw)
    const name = typeof data?.name === 'string' ? data.name.trim() : ''
    return name.length ? name : null
  } catch {
    return null
  }
}

export function inferWorkflowFile(rootDir: string): string | null {
  const workflowsDir = resolve(rootDir, '.github', 'workflows')
  const preferred = resolve(workflowsDir, 'npm-release.yml')
  if (existsSync(preferred)) return 'npm-release.yml'

  if (!existsSync(workflowsDir)) return null
  let entries: string[] = []
  try {
    entries = readdirSync(workflowsDir)
  } catch {
    return null
  }
  const candidates = entries.filter((entry) => {
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) return false
    const full = resolve(workflowsDir, entry)
    try {
      return statSync(full).isFile()
    } catch {
      return false
    }
  })
  if (candidates.length === 1) {
    return candidates[0] ?? null
  }
  return null
}

export function parseGitHubRemote(remoteUrl: string): { owner: string; repo: string } | null {
  const trimmed = remoteUrl.trim()
  if (!trimmed) return null
  const match = trimmed.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

