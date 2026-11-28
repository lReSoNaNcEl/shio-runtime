import {
  isCodexReasoningEffort,
  isLlmProviderId,
  LLM_PROVIDER_IDS,
  type LlmCredentialStatus,
  type LlmPersistedConfig,
  type LlmProviderId,
  type LlmProviderPersistedSettings,
  type LlmPublicConfig,
  type LlmRoleCandidate,
  MAX_CHARACTER_FALLBACKS,
} from '../../shared/llm'
import { CODEX_MODEL, isCodexModelId } from './CodexCliProvider'
import { OLLAMA_DEFAULT_MODEL } from './providers/ollama'
import { normalizeProviderAccountId, normalizeProviderModelId } from './registry'

function defaultProviderSettings(providerId: LlmProviderId): LlmProviderPersistedSettings {
  const model =
    providerId === 'codex-cli' ? CODEX_MODEL : providerId === 'ollama' ? OLLAMA_DEFAULT_MODEL : ''
  return { model, accountId: '' }
}

export function defaultLlmConfig(): LlmPersistedConfig {
  const providers = {} as Record<LlmProviderId, LlmProviderPersistedSettings>
  for (const id of LLM_PROVIDER_IDS) providers[id] = defaultProviderSettings(id)
  return {
    activeProvider: 'groq',
    providers,
    speculativeDirectReply: false,
    roles: {
      computerUseVision: {
        providerId: '',
        model: '',
        timeoutMs: 15_000,
        maxSteps: 30,
      },
      characterFallbacks: [],
    },
  }
}

/** Ordered, bounded, de-duplicated fallbacks; unknown providers and empty models are dropped. */
function toCharacterFallbacks(value: unknown): LlmRoleCandidate[] {
  if (!Array.isArray(value)) return []
  const result: LlmRoleCandidate[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (!isLlmProviderId(record.providerId)) continue
    if (typeof record.model !== 'string') continue
    const model = normalizeProviderModelId(record.providerId, record.model.trim())
    if (!model || model.length > 500) continue
    if (result.some((item) => item.providerId === record.providerId && item.model === model))
      continue
    result.push({ providerId: record.providerId, model })
    if (result.length >= MAX_CHARACTER_FALLBACKS) break
  }
  return result
}

function toProviderSettings(
  providerId: LlmProviderId,
  value: unknown,
): LlmProviderPersistedSettings {
  const base = defaultProviderSettings(providerId)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const efforts = record.codexReasoningByModel
    if (
      providerId === 'codex-cli' &&
      efforts &&
      typeof efforts === 'object' &&
      !Array.isArray(efforts)
    ) {
      const entries = Object.entries(efforts)
        .filter(([id, level]) => isCodexModelId(id) && isCodexReasoningEffort(level))
        .slice(0, 128)
      if (entries.length) base.codexReasoningByModel = Object.fromEntries(entries)
    }
    if (typeof record.model === 'string' && record.model) {
      base.model = normalizeProviderModelId(providerId, record.model) || base.model
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
  } else if (isLlmProviderId(record.activeProvider)) {
    result.activeProvider = record.activeProvider
  }
  result.speculativeDirectReply = record.speculativeDirectReply === true
  const providers = record.providers
  if (providers && typeof providers === 'object') {
    const providerRecord = providers as Record<string, unknown>
    for (const id of LLM_PROVIDER_IDS) {
      result.providers[id] = toProviderSettings(id, providerRecord[id])
    }
  }
  const roles = record.roles
  if (roles && typeof roles === 'object') {
    const roleRecord = roles as Record<string, unknown>
    result.roles.characterFallbacks = toCharacterFallbacks(roleRecord.characterFallbacks)
    const computerUseVision = roleRecord.computerUseVision
    if (computerUseVision && typeof computerUseVision === 'object') {
      const visualValue = computerUseVision as Record<string, unknown>
      if (isLlmProviderId(visualValue.providerId)) {
        result.roles.computerUseVision.providerId = visualValue.providerId
      }
      if (typeof visualValue.model === 'string') {
        result.roles.computerUseVision.model = result.roles.computerUseVision.providerId
          ? normalizeProviderModelId(result.roles.computerUseVision.providerId, visualValue.model)
          : ''
      }
      if (typeof visualValue.timeoutMs === 'number' && Number.isFinite(visualValue.timeoutMs)) {
        result.roles.computerUseVision.timeoutMs = Math.max(
          5_000,
          Math.min(60_000, Math.round(visualValue.timeoutMs)),
        )
      }
      if (typeof visualValue.maxSteps === 'number' && Number.isFinite(visualValue.maxSteps)) {
        result.roles.computerUseVision.maxSteps = Math.max(
          1,
          Math.min(300, Math.round(visualValue.maxSteps)),
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
      ...(config.providers[id].codexReasoningByModel && {
        codexReasoningByModel: config.providers[id].codexReasoningByModel,
      }),
      accountId: getAccountId(id, config.providers[id].accountId ?? ''),
      credential: getCredentialStatus(id),
    }
  }
  return {
    activeProvider: config.activeProvider,
    providers,
    speculativeDirectReply: config.speculativeDirectReply,
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
