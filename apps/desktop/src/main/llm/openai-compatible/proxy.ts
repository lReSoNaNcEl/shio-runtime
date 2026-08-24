import type { AxiosInstance, AxiosProxyConfig } from 'axios'

export type SystemProxyResolver = (url: string) => Promise<string>

function parseProxyUrl(value: string, fallbackProtocol = 'http:'): AxiosProxyConfig | false {
  try {
    const parsed = new URL(value.includes('://') ? value : `${fallbackProtocol}//${value}`)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80),
      protocol: parsed.protocol.replace(':', ''),
      ...(parsed.username
        ? {
            auth: {
              username: decodeURIComponent(parsed.username),
              password: decodeURIComponent(parsed.password),
            },
          }
        : {}),
    }
  } catch {
    return false
  }
}

export function proxyFromEnv(
  environment: NodeJS.ProcessEnv = process.env,
): AxiosProxyConfig | false {
  const value =
    environment.HTTPS_PROXY ||
    environment.https_proxy ||
    environment.HTTP_PROXY ||
    environment.http_proxy ||
    ''
  return value ? parseProxyUrl(value) : false
}

export function proxyFromSystemRules(rules: string): AxiosProxyConfig | false {
  for (const rule of rules.split(';')) {
    const [kind = '', endpoint = ''] = rule.trim().split(/\s+/, 2)
    const normalizedKind = kind.toUpperCase()
    if (normalizedKind === 'DIRECT') return false
    if (!endpoint) continue
    if (normalizedKind === 'PROXY' || normalizedKind === 'HTTP') {
      const proxy = parseProxyUrl(endpoint, 'http:')
      if (proxy) return proxy
    }
    if (normalizedKind === 'HTTPS') {
      const proxy = parseProxyUrl(endpoint, 'https:')
      if (proxy) return proxy
    }
  }
  return false
}

async function resolveElectronSystemProxy(url: string): Promise<string> {
  try {
    const electron = await import('electron')
    return await electron.session.defaultSession.resolveProxy(url)
  } catch {
    return 'DIRECT'
  }
}

export async function resolveLlmProxy(
  url: string,
  options: {
    environment?: NodeJS.ProcessEnv
    resolveSystemProxy?: SystemProxyResolver
  } = {},
): Promise<AxiosProxyConfig | false> {
  const environmentProxy = proxyFromEnv(options.environment)
  if (environmentProxy) return environmentProxy
  const rules = await (options.resolveSystemProxy ?? resolveElectronSystemProxy)(url)
  return proxyFromSystemRules(rules)
}

export function installLlmProxyResolver(
  http: AxiosInstance,
  resolveProxy: (url: string) => Promise<AxiosProxyConfig | false> = resolveLlmProxy,
): void {
  http.interceptors.request.use(async (config) => {
    config.proxy = await resolveProxy(http.getUri(config))
    return config
  })
}
