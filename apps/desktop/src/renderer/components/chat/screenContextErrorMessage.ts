import type { TranslationKey } from '../../../shared/localization'
import type { ScreenContextErrorCode } from '../../../shared/screen-context'

const ERROR_KEYS: Record<ScreenContextErrorCode, TranslationKey> = {
  VISION_UNSUPPORTED: 'screenContext.error.visionUnsupported',
  PERMISSION_DENIED: 'screenContext.error.permissionDenied',
  NO_SOURCES: 'screenContext.error.noSources',
  SOURCE_NOT_FOUND: 'screenContext.error.sourceNotFound',
  CAPTURE_EMPTY: 'screenContext.error.captureEmpty',
  CAPTURE_TOO_LARGE: 'screenContext.error.captureTooLarge',
  CAPTURE_EXPIRED: 'screenContext.error.captureExpired',
  CAPTURE_NOT_OWNED: 'screenContext.error.captureNotOwned',
  UNSUPPORTED_IMAGE_TYPE: 'screenContext.input.unsupportedType',
  IMAGE_DECODE_FAILED: 'screenContext.error.imageDecodeFailed',
  RECAPTURE_UNAVAILABLE: 'screenContext.error.recaptureUnavailable',
  OPERATION_STALE: 'screenContext.error.unknown',
  UNKNOWN: 'screenContext.error.unknown',
}

export function screenContextErrorMessage(
  code: ScreenContextErrorCode,
  translate: (key: TranslationKey) => string,
): string {
  return translate(ERROR_KEYS[code])
}
