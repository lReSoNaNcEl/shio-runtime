import { LLM_PROVIDER_IDS, type LlmProviderId } from '../../shared/llm'
import { defaultLlmConfig, normalizeLlmConfig } from './config'
import type { LlmCredentialMap } from './LlmCredentialStore'
import { isLlmProviderId } from './registry'

export interface LegacyPersistedLlmConfig {
  provider?: string
  apiKey?: string
  model?: string
  groqApiKey?: string
  groqModel?: string
}

export function resolveLlmPersistence(saved: Record<string, unknown> & LegacyPersistedLlmConfig): {
  llm: ReturnType<typeof defaultLlmConfig>
  plaintextCredentials: LlmCredentialMap
  plaintextProviders: LlmProviderId[]
  migrated: boolean
} {
  const plaintextCredentials: LlmCredentialMap = {}
  const plaintextProviders = new Set<LlmProviderId>()
  if (saved.llm && typeof saved.llm === 'object') {
    const llmRecord = saved.llm as Record<string, unknown>
    const providers =
      llmRecord.providers && typeof llmRecord.providers === 'object'
        ? (llmRecord.providers as Record<string, unknown>)
        : {}
    for (const provider of LLM_PROVIDER_IDS) {
      const settings = providers[provider]
      if (!settings || typeof settings !== 'object') continue
      const providerSettings = settings as Record<string, unknown>
      const credential = ['apiKey', 'token', 'secret', 'credentialValue']
        .map((field) => providerSettings[field])
        .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
      if (credential) {
        plaintextCredentials[provider] = credential
        plaintextProviders.add(provider)
      }
      if (typeof providerSettings.maskedKey === 'string') plaintextProviders.add(provider)
    }
    return {
      llm: normalizeLlmConfig(saved.llm),
      plaintextCredentials,
      plaintextProviders: [...plaintextProviders],
      migrated: plaintextProviders.size > 0,
    }
  }

  const llm = defaultLlmConfig()
  let migrated = false
  if (typeof saved.provider === 'string' && isLlmProviderId(saved.provider)) {
    llm.activeProvider = saved.provider
    migrated = true
  }
  if (typeof saved.apiKey === 'string' && saved.apiKey) {
    plaintextCredentials[llm.activeProvider] = saved.apiKey
    plaintextProviders.add(llm.activeProvider)
    migrated = true
  }
  if (typeof saved.model === 'string' && saved.model) {
    llm.providers[llm.activeProvider].model = saved.model
    migrated = true
  }
  if (typeof saved.groqApiKey === 'string' && saved.groqApiKey && !plaintextCredentials.groq) {
    plaintextCredentials.groq = saved.groqApiKey
    plaintextProviders.add('groq')
    migrated = true
  }
  if (typeof saved.groqModel === 'string' && saved.groqModel) {
    llm.providers.groq.model = saved.groqModel
    migrated = true
  }
  return {
    llm,
    plaintextCredentials,
    plaintextProviders: [...plaintextProviders],
    migrated,
  }
}
