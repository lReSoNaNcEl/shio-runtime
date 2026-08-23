/**
 * Shared, serializable Speech Adapter error contract.
 *
 * This is the ONLY speech-error type that crosses the main<->renderer boundary.
 * It carries data only: no classes, no runtime behavior, no technology-specific
 * fields. Main normalizes external ASR/TTS/streaming failures into these stable
 * codes; the renderer maps them to user-facing messages and capability state.
 *
 * Microphone/device failures are a DIFFERENT domain (local capture, permission,
 * device selection) and must never be represented here — see `MicrophoneErrorCode`.
 */

export type SpeechServiceErrorCode =
  | 'CANCELLED' // request was intentionally cancelled by its owning Runtime
  | 'SERVICE_UNAVAILABLE' // transport failure: service unreachable (recoverable)
  | 'SERVICE_ERROR' // service reached but returned 5xx (recoverable)
  | 'REQUEST_TIMEOUT' // request timed out (recoverable)
  | 'REQUEST_REJECTED' // service reached, rejected the request with 4xx (not recoverable)
  | 'RECOGNITION_FAILED' // ASR domain failure, e.g. no speech recognized (not recoverable)
  | 'INVALID_RESPONSE' // response did not match the expected contract (not recoverable)
  | 'UNKNOWN'

export type SpeechOperation = 'health' | 'recognition' | 'synthesis' | 'streaming'

export interface SerializedSpeechError {
  code: SpeechServiceErrorCode
  operation: SpeechOperation
  recoverable: boolean
  /**
   * Short, sanitized technical hint for developers (surfaced only in an
   * expandable Runtime Health block). Must never contain stack traces, request
   * bodies, headers, authorization, or filesystem paths.
   */
  technicalMessage?: string
}

/** Which codes are worth retrying with a background health-check. */
export function isRecoverableSpeechErrorCode(code: SpeechServiceErrorCode): boolean {
  return code === 'SERVICE_UNAVAILABLE' || code === 'SERVICE_ERROR' || code === 'REQUEST_TIMEOUT'
}

/**
 * Local microphone/device error domain. Intentionally separate from the Speech
 * Adapter contract: a microphone problem must never flip Speech API capabilities,
 * start a Speech API health-check, or show a "Speech API unavailable" banner.
 */
export type MicrophoneErrorCode =
  | 'NO_DEVICE_SELECTED'
  | 'DEVICE_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'DEVICE_CONSTRAINT_FAILED'
  | 'DEVICE_UNAVAILABLE'
  | 'UNKNOWN'
