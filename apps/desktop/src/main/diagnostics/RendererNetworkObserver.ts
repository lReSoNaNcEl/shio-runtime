import type { Session } from 'electron'

import {
  type NetworkRequestDiagnostics,
  networkRequestDiagnostics,
} from './NetworkRequestDiagnostics'
import { safeNetworkHeaders, safeNetworkTarget } from './observeAxiosNetwork'

const HTTP_URL_FILTER = { urls: ['http://*/*', 'https://*/*'] }

export class RendererNetworkObserver {
  private readonly requestIds = new Map<number, string>()
  private disposed = false

  constructor(
    private readonly session: Session,
    private readonly webContentsId: number,
    private readonly diagnostics: NetworkRequestDiagnostics = networkRequestDiagnostics,
  ) {
    session.webRequest.onBeforeRequest(HTTP_URL_FILTER, (details, callback) => {
      if (details.webContentsId === this.webContentsId) {
        const target = safeNetworkTarget(details.url)
        if (target) {
          this.requestIds.set(
            details.id,
            this.diagnostics.start({
              source: 'renderer-fetch',
              method: details.method,
              target,
              startedAt: details.timestamp,
              requestBody: rendererUploadBody(details.uploadData),
            }),
          )
        }
      }
      callback({})
    })
    session.webRequest.onBeforeSendHeaders(HTTP_URL_FILTER, (details, callback) => {
      if (details.webContentsId === this.webContentsId) {
        const diagnosticId = this.requestIds.get(details.id)
        if (diagnosticId) {
          this.diagnostics.updateRequest(diagnosticId, {
            requestHeaders: safeNetworkHeaders(details.requestHeaders),
          })
        }
      }
      callback({})
    })
    session.webRequest.onCompleted(HTTP_URL_FILTER, (details) => {
      if (details.webContentsId !== this.webContentsId) return
      this.complete(
        details.id,
        'success',
        details.statusCode,
        details.timestamp,
        details.responseHeaders,
      )
    })
    session.webRequest.onErrorOccurred(HTTP_URL_FILTER, (details) => {
      if (details.webContentsId !== this.webContentsId) return
      const outcome = details.error === 'net::ERR_ABORTED' ? 'cancelled' : 'failure'
      this.complete(details.id, outcome, undefined, details.timestamp)
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.session.webRequest.onBeforeRequest(null)
    this.session.webRequest.onBeforeSendHeaders(null)
    this.session.webRequest.onCompleted(null)
    this.session.webRequest.onErrorOccurred(null)
    for (const id of this.requestIds.values()) {
      this.diagnostics.complete(id, { outcome: 'cancelled' })
    }
    this.requestIds.clear()
  }

  private complete(
    requestId: number,
    outcome: 'success' | 'failure' | 'cancelled',
    status: number | undefined,
    completedAt: number,
    responseHeaders?: Record<string, string[]>,
  ): void {
    const diagnosticId = this.requestIds.get(requestId)
    if (!diagnosticId) return
    this.requestIds.delete(requestId)
    this.diagnostics.complete(diagnosticId, {
      outcome,
      status,
      completedAt,
      responseHeaders: safeNetworkHeaders(responseHeaders),
      responseBody: { kind: 'unavailable' },
    })
  }
}

export function rendererUploadBody(uploadData: unknown): {
  kind: 'empty' | 'binary'
  byteLength?: number
} {
  if (!Array.isArray(uploadData) || uploadData.length === 0) return { kind: 'empty' }

  const byteLength = uploadData.reduce((total, entry: unknown) => {
    if (!entry || typeof entry !== 'object') return total
    const bytes = (entry as { bytes?: unknown }).bytes
    if (Buffer.isBuffer(bytes) || ArrayBuffer.isView(bytes)) return total + bytes.byteLength
    if (bytes instanceof ArrayBuffer) return total + bytes.byteLength
    return total
  }, 0)
  return { kind: 'binary', byteLength: byteLength || undefined }
}
