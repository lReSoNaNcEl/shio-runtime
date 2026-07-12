import { LLM_PROVIDER_IDS, type LlmConfig, type LlmProviderId, type ProviderCredentials } from '../../../shared/llmProviders'
import { isLlmProviderId } from '../registry/index'
import { defaultLlmConfig, emptyCredentials } from './defaults'

function toCredentials(value: unknown, providerId: LlmProviderId): ProviderCredentials {
  const base = emptyCredentials(providerId)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.apiKey === 'string') base.apiKey = record.apiKey
    if (typeof record.model === 'string' && record.model) base.model = record.model
  }
  return base
}

/**
 * Coerce arbitrary persisted JSON into a valid {@link LlmConfig}, guaranteeing
 * every provider has an entry and `activeProvider` is a known id.
 */
export function normalizeLlmConfig(value: unknown): LlmConfig {
  const result = defaultLlmConfig()
  if (!value || typeof value !== 'object') return result

  const record = value as Record<string, unknown>
  if (typeof record.activeProvider === 'string' && isLlmProviderId(record.activeProvider)) {
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
      const value = selector as Record<string, unknown>
      result.roles.backlogSelector.enabled = value.enabled === true
      if (typeof value.providerId === 'string' && isLlmProviderId(value.providerId)) {
        result.roles.backlogSelector.providerId = value.providerId
      }
      if (typeof value.model === 'string') result.roles.backlogSelector.model = value.model
      if (typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs)) {
        result.roles.backlogSelector.timeoutMs = Math.max(250, Math.min(10_000, value.timeoutMs))
      }
      if (typeof value.minimumConfidence === 'number' && Number.isFinite(value.minimumConfidence)) {
        result.roles.backlogSelector.minimumConfidence = Math.max(0, Math.min(1, value.minimumConfidence))
      }
    }
  }
  return result
}
