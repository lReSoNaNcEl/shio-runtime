import { randomUUID } from 'node:crypto'

import type {
  ScreenContextCaptureDescriptor,
  ScreenContextErrorCode,
  ScreenContextSource,
  ScreenContextSourceKind,
} from '../../shared/screen-context/contracts'
import { mainLog } from '../logging/safeLogger'
import { type ScreenCaptureAdapter, ScreenCaptureError } from './ScreenCaptureAdapter'

export const SCREEN_CONTEXT_TUNING = {
  ttlMs: 120_000,
  maxPendingPerRenderer: 1,
  maxBytes: 5 * 1024 * 1024,
} as const

export interface PendingCapture {
  captureId: string
  rendererId: number
  bytes: Uint8Array
  mimeType: 'image/jpeg'
  sourceName: string
  sourceKind: ScreenContextSourceKind
  width: number
  height: number
  expiresAt: number
}

export class ScreenContextError extends Error {
  constructor(readonly code: ScreenContextErrorCode) {
    super(code)
    this.name = 'ScreenContextError'
  }
}

interface StoredCapture extends PendingCapture {
  expirationTimer: ReturnType<typeof setTimeout>
}

export class ScreenContextService {
  private readonly captures = new Map<string, StoredCapture>()
  private readonly captureByRenderer = new Map<number, string>()
  private readonly expiredCaptures = new Map<string, number>()
  private readonly expiredCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly adapter: ScreenCaptureAdapter) {}

  async listSources(rendererId: number): Promise<ScreenContextSource[]> {
    try {
      const sources = await this.adapter.listSources()
      mainLog.info('Screen Sources Listed', { rendererId, count: sources.length })
      return sources
    } catch (error) {
      throw this.normalizeError(error)
    }
  }

  async capture(rendererId: number, sourceId: string): Promise<ScreenContextCaptureDescriptor> {
    this.releaseRendererCapture(rendererId)
    try {
      const captured = await this.adapter.captureSource(sourceId)
      if (captured.bytes.byteLength > SCREEN_CONTEXT_TUNING.maxBytes) {
        throw new ScreenContextError('CAPTURE_TOO_LARGE')
      }
      const captureId = randomUUID()
      const expiresAt = Date.now() + SCREEN_CONTEXT_TUNING.ttlMs
      const expirationTimer = setTimeout(
        () => this.expireCapture(captureId),
        SCREEN_CONTEXT_TUNING.ttlMs,
      )
      const stored: StoredCapture = {
        captureId,
        rendererId,
        bytes: captured.bytes,
        mimeType: captured.mimeType,
        sourceName: captured.sourceName,
        sourceKind: captured.sourceKind,
        width: captured.width,
        height: captured.height,
        expiresAt,
        expirationTimer,
      }
      this.captures.set(captureId, stored)
      this.captureByRenderer.set(rendererId, captureId)
      mainLog.info('Screen Context Captured', {
        rendererId,
        sourceKind: captured.sourceKind,
        width: captured.width,
        height: captured.height,
        bytes: captured.bytes.byteLength,
      })
      return {
        captureId,
        sourceName: captured.sourceName,
        sourceKind: captured.sourceKind,
        previewDataUrl: captured.previewDataUrl,
        width: captured.width,
        height: captured.height,
        expiresAt,
      }
    } catch (error) {
      const normalized = this.normalizeError(error)
      mainLog.warn('Screen Context Rejected', { rendererId, reason: normalized.code })
      throw normalized
    }
  }

  consume(rendererId: number, captureId: string): PendingCapture {
    const capture = this.captures.get(captureId)
    if (!capture) {
      if (this.expiredCaptures.get(captureId) === rendererId) {
        throw new ScreenContextError('CAPTURE_EXPIRED')
      }
      throw new ScreenContextError('CAPTURE_NOT_OWNED')
    }
    if (capture.rendererId !== rendererId) throw new ScreenContextError('CAPTURE_NOT_OWNED')
    if (capture.expiresAt <= Date.now()) {
      this.expireCapture(captureId)
      throw new ScreenContextError('CAPTURE_EXPIRED')
    }
    this.removeCapture(captureId)
    mainLog.info('Screen Context Consumed', {
      rendererId,
      sourceKind: capture.sourceKind,
      width: capture.width,
      height: capture.height,
      bytes: capture.bytes.byteLength,
    })
    const { expirationTimer: _expirationTimer, ...pending } = capture
    return pending
  }

  release(rendererId: number, captureId: string): boolean {
    const capture = this.captures.get(captureId)
    if (!capture || capture.rendererId !== rendererId) return false
    this.removeCapture(captureId)
    mainLog.info('Screen Context Released', {
      rendererId,
      sourceKind: capture.sourceKind,
      width: capture.width,
      height: capture.height,
      bytes: capture.bytes.byteLength,
    })
    return true
  }

  disposeRenderer(rendererId: number): void {
    this.releaseRendererCapture(rendererId)
    for (const [captureId, ownerId] of this.expiredCaptures) {
      if (ownerId === rendererId) this.clearExpiredMarker(captureId)
    }
  }

  dispose(): void {
    for (const captureId of [...this.captures.keys()]) this.removeCapture(captureId)
    for (const captureId of [...this.expiredCaptures.keys()]) this.clearExpiredMarker(captureId)
  }

  private releaseRendererCapture(rendererId: number): void {
    const captureId = this.captureByRenderer.get(rendererId)
    if (captureId) this.release(rendererId, captureId)
  }

  private expireCapture(captureId: string): void {
    const capture = this.captures.get(captureId)
    if (!capture) return
    this.removeCapture(captureId)
    this.expiredCaptures.set(captureId, capture.rendererId)
    const cleanupTimer = setTimeout(
      () => this.clearExpiredMarker(captureId),
      SCREEN_CONTEXT_TUNING.ttlMs,
    )
    this.expiredCleanupTimers.set(captureId, cleanupTimer)
    mainLog.info('Screen Context Expired', {
      rendererId: capture.rendererId,
      sourceKind: capture.sourceKind,
      width: capture.width,
      height: capture.height,
      bytes: capture.bytes.byteLength,
    })
  }

  private removeCapture(captureId: string): void {
    const capture = this.captures.get(captureId)
    if (!capture) return
    clearTimeout(capture.expirationTimer)
    this.captures.delete(captureId)
    if (this.captureByRenderer.get(capture.rendererId) === captureId) {
      this.captureByRenderer.delete(capture.rendererId)
    }
  }

  private clearExpiredMarker(captureId: string): void {
    const timer = this.expiredCleanupTimers.get(captureId)
    if (timer) clearTimeout(timer)
    this.expiredCleanupTimers.delete(captureId)
    this.expiredCaptures.delete(captureId)
  }

  private normalizeError(error: unknown): ScreenContextError {
    if (error instanceof ScreenContextError) return error
    if (error instanceof ScreenCaptureError) return new ScreenContextError(error.code)
    return new ScreenContextError('UNKNOWN')
  }
}
