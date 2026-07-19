import type { LlmProviderId } from '../../../shared/llm'
import type { LlmCapabilities } from '../types'

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
  /(^|[-_/:])o4-?mini/i,
]

const NO_TEMPERATURE_PATTERNS: readonly RegExp[] = [
  /(^|[-_/:])o1([-_/:]|$)/i,
  /(^|[-_/:])o3([-_/:]|$)/i,
  /(^|[-_/:])o4-?mini/i,
]

const NON_REASONING_BUDGET: Record<LlmProviderId, number> = {
  groq: 512,
  cerebras: 1024,
  github: 1024,
  openrouter: 1024,
  mistral: 1024,
}

const REASONING_BUDGET = 4096

const VISION_MODEL_PATTERNS: readonly RegExp[] = [
  /(?:^|[-_/:])vision(?:$|[-_/:])/i,
  /(?:^|[-_/:])llava(?:$|[-_/:])/i,
  /(?:^|[-_/:])pixtral(?:$|[-_/:])/i,
  /(?:^|[-_/:])qwen[^/:]*?(?:[-_.])vl(?:$|[-_/:])/i,
  /(?:^|[-_/:])gpt-4o(?:$|[-_/:])/i,
  /(?:^|[-_/:])gpt-4\.1(?:$|[-_/:])/i,
  /(?:^|[-_/:])gemini(?:$|[-_/:])/i,
  /(?:^|[-_/:])claude(?:$|[-_/:])/i,
  /(?:^|[-_/:])llama-4[^/:]*(?:scout|maverick)(?:$|[-_/:])/i,
  /(?:^|[/])qwen\/qwen3\.6-[^/:]+(?:$|[:/])/i,
  /(?:^|[/])mistral-small-(?:2503|2506|latest)(?:$|[:/])/i,
  /(?:^|[/])mistral-medium-(?:2505|2508|latest)(?:$|[:/])/i,
  /(?:^|[/])mistral-large-(?:2512|latest)(?:$|[:/])/i,
  /(?:^|[/])ministral-(?:3b|8b|14b)-2512(?:$|[:/])/i,
  /(?:^|[/])magistral-(?:small|medium)-(?:2509|latest)(?:$|[:/])/i,
]

export function isReasoningModel(modelId: string): boolean {
  return REASONING_MODEL_PATTERNS.some((pattern) => pattern.test(modelId))
}

export function isVisionModel(modelId: string): boolean {
  return VISION_MODEL_PATTERNS.some((pattern) => pattern.test(modelId))
}

export function resolveBaseCapabilities(
  providerId: LlmProviderId,
  modelId: string,
): LlmCapabilities {
  const model = modelId.trim()
  const reasoning = isReasoningModel(model)
  return {
    supportsReasoning: reasoning,
    supportsStreaming: true,
    supportsTemperature: !NO_TEMPERATURE_PATTERNS.some((pattern) => pattern.test(model)),
    supportsSystemPrompt: true,
    supportsVision: isVisionModel(model),
    recommendedMaxTokens: reasoning ? REASONING_BUDGET : NON_REASONING_BUDGET[providerId],
  }
}

export function applyCatalogCapabilityHints(
  providerId: LlmProviderId,
  capabilities: LlmCapabilities,
  hints:
    | {
        supportsVision?: boolean
        supportsReasoning?: boolean
      }
    | undefined,
): LlmCapabilities {
  if (!hints) return capabilities
  const supportsReasoning = hints.supportsReasoning ?? capabilities.supportsReasoning
  return {
    ...capabilities,
    supportsReasoning,
    supportsVision: hints.supportsVision ?? capabilities.supportsVision,
    recommendedMaxTokens: supportsReasoning ? REASONING_BUDGET : NON_REASONING_BUDGET[providerId],
  }
}
