export const NETWORK_REQUEST_SOURCES = [
  'renderer-fetch',
  'speech-api',
  'llm',
  'project-awareness',
  'web-search',
] as const

export type NetworkRequestSource = (typeof NETWORK_REQUEST_SOURCES)[number]

export type NetworkRequestOutcome = 'pending' | 'success' | 'failure' | 'cancelled' | 'timeout'

export interface NetworkRequestDiagnostic {
  id: string
  source: NetworkRequestSource
  method: string
  /** HTTP(S) origin and pathname only. Query, fragment, user info, and headers are never exposed. */
  target: string
  startedAt: number
  completedAt?: number
  durationMs?: number
  status?: number
  outcome: NetworkRequestOutcome
}

export interface NetworkHeaderDiagnostic {
  name: string
  value: string
}

export interface NetworkBodyDiagnostic {
  kind: 'empty' | 'json' | 'text' | 'binary' | 'unavailable'
  contentType?: string
  byteLength?: number
  text?: string
  truncated?: boolean
}

export interface NetworkRequestDiagnosticDetails {
  request: NetworkRequestDiagnostic
  requestHeaders: NetworkHeaderDiagnostic[]
  responseHeaders: NetworkHeaderDiagnostic[]
  requestBody: NetworkBodyDiagnostic
  responseBody: NetworkBodyDiagnostic
}
