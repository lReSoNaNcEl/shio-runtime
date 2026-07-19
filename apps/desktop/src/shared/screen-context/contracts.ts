export type ScreenContextDesktopSourceKind = 'screen' | 'window'

export type ScreenContextAttachmentKind = ScreenContextDesktopSourceKind | 'clipboard' | 'file'

export type ScreenContextImageMimeType = 'image/jpeg' | 'image/png'

export type ScreenContextImportMimeType = ScreenContextImageMimeType | 'image/webp'

export interface ScreenContextSource {
  id: string
  name: string
  kind: ScreenContextDesktopSourceKind
  previewDataUrl: string
  appIconDataUrl?: string
}

export interface ScreenContextImportRequest {
  bytes: ArrayBuffer
  mimeType: ScreenContextImportMimeType
  sourceKind: 'clipboard' | 'file'
  sourceName?: string
}

export interface ScreenContextCaptureDescriptor {
  captureId: string
  sourceName: string
  sourceKind: ScreenContextAttachmentKind
  mimeType: ScreenContextImageMimeType
  previewDataUrl: string
  width: number
  height: number
  expiresAt: number
  canRecapture: boolean
}

export const SCREEN_CONTEXT_IMPORT_LIMITS = {
  maxInputBytes: 20 * 1024 * 1024,
} as const

export type ScreenContextErrorCode =
  | 'VISION_UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'NO_SOURCES'
  | 'SOURCE_NOT_FOUND'
  | 'CAPTURE_EMPTY'
  | 'CAPTURE_TOO_LARGE'
  | 'CAPTURE_EXPIRED'
  | 'CAPTURE_NOT_OWNED'
  | 'UNSUPPORTED_IMAGE_TYPE'
  | 'IMAGE_DECODE_FAILED'
  | 'RECAPTURE_UNAVAILABLE'
  | 'UNKNOWN'

export interface ScreenContextErrorResult {
  ok: false
  error: {
    code: ScreenContextErrorCode
  }
}

export type ScreenContextResult<T> = { ok: true; value: T } | ScreenContextErrorResult
