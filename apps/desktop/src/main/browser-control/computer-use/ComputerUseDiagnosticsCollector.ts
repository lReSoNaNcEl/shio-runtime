import {
  type BrowserComputerUseDiagnostics,
  EMPTY_BROWSER_COMPUTER_USE_DIAGNOSTICS,
} from '../../../shared/browser-computer-use'
import type { BrowserHeldInputSnapshot } from '../playwright/BrowserHeldInputRegistry'
import type { BrowserCdpFrameStreamMetrics } from '../playwright/PlaywrightCdpFrameStream'
import type { ReactiveTrackerResult } from './BrowserReactiveTrackerProtocol'

const SAMPLE_LIMIT = 512

export class ComputerUseDiagnosticsCollector {
  private current: BrowserComputerUseDiagnostics = {
    ...EMPTY_BROWSER_COMPUTER_USE_DIAGNOSTICS,
  }
  private readonly vlmLatencies: number[] = []
  private readonly trackingLatencies: number[] = []
  private readonly frameToInputLatencies: number[] = []
  private readonly inputTimes: number[] = []
  private activePlanCreatedAt = 0

  reset(): void {
    this.current = { ...EMPTY_BROWSER_COMPUTER_USE_DIAGNOSTICS }
    this.vlmLatencies.length = 0
    this.trackingLatencies.length = 0
    this.frameToInputLatencies.length = 0
    this.inputTimes.length = 0
    this.activePlanCreatedAt = 0
  }

  snapshot(now = Date.now()): BrowserComputerUseDiagnostics {
    return {
      ...this.current,
      planAgeMs: this.activePlanCreatedAt > 0 ? Math.max(0, now - this.activePlanCreatedAt) : 0,
      vlmLatencyP50Ms: percentile(this.vlmLatencies, 0.5),
      vlmLatencyP95Ms: percentile(this.vlmLatencies, 0.95),
      trackingLatencyP50Ms: percentile(this.trackingLatencies, 0.5),
      trackingLatencyP95Ms: percentile(this.trackingLatencies, 0.95),
      frameToInputP50Ms: percentile(this.frameToInputLatencies, 0.5),
      frameToInputP95Ms: percentile(this.frameToInputLatencies, 0.95),
    }
  }

  recordFrameStream(metrics: BrowserCdpFrameStreamMetrics): void {
    this.current.captureFps = metrics.captureFps
    this.current.framesReceived = metrics.framesReceived
    this.current.framesProcessed = metrics.framesProcessed
    this.current.framesDropped = metrics.framesDropped
    this.current.maxPendingFrames = metrics.maxPendingFrames
    this.current.pendingFrames = metrics.pendingFrames
    this.current.activeScreencast = metrics.active
  }

  recordTracking(result: ReactiveTrackerResult): void {
    this.current.trackingConfidence = result.trackingConfidence
    this.current.workerMemoryBytes = result.workerMemoryBytes
    appendSample(this.trackingLatencies, result.latencyMs)
  }

  recordInput(count: number, receivedAt: number, now: number): void {
    if (count <= 0) return
    this.current.inputEventsTotal += count
    appendSample(this.frameToInputLatencies, Math.max(0, now - receivedAt))
    for (let index = 0; index < count; index += 1) this.inputTimes.push(now)
    while (this.inputTimes.length > 0 && now - this.inputTimes[0] > 1_000) {
      this.inputTimes.shift()
    }
    this.current.fastInputHz = this.inputTimes.length
  }

  recordVlm(durationMs: number): void {
    this.current.vlmRequestsTotal += 1
    appendSample(this.vlmLatencies, durationMs)
  }

  setVlmActive(active: boolean): void {
    this.current.activeVlmRequests = active ? 1 : 0
  }

  setHeldInputs(snapshot: BrowserHeldInputSnapshot): void {
    this.current.heldKeys = snapshot.keys.length
    this.current.heldButtons = snapshot.buttons.length
  }

  setWorkerActive(active: boolean): void {
    this.current.workerActive = active
    if (!active) this.current.workerMemoryBytes = 0
  }

  setActiveCdpSessions(count: number): void {
    this.current.activeCdpSessions = Math.max(0, Math.min(2, Math.round(count)))
  }

  activatePlan(createdAt: number, replacement: boolean): void {
    if (replacement) this.current.planReplacements += 1
    this.activePlanCreatedAt = createdAt
  }

  deactivatePlan(expired: boolean): void {
    if (expired) this.current.planExpirations += 1
    this.activePlanCreatedAt = 0
  }

  recordReanchor(): void {
    this.current.reanchors += 1
  }

  recordModeTransition(): void {
    this.current.modeTransitions += 1
  }
}

function appendSample(samples: number[], value: number): void {
  samples.push(Math.max(0, value))
  if (samples.length > SAMPLE_LIMIT) samples.splice(0, samples.length - SAMPLE_LIMIT)
}

function percentile(samples: readonly number[], quantile: number): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))]
}
