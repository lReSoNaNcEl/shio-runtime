export type {
  BacklogSelectorRoleConfig,
  LlmCredentialStatus,
  LlmPersistedConfig,
  LlmProviderId,
  LlmProviderPersistedSettings,
  LlmProviderPublicSettings,
  LlmPublicConfig,
  ModelFetchErrorKind,
  ModelInfo,
  ProviderProfile,
} from '../../shared/llm'
export { LLM_PROVIDER_IDS } from '../../shared/llm'
export { defaultLlmConfig, normalizeLlmConfig } from './config'
export {
  classifyHttpFailure,
  LlmCapabilityError,
  LlmResponseError,
  LlmTurnCancelledError,
  ModelFetchError,
  normalizeHttpErrorMessage,
} from './errors'
export {
  type LlmCredentialMap,
  type LlmCredentialProtector,
  LlmCredentialStore,
  type ResolvedLlmCredential,
} from './LlmCredentialStore'
export { LlmGateway } from './LlmGateway'
export {
  createLLMProvider,
  createModelCatalog,
  enrichModelCatalog,
  getProviderProfile,
  hasLoadedModelCatalog,
  isLlmProviderId,
  PROVIDER_PROFILES,
  resolveModelCapabilities,
} from './registry'
export type {
  ChatMessage,
  LLMProvider,
  LlmCapabilities,
  LlmContentPart,
  LlmImageContentPart,
  LlmMessageContent,
  LlmRequestOptions,
  LlmTextContentPart,
  ModelCatalogEntry,
  ModelCatalogProvider,
} from './types'
