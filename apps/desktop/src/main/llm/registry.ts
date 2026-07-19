import { LLM_PROVIDER_IDS, type LlmProviderId, type ModelInfo } from '../../shared/llm/providers'
import {
  applyCatalogCapabilityHints,
  resolveBaseCapabilities,
} from './openai-compatible/capabilities'
import { OpenAICompatibleClient } from './openai-compatible/OpenAICompatibleClient'
import { cerebrasProvider } from './providers/cerebras'
import { githubModelsProvider } from './providers/githubModels'
import { groqProvider } from './providers/groq'
import { mistralProvider } from './providers/mistral'
import { openRouterProvider } from './providers/openRouter'
import type {
  LLMProvider,
  LlmCapabilities,
  ModelCatalogEntry,
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

const catalogCapabilityHints = new Map<string, ModelCatalogEntry['capabilities']>()
const loadedModelCatalogs = new Set<LlmProviderId>()

function modelCapabilityKey(providerId: LlmProviderId, modelId: string): string {
  return `${providerId}:${modelId.trim().toLowerCase()}`
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
    capabilities: resolveModelCapabilities(config.provider, config.model),
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
  const resolved = definition.resolveCapabilities?.(modelId, base) ?? base
  return applyCatalogCapabilityHints(
    providerId,
    resolved,
    catalogCapabilityHints.get(modelCapabilityKey(providerId, modelId)),
  )
}

export function hasLoadedModelCatalog(providerId: LlmProviderId): boolean {
  return loadedModelCatalogs.has(providerId)
}

export function enrichModelCatalog(
  providerId: LlmProviderId,
  models: readonly ModelCatalogEntry[],
): ModelInfo[] {
  loadedModelCatalogs.add(providerId)
  return models.map((model) => {
    const key = modelCapabilityKey(providerId, model.id)
    if (
      model.capabilities?.supportsVision !== undefined ||
      model.capabilities?.supportsReasoning !== undefined
    ) {
      catalogCapabilityHints.set(key, model.capabilities)
    } else {
      catalogCapabilityHints.delete(key)
    }
    const capabilities = resolveModelCapabilities(providerId, model.id)
    return {
      ...model,
      capabilities: {
        supportsVision: capabilities.supportsVision,
        supportsReasoning: capabilities.supportsReasoning,
      },
    }
  })
}
