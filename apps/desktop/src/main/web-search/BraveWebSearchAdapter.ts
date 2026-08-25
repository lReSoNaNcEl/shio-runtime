import type {
  WebSearchFreshness,
  WebSearchInput,
  WebSearchResult,
  WebSearchResultItem,
  WebSearchStatus,
} from '../../shared/web-search'
import type { WebSearchAdapter } from './WebSearchAdapter'

const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'
const SEARCH_TIMEOUT_MS = 12_000
const FRESHNESS: Record<WebSearchFreshness, string> = {
  day: 'pd',
  week: 'pw',
  month: 'pm',
  year: 'py',
}

interface BraveWebResult {
  title?: unknown
  url?: unknown
  description?: unknown
  page_age?: unknown
  profile?: { long_name?: unknown }
  meta_url?: { hostname?: unknown }
}

function boundedString(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maximum) : undefined
}

function publishedAt(value: unknown): string | undefined {
  const candidate = boundedString(value, 100)
  if (!candidate) return undefined
  const timestamp = Date.parse(candidate)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined
}

function searchQuery(input: WebSearchInput): string {
  const domainFilter = input.domains?.map((domain) => `site:${domain}`).join(' OR ')
  return domainFilter ? `${input.query} (${domainFilter})` : input.query
}

export class BraveWebSearchAdapter implements WebSearchAdapter {
  constructor(
    private readonly credential: () => string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  status(): WebSearchStatus {
    return this.credential()?.trim()
      ? { availability: 'available' }
      : { availability: 'needs-setup', reason: 'missing-credential' }
  }

  async search(input: WebSearchInput, signal?: AbortSignal): Promise<WebSearchResult> {
    const token = this.credential()?.trim()
    if (!token) throw new Error('WEB_SEARCH_CREDENTIAL_MISSING')
    const url = new URL(BRAVE_SEARCH_ENDPOINT)
    url.searchParams.set('q', searchQuery(input))
    url.searchParams.set('count', String(input.limit ?? 5))
    url.searchParams.set('safesearch', 'moderate')
    url.searchParams.set('extra_snippets', 'false')
    if (input.freshness) url.searchParams.set('freshness', FRESHNESS[input.freshness])

    const timeoutSignal = AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': token,
      },
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    })
    if (!response.ok) throw new Error(`WEB_SEARCH_HTTP_${response.status}`)
    const payload = (await response.json()) as { web?: { results?: unknown } }
    const rawResults = Array.isArray(payload.web?.results) ? payload.web.results : []
    const maximum = input.limit ?? 5
    const results: WebSearchResultItem[] = []
    for (const raw of rawResults.slice(0, maximum)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const item = raw as BraveWebResult
      const title = boundedString(item.title, 300)
      const urlValue = boundedString(item.url, 2_048)
      if (!title || !urlValue) continue
      let parsedUrl: URL
      try {
        parsedUrl = new URL(urlValue)
      } catch {
        continue
      }
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') continue
      results.push({
        title,
        url: parsedUrl.toString(),
        snippet: boundedString(item.description, 600),
        publishedAt: publishedAt(item.page_age),
        source:
          boundedString(item.profile?.long_name, 160) ??
          boundedString(item.meta_url?.hostname, 253) ??
          parsedUrl.hostname,
      })
    }
    return Object.freeze({
      results: Object.freeze(results.map((result) => Object.freeze(result))),
      truncated: rawResults.length > maximum,
      provider: 'brave',
    })
  }
}
