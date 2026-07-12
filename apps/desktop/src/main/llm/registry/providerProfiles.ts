import type { LlmProviderId, ProviderProfile } from '../../../shared/llmProviders'

export type { LlmProviderId, ProviderProfile }

/**
 * Single source of truth for "what providers exist". Adding a new provider
 * means adding one entry here plus one provider class.
 */
export const PROVIDER_PROFILES: readonly ProviderProfile[] = [
  { id: 'groq', displayName: 'Groq', requiresApiKey: true, modelsRequireApiKey: false },
  { id: 'cerebras', displayName: 'Cerebras', requiresApiKey: true, modelsRequireApiKey: false },
  { id: 'github', displayName: 'GitHub Models', requiresApiKey: true, modelsRequireApiKey: true },
  { id: 'openrouter', displayName: 'OpenRouter', requiresApiKey: true, modelsRequireApiKey: false },
  { id: 'mistral', displayName: 'Mistral', requiresApiKey: true, modelsRequireApiKey: true },
]

export function isLlmProviderId(value: string): value is LlmProviderId {
  return PROVIDER_PROFILES.some((p) => p.id === value)
}

export function getProviderProfile(id: LlmProviderId): ProviderProfile {
  const profile = PROVIDER_PROFILES.find((p) => p.id === id)
  if (!profile) throw new Error(`Unknown LLM provider: ${id}`)
  return profile
}
