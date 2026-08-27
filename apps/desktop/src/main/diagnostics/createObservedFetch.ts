import type { NetworkRequestSource } from '../../shared/diagnostics'
import {
  type NetworkRequestDiagnostics,
  networkRequestDiagnostics,
} from './NetworkRequestDiagnostics'
import { previewNetworkBody, safeNetworkHeaders, safeNetworkTarget } from './observeAxiosNetwork'

export function createObservedFetch(
  fetchImpl: typeof fetch,
  source: NetworkRequestSource,
  diagnostics: NetworkRequestDiagnostics = networkRequestDiagnostics,
): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined
    const target = safeNetworkTarget(request?.url ?? String(input))
    if (!target) return fetchImpl(input, init)

    const headers = mergedHeaders(request?.headers, init?.headers)
    const id = diagnostics.start({
      source,
      method: init?.method ?? request?.method ?? 'GET',
      target,
      requestHeaders: safeNetworkHeaders(headers),
      requestBody:
        init?.body === undefined
          ? { kind: request?.body ? 'unavailable' : 'empty' }
          : previewNetworkBody(init.body, headers),
    })

    try {
      const response = await fetchImpl(input, init)
      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim()
      diagnostics.complete(id, {
        outcome: response.ok ? 'success' : 'failure',
        status: response.status,
        responseHeaders: safeNetworkHeaders(response.headers),
        // Fetch bodies can be one-shot streams. In particular, cloning an SSE body can
        // create an unbounded buffering branch, so diagnostics never consumes it.
        responseBody: { kind: 'unavailable', contentType },
      })
      return response
    } catch (error) {
      diagnostics.complete(id, {
        outcome: fetchOutcome(error, init?.signal ?? request?.signal),
      })
      throw error
    }
  }
}

function mergedHeaders(base?: Headers, override?: HeadersInit): Headers {
  const headers = new Headers(base)
  if (override) {
    new Headers(override).forEach((value, name) => {
      headers.set(name, value)
    })
  }
  return headers
}

function fetchOutcome(
  error: unknown,
  signal: AbortSignal | null | undefined,
): 'failure' | 'cancelled' | 'timeout' {
  if (signal?.aborted) {
    return signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
      ? 'timeout'
      : 'cancelled'
  }
  return error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'failure'
}
