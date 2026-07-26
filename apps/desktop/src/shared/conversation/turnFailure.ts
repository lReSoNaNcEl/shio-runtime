import type { LlmProviderId, LlmTurnErrorCode } from '../llm'
import type { ScreenContextErrorCode } from '../screen-context'

export type ConversationTurnErrorCode = LlmTurnErrorCode | ScreenContextErrorCode

export type AttachmentDisposition = 'retained' | 'released' | 'expired'

interface ConversationTurnFailureRecovery {
  providerId?: LlmProviderId
  attachmentDisposition: AttachmentDisposition
  retrySameRequest: boolean
  canResubmitWithoutImage: boolean
}

export type ConversationTurnFailure = ConversationTurnFailureRecovery &
  (
    | { domain: 'llm'; code: LlmTurnErrorCode }
    | { domain: 'screen-context'; code: ScreenContextErrorCode }
  )

export function deriveTurnRecoveryCapabilities(input: {
  code: ConversationTurnErrorCode
  transportRecoverable: boolean
  hadImage: boolean
  attachmentDisposition: AttachmentDisposition
}): Pick<ConversationTurnFailure, 'retrySameRequest' | 'canResubmitWithoutImage'> {
  return {
    retrySameRequest:
      input.transportRecoverable && (!input.hadImage || input.attachmentDisposition === 'retained'),
    canResubmitWithoutImage: input.hadImage && input.code !== 'CANCELLED',
  }
}
