export type {
  BacklogSelectorRoleConfig,
  LlmConfig,
  LlmProviderId,
  ModelFetchErrorKind,
  ModelInfo,
  ProviderCredentials,
  ProviderProfile,
} from '../../shared/llm/providers'
export { LLM_PROVIDER_IDS } from '../../shared/llm/providers'
export { defaultLlmConfig, normalizeLlmConfig } from './config'
export {
  LlmCapabilityError,
  LlmResponseError,
  ModelFetchError,
  normalizeHttpErrorMessage,
} from './errors'
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
