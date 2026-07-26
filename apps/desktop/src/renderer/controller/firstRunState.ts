import type { LlmReadiness } from '../../shared/llm'

export function isVrmConfigured(filePath: string): boolean {
  return filePath.trim().length > 0
}

export function shouldBlockChatSubmission(readiness: LlmReadiness): boolean {
  return readiness.reason === 'missing-credential'
}
