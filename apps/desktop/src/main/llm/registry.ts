import { LLM_PROVIDER_IDS, type LlmProviderId, type ModelInfo } from '../../shared/llm'
import { createAiSdkAdapter, createModelCatalogClient } from './AiSdkAdapter'
import {
  applyCatalogCapabilityHints,
  resolveBaseCapabilities,
} from './openai-compatible/capabilities'
import { cloudflareProvider } from './providers/cloudflare'
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
  openrouter: openRouterProvider,
  mistral: mistralProvider,
}

interface ModelCatalogSnapshot {
  identity: string
  hints: Map<string, ModelCatalogEntry['capabilities']>
}

// One snapshot per provider. Hints apply only to the exact catalog identity they came from;
// a newer catalog replaces the whole snapshot so removed models drop their hints.
const modelCatalogSnapshots = new Map<LlmProviderId, ModelCatalogSnapshot>()

function modelCapabilityKey(modelId: string): string {
  return modelId.trim().toLowerCase()
}

function modelCatalogIdentity(
  providerId: LlmProviderId,
  connection: ProviderConnectionSettings,
): string {
  return normalizeProviderAccountId(providerId, connection.accountId ?? '')
}

function currentCatalogHints(
  providerId: LlmProviderId,
  connection: ProviderConnectionSettings,
): ModelCatalogSnapshot['hints'] | undefined {
  const snapshot = modelCatalogSnapshots.get(providerId)
  return snapshot?.identity === modelCatalogIdentity(providerId, connection)
    ? snapshot.hints
    : undefined
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
  capabilities?: LlmCapabilities
}): LLMProvider {
  return createAiSdkAdapter({
    definition: getProviderDefinition(config.provider),
    apiKey: config.apiKey,
    model: config.model,
    connection: { accountId: config.accountId },
    capabilities:
      config.capabilities ??
      resolveModelCapabilities(config.provider, config.model, { accountId: config.accountId }),
  })
}

export function createModelCatalog(
  id: LlmProviderId,
  connection: ProviderConnectionSettings = {},
): ModelCatalogProvider {
  return createModelCatalogClient({ definition: getProviderDefinition(id), connection })
}

export function resolveModelCapabilities(
  providerId: LlmProviderId,
  modelId: string,
  connection: ProviderConnectionSettings = {},
): LlmCapabilities {
  const definition = getProviderDefinition(providerId)
  const normalizedModelId = normalizeProviderModelId(providerId, modelId)
  const base = {
    ...resolveBaseCapabilities(providerId, normalizedModelId),
    supportsStreaming: definition.chat.supportsStreaming,
  }
  const resolved = definition.resolveCapabilities?.(normalizedModelId, base) ?? base
  return applyCatalogCapabilityHints(
    providerId,
    resolved,
    currentCatalogHints(providerId, connection)?.get(modelCapabilityKey(normalizedModelId)),
  )
}

export function hasLoadedModelCatalog(
  providerId: LlmProviderId,
  connection: ProviderConnectionSettings = {},
): boolean {
  return currentCatalogHints(providerId, connection) !== undefined
}

/** Drops catalog hints after a credential change; the next refresh reloads the catalog. */
export function invalidateModelCatalog(providerId: LlmProviderId): void {
  modelCatalogSnapshots.delete(providerId)
}

export function enrichModelCatalog(
  providerId: LlmProviderId,
  models: readonly ModelCatalogEntry[],
  connection: ProviderConnectionSettings = {},
): ModelInfo[] {
  const hints: ModelCatalogSnapshot['hints'] = new Map()
  modelCatalogSnapshots.set(providerId, {
    identity: modelCatalogIdentity(providerId, connection),
    hints,
  })
  const canonicalModels = new Map<string, ModelCatalogEntry>()
  for (const model of models) {
    const sourceId = model.id.trim()
    const id = normalizeProviderModelId(providerId, sourceId)
    const normalizedModel = id === sourceId ? model : { ...model, id }
    if (!canonicalModels.has(id) || sourceId === id) canonicalModels.set(id, normalizedModel)
  }
  return [...canonicalModels.values()].map((model) => {
    const id = model.id
    if (
      model.capabilities?.supportsImageGeneration !== undefined ||
      model.capabilities?.supportsVision !== undefined ||
      model.capabilities?.supportsReasoning !== undefined ||
      model.capabilities?.supportsStreaming !== undefined ||
      model.capabilities?.supportsToolCalling !== undefined
    ) {
      hints.set(modelCapabilityKey(id), model.capabilities)
    }
    const capabilities = resolveModelCapabilities(providerId, id, connection)
    return {
      ...model,
      capabilities: {
        supportsImageGeneration: model.capabilities?.supportsImageGeneration ?? false,
        supportsVision: capabilities.supportsVision,
        supportsReasoning: capabilities.supportsReasoning,
        supportsStreaming: capabilities.supportsStreaming,
        supportsToolCalling: capabilities.supportsToolCalling,
      },
    }
  })
}
