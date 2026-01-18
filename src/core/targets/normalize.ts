import path from 'node:path'

export function normalizeWorkflowName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Workflow filename cannot be empty.')
  }
  const basename = path.basename(trimmed)
  if (!basename) {
    throw new Error('Workflow filename cannot be empty.')
  }
  return basename
}
