import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

import type { BrowserReactiveControlPlan } from '../../../shared/browser-computer-use'
import type { BrowserCdpFrame } from '../playwright/PlaywrightCdpFrameStream'
import type {
  ReactiveTrackerRequest,
  ReactiveTrackerResponse,
  ReactiveTrackerResult,
} from './BrowserReactiveTrackerProtocol'

interface PendingTracking {
  resolve(result: ReactiveTrackerResult): void
  reject(error: unknown): void
  unlinkAbort(): void
}

export interface BrowserReactiveTrackerOptions {
  workerPath?: string
  createWorker?: () => Worker
}

export interface BrowserReactiveTrackerPort {
  active(): boolean
  memoryBytes(): number
  track(
    frame: BrowserCdpFrame,
    plan: BrowserReactiveControlPlan,
    viewport: { width: number; height: number },
    signal: AbortSignal,
  ): Promise<ReactiveTrackerResult>
  stop(): Promise<void>
}

/** Main-side owner for the decode/tracking Worker Thread lifecycle. */
export class BrowserReactiveTracker implements BrowserReactiveTrackerPort {
  private worker: Worker | null = null
  private requestSequence = 0
  private readonly pending = new Map<number, PendingTracking>()
  private workerMemoryBytes = 0

  constructor(private readonly options: BrowserReactiveTrackerOptions = {}) {}

  active(): boolean {
    return this.worker !== null
  }

  memoryBytes(): number {
    return this.workerMemoryBytes
  }

  async track(
    frame: BrowserCdpFrame,
    plan: BrowserReactiveControlPlan,
    viewport: { width: number; height: number },
    signal: AbortSignal,
  ): Promise<ReactiveTrackerResult> {
    if (signal.aborted) throw signal.reason ?? new Error('REACTIVE_TRACKING_ABORTED')
    const worker = this.ensureWorker()
    const requestId = ++this.requestSequence
    const bytes = Uint8Array.from(frame.bytes).buffer
    const request: ReactiveTrackerRequest = {
      type: 'track',
      requestId,
      frame: {
        id: frame.id,
        pageId: frame.pageId,
        bytes,
        receivedAt: frame.receivedAt,
        sensitiveRegions: frame.sensitiveRegions,
      },
      viewport,
      plan,
    }
    return new Promise<ReactiveTrackerResult>((resolve, reject) => {
      const abort = (): void => {
        this.pending.delete(requestId)
        reject(signal.reason ?? new Error('REACTIVE_TRACKING_ABORTED'))
      }
      signal.addEventListener('abort', abort, { once: true })
      this.pending.set(requestId, {
        resolve,
        reject,
        unlinkAbort: () => signal.removeEventListener('abort', abort),
      })
      worker.postMessage(request, [bytes])
    })
  }

  async stop(): Promise<void> {
    const worker = this.worker
    this.worker = null
    this.workerMemoryBytes = 0
    for (const pending of this.pending.values()) {
      pending.unlinkAbort()
      pending.reject(new Error('REACTIVE_TRACKER_STOPPED'))
    }
    this.pending.clear()
    if (worker) await worker.terminate()
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker =
      this.options.createWorker?.() ??
      new Worker(this.options.workerPath ?? join(__dirname, 'browserReactiveTrackerWorker.js'))
    worker.on('message', (response: ReactiveTrackerResponse) => this.receive(response))
    worker.on('error', (error) => this.failAll(error))
    worker.on('exit', (code) => {
      if (this.worker === worker) this.worker = null
      if (code !== 0) this.failAll(new Error(`REACTIVE_TRACKER_EXIT_${code}`))
    })
    this.worker = worker
    return worker
  }

  private receive(response: ReactiveTrackerResponse): void {
    const requestId = response.type === 'tracked' ? response.result.requestId : response.requestId
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    pending.unlinkAbort()
    if (response.type === 'failed') {
      pending.reject(new Error(response.code))
      return
    }
    this.workerMemoryBytes = response.result.workerMemoryBytes
    pending.resolve(response.result)
  }

  private failAll(error: unknown): void {
    for (const pending of this.pending.values()) {
      pending.unlinkAbort()
      pending.reject(error)
    }
    this.pending.clear()
  }
}
