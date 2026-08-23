import axios, {
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'

import type {
  NetworkBodyDiagnostic,
  NetworkHeaderDiagnostic,
  NetworkRequestSource,
} from '../../shared/diagnostics'
import {
  type NetworkRequestDiagnostics,
  networkRequestDiagnostics,
} from './NetworkRequestDiagnostics'

export function safeNetworkTarget(url: string, baseUrl?: string): string | null {
  try {
    const parsed = baseUrl ? new URL(url, baseUrl) : new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch {
    return null
  }
}

const MAX_BODY_PREVIEW_CHARACTERS = 8_000
const MAX_HEADER_COUNT = 64
const MAX_HEADER_VALUE_CHARACTERS = 500
const MAX_JSON_DEPTH = 8
const MAX_JSON_ENTRIES = 100
const MAX_JSON_STRING_CHARACTERS = 2_000
const SENSITIVE_FIELD_NAME =
  /(?:api[-_]?key|authorization|cookie|credential|password|secret|session|token)/i

export function safeNetworkHeaders(input: unknown): NetworkHeaderDiagnostic[] {
  const record = headerRecord(input)
  return Object.entries(record)
    .slice(0, MAX_HEADER_COUNT)
    .map(([rawName, rawValue]) => {
      const name = rawName.slice(0, 100)
      const value = SENSITIVE_FIELD_NAME.test(name)
        ? '[REDACTED]'
        : boundedText(redactTextSecrets(headerValue(rawValue)), MAX_HEADER_VALUE_CHARACTERS).text
      return { name, value }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function previewNetworkBody(body: unknown, headers?: unknown): NetworkBodyDiagnostic {
  const safeHeaders = safeNetworkHeaders(headers)
  const contentType = safeHeaders
    .find((header) => header.name.toLocaleLowerCase() === 'content-type')
    ?.value.split(';', 1)[0]
    ?.trim()

  if (body === null || body === undefined || body === '') return { kind: 'empty', contentType }
  const binaryBytes = binaryByteLength(body)
  if (binaryBytes !== null || isOpaqueBody(body)) {
    return {
      kind: 'binary',
      contentType,
      byteLength: binaryBytes ?? undefined,
    }
  }
  if (typeof body === 'string') {
    const byteLength = Buffer.byteLength(body, 'utf8')
    const parsed = parseStructuredText(body, contentType)
    if (parsed !== null) return jsonBodyPreview(parsed, contentType, byteLength)
    const preview = boundedText(redactTextSecrets(body), MAX_BODY_PREVIEW_CHARACTERS)
    return {
      kind: 'text',
      contentType,
      byteLength,
      text: preview.text,
      truncated: preview.truncated,
    }
  }
  if (body instanceof URLSearchParams) {
    return jsonBodyPreview(Object.fromEntries(body.entries()), contentType)
  }
  if (typeof body === 'object') return jsonBodyPreview(body, contentType)
  const preview = boundedText(redactTextSecrets(String(body)), MAX_BODY_PREVIEW_CHARACTERS)
  return { kind: 'text', contentType, text: preview.text, truncated: preview.truncated }
}

export function observeAxiosNetwork(
  http: AxiosInstance,
  source: NetworkRequestSource,
  diagnostics: NetworkRequestDiagnostics = networkRequestDiagnostics,
): () => void {
  const requestIds = new WeakMap<object, string>()
  const requestInterceptor = http.interceptors.request.use((config) => {
    const target = safeNetworkTarget(String(config.url ?? ''), config.baseURL)
    if (target) {
      requestIds.set(
        config,
        diagnostics.start({
          source,
          method: String(config.method ?? 'GET'),
          target,
          requestHeaders: safeNetworkHeaders(config.headers),
          requestBody: previewNetworkBody(config.data, config.headers),
        }),
      )
    }
    return config
  })

  const completeResponse = (response: AxiosResponse): AxiosResponse => {
    completeAxiosRequest(requestIds, diagnostics, response.config, 'success', response)
    return response
  }
  const completeError = (error: unknown): Promise<never> => {
    if (axios.isAxiosError(error) && error.config) {
      completeAxiosRequest(
        requestIds,
        diagnostics,
        error.config,
        axiosOutcome(error),
        error.response,
      )
    }
    return Promise.reject(error)
  }
  const responseInterceptor = http.interceptors.response.use(completeResponse, completeError)

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    http.interceptors.request.eject(requestInterceptor)
    http.interceptors.response.eject(responseInterceptor)
  }
}

function completeAxiosRequest(
  requestIds: WeakMap<object, string>,
  diagnostics: NetworkRequestDiagnostics,
  config: InternalAxiosRequestConfig,
  outcome: 'success' | 'failure' | 'cancelled' | 'timeout',
  response?: AxiosResponse,
): void {
  const id = requestIds.get(config)
  if (!id) return
  requestIds.delete(config)
  diagnostics.complete(id, {
    outcome,
    status: response?.status,
    responseHeaders: response ? safeNetworkHeaders(response.headers) : undefined,
    responseBody: response ? previewNetworkBody(response.data, response.headers) : undefined,
  })
}

function headerRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {}
  const candidate = input as { toJSON?: () => unknown }
  const normalized = typeof candidate.toJSON === 'function' ? candidate.toJSON() : input
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return {}
  return normalized as Record<string, unknown>
}

function headerValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(', ')
  return String(value ?? '')
}

function redactTextSecrets(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_-]{12,})\b/g, '[REDACTED]')
    .replace(
      /((?:api[-_]?key|authorization|credential|password|secret|token)\s*["']?\s*[:=]\s*["']?)[^\s,"'}&]+/gi,
      '$1[REDACTED]',
    )
}

