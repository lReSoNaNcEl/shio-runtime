export type ScreenContextSourceKind = 'screen' | 'window'

export interface ScreenContextSource {
  id: string
  name: string
  kind: ScreenContextSourceKind
  previewDataUrl: string
  appIconDataUrl?: string
}

export interface ScreenContextCaptureDescriptor {
  captureId: string
  sourceName: string
  sourceKind: ScreenContextSourceKind
  previewDataUrl: string
  width: number
  height: number
  expiresAt: number
}

export type ScreenContextErrorCode =
  | 'VISION_UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'NO_SOURCES'
  | 'SOURCE_NOT_FOUND'
  | 'CAPTURE_EMPTY'
  | 'CAPTURE_TOO_LARGE'
  | 'CAPTURE_EXPIRED'
  | 'CAPTURE_NOT_OWNED'
  | 'UNKNOWN'

export interface ScreenContextErrorResult {
  ok: false
  error: {
    code: ScreenContextErrorCode
  }
}

export type ScreenContextResult<T> = { ok: true; value: T } | ScreenContextErrorResult
