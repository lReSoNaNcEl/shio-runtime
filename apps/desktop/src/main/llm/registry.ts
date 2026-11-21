import {
  type CodexReasoningEffort,
  isCodexReasoningEffort,
  LLM_PROVIDER_IDS,
  type LlmProviderId,
  type ModelInfo,
} from '../../shared/llm'
import { createAiSdkAdapter, createModelCatalogClient } from './AiSdkAdapter'
import {
  CODEX_MODEL,
  codexCapabilities,
  codexProfile,
  createCodexCliProvider,
  fetchCodexModels,
  isCodexModelId,
} from './CodexCliProvider'
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

const PROVIDER_DEFINITIONS: Record<Exclude<LlmProviderId, 'codex-cli'>, ProviderDefinition> = {
  groq: groqProvider,
  cloudflare: cloudflareProvider,
  openrouter: openRouterProvider,
  mistral: mistralProvider,
}

interface ModelCatalogSnapshot {
  identity: string
  hints: Map<
    string,
    NonNullable<ModelCatalogEntry['capabilities']> & Pick<ModelCatalogEntry, 'reasoning'>
  >
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

export const PROVIDER_PROFILES = LLM_PROVIDER_IDS.map(getProviderProfile)

export function getProviderDefinition(id: LlmProviderId): ProviderDefinition {
  if (id === 'codex-cli') throw new Error('Codex CLI has no HTTP transport')
  return PROVIDER_DEFINITIONS[id]
}

export function getProviderProfile(id: LlmProviderId): ProviderDefinition['profile'] {
  return id === 'codex-cli' ? codexProfile : getProviderDefinition(id).profile
}

export function normalizeProviderModelId(providerId: LlmProviderId, modelId: string): string {
  const normalized = modelId.trim()
  if (providerId === 'codex-cli') return isCodexModelId(normalized) ? normalized : ''
  return getProviderDefinition(providerId).normalizeModelId?.(normalized) ?? normalized
}

export function normalizeProviderAccountId(providerId: LlmProviderId, accountId: string): string {
  if (!getProviderProfile(providerId).requiresAccountId) return ''
  const definition = getProviderDefinition(providerId)
  return definition.normalizeAccountId?.(accountId.trim()) ?? accountId.trim()
}

export function resolveProviderChatBaseUrl(
  providerId: LlmProviderId,
  connection: ProviderConnectionSettings = {},
): string {
  if (providerId === 'codex-cli') return ''
  const definition = getProviderDefinition(providerId)
  return definition.chat.resolveBaseUrl?.(connection) ?? definition.chat.baseUrl
}

export function isLlmProviderId(value: string): value is LlmProviderId {
  return LLM_PROVIDER_IDS.some((providerId) => providerId === value)
}

export function createLLMProvider(config: {
  reasoningEffort?: CodexReasoningEffort
  provider: LlmProviderId
  apiKey: string
  model: string
  accountId?: string
  capabilities?: LlmCapabilities
}): LLMProvider {
  if (config.provider === 'codex-cli') {
    const options = currentCatalogHints(config.provider, {})?.get(
      modelCapabilityKey(config.model),
    )?.reasoning
    const requested = config.reasoningEffort
    const effort =
      isCodexReasoningEffort(requested) && (!options || options.levels.includes(requested))
        ? requested
        : options
          ? options.defaultLevel
          : config.model === CODEX_MODEL
            ? 'low'
            : undefined
    return createCodexCliProvider(
      config.model,
      config.capabilities ?? resolveModelCapabilities(config.provider, config.model),
      effort,
    )
  }
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
  if (id === 'codex-cli') return { fetchModels: fetchCodexModels }
  return createModelCatalogClient({ definition: getProviderDefinition(id), connection })
}

export function resolveModelCapabilities(
  providerId: LlmProviderId,
  modelId: string,
  connection: ProviderConnectionSettings = {},
): LlmCapabilities {
  if (providerId === 'codex-cli')
    return applyCatalogCapabilityHints(
      providerId,
      codexCapabilities(modelId),
      currentCatalogHints(providerId, connection)?.get(modelCapabilityKey(modelId)),
    )
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
      hints.set(modelCapabilityKey(id), { ...model.capabilities, reasoning: model.reasoning })
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
