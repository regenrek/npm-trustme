import https from 'node:https'

export interface NpmRegistryUser {
  name?: string
  email?: string
  trustedPublisher?: boolean
}

export interface NpmRegistryVersion {
  _npmUser?: NpmRegistryUser
}

export interface NpmRegistryMetadata {
  name?: string
  repository?: unknown
  versions?: Record<string, NpmRegistryVersion>
  ['dist-tags']?: Record<string, string>
}

export interface RegistryStatus {
  exists: boolean
  latestVersion?: string
  hasTrustedPublisher?: boolean
  repository?: unknown
}

export async function fetchPackageMetadata(name: string): Promise<NpmRegistryMetadata | null> {
  const url = packageMetadataUrl(name)
  try {
    const meta = await httpJson(url)
    return meta as NpmRegistryMetadata
  } catch (error) {
    const statusCode = (error as any)?.statusCode
    if (statusCode === 404) return null
    throw error
  }
}

export function getLatestVersion(meta: NpmRegistryMetadata): string | null {
  const latest = meta['dist-tags']?.latest
  return typeof latest === 'string' && latest.trim() ? latest.trim() : null
}

export function hasTrustedPublisher(meta: NpmRegistryMetadata, version: string): boolean {
  const ver = meta.versions?.[version]
  const user = ver?._npmUser
  if (!user) return false
  if (user.trustedPublisher) return true
  if (user.name === 'GitHub Actions' && user.email === 'npm-oidc-no-reply@github.com') return true
  return false
}

export function extractRepository(meta: NpmRegistryMetadata): unknown | undefined {
  return meta.repository
}

function packageMetadataUrl(name: string): string {
  return `https://registry.npmjs.org/${encodeURIComponent(name)}`
}

function httpJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      const { statusCode } = res
      if (!statusCode) {
        reject(new Error('No status code'))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (d) => chunks.push(typeof d === 'string' ? Buffer.from(d) : d))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        if (statusCode < 200 || statusCode >= 300) {
          const err: any = new Error(`HTTP ${statusCode} for ${url}`)
          err.statusCode = statusCode
          err.body = body
          reject(err)
          return
        }
        try {
          resolve(body ? JSON.parse(body) : {})
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
  })
}
