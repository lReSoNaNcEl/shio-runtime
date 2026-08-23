import type {
  NetworkBodyDiagnostic,
  NetworkHeaderDiagnostic,
  NetworkRequestDiagnostic,
  NetworkRequestDiagnosticDetails,
  NetworkRequestOutcome,
  NetworkRequestSource,
} from '../../shared/diagnostics'

export const MAX_NETWORK_REQUEST_DIAGNOSTICS = 300

export interface StartNetworkRequestInput {
  source: NetworkRequestSource
  method: string
  target: string
  startedAt?: number
  requestHeaders?: NetworkHeaderDiagnostic[]
  requestBody?: NetworkBodyDiagnostic
}

export interface CompleteNetworkRequestInput {
  outcome: Exclude<NetworkRequestOutcome, 'pending'>
  status?: number
  completedAt?: number
  responseHeaders?: NetworkHeaderDiagnostic[]
  responseBody?: NetworkBodyDiagnostic
}

interface UpdateNetworkRequestInput {
  requestHeaders?: NetworkHeaderDiagnostic[]
  requestBody?: NetworkBodyDiagnostic
}

interface NetworkRequestRecord {
  request: NetworkRequestDiagnostic
  requestHeaders: NetworkHeaderDiagnostic[]
  responseHeaders: NetworkHeaderDiagnostic[]
  requestBody: NetworkBodyDiagnostic
  responseBody: NetworkBodyDiagnostic
}

export class NetworkRequestDiagnostics {
  private readonly records: NetworkRequestRecord[] = []
  private sequence = 0

  constructor(private readonly capacity = MAX_NETWORK_REQUEST_DIAGNOSTICS) {}

  start(input: StartNetworkRequestInput): string {
    const startedAt = input.startedAt ?? Date.now()
    const id = `network-${Math.round(startedAt)}-${++this.sequence}`
    this.records.unshift({
      request: {
        id,
        source: input.source,
        method: input.method.trim().toUpperCase() || 'GET',
        target: input.target,
        startedAt,
        outcome: 'pending',
      },
      requestHeaders: cloneHeaders(input.requestHeaders),
      responseHeaders: [],
      requestBody: cloneBody(input.requestBody ?? { kind: 'empty' }),
      responseBody: { kind: 'unavailable' },
    })
    if (this.records.length > this.capacity) this.records.length = this.capacity
    return id
  }

  updateRequest(id: string, input: UpdateNetworkRequestInput): void {
    const record = this.records.find((entry) => entry.request.id === id)
    if (record?.request.outcome !== 'pending') return
    if (input.requestHeaders) record.requestHeaders = cloneHeaders(input.requestHeaders)
    if (input.requestBody) record.requestBody = cloneBody(input.requestBody)
  }

  complete(id: string, input: CompleteNetworkRequestInput): void {
    const record = this.records.find((entry) => entry.request.id === id)
    if (record?.request.outcome !== 'pending') return
    const request = record.request
    const completedAt = input.completedAt ?? Date.now()
    request.completedAt = completedAt
    request.durationMs = Math.max(0, completedAt - request.startedAt)
    request.status = input.status
    request.outcome = input.outcome
    if (input.responseHeaders) record.responseHeaders = cloneHeaders(input.responseHeaders)
    if (input.responseBody) record.responseBody = cloneBody(input.responseBody)
  }

  snapshot(): NetworkRequestDiagnostic[] {
    return this.records.map(({ request }) => ({ ...request }))
  }

  details(id: string): NetworkRequestDiagnosticDetails | null {
    const record = this.records.find((entry) => entry.request.id === id)
    if (!record) return null
    return {
      request: { ...record.request },
      requestHeaders: cloneHeaders(record.requestHeaders),
      responseHeaders: cloneHeaders(record.responseHeaders),
      requestBody: cloneBody(record.requestBody),
      responseBody: cloneBody(record.responseBody),
    }
  }
}

export const networkRequestDiagnostics = new NetworkRequestDiagnostics()

function cloneHeaders(headers: NetworkHeaderDiagnostic[] | undefined): NetworkHeaderDiagnostic[] {
  return headers?.map((header) => ({ ...header })) ?? []
}

function cloneBody(body: NetworkBodyDiagnostic): NetworkBodyDiagnostic {
  return { ...body }
}
