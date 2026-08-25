import type {
  WebSearchFreshness,
  WebSearchInput,
  WebSearchResult,
  WebSearchResultItem,
  WebSearchStatus,
} from '../../shared/web-search'
import type { WebSearchAdapter } from './WebSearchAdapter'

const DUCKDUCKGO_LITE_ENDPOINT = 'https://lite.duckduckgo.com/lite/'
const SEARCH_TIMEOUT_MS = 12_000
const MAX_RESPONSE_BYTES = 1_000_000
const FRESHNESS: Record<WebSearchFreshness, string> = {
  day: 'd',
  week: 'w',
  month: 'm',
  year: 'y',
}

interface ParsedAnchor {
  start: number
  end: number
  href: string
  titleHtml: string
}

function boundedString(value: string, maximum: number): string | undefined {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized ? normalized.slice(0, maximum) : undefined
}

function decodeHtmlEntities(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }
  return value
    .replace(/&#(x?[0-9a-f]+);/giu, (_match, encoded: string) => {
      const hexadecimal = encoded.toLocaleLowerCase().startsWith('x')
      const parsed = Number.parseInt(
        hexadecimal ? encoded.slice(1) : encoded,
        hexadecimal ? 16 : 10,
      )
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0x10ffff
        ? String.fromCodePoint(parsed)
        : '\ufffd'
    })
    .replace(/&([a-z]+);/giu, (match, entity: string) => named[entity.toLocaleLowerCase()] ?? match)
}

function plainText(html: string, maximum: number): string | undefined {
  return boundedString(
    decodeHtmlEntities(html.replace(/<!--[\s\S]*?-->/gu, ' ').replace(/<[^>]*>/gu, ' ')),
    maximum,
  )
}

function attribute(attributes: string, name: string): string | undefined {
  const pattern = /([a-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu
  for (const match of attributes.matchAll(pattern)) {
    if (match[1]?.toLocaleLowerCase() !== name) continue
    return match[2] ?? match[3] ?? match[4]
  }
  return undefined
}

function resultAnchors(html: string): readonly ParsedAnchor[] {
  const anchors: ParsedAnchor[] = []
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/giu
  for (const match of html.matchAll(pattern)) {
    const attributes = match[1] ?? ''
    const classes = attribute(attributes, 'class')?.split(/\s+/u) ?? []
    const href = attribute(attributes, 'href')
    if (!classes.includes('result-link') || !href || match.index === undefined) continue
    anchors.push({
      start: match.index,
      end: match.index + match[0].length,
      href,
      titleHtml: match[2] ?? '',
    })
  }
  return Object.freeze(anchors)
}

function externalResultUrl(value: string): URL | undefined {
  let parsed: URL
  try {
    parsed = new URL(decodeHtmlEntities(value), DUCKDUCKGO_LITE_ENDPOINT)
    if (parsed.hostname === 'duckduckgo.com' && parsed.pathname === '/l/') {
      const target = parsed.searchParams.get('uddg')
      if (!target) return undefined
      parsed = new URL(target)
    }
  } catch {
    return undefined
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username ||
    parsed.password
  ) {
    return undefined
  }
  parsed.hash = ''
  return parsed
}

function parsedResults(html: string): readonly WebSearchResultItem[] {
  const anchors = resultAnchors(html)
  const results: WebSearchResultItem[] = []
  for (const [index, anchor] of anchors.entries()) {
    const title = plainText(anchor.titleHtml, 300)
    const url = externalResultUrl(anchor.href)
    if (!title || !url) continue
    const segment = html.slice(anchor.end, anchors[index + 1]?.start ?? html.length)
    const snippetHtml =
      /<td\b[^>]*class\s*=\s*(['"])[^'"]*\bresult-snippet\b[^'"]*\1[^>]*>([\s\S]*?)<\/td>/iu.exec(
        segment,
      )?.[2]
    results.push({
      title,
      url: url.toString(),
      snippet: snippetHtml ? plainText(snippetHtml, 600) : undefined,
      source: url.hostname,
    })
  }
  return Object.freeze(results.map((result) => Object.freeze(result)))
}

function searchQuery(input: WebSearchInput): string {
  const domainFilter = input.domains?.map((domain) => `site:${domain}`).join(' OR ')
  return domainFilter ? `${input.query} (${domainFilter})` : input.query
}

async function boundedHtml(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error('WEB_SEARCH_RESPONSE_TOO_LARGE')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let html = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error('WEB_SEARCH_RESPONSE_TOO_LARGE')
    }
    html += decoder.decode(value, { stream: true })
  }
  return html + decoder.decode()
}

function validateResponseOrigin(value: string): void {
  if (!value) return
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    !['duckduckgo.com', 'html.duckduckgo.com', 'lite.duckduckgo.com'].includes(url.hostname)
  ) {
    throw new Error('WEB_SEARCH_UNEXPECTED_ORIGIN')
  }
}

export class DuckDuckGoWebSearchAdapter implements WebSearchAdapter {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  status(): WebSearchStatus {
    return { availability: 'available' }
  }

  async search(input: WebSearchInput, signal?: AbortSignal): Promise<WebSearchResult> {
    const url = new URL(DUCKDUCKGO_LITE_ENDPOINT)
    url.searchParams.set('q', searchQuery(input))
    if (input.freshness) url.searchParams.set('df', FRESHNESS[input.freshness])

    const timeoutSignal = AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'text/html',
        'Accept-Encoding': 'gzip, br',
        'User-Agent': 'Shio-Runtime-WebSearch/1.0',
      },
      redirect: 'follow',
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    })
    if (response.status !== 200) throw new Error(`WEB_SEARCH_HTTP_${response.status}`)
    validateResponseOrigin(response.url)
    if (!response.headers.get('content-type')?.toLocaleLowerCase().includes('text/html')) {
      throw new Error('WEB_SEARCH_UNEXPECTED_CONTENT_TYPE')
    }
    const rawResults = parsedResults(await boundedHtml(response))
    const maximum = input.limit ?? 5
    return Object.freeze({
      results: Object.freeze(rawResults.slice(0, maximum)),
      truncated: rawResults.length > maximum,
      provider: 'duckduckgo',
    })
  }
}
