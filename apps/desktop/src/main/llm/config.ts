import {
  LLM_PROVIDER_IDS,
  type LlmConfig,
  type LlmProviderId,
  type ProviderCredentials,
} from '../../shared/llm/providers'

export const GROQ_DEFAULT_MODEL = 'qwen/qwen3.6-27b'

export function emptyCredentials(providerId: LlmProviderId): ProviderCredentials {
  return { apiKey: '', model: providerId === 'groq' ? GROQ_DEFAULT_MODEL : '' }
}

function isKnownProviderId(value: string): value is LlmProviderId {
  return LLM_PROVIDER_IDS.some((providerId) => providerId === value)
}

export function defaultLlmConfig(): LlmConfig {
  const providers = {} as Record<LlmProviderId, ProviderCredentials>
  for (const id of LLM_PROVIDER_IDS) providers[id] = emptyCredentials(id)
  return {
    activeProvider: 'groq',
    providers,
    roles: {
      backlogSelector: {
        enabled: false,
        providerId: '',
        model: '',
        timeoutMs: 2_000,
        minimumConfidence: 0.72,
      },
    },
  }
}

function toCredentials(value: unknown, providerId: LlmProviderId): ProviderCredentials {
  const base = emptyCredentials(providerId)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.apiKey === 'string') base.apiKey = record.apiKey
    if (typeof record.model === 'string' && record.model) base.model = record.model
  }
  return base
}

export function normalizeLlmConfig(value: unknown): LlmConfig {
  const result = defaultLlmConfig()
  if (!value || typeof value !== 'object') return result

  const record = value as Record<string, unknown>
  if (typeof record.activeProvider === 'string' && isKnownProviderId(record.activeProvider)) {
    result.activeProvider = record.activeProvider
  }
  const providers = record.providers
  if (providers && typeof providers === 'object') {
    const providerRecord = providers as Record<string, unknown>
    for (const id of LLM_PROVIDER_IDS) {
      result.providers[id] = toCredentials(providerRecord[id], id)
    }
  }
  const roles = record.roles
  if (roles && typeof roles === 'object') {
    const selector = (roles as Record<string, unknown>).backlogSelector
    if (selector && typeof selector === 'object') {
      const selectorValue = selector as Record<string, unknown>
      result.roles.backlogSelector.enabled = selectorValue.enabled === true
      if (
        typeof selectorValue.providerId === 'string' &&
        isKnownProviderId(selectorValue.providerId)
      ) {
        result.roles.backlogSelector.providerId = selectorValue.providerId
      }
      if (typeof selectorValue.model === 'string') {
        result.roles.backlogSelector.model = selectorValue.model
      }
      if (typeof selectorValue.timeoutMs === 'number' && Number.isFinite(selectorValue.timeoutMs)) {
        result.roles.backlogSelector.timeoutMs = Math.max(
          250,
          Math.min(10_000, selectorValue.timeoutMs),
        )
      }
      if (
        typeof selectorValue.minimumConfidence === 'number' &&
        Number.isFinite(selectorValue.minimumConfidence)
      ) {
        result.roles.backlogSelector.minimumConfidence = Math.max(
          0,
          Math.min(1, selectorValue.minimumConfidence),
        )
      }
    }
  }
  return result
}
