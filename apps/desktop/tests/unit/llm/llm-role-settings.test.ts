import { describe, expect, it } from 'vitest'

import { defaultLlmConfig } from '../../../src/main/llm/config'
import type { ResolvedLlmCredential } from '../../../src/main/llm/LlmCredentialStore'
import { resolveLlmRoleSettings } from '../../../src/main/llm/roleSettings'
import {
  LLM_PROVIDER_IDS,
  type LlmPersistedConfig,
  type LlmProviderId,
} from '../../../src/shared/llm'

const credential = (provider: LlmProviderId): ResolvedLlmCredential => ({
  apiKey: provider === 'groq' ? '' : `key-${provider}`,
  status: {
    configured: provider !== 'groq',
    source: provider === 'groq' ? 'none' : 'secure_store',
  } as ResolvedLlmCredential['status'],
})
const accountId = (provider: LlmProviderId, persisted: string | undefined) =>
  provider === 'cloudflare' ? (persisted ?? '').trim() : ''

function configs(): LlmPersistedConfig[] {
  const result: LlmPersistedConfig[] = []
  for (const activeProvider of LLM_PROVIDER_IDS)
    for (const visualProvider of ['', 'openrouter', 'cloudflare'] as const) {
      const config = defaultLlmConfig()
      config.activeProvider = activeProvider
      for (const id of LLM_PROVIDER_IDS)
        config.providers[id] = {
          model: ` model-${id} `,
          accountId: id === 'cloudflare' ? ' acc ' : '',
        }
      config.roles.computerUseVision = {
        ...config.roles.computerUseVision,
        providerId: visualProvider,
        model: visualProvider ? ' vision-model ' : '',
      }
      result.push(config)
    }
  return result
}

// The resolutions that buildApplicationDependencies previously spelled out by hand.
const previous = {
  character(config: LlmPersistedConfig) {
    const provider = config.activeProvider
    return {
      provider,
      apiKey: credential(provider).apiKey,
      model: config.providers[provider].model,
      accountId: accountId(provider, config.providers[provider].accountId),
    }
  },
  dshModel(config: LlmPersistedConfig) {
    return previous.character(config).model.trim()
  },
  visual(config: LlmPersistedConfig) {
    const role = config.roles.computerUseVision
    const automatic = !role.providerId
    const provider = role.providerId || config.activeProvider
    return {
      automatic,
      provider,
      apiKey: credential(provider).apiKey,
      model: automatic ? config.providers[provider].model.trim() : role.model.trim(),
      accountId: accountId(provider, config.providers[provider].accountId),
    }
  },
}

describe('LLM role settings', () => {
  const sources = (config: LlmPersistedConfig) => ({
    config: () => config,
    credential,
    accountId,
  })

  it('reproduces the previous Character, DSH and Browser vision resolution exactly', () => {
    for (const config of configs()) {
      const character = resolveLlmRoleSettings('character', sources(config))
      expect({
        provider: character.provider,
        apiKey: character.apiKey,
        model: character.model,
        accountId: character.accountId,
      }).toEqual(previous.character(config))
      expect(character.model.trim()).toBe(previous.dshModel(config))
      const visual = resolveLlmRoleSettings('computerUseVision', sources(config))
      expect({
        automatic: visual.automatic,
        provider: visual.provider,
        apiKey: visual.apiKey,
        model: visual.model,
        accountId: visual.accountId,
      }).toEqual(previous.visual(config))
    }
  })

  it('reports credential status without exposing it through another path', () => {
    const config = configs()[0]
    config.activeProvider = 'groq'
    const character = resolveLlmRoleSettings('character', sources(config))
    expect(character.credential.configured).toBe(false)
    expect(character.apiKey).toBe('')
  })
})
