import type { AxiosProxyConfig } from 'axios'

export function proxyFromEnv(): AxiosProxyConfig | false {
  const url =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    ''
  if (!url) return false
  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80),
      protocol: parsed.protocol.replace(':', ''),
    }
  } catch {
    return false
  }
}