function parseStructuredText(value: string, contentType?: string): unknown | null {
  const trimmed = value.trim()
  if (contentType?.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(value).entries())
  }
  if (!contentType?.includes('json') && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null
  }
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return null
  }
}

function jsonBodyPreview(
  value: unknown,
  contentType?: string,
  byteLength?: number,
): NetworkBodyDiagnostic {
  const state = { truncated: false }
  const sanitized = sanitizeJsonValue(value, state)
  const serialized = JSON.stringify(sanitized, null, 2)
  const preview = boundedText(serialized, MAX_BODY_PREVIEW_CHARACTERS)
  return {
    kind: 'json',
    contentType,
    byteLength: byteLength ?? Buffer.byteLength(serialized, 'utf8'),
    text: preview.text,
    truncated: state.truncated || preview.truncated,
  }
}

function sanitizeJsonValue(value: unknown, state: { truncated: boolean }, depth = 0): unknown {
  if (depth >= MAX_JSON_DEPTH) {
    state.truncated = true
    return '[TRUNCATED]'
  }
  if (typeof value === 'string') {
    const redacted = redactTextSecrets(value)
    const preview = boundedText(redacted, MAX_JSON_STRING_CHARACTERS)
    if (preview.truncated) state.truncated = true
    return preview.text
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_ENTRIES) state.truncated = true
    return value.slice(0, MAX_JSON_ENTRIES).map((item) => sanitizeJsonValue(item, state, depth + 1))
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    if (keys.length > MAX_JSON_ENTRIES) state.truncated = true
    return Object.fromEntries(
      keys
        .slice(0, MAX_JSON_ENTRIES)
        .map((key) => [
          key,
          SENSITIVE_FIELD_NAME.test(key)
            ? '[REDACTED]'
            : sanitizeJsonValue(record[key], state, depth + 1),
        ]),
    )
  }
  return String(value)
}

function binaryByteLength(value: unknown): number | null {
  if (Buffer.isBuffer(value)) return value.byteLength
  if (value instanceof ArrayBuffer) return value.byteLength
  if (ArrayBuffer.isView(value)) return value.byteLength
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size
  return null
}

function isOpaqueBody(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const constructorName = (value as { constructor?: { name?: string } }).constructor?.name
  return constructorName === 'FormData' || 'pipe' in value
}

function boundedText(value: string, limit: number): { text: string; truncated: boolean } {
  if (value.length <= limit) return { text: value, truncated: false }
  return { text: value.slice(0, limit), truncated: true }
}

function axiosOutcome(error: { code?: string }): 'failure' | 'cancelled' | 'timeout' {
  if (error.code === 'ERR_CANCELED') return 'cancelled'
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return 'timeout'
  return 'failure'
}
