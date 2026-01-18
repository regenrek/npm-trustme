import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'

export interface TargetFileEntry {
  packageName?: string
  packagePath?: string
  owner?: string
  repo?: string
  workflow?: string
  environment?: string
  maintainer?: string
  publishingAccess?: string
}

export async function loadTargetsFile(filePath: string): Promise<TargetFileEntry[]> {
  const raw = await readFile(filePath, 'utf8')
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error(`Targets file is empty: ${filePath}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    parsed = parseYaml(trimmed)
  }

  const entries: unknown[] | null = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { targets?: unknown[] }).targets)
      ? (parsed as { targets: unknown[] }).targets
      : null

  if (!entries) {
    throw new Error('Targets file must be an array or an object with a "targets" array.')
  }

  return entries.map((entry, index) => normalizeEntry(entry, index))
}

function normalizeEntry(entry: unknown, index: number): TargetFileEntry {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Invalid target entry at index ${index}.`)
  }
  const data = entry as Record<string, unknown>
  return {
    packageName: scalarField(data.packageName ?? data.package, 'packageName', index),
    packagePath: scalarField(data.packagePath, 'packagePath', index),
    owner: scalarField(data.owner, 'owner', index),
    repo: scalarField(data.repo, 'repo', index),
    workflow: scalarField(data.workflow, 'workflow', index),
    environment: scalarField(data.environment, 'environment', index),
    maintainer: scalarField(data.maintainer, 'maintainer', index),
    publishingAccess: scalarField(data.publishingAccess, 'publishingAccess', index)
  }
}

function scalarField(value: unknown, field: string, index: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? text : undefined
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  throw new Error(`Invalid ${field} at index ${index}; expected string, number, or boolean.`)
}
