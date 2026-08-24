import type { LlmPublicConfig, LlmReadiness } from '../../shared/llm'
import { PROVIDER_PROFILES } from './registry'

export function resolveLlmReadiness(config: LlmPublicConfig): LlmReadiness {
  const provider = PROVIDER_PROFILES.find((item) => item.id === config.activeProvider)
  const credentialReady =
    provider?.requiresApiKey === false ||
    config.providers[config.activeProvider].credential.configured
  const accountReady =
    provider?.requiresAccountId !== true ||
    Boolean(config.providers[config.activeProvider].accountId?.trim())
  return {
    reason: !accountReady
      ? 'missing-account-id'
      : credentialReady
        ? config.providers[config.activeProvider].model.trim()
          ? 'ready'
          : 'model-missing'
        : 'missing-credential',
    providerId: config.activeProvider,
    providerDisplayName: provider?.displayName ?? config.activeProvider,
  }
}
