export type {
  BacklogSelectorRoleConfig,
  LlmConfig,
  LlmProviderId,
  ModelFetchErrorKind,
  ModelInfo,
  ProviderCredentials,
  ProviderProfile,
} from '../../shared/llmProviders'
export { LLM_PROVIDER_IDS } from '../../shared/llmProviders'
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
  getProviderProfile,
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
  ModelCatalogProvider,
} from './types'
