import { randomUUID } from 'node:crypto'

import type {
  ScreenContextAttachmentKind,
  ScreenContextCaptureDescriptor,
  ScreenContextErrorCode,
  ScreenContextImageMimeType,
  ScreenContextImportRequest,
  ScreenContextSource,
} from '../../shared/screen-context'
import { mainLog } from '../logging/safeLogger'
import {
  ImageNormalizationError,
  ImageNormalizer,
  type NormalizedScreenContextImage,
} from './ImageNormalizer'
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
  mimeType: ScreenContextImageMimeType
  sourceName: string
  sourceKind: ScreenContextAttachmentKind
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
  recaptureSourceId?: string
}

export class ScreenContextService {
  private readonly captures = new Map<string, StoredCapture>()
  private readonly captureByRenderer = new Map<number, string>()
  private readonly operationByRenderer = new Map<number, string>()
  private readonly expiredCaptures = new Map<string, number>()
  private readonly expiredCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly adapter: ScreenCaptureAdapter,
    private readonly normalizer = new ImageNormalizer(),
  ) {}

  async listSources(rendererId: number): Promise<ScreenContextSource[]> {
    try {
      const sources = await this.adapter.listSources()
      mainLog.info('Screen Sources Listed', { rendererId, count: sources.length })
      return sources
    } catch (error) {
      throw this.normalizeError(error)
    }
  }

  async capture(
    rendererId: number,
    operationId: string,
    sourceId: string,
  ): Promise<ScreenContextCaptureDescriptor> {
    this.beginOperation(rendererId, operationId)
    try {
      const captured = await this.adapter.captureSource(sourceId)
      const image = this.normalizer.normalizeDesktopCapture(captured.image)
      const descriptor = this.storeCapture(rendererId, operationId, image, {
        sourceName: captured.sourceName,
        sourceKind: captured.sourceKind,
        recaptureSourceId: sourceId,
      })
      mainLog.info('Screen Context Captured', {
        rendererId,
        sourceKind: captured.sourceKind,
        width: image.width,
        height: image.height,
        bytes: image.bytes.byteLength,
      })
      return descriptor
    } catch (error) {
      this.cancelOperation(rendererId, operationId)
      const normalized = this.normalizeError(error)
      mainLog.warn('Screen Context Rejected', { rendererId, reason: normalized.code })
      throw normalized
    }
  }

  async importImage(
    rendererId: number,
    request: ScreenContextImportRequest,
  ): Promise<ScreenContextCaptureDescriptor> {
    this.beginOperation(rendererId, request.operationId)
    try {
      const image = await this.normalizer.normalizeImport(request.bytes, request.mimeType)
      const sourceName =
        request.sourceKind === 'clipboard' ? '' : this.sanitizeSourceName(request.sourceName)
      const descriptor = this.storeCapture(rendererId, request.operationId, image, {
        sourceName,
        sourceKind: request.sourceKind,
      })
      mainLog.info('Screen Context Imported', {
        rendererId,
        sourceKind: request.sourceKind,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        bytes: image.bytes.byteLength,
      })
      return descriptor
    } catch (error) {
      this.cancelOperation(rendererId, request.operationId)
      const normalized = this.normalizeError(error)
      mainLog.warn('Screen Context Import Rejected', {
        rendererId,
        sourceKind: request.sourceKind,
        mimeType: request.mimeType,
        reason: normalized.code,
      })
      throw normalized
    }
  }

  async recapture(
    rendererId: number,
    operationId: string,
    captureId: string,
  ): Promise<ScreenContextCaptureDescriptor> {
    this.beginOperation(rendererId, operationId)
    try {
      const existing = this.getOwnedCapture(rendererId, captureId)
      if (!existing.recaptureSourceId) {
        throw new ScreenContextError('RECAPTURE_UNAVAILABLE')
      }
      const captured = await this.adapter.captureSource(existing.recaptureSourceId)
      const image = this.normalizer.normalizeDesktopCapture(captured.image)
      const descriptor = this.storeCapture(rendererId, operationId, image, {
        sourceName: captured.sourceName,
        sourceKind: captured.sourceKind,
        recaptureSourceId: existing.recaptureSourceId,
      })
      mainLog.info('Screen Context Recaptured', {
        rendererId,
        sourceKind: captured.sourceKind,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        bytes: image.bytes.byteLength,
      })
      return descriptor
    } catch (error) {
      this.cancelOperation(rendererId, operationId)
      const normalized = this.normalizeError(error)
      mainLog.warn('Screen Context Recapture Rejected', {
        rendererId,
        reason: normalized.code,
      })
      throw normalized
    }
  }

  consume(rendererId: number, captureId: string): PendingCapture {
    const capture = this.getOwnedCapture(rendererId, captureId)
    this.removeCapture(captureId)
    mainLog.info('Screen Context Consumed', {
      rendererId,
      sourceKind: capture.sourceKind,
      width: capture.width,
      height: capture.height,
      bytes: capture.bytes.byteLength,
    })
    const {
      expirationTimer: _expirationTimer,
      recaptureSourceId: _recaptureSourceId,
      ...pending
    } = capture
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

  cancelOperation(rendererId: number, operationId: string): boolean {
    if (this.operationByRenderer.get(rendererId) !== operationId) return false
    this.operationByRenderer.delete(rendererId)
    mainLog.info('Screen Context Operation Cancelled', { rendererId })
    return true
  }

  disposeRenderer(rendererId: number): void {
    this.operationByRenderer.delete(rendererId)
    this.releaseRendererCapture(rendererId)
    for (const [captureId, ownerId] of this.expiredCaptures) {
      if (ownerId === rendererId) this.clearExpiredMarker(captureId)
    }
  }

  dispose(): void {
    this.operationByRenderer.clear()
    for (const captureId of [...this.captures.keys()]) this.removeCapture(captureId)
    for (const captureId of [...this.expiredCaptures.keys()]) this.clearExpiredMarker(captureId)
  }

  private storeCapture(
    rendererId: number,
    operationId: string,
    image: NormalizedScreenContextImage,
    metadata: {
      sourceName: string
      sourceKind: ScreenContextAttachmentKind
      recaptureSourceId?: string
    },
  ): ScreenContextCaptureDescriptor {
    if (this.operationByRenderer.get(rendererId) !== operationId) {
      throw new ScreenContextError('OPERATION_STALE')
    }
    this.operationByRenderer.delete(rendererId)
    const previousCaptureId = this.captureByRenderer.get(rendererId)
    const captureId = randomUUID()
    const expiresAt = Date.now() + SCREEN_CONTEXT_TUNING.ttlMs
    const expirationTimer = setTimeout(
      () => this.expireCapture(captureId),
      SCREEN_CONTEXT_TUNING.ttlMs,
    )
    const stored: StoredCapture = {
      captureId,
      rendererId,
      bytes: image.bytes,
      mimeType: image.mimeType,
      sourceName: metadata.sourceName,
      sourceKind: metadata.sourceKind,
      width: image.width,
      height: image.height,
      expiresAt,
      expirationTimer,
      recaptureSourceId: metadata.recaptureSourceId,
    }
    this.captures.set(captureId, stored)
    this.captureByRenderer.set(rendererId, captureId)
    if (previousCaptureId && previousCaptureId !== captureId) {
      this.removeCapture(previousCaptureId)
    }
    return {
      captureId,
      sourceName: metadata.sourceName,
      sourceKind: metadata.sourceKind,
      mimeType: image.mimeType,
      previewDataUrl: image.previewDataUrl,
      width: image.width,
      height: image.height,
      expiresAt,
      canRecapture: metadata.recaptureSourceId !== undefined,
    }
  }

  private beginOperation(rendererId: number, operationId: string): void {
    this.operationByRenderer.set(rendererId, operationId)
  }

  private getOwnedCapture(rendererId: number, captureId: string): StoredCapture {
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
    return capture
  }

  private sanitizeSourceName(sourceName?: string): string {
    const basename = (sourceName ?? '')
      .replace(/^.*[\\/]/u, '')
      .replace(/[\\/]/gu, '')
      .slice(0, 255)
    return basename || 'image'
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
    if (error instanceof ScreenCaptureError || error instanceof ImageNormalizationError) {
      return new ScreenContextError(error.code)
    }
    return new ScreenContextError('UNKNOWN')
  }
}
