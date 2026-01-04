import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import fg from 'fast-glob'
import { parse as parseYaml } from 'yaml'

export interface WorkspacePackage {
  name: string
  dir: string
  packageJsonPath: string
  private: boolean
  repository?: string
}

export interface WorkspaceInfo {
  rootDir: string
  patterns: string[]
  packages: WorkspacePackage[]
}

export type PackageResolutionReason =
  | 'explicit-package'
  | 'explicit-path'
  | 'workspace-cwd'
  | 'workspace-single'
  | 'root-package'

export interface PackageResolutionOptions {
  cwd: string
  rootDir: string
  packageName?: string
  packagePath?: string
}

export interface ResolvedPackageTarget {
  packageName: string
  packageDir: string
  packageJsonPath?: string
  repository?: string
  private?: boolean
  rootDir: string
  reason: PackageResolutionReason
  workspace?: WorkspaceInfo
}

export function resolveRepoRoot(startDir: string): string | null {
  return findUpward(startDir, (dir) => existsSync(resolve(dir, '.git')))
}

export function resolveWorkspaceRoot(startDir: string): string | null {
  return findUpward(startDir, (dir) => hasWorkspaceConfig(dir))
}

export function resolveWorkspaceInfo(rootDir: string): WorkspaceInfo | null {
  const patterns = readWorkspacePatterns(rootDir)
  if (!patterns.length) return null
  const packages = discoverWorkspacePackages(rootDir, patterns)
  if (!packages.length) {
    throw new Error(`Workspace config found at ${rootDir}, but no packages resolved.`)
  }
  return { rootDir, patterns, packages }
}

export function resolvePackageTarget(options: PackageResolutionOptions): ResolvedPackageTarget {
  const rootDir = options.rootDir
  const workspace = resolveWorkspaceInfo(rootDir)
  const workspacePackages = workspace?.packages ?? []
  const cwd = resolve(options.cwd)

  if (options.packagePath) {
    const resolvedPath = resolvePackagePath(rootDir, options.packagePath)
    const descriptor = readPackageDescriptor(resolvedPath)
    if (!descriptor?.name) {
      throw new Error(`package.json missing or invalid at ${resolvedPath}.`)
    }
    return {
      packageName: descriptor.name,
      packageDir: resolvedPath,
      packageJsonPath: descriptor.packageJsonPath,
      repository: descriptor.repository,
      private: descriptor.private,
      rootDir,
      reason: 'explicit-path',
      workspace
    }
  }

  if (options.packageName) {
    const explicit = options.packageName.trim()
    if (!explicit) {
      throw new Error('Package name cannot be empty.')
    }
    if (workspacePackages.length) {
      const match = findWorkspacePackageByName(workspacePackages, explicit)
      if (match) {
        return {
          packageName: match.name,
          packageDir: match.dir,
          packageJsonPath: match.packageJsonPath,
          repository: match.repository,
          private: match.private,
          rootDir,
          reason: 'explicit-package',
          workspace
        }
      }
      const rootDescriptor = readPackageDescriptor(rootDir)
      if (rootDescriptor?.name === explicit) {
        return {
          packageName: rootDescriptor.name,
          packageDir: rootDescriptor.dir,
          packageJsonPath: rootDescriptor.packageJsonPath,
          repository: rootDescriptor.repository,
          private: rootDescriptor.private,
          rootDir,
          reason: 'explicit-package',
          workspace
        }
      }
      const available = workspacePackages.map(pkg => `${pkg.name} (${relativePath(rootDir, pkg.dir)})`).join(', ')
      throw new Error(
        `Package "${explicit}" not found in workspace. Use --package-path or choose from: ${available}.`
      )
    }
    const rootDescriptor = readPackageDescriptor(rootDir)
    return {
      packageName: explicit,
      packageDir: rootDir,
      packageJsonPath: rootDescriptor?.packageJsonPath,
      repository: rootDescriptor?.repository,
      private: rootDescriptor?.private,
      rootDir,
      reason: 'explicit-package'
    }
  }

  if (workspacePackages.length) {
    const byCwd = findWorkspacePackageForCwd(workspacePackages, cwd)
    if (byCwd) {
      return {
        packageName: byCwd.name,
        packageDir: byCwd.dir,
        packageJsonPath: byCwd.packageJsonPath,
        repository: byCwd.repository,
        private: byCwd.private,
        rootDir,
        reason: 'workspace-cwd',
        workspace
      }
    }
    if (workspacePackages.length === 1) {
      const only = workspacePackages[0]
      return {
        packageName: only.name,
        packageDir: only.dir,
        packageJsonPath: only.packageJsonPath,
        repository: only.repository,
        private: only.private,
        rootDir,
        reason: 'workspace-single',
        workspace
      }
    }
    const available = workspacePackages.map(pkg => `${pkg.name} (${relativePath(rootDir, pkg.dir)})`).join(', ')
    throw new Error(
      `Multiple workspace packages found. Use --package, --package-path, or run from a package directory. Available: ${available}.`
    )
  }

  const rootDescriptor = readPackageDescriptor(rootDir)
  if (rootDescriptor?.name) {
    return {
      packageName: rootDescriptor.name,
      packageDir: rootDir,
      packageJsonPath: rootDescriptor.packageJsonPath,
      repository: rootDescriptor.repository,
      private: rootDescriptor.private,
      rootDir,
      reason: 'root-package'
    }
  }

  throw new Error('Unable to infer package name. Provide --package or --package-path.')
}

