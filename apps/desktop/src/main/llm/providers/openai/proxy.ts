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
    const u = new URL(url)
    return {
      host: u.hostname,
      port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80),
      protocol: u.protocol.replace(':', ''),
    }
  } catch {
    return false
  }
}
