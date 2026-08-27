import { Readable } from 'node:stream'

import axios from 'axios'

import { createObservedFetch } from '../../diagnostics/createObservedFetch'
import { installLlmProxyResolver } from './proxy'

/**
 * The official SDK owns Chat Completions and SSE semantics. This Fetch bridge
 * keeps Shio's existing Electron/environment proxy resolution in one place.
 */
export function createOpenAISdkFetch(): typeof fetch {
  const http = axios.create({ timeout: 0, validateStatus: () => true })
  installLlmProxyResolver(http)

  const proxyAwareFetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : undefined
    const signal = init?.signal ?? request?.signal
    const headers = new Headers(request?.headers)
    if (init?.headers) {
      new Headers(init.headers).forEach((value, name) => {
        headers.set(name, value)
      })
    }
    let body: BodyInit | null | undefined = init?.body
    if (body === undefined && request?.body) body = Buffer.from(await request.arrayBuffer())

    try {
      const response = await http.request<Readable>({
        url: request?.url ?? String(input),
        method: init?.method ?? request?.method ?? 'GET',
        headers: Object.fromEntries(headers.entries()),
        data: body,
        responseType: 'stream',
        signal: signal ?? undefined,
        timeout: 0,
        validateStatus: () => true,
      })
      const responseHeaders = new Headers()
      for (const [name, value] of Object.entries(response.headers)) {
        if (value === undefined) continue
        responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : String(value))
      }
      const responseBody = [204, 205, 304].includes(response.status)
        ? null
        : (Readable.toWeb(response.data) as ReadableStream<Uint8Array>)
      return new Response(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      })
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
      }
      throw error
    }
  }

  return createObservedFetch(proxyAwareFetch, 'llm')
}
