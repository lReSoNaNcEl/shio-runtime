import type { LlmProviderId } from './providers'

export type LlmTurnErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'AUTH_ERROR'
  | 'ACCESS_DENIED'
  | 'RATE_LIMITED'
  | 'PROVIDER_REJECTED'
  | 'REQUEST_TOO_LARGE'
  | 'VISION_UNSUPPORTED'
  | 'CANCELLED'
  | 'EMPTY_STREAM'
  | 'INVALID_STREAM_CHUNK'
  | 'INCOMPLETE_TOOL_CALL'
  | 'UNKNOWN'

export interface LlmResponseFailure {
  providerId: LlmProviderId
  code: LlmTurnErrorCode
  recoverable: boolean
  technicalMessage?: string
}
