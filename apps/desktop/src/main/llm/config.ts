import {
  LLM_PROVIDER_IDS,
  type LlmCredentialStatus,
  type LlmPersistedConfig,
  type LlmProviderId,
  type LlmProviderPersistedSettings,
  type LlmPublicConfig,
} from '../../shared/llm'
import { normalizeProviderAccountId, normalizeProviderModelId } from './registry'

export function emptyProviderSettings(): LlmProviderPersistedSettings {
  return { model: '', accountId: '' }
}

function isKnownProviderId(value: string): value is LlmProviderId {
  return LLM_PROVIDER_IDS.some((providerId) => providerId === value)
}

export function defaultLlmConfig(): LlmPersistedConfig {
  const providers = {} as Record<LlmProviderId, LlmProviderPersistedSettings>
  for (const id of LLM_PROVIDER_IDS) providers[id] = emptyProviderSettings()
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

function toProviderSettings(
  providerId: LlmProviderId,
  value: unknown,
): LlmProviderPersistedSettings {
  const base = emptyProviderSettings()
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.model === 'string' && record.model) {
      base.model = normalizeProviderModelId(providerId, record.model)
    }
    if (typeof record.accountId === 'string') {
      base.accountId = normalizeProviderAccountId(providerId, record.accountId)
    }
  }
  return base
}

export function normalizeLlmConfig(value: unknown): LlmPersistedConfig {
  const result = defaultLlmConfig()
  if (!value || typeof value !== 'object') return result

  const record = value as Record<string, unknown>
  if (record.activeProvider === 'cerebras') {
    result.activeProvider = 'cloudflare'
  } else if (
    typeof record.activeProvider === 'string' &&
    isKnownProviderId(record.activeProvider)
  ) {
    result.activeProvider = record.activeProvider
  }
  const providers = record.providers
  if (providers && typeof providers === 'object') {
    const providerRecord = providers as Record<string, unknown>
    for (const id of LLM_PROVIDER_IDS) {
      result.providers[id] = toProviderSettings(id, providerRecord[id])
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
      const legacyCerebrasSelector = selectorValue.providerId === 'cerebras'
      if (legacyCerebrasSelector) {
        result.roles.backlogSelector.enabled = false
        result.roles.backlogSelector.providerId = ''
        result.roles.backlogSelector.model = ''
      }
      if (!legacyCerebrasSelector && typeof selectorValue.model === 'string') {
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

export function toPublicLlmConfig(
  config: LlmPersistedConfig,
  getCredentialStatus: (provider: LlmProviderId) => LlmCredentialStatus,
  getAccountId: (provider: LlmProviderId, persistedAccountId: string) => string = (
    _provider,
    persistedAccountId,
  ) => persistedAccountId,
): LlmPublicConfig {
  const providers = {} as LlmPublicConfig['providers']
  for (const id of LLM_PROVIDER_IDS) {
    providers[id] = {
      model: config.providers[id].model,
      accountId: getAccountId(id, config.providers[id].accountId ?? ''),
      credential: getCredentialStatus(id),
    }
  }
  return {
    activeProvider: config.activeProvider,
    providers,
    roles: config.roles,
  }
}

export function resolveLlmProviderAccountId(
  providerId: LlmProviderId,
  persistedAccountId: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured = normalizeProviderAccountId(providerId, persistedAccountId ?? '')
  if (configured || providerId !== 'cloudflare') return configured
  return normalizeProviderAccountId(providerId, environment.CLOUDFLARE_ACCOUNT_ID ?? '')
}
