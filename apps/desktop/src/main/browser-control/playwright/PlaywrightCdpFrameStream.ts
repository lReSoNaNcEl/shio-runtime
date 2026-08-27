import type { CDPSession, Frame, Page } from 'playwright-core'

import { mainLog } from '../../logging/safeLogger'

export interface BrowserSensitiveRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserCdpFrame {
  id: number
  pageId: string
  bytes: Uint8Array
  receivedAt: number
  sensitiveRegions: readonly BrowserSensitiveRegion[]
}

export interface BrowserCdpFrameStreamMetrics {
  captureFps: number
  framesReceived: number
  framesProcessed: number
  framesDropped: number
  maxPendingFrames: 0 | 1
  pendingFrames: 0 | 1
  active: boolean
}

interface ScreencastFramePayload {
  data: string
  sessionId: number
  metadata?: { deviceWidth?: number; deviceHeight?: number }
}

export interface PlaywrightCdpFrameStreamOptions {
  now?: () => number
  createSession(page: Page): Promise<CDPSession>
  onMetrics?(metrics: BrowserCdpFrameStreamMetrics): void
}

/** Chromium screencast transport with an ACK-every-frame, latest-frame-only queue. */
export class PlaywrightCdpFrameStream {
  private session: CDPSession | null = null
  private page: Page | null = null
  private pageId = ''
  private sensitiveRegions: readonly BrowserSensitiveRegion[] = []
  private viewport = { width: 0, height: 0 }
  private active = false
  private frameSequence = 0
  private framesReceived = 0
  private framesProcessed = 0
  private framesDropped = 0
  private maxPendingFrames: 0 | 1 = 0
  private arrivalTimes: number[] = []
  private pending: BrowserCdpFrame | null = null
  private processing: Promise<void> | null = null
  private processFrame: ((frame: BrowserCdpFrame) => Promise<void>) | null = null
  private invalidate: ((reason: string) => void) | null = null

  private readonly onFrame = (payload: ScreencastFramePayload): void => {
    const session = this.session
    if (!session) return
    void session
      .send('Page.screencastFrameAck', { sessionId: payload.sessionId })
      .catch((error: unknown) => {
        mainLog.warn('[BrowserComputerUse] screencast frame ACK failed', {
          code: error instanceof Error ? error.name : 'Error',
        })
      })
    if (!this.active) return
    const metadata = payload.metadata
    if (
      metadata?.deviceWidth !== undefined &&
      metadata.deviceHeight !== undefined &&
      (Math.round(metadata.deviceWidth) !== this.viewport.width ||
        Math.round(metadata.deviceHeight) !== this.viewport.height)
    ) {
      this.invalidate?.('viewport-change')
      return
    }
    const receivedAt = this.now()
    this.framesReceived += 1
    this.arrivalTimes.push(receivedAt)
    this.arrivalTimes = this.arrivalTimes.filter((value) => receivedAt - value <= 1_000)
    const frame: BrowserCdpFrame = {
      id: ++this.frameSequence,
      pageId: this.pageId,
      bytes: new Uint8Array(Buffer.from(payload.data, 'base64')),
      receivedAt,
      sensitiveRegions: this.sensitiveRegions,
    }
    if (this.processing) {
      if (this.pending) this.framesDropped += 1
      this.pending = frame
      this.maxPendingFrames = 1
      this.publishMetrics()
      return
    }
    this.launchProcessing(frame)
  }

  private readonly onFrameNavigated = (frame: Frame): void => {
    if (frame === this.page?.mainFrame()) this.invalidate?.('navigation')
  }

  private readonly onPageClosed = (): void => this.invalidate?.('page-close')

  constructor(private readonly options: PlaywrightCdpFrameStreamOptions) {}

  async start(input: {
    page: Page
    pageId: string
    viewport: { width: number; height: number }
    maxFrameRate: number
    sensitiveRegions: readonly BrowserSensitiveRegion[]
    processFrame(frame: BrowserCdpFrame): Promise<void>
    invalidate(reason: string): void
  }): Promise<void> {
    await this.stop()
    this.page = input.page
    this.pageId = input.pageId
    this.sensitiveRegions = Object.freeze([...input.sensitiveRegions])
    this.viewport = { ...input.viewport }
    this.processFrame = input.processFrame
    this.invalidate = input.invalidate
    const session = await this.options.createSession(input.page)
    this.session = session
    session.on('Page.screencastFrame', this.onFrame)
    input.page.on('framenavigated', this.onFrameNavigated)
    input.page.on('close', this.onPageClosed)
    this.active = true
    try {
      await session.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 65,
        everyNthFrame: Math.max(1, Math.ceil(60 / Math.max(1, input.maxFrameRate))),
      })
      this.publishMetrics()
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async stop(): Promise<void> {
    const session = this.session
    const page = this.page
    this.active = false
    if (this.pending) this.framesDropped += 1
    this.pending = null
    this.session = null
    this.page = null
    this.pageId = ''
    this.sensitiveRegions = []
    this.viewport = { width: 0, height: 0 }
    this.processFrame = null
    this.invalidate = null
    if (page) {
      page.off('framenavigated', this.onFrameNavigated)
      page.off('close', this.onPageClosed)
    }
    if (session) {
      session.off('Page.screencastFrame', this.onFrame)
      await session.send('Page.stopScreencast').catch(() => undefined)
      await session.detach().catch(() => undefined)
    }
    await this.processing?.catch(() => undefined)
    this.publishMetrics()
  }

  metrics(): BrowserCdpFrameStreamMetrics {
    return {
      captureFps: this.arrivalTimes.length,
      framesReceived: this.framesReceived,
      framesProcessed: this.framesProcessed,
      framesDropped: this.framesDropped,
      maxPendingFrames: this.maxPendingFrames,
      pendingFrames: this.pending ? 1 : 0,
      active: this.active,
    }
  }

  resetMetrics(): void {
    if (this.active) return
    this.frameSequence = 0
    this.framesReceived = 0
    this.framesProcessed = 0
    this.framesDropped = 0
    this.maxPendingFrames = 0
    this.arrivalTimes = []
    this.pending = null
    this.publishMetrics()
  }

  private launchProcessing(frame: BrowserCdpFrame): void {
    const task = this.drain(frame)
    this.processing = task
    void task
      .catch((error: unknown) => {
        this.framesDropped += 1
        this.publishMetrics()
        if (!this.active) return
        mainLog.warn('[BrowserComputerUse] reactive frame processing failed', {
          code: error instanceof Error ? error.name : 'Error',
        })
        this.invalidate?.('frame-processing-failed')
      })
      .finally(() => {
        if (this.processing !== task) return
        this.processing = null
        if (!this.active || !this.pending) return
        const pending = this.pending
        this.pending = null
        this.launchProcessing(pending)
      })
  }

  private async drain(initial: BrowserCdpFrame): Promise<void> {
    let frame: BrowserCdpFrame | null = initial
    while (frame && this.active) {
      await this.processFrame?.(frame)
      this.framesProcessed += 1
      frame = this.pending
      this.pending = null
      this.publishMetrics()
    }
  }

  private publishMetrics(): void {
    this.options.onMetrics?.(this.metrics())
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}
