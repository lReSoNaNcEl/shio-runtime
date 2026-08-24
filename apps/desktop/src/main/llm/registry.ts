import { LLM_PROVIDER_IDS, type LlmProviderId, type ModelInfo } from '../../shared/llm'
import {
  applyCatalogCapabilityHints,
  resolveBaseCapabilities,
} from './openai-compatible/capabilities'
import { OpenAICompatibleClient } from './openai-compatible/OpenAICompatibleClient'
import { cloudflareProvider } from './providers/cloudflare'
import { githubModelsProvider } from './providers/githubModels'
import { groqProvider } from './providers/groq'
import { mistralProvider } from './providers/mistral'
import { openRouterProvider } from './providers/openRouter'
import type {
  LLMProvider,
  LlmCapabilities,
  ModelCatalogEntry,
  ModelCatalogProvider,
  ProviderConnectionSettings,
  ProviderDefinition,
} from './types'

const PROVIDER_DEFINITIONS: Record<LlmProviderId, ProviderDefinition> = {
  groq: groqProvider,
  cloudflare: cloudflareProvider,
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

export function normalizeProviderModelId(providerId: LlmProviderId, modelId: string): string {
  const normalized = modelId.trim()
  return getProviderDefinition(providerId).normalizeModelId?.(normalized) ?? normalized
}

export function normalizeProviderAccountId(providerId: LlmProviderId, accountId: string): string {
  const definition = getProviderDefinition(providerId)
  if (!definition.profile.requiresAccountId) return ''
  return definition.normalizeAccountId?.(accountId.trim()) ?? accountId.trim()
}

export function resolveProviderChatBaseUrl(
  providerId: LlmProviderId,
  connection: ProviderConnectionSettings = {},
): string {
  const definition = getProviderDefinition(providerId)
  return definition.chat.resolveBaseUrl?.(connection) ?? definition.chat.baseUrl
}

export function isLlmProviderId(value: string): value is LlmProviderId {
  return LLM_PROVIDER_IDS.some((providerId) => providerId === value)
}

export function createLLMProvider(config: {
  provider: LlmProviderId
  apiKey: string
  model: string
  accountId?: string
}): LLMProvider {
  return new OpenAICompatibleClient({
    definition: getProviderDefinition(config.provider),
    apiKey: config.apiKey,
    model: config.model,
    connection: { accountId: config.accountId },
    capabilities: resolveModelCapabilities(config.provider, config.model),
  })
}

export function createModelCatalog(
  id: LlmProviderId,
  connection: ProviderConnectionSettings = {},
): ModelCatalogProvider {
  return new OpenAICompatibleClient({
    definition: getProviderDefinition(id),
    apiKey: '',
    model: '',
    connection,
  })
}

export function resolveModelCapabilities(
  providerId: LlmProviderId,
  modelId: string,
): LlmCapabilities {
  const definition = getProviderDefinition(providerId)
  const normalizedModelId = normalizeProviderModelId(providerId, modelId)
  const base = resolveBaseCapabilities(providerId, normalizedModelId)
  const resolved = definition.resolveCapabilities?.(normalizedModelId, base) ?? base
  return applyCatalogCapabilityHints(
    providerId,
    resolved,
    catalogCapabilityHints.get(modelCapabilityKey(providerId, normalizedModelId)),
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
  const canonicalModels = new Map<string, ModelCatalogEntry>()
  for (const model of models) {
    const sourceId = model.id.trim()
    const id = normalizeProviderModelId(providerId, sourceId)
    const normalizedModel = id === sourceId ? model : { ...model, id }
    if (!canonicalModels.has(id) || sourceId === id) canonicalModels.set(id, normalizedModel)
  }
  return [...canonicalModels.values()].map((model) => {
    const id = model.id
    const key = modelCapabilityKey(providerId, id)
    if (
      model.capabilities?.supportsVision !== undefined ||
      model.capabilities?.supportsReasoning !== undefined ||
      model.capabilities?.supportsToolCalling !== undefined
    ) {
      catalogCapabilityHints.set(key, model.capabilities)
    } else {
      catalogCapabilityHints.delete(key)
    }
    const capabilities = resolveModelCapabilities(providerId, id)
    return {
      ...model,
      capabilities: {
        supportsVision: capabilities.supportsVision,
        supportsReasoning: capabilities.supportsReasoning,
        supportsToolCalling: capabilities.supportsToolCalling,
      },
    }
  })
}
