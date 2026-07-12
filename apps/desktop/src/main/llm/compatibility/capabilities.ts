import type { LlmProviderId } from '../../../shared/llmProviders'

/**
 * Provider/model capability metadata. The adapter resolves this once per
 * request and drives all compatibility decisions from it, so the rest of the
 * codebase never needs provider-specific conditionals.
 */
export interface LlmCapabilities {
  supportsReasoning: boolean
  supportsStreaming: boolean
  supportsTemperature: boolean
  supportsSystemPrompt: boolean
  recommendedMaxTokens: number
}

// Model-id markers for reasoning-capable models (GLM, GPT-OSS, DeepSeek R1,
// Qwen thinking variants, QwQ, OpenAI o-series, Magistral, ...). Matching is
// intentionally broad so future reasoning models are handled without new code.
const REASONING_MODEL_PATTERNS: readonly RegExp[] = [
  /glm/i,
  /gpt-?oss/i,
  /deepseek[-_]?r1/i,
  /deepseek[-_]?reason/i,
  /(^|[-_/:])r1([-_/:]|$)/i,
  /qwq/i,
  /qwen-?3/i,
  /reason/i,
  /think/i,
  /magistral/i,
  /(^|[-_/:])o1([-_/:]|$)/i,
  /(^|[-_/:])o3([-_/:]|$)/i,
  /(^|[-_/:])o4-?mini/i
]

// Models that reject an explicit `temperature` parameter (OpenAI o-series).
const NO_TEMPERATURE_PATTERNS: readonly RegExp[] = [
  /(^|[-_/:])o1([-_/:]|$)/i,
  /(^|[-_/:])o3([-_/:]|$)/i,
  /(^|[-_/:])o4-?mini/i
]

export function isReasoningModel(modelId: string): boolean {
  return REASONING_MODEL_PATTERNS.some((re) => re.test(modelId))
}

const NON_REASONING_BUDGET: Record<LlmProviderId, number> = {
  groq: 512,
  cerebras: 1024,
  github: 1024,
  openrouter: 1024,
  mistral: 1024
}

const REASONING_BUDGET = 4096

export function resolveCapabilities(providerId: LlmProviderId, modelId: string): LlmCapabilities {
  const model = modelId.trim()
  const reasoning = isReasoningModel(model)
  const supportsTemperature = !NO_TEMPERATURE_PATTERNS.some((re) => re.test(model))
  return {
    supportsReasoning: reasoning,
    supportsStreaming: true,
    supportsTemperature,
    supportsSystemPrompt: true,
    recommendedMaxTokens: reasoning ? REASONING_BUDGET : NON_REASONING_BUDGET[providerId]
  }
}
