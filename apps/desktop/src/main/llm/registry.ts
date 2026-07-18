import { LLM_PROVIDER_IDS, type LlmProviderId } from '../../shared/llmProviders'
import { resolveBaseCapabilities } from './openai-compatible/capabilities'
import { OpenAICompatibleClient } from './openai-compatible/OpenAICompatibleClient'
import { cerebrasProvider } from './providers/cerebras'
import { githubModelsProvider } from './providers/githubModels'
import { groqProvider } from './providers/groq'
import { mistralProvider } from './providers/mistral'
import { openRouterProvider } from './providers/openRouter'
import type {
  LLMProvider,
  LlmCapabilities,
  ModelCatalogProvider,
  ProviderDefinition,
} from './types'

const PROVIDER_DEFINITIONS: Record<LlmProviderId, ProviderDefinition> = {
  groq: groqProvider,
  cerebras: cerebrasProvider,
  github: githubModelsProvider,
  openrouter: openRouterProvider,
  mistral: mistralProvider,
}

export const PROVIDER_PROFILES = Object.values(PROVIDER_DEFINITIONS).map(
  (definition) => definition.profile,
)

export function getProviderDefinition(id: LlmProviderId): ProviderDefinition {
  return PROVIDER_DEFINITIONS[id]
}

export function getProviderProfile(id: LlmProviderId): ProviderDefinition['profile'] {
  return getProviderDefinition(id).profile
}

export function isLlmProviderId(value: string): value is LlmProviderId {
  return LLM_PROVIDER_IDS.some((providerId) => providerId === value)
}

export function createLLMProvider(config: {
  provider: LlmProviderId
  apiKey: string
  model: string
}): LLMProvider {
  return new OpenAICompatibleClient({
    definition: getProviderDefinition(config.provider),
    apiKey: config.apiKey,
    model: config.model,
  })
}

export function createModelCatalog(id: LlmProviderId): ModelCatalogProvider {
  return new OpenAICompatibleClient({
    definition: getProviderDefinition(id),
    apiKey: '',
    model: '',
  })
}

export function resolveModelCapabilities(
  providerId: LlmProviderId,
  modelId: string,
): LlmCapabilities {
  const definition = getProviderDefinition(providerId)
  const base = resolveBaseCapabilities(providerId, modelId)
  return definition.resolveCapabilities?.(modelId, base) ?? base
}
