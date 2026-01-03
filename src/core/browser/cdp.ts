export interface CdpVersionInfo {
  Browser?: string
  webSocketDebuggerUrl?: string
  userAgent?: string
  'WebKit-Version'?: string
}

export function buildCdpUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}

export async function fetchCdpVersion(url: string, timeoutMs = 800): Promise<CdpVersionInfo | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/json/version`, {
      signal: controller.signal
    })
    if (!response.ok) return null
    const data = (await response.json()) as CdpVersionInfo
    return data
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export async function isCdpAvailable(url: string, timeoutMs = 800): Promise<boolean> {
  const info = await fetchCdpVersion(url, timeoutMs)
  return Boolean(info && info.webSocketDebuggerUrl)
}

export async function detectCdpUrl(urls: string[], timeoutMs = 800): Promise<string | null> {
  for (const url of urls) {
    if (await isCdpAvailable(url, timeoutMs)) return url
  }
  return null
}
