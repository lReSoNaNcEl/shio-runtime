import {
  LLM_PROVIDER_IDS,
  type LlmConfig,
  type LlmProviderId,
  type ProviderCredentials,
} from '../../../shared/llmProviders'

export const GROQ_DEFAULT_MODEL = 'qwen/qwen3.6-27b'

export function emptyCredentials(providerId: LlmProviderId): ProviderCredentials {
  return { apiKey: '', model: providerId === 'groq' ? GROQ_DEFAULT_MODEL : '' }
}

/** Fresh, fully-populated LLM config with an entry for every known provider. */
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
