export const BROWSER_REALTIME_MAX_FRAME_EDGE = 768
export const BROWSER_REALTIME_MAX_FRAME_BYTES = 2 * 1_024 * 1_024
export const BROWSER_REALTIME_MAX_INPUT_BATCH_SIZE = 32
export const BROWSER_REALTIME_CAPTURE_TIMEOUT_MS = 5_000

export interface BrowserRealtimeSession {
  sessionId: string
  tabId: string
  origin: string
  url: string
  connectedAt: number
}

export interface BrowserRealtimeFrameCaptureRequest {
  sessionId: string
  tabId: string
  maxFrameAgeMs?: number
}

export interface BrowserRealtimeViewport {
  width: number
  height: number
  pageScaleFactor: number
}

export interface BrowserGameSurfaceCandidate {
  id: string
  kind: 'canvas' | 'game-root'
  label?: string
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
}

export type BrowserGameBlockerKind = 'captcha' | 'anti-bot' | 'authentication'

export interface BrowserGameEnvironmentInspection {
  surfaces: readonly BrowserGameSurfaceCandidate[]
  blocker?: BrowserGameBlockerKind
  /** Fixed Main-owned inspection of the real CSS content viewport. */
  viewport?: BrowserRealtimeViewport
}

export interface BrowserRealtimeFrame {
  sessionId: string
  tabId: string
  frameId: number
  capturedAt: number
  width: number
  height: number
  viewport: BrowserRealtimeViewport
  image: {
    mimeType: 'image/jpeg' | 'image/png'
    bytes: Uint8Array
  }
}

export type BrowserRealtimePointerButton = 'left' | 'middle' | 'right'

export type BrowserRealtimeInputEvent =
  | {
      type: 'pointer-move'
      x: number
      y: number
    }
  | {
      type: 'pointer-down' | 'pointer-up'
      x: number
      y: number
      button: BrowserRealtimePointerButton
    }
  | {
      type: 'key-down' | 'key-up'
      key: string
      code?: string
      text?: string
    }

export interface BrowserRealtimeInputBatch {
  sessionId: string
  tabId: string
  events: readonly BrowserRealtimeInputEvent[]
}

/**
 * Main-internal, browser-relative frame and input access. This is a Plugin
 * capability for bounded delegated runtimes, not a Character-facing tool.
 */
export interface BrowserRealtimeControlProvider {
  session(): BrowserRealtimeSession | null
  inspectGameEnvironment(signal: AbortSignal): Promise<BrowserGameEnvironmentInspection>
  captureFrame(
    request: BrowserRealtimeFrameCaptureRequest,
    signal: AbortSignal,
  ): Promise<BrowserRealtimeFrame>
  dispatchInput(input: BrowserRealtimeInputBatch, signal: AbortSignal): Promise<void>
  releaseInputs(): Promise<void>
  getViewport(): Promise<BrowserRealtimeViewport>
}

export type BrowserRealtimeControlProviderResolver = () =>
  | BrowserRealtimeControlProvider
  | undefined
