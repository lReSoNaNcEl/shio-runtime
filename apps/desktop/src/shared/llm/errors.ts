import type { LlmProviderId } from './providers'

export type LlmTurnErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'PROVIDER_REJECTED'
  | 'REQUEST_TOO_LARGE'
  | 'VISION_UNSUPPORTED'
  | 'CANCELLED'
  | 'UNKNOWN'

export interface LlmResponseFailure {
  providerId: LlmProviderId
  code: LlmTurnErrorCode
  recoverable: boolean
  technicalMessage?: string
}
