import { type CheerioAPI, load } from 'cheerio'

import type {
  WebSearchFailureCode,
  WebSearchFreshness,
  WebSearchInput,
  WebSearchParserState,
  WebSearchResult,
  WebSearchResultItem,
  WebSearchStatus,
} from '../../shared/web-search'
import { createObservedFetch } from '../diagnostics/createObservedFetch'
import type { WebSearchAdapter } from './WebSearchAdapter'

const DUCKDUCKGO_LITE_ENDPOINT = 'https://lite.duckduckgo.com/lite/'
const SEARCH_TIMEOUT_MS = 12_000
const MAX_RESPONSE_BYTES = 1_000_000
const PARSER_SIGNATURE = 'duckduckgo-lite/cheerio-result-link-v2'
const CIRCUIT_FAILURE_THRESHOLD = 3
const CIRCUIT_OPEN_MS = 30_000
const FRESHNESS: Record<WebSearchFreshness, string> = {
  day: 'd',
  week: 'w',
  month: 'm',
  year: 'y',
}

function boundedString(value: string, maximum: number): string | undefined {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized ? normalized.slice(0, maximum) : undefined
}

function externalResultUrl(value: string): URL | undefined {
  let parsed: URL
  try {
    parsed = new URL(value, DUCKDUCKGO_LITE_ENDPOINT)
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

interface ParsedDocument {
  state: Extract<WebSearchParserState, 'valid-results' | 'valid-empty' | 'structural-failure'>
  results: readonly WebSearchResultItem[]
}

function isChallengePage($: CheerioAPI): boolean {
  if ($('.challenge-form, .anomaly-modal').length > 0) return true
  let structuralMarker = false
  $('[id], [class]').each((_index, element) => {
    const marker = `${$(element).attr('id') ?? ''} ${$(element).attr('class') ?? ''}`
      .toLocaleLowerCase()
      .trim()
    if (marker.includes('captcha') || marker.includes('cf-chl-')) structuralMarker = true
  })
  if (structuralMarker) return true
  const text = boundedString($.root().text(), 20_000) ?? ''
  return /(?:bots use duckduckgo|please complete the following challenge)/iu.test(text)
}

function hasLitePageSignature($: CheerioAPI): boolean {
  const identifiesDuckDuckGo = /duckduckgo/iu.test(`${$('title').text()} ${$.root().text()}`)
  const hasLiteForm = $('form')
    .toArray()
    .some((form) => ($(form).attr('action') ?? '').includes('/lite/'))
  return identifiesDuckDuckGo && (hasLiteForm || $('input[name="q"]').length > 0)
}

function hasExplicitNoResults($: CheerioAPI): boolean {
  return /(?:no (?:more )?results(?: found)?|did not match any documents|no results\.)/iu.test(
    boundedString($.root().text(), 20_000) ?? '',
  )
}

function parseDocument($: CheerioAPI): ParsedDocument {
  const candidates: Array<{ href: string; title: string; snippet?: string }> = []
  let current: (typeof candidates)[number] | undefined
  $('.result-link, .result-snippet').each((_index, element) => {
    const selection = $(element)
    if (selection.hasClass('result-link')) {
      const href = selection.attr('href')
      const title = boundedString(selection.text(), 300)
      current = href && title ? { href, title } : undefined
      if (current) candidates.push(current)
      return
    }
    if (current && current.snippet === undefined) {
      current.snippet = boundedString(selection.text(), 600)
    }
  })

  const results: WebSearchResultItem[] = []
  for (const candidate of candidates) {
    const url = externalResultUrl(candidate.href)
    if (!url) continue
    results.push({
      title: candidate.title,
      url: url.toString(),
      snippet: candidate.snippet,
      source: url.hostname,
    })
  }
  if (results.length > 0) {
    return {
      state: 'valid-results',
      results: Object.freeze(results.map((result) => Object.freeze(result))),
    }
  }
  if (hasLitePageSignature($) && hasExplicitNoResults($)) {
    return { state: 'valid-empty', results: Object.freeze([]) }
  }
  return { state: 'structural-failure', results: Object.freeze([]) }
}

function searchQuery(input: WebSearchInput): string {
  const domainFilter = input.domains?.map((domain) => `site:${domain}`).join(' OR ')
  return domainFilter ? `${input.query} (${domainFilter})` : input.query
}

async function boundedHtml(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new WebSearchAdapterError('response-too-large')
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
      throw new WebSearchAdapterError('response-too-large')
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
    throw new WebSearchAdapterError('unexpected-origin')
  }
}

export class WebSearchAdapterError extends Error {
  constructor(
    readonly code: WebSearchFailureCode,
    message = `WEB_SEARCH_${code.toLocaleUpperCase().replaceAll('-', '_')}`,
  ) {
    super(message)
    this.name = 'WebSearchAdapterError'
  }
}

export class DuckDuckGoWebSearchAdapter implements WebSearchAdapter {
  private parserState: WebSearchParserState = 'not-observed'
  private lastSearchAt: number | undefined
  private lastSuccessfulSearchAt: number | undefined
  private consecutiveFailureCount = 0
  private lastFailureCode: WebSearchFailureCode | undefined
  private circuitOpenUntil: number | undefined

  constructor(
    private readonly fetchImpl: typeof fetch = createObservedFetch(fetch, 'web-search'),
    private readonly now: () => number = Date.now,
  ) {}

  status(): WebSearchStatus {
    const diagnostics = Object.freeze({
      parserSignature: PARSER_SIGNATURE,
      parserState: this.parserState,
      ...(this.lastSearchAt === undefined ? {} : { lastSearchAt: this.lastSearchAt }),
      ...(this.lastSuccessfulSearchAt === undefined
        ? {}
        : { lastSuccessfulSearchAt: this.lastSuccessfulSearchAt }),
      consecutiveFailureCount: this.consecutiveFailureCount,
      ...(this.lastFailureCode === undefined ? {} : { lastFailureCode: this.lastFailureCode }),
      ...(this.circuitOpenUntil === undefined ? {} : { circuitOpenUntil: this.circuitOpenUntil }),
    })
    if (this.circuitOpenUntil !== undefined && this.circuitOpenUntil > this.now()) {
      return { availability: 'degraded', reason: 'circuit-open', diagnostics }
    }
    if (this.parserState === 'structural-failure') {
      return { availability: 'degraded', reason: 'parser-failure', diagnostics }
    }
    if (this.parserState === 'challenge') {
      return { availability: 'degraded', reason: 'challenge', diagnostics }
    }
    if (this.consecutiveFailureCount > 0) {
      return { availability: 'degraded', reason: 'network-failure', diagnostics }
    }
    return { availability: 'available', diagnostics }
  }

  async search(input: WebSearchInput, signal?: AbortSignal): Promise<WebSearchResult> {
    const searchStartedAt = this.now()
    this.lastSearchAt = searchStartedAt
    if (this.circuitOpenUntil !== undefined && this.circuitOpenUntil > searchStartedAt) {
      this.lastFailureCode = 'circuit-open'
      throw new WebSearchAdapterError('circuit-open')
    }
    if (this.circuitOpenUntil !== undefined) this.circuitOpenUntil = undefined
    const url = new URL(DUCKDUCKGO_LITE_ENDPOINT)
    url.searchParams.set('q', searchQuery(input))
    if (input.freshness) url.searchParams.set('df', FRESHNESS[input.freshness])

    const timeoutSignal = AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    try {
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
      validateResponseOrigin(response.url)
      if (!response.headers.get('content-type')?.toLocaleLowerCase().includes('text/html')) {
        throw new WebSearchAdapterError('unexpected-content-type')
      }
      const html = await boundedHtml(response)
      const $ = load(html, { xml: { decodeEntities: true, xmlMode: false } }, false)
      if (isChallengePage($)) {
        this.parserState = 'challenge'
        throw new WebSearchAdapterError('challenge')
      }
      if (response.status !== 200) throw new WebSearchAdapterError('http-error')
      const parsed = parseDocument($)
      this.parserState = parsed.state
      if (parsed.state === 'structural-failure') {
        throw new WebSearchAdapterError('parser-structure')
      }
      this.recordSuccess()
      const maximum = input.limit ?? 5
      return Object.freeze({
        results: Object.freeze(parsed.results.slice(0, maximum)),
        truncated: parsed.results.length > maximum,
        provider: 'duckduckgo',
      })
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      const failure = this.normalizeFailure(error, timeoutSignal.aborted)
      if (failure.code !== 'circuit-open') this.recordFailure(failure.code)
      throw failure
    }
  }

  private recordSuccess(): void {
    this.lastSuccessfulSearchAt = this.now()
    this.consecutiveFailureCount = 0
    this.circuitOpenUntil = undefined
  }

  private recordFailure(code: WebSearchFailureCode): void {
    this.lastFailureCode = code
    this.consecutiveFailureCount += 1
    if (this.consecutiveFailureCount >= CIRCUIT_FAILURE_THRESHOLD) {
      this.circuitOpenUntil = this.now() + CIRCUIT_OPEN_MS
    }
  }

  private normalizeFailure(error: unknown, timedOut: boolean): WebSearchAdapterError {
    if (error instanceof WebSearchAdapterError) return error
    return new WebSearchAdapterError(timedOut ? 'timeout' : 'network')
  }
}