function findUpward(startDir: string, predicate: (dir: string) => boolean): string | null {
  let current = resolve(startDir)
  for (let i = 0; i < 50; i += 1) {
    if (predicate(current)) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

function hasWorkspaceConfig(dir: string): boolean {
  if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return true
  const pkg = readPackageJson(resolve(dir, 'package.json'))
  return Boolean(pkg && pkg.workspaces)
}

function readWorkspacePatterns(rootDir: string): string[] {
  const pnpmPath = resolve(rootDir, 'pnpm-workspace.yaml')
  if (existsSync(pnpmPath)) {
    const raw = readFileSync(pnpmPath, 'utf8')
    const data = parseYaml(raw) as { packages?: unknown }
    const packages = Array.isArray(data?.packages) ? data.packages : []
    return normalizeWorkspacePatterns(packages)
  }
  const pkg = readPackageJson(resolve(rootDir, 'package.json'))
  const workspaces = pkg?.workspaces
  if (Array.isArray(workspaces)) return normalizeWorkspacePatterns(workspaces)
  if (workspaces && typeof workspaces === 'object' && Array.isArray((workspaces as any).packages)) {
    return normalizeWorkspacePatterns((workspaces as any).packages)
  }
  return []
}

function normalizeWorkspacePatterns(values: unknown[]): string[] {
  const patterns = values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
  return Array.from(new Set(patterns))
}

function discoverWorkspacePackages(rootDir: string, patterns: string[]): WorkspacePackage[] {
  const matches = fg.sync(patterns, {
    cwd: rootDir,
    onlyFiles: false,
    unique: true,
    followSymbolicLinks: false,
    dot: false,
    ignore: ['**/node_modules/**', '**/.git/**']
  })

  const dirs = new Set<string>()
  for (const match of matches) {
    const abs = resolve(rootDir, match)
    const stat = safeStat(abs)
    if (!stat) continue
    if (stat.isDirectory()) {
      dirs.add(abs)
    } else if (stat.isFile() && abs.endsWith('package.json')) {
      dirs.add(dirname(abs))
    }
  }

  const packages: WorkspacePackage[] = []
  const invalid: string[] = []
  for (const dir of dirs) {
    const descriptor = readPackageDescriptor(dir)
    if (!descriptor?.name) {
      invalid.push(relativePath(rootDir, dir))
      continue
    }
    packages.push(descriptor)
  }

  if (invalid.length) {
    throw new Error(`Workspace package.json missing "name" in: ${invalid.join(', ')}`)
  }

  const byName = new Map<string, WorkspacePackage>()
  for (const pkg of packages) {
    const existing = byName.get(pkg.name)
    if (existing && existing.dir !== pkg.dir) {
      throw new Error(
        `Duplicate workspace package name "${pkg.name}" in ${relativePath(rootDir, existing.dir)} and ${relativePath(
          rootDir,
          pkg.dir
        )}.`
      )
    }
    byName.set(pkg.name, pkg)
  }

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))
}

function findWorkspacePackageByName(packages: WorkspacePackage[], name: string): WorkspacePackage | undefined {
  return packages.find(pkg => pkg.name === name)
}

function findWorkspacePackageForCwd(packages: WorkspacePackage[], cwd: string): WorkspacePackage | undefined {
  const matches = packages.filter(pkg => isWithinDir(pkg.dir, cwd))
  if (!matches.length) return undefined
  return matches.sort((a, b) => b.dir.length - a.dir.length)[0]
}

function resolvePackagePath(rootDir: string, input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Package path cannot be empty.')
  const candidate = resolve(rootDir, trimmed)
  if (!existsSync(candidate)) {
    throw new Error(`Package path not found: ${candidate}`)
  }
  const stat = safeStat(candidate)
  if (!stat) throw new Error(`Package path not accessible: ${candidate}`)

  let dir = candidate
  if (stat.isFile()) {
    if (!candidate.endsWith('package.json')) {
      throw new Error(`Package path must point to a directory or package.json: ${candidate}`)
    }
    dir = dirname(candidate)
  }

  if (!isWithinDir(rootDir, dir)) {
    throw new Error(`Package path must be within ${rootDir}.`)
  }

  return dir
}

function readPackageDescriptor(dir: string): WorkspacePackage | null {
  const packageJsonPath = resolve(dir, 'package.json')
  const pkg = readPackageJson(packageJsonPath)
  if (!pkg) return null
  const name = typeof pkg.name === 'string' ? pkg.name.trim() : ''
  if (!name) {
    return { name: '', dir, packageJsonPath, private: Boolean(pkg.private), repository: normalizeRepository(pkg.repository) }
  }
  return {
    name,
    dir,
    packageJsonPath,
    private: Boolean(pkg.private),
    repository: normalizeRepository(pkg.repository)
  }
}

function readPackageJson(path: string): any | null {
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function normalizeRepository(repo: unknown): string | undefined {
  if (typeof repo === 'string') return repo
  if (repo && typeof repo === 'object' && typeof (repo as any).url === 'string') return (repo as any).url
  return undefined
}

function safeStat(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

function isWithinDir(base: string, target: string): boolean {
  const rel = relative(base, target)
  if (!rel) return true
  return !rel.startsWith('..') && !isAbsolute(rel)
}

function relativePath(rootDir: string, target: string): string {
  const rel = relative(rootDir, target)
  return rel || '.'
}
