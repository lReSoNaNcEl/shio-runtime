import type { LlmReadiness } from '../../shared/llm'

export type LlmSetupReadiness = LlmReadiness & {
  reason: 'missing-account-id' | 'missing-credential' | 'model-missing'
}

export function isVrmConfigured(filePath: string): boolean {
  return filePath.trim().length > 0
}

export function shouldBlockChatSubmission(readiness: LlmReadiness): readiness is LlmSetupReadiness {
  return (
    readiness.reason === 'missing-account-id' ||
    readiness.reason === 'missing-credential' ||
    readiness.reason === 'model-missing'
  )
}
