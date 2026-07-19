import type { LlmProviderId } from '../../shared/llm/providers'
import { mainLog } from '../logging/safeLogger'
import type { RuntimeFinishReason } from './openai-compatible/response'

export interface LlmDebugRecord {
  provider: LlmProviderId
  model: string
  finishReason: RuntimeFinishReason
  latencyMs: number
  hadReasoning: boolean
  contentEmpty: boolean
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  status?: number
  error?: string
}

export function llmDebugEnabled(): boolean {
  const flag = process.env.LLM_DEBUG ?? process.env.SHIO_LLM_DEBUG ?? ''
  return flag === '1' || flag.toLowerCase() === 'true' || Boolean(process.env.DEBUG)
}

export function llmDebug(record: LlmDebugRecord): void {
  if (!llmDebugEnabled()) return
  mainLog.info('[LLMDBG]', JSON.stringify(record))
}
