import type { BrowserReactiveControlPlan } from '../../../shared/browser-computer-use'
import type { BrowserSensitiveRegion } from '../playwright/PlaywrightCdpFrameStream'

export interface ReactiveTrackerRequest {
  type: 'track'
  requestId: number
  frame: {
    id: number
    pageId: string
    bytes: ArrayBuffer
    receivedAt: number
    sensitiveRegions: readonly BrowserSensitiveRegion[]
  }
  viewport: { width: number; height: number }
  plan: BrowserReactiveControlPlan
}

export interface ReactiveTrackedAnchor {
  id: string
  bounds: { x: number; y: number; width: number; height: number }
  confidence: number
}

export interface ReactiveTrackerResult {
  requestId: number
  planId: string
  pageId: string
  frameId: number
  receivedAt: number
  width: number
  height: number
  trackingConfidence: number
  sceneDifference: number
  motionIntensity: number
  anchors: readonly ReactiveTrackedAnchor[]
  latencyMs: number
  workerMemoryBytes: number
}

export type ReactiveTrackerResponse =
  | { type: 'tracked'; result: ReactiveTrackerResult }
  | { type: 'failed'; requestId: number; code: string }
