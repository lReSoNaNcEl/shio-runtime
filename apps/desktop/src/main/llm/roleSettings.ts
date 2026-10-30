import type { LlmPersistedConfig, LlmProviderId } from '../../shared/llm'
import { resolveLlmProviderAccountId } from './config'
import type { ResolvedLlmCredential } from './LlmCredentialStore'
import type { LlmGatewaySettings } from './types'

/** Every Main-owned LLM consumer selects its provider/model through one named role. */
export const LLM_ROLE_IDS = [
  'character',
  'backlogSelector',
  'computerUseVision',
  'fastBrain',
  'sessionSummarizer',
] as const
export type LlmRoleId = (typeof LLM_ROLE_IDS)[number]

/** Non-secret per-call selection of an owner whose choice lives outside LLM config. */
export interface LlmRoleSelection {
  providerId?: LlmProviderId | ''
  model?: string
}

export interface LlmRoleSources {
  config: () => LlmPersistedConfig
  credential: (provider: LlmProviderId) => ResolvedLlmCredential
  accountId?: (provider: LlmProviderId, persistedAccountId: string | undefined) => string
}

export interface ResolvedLlmRoleSettings extends LlmGatewaySettings {
  /** The role inherited the Character provider instead of an explicit selection. */
  automatic: boolean
  credential: ResolvedLlmCredential['status']
}

/** The single place that turns LLM config, credentials and account IDs into
 * gateway settings. Credentials are read from the Main-owned store only. */
/** Ordered fallbacks of a role. Only the Character role has configured fallbacks. */
export function resolveLlmRoleFallbacks(
  role: LlmRoleId,
  sources: LlmRoleSources,
): ResolvedLlmRoleSettings[] {
  if (role !== 'character') return []
  const config = sources.config()
  const accountIdFor = sources.accountId ?? resolveLlmProviderAccountId
  const primary = config.activeProvider
  return config.roles.characterFallbacks
    .filter(
      (candidate) =>
        candidate.providerId !== primary ||
        candidate.model !== config.providers[primary].model.trim(),
    )
    .map((candidate) => {
      const credential = sources.credential(candidate.providerId)
      return {
        provider: candidate.providerId,
        apiKey: credential.apiKey,
        model: candidate.model,
        accountId: accountIdFor(
          candidate.providerId,
          config.providers[candidate.providerId].accountId,
        ),
        automatic: false,
        credential: credential.status,
      }
    })
}

export function resolveLlmRoleSettings(
  role: LlmRoleId,
  sources: LlmRoleSources,
  selection: LlmRoleSelection = {},
): ResolvedLlmRoleSettings {
  const config = sources.config()
  const accountIdFor = sources.accountId ?? resolveLlmProviderAccountId
  const settingsFor = (
    provider: LlmProviderId,
    model: string,
    automatic: boolean,
  ): ResolvedLlmRoleSettings => {
    const credential = sources.credential(provider)
    return {
      provider,
      apiKey: credential.apiKey,
      model,
      accountId: accountIdFor(provider, config.providers[provider].accountId),
      automatic,
      credential: credential.status,
    }
  }
  switch (role) {
    // The session summarizer has no override yet; it shares the Character selection.
    case 'sessionSummarizer':
    case 'character':
      return settingsFor(config.activeProvider, config.providers[config.activeProvider].model, true)
    case 'computerUseVision': {
      const visual = config.roles.computerUseVision
      const automatic = !visual.providerId
      const provider = visual.providerId || config.activeProvider
      return settingsFor(
        provider,
        automatic ? config.providers[provider].model.trim() : visual.model.trim(),
        automatic,
      )
    }
    case 'backlogSelector': {
      const selector = config.roles.backlogSelector
      const automatic = !selector.providerId
      const provider = selector.providerId || config.activeProvider
      return settingsFor(provider, selector.model, automatic)
    }
    case 'fastBrain': {
      const automatic = !selection.providerId
      const provider = selection.providerId || config.activeProvider
      return settingsFor(
        provider,
        selection.model?.trim() || config.providers[provider].model,
        automatic,
      )
    }
  }
}
