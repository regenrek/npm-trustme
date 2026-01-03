import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname, resolve } from 'node:path'

export interface TrustmeConfig {
  chromeCdpUrl?: string
  chromeDebugPort?: number
  chromeUserDataDir?: string
  chromeProfile?: string
  chromePath?: string
  trustedPublisherTemplate?: TrustedPublisherTemplate
}

export interface TrustedPublisherTemplate {
  action: string
  method: 'POST' | 'GET'
  staticFields: Record<string, string>
  fieldMap: {
    owner: string
    repo: string
    workflow: string
    environment?: string
    maintainer?: string
    publisher?: string
  }
}

const DEFAULT_CONFIG_NAME = 'config.json'

export function defaultTrustmeDir(): string {
  return resolve(os.homedir(), '.npm-trustme')
}

export function defaultTrustmeChromeDir(): string {
  return resolve(defaultTrustmeDir(), 'chrome')
}

export function getConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.NPM_TRUSTME_CONFIG
  if (configured) return resolve(configured)
  return resolve(defaultTrustmeDir(), DEFAULT_CONFIG_NAME)
}

export async function readConfig(env: NodeJS.ProcessEnv = process.env): Promise<TrustmeConfig> {
  const path = getConfigPath(env)
  if (!existsSync(path)) return {}
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch {
    return {}
  }
}

export async function writeConfig(update: Partial<TrustmeConfig>, env: NodeJS.ProcessEnv = process.env): Promise<TrustmeConfig> {
  const path = getConfigPath(env)
  const current = await readConfig(env)
  const merged = { ...current, ...update }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(merged, null, 2))
  return merged
}
