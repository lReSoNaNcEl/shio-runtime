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
export {
  defaultLlmConfig,
  normalizeLlmConfig,
  resolveLlmProviderAccountId,
} from './config'
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
export { resolveLlmReadiness } from './readiness'
export {
  createLLMProvider,
  createModelCatalog,
  enrichModelCatalog,
  getProviderDefinition,
  getProviderProfile,
  hasLoadedModelCatalog,
  isLlmProviderId,
  normalizeProviderAccountId,
  PROVIDER_PROFILES,
  resolveModelCapabilities,
  resolveProviderChatBaseUrl,
} from './registry'
export type {
  ChatMessage,
  LLMProvider,
  LlmCapabilities,
  LlmCompletion,
  LlmCompletionOptions,
  LlmContentPart,
  LlmImageContentPart,
  LlmMessageContent,
  LlmRequestOptions,
  LlmStreamOptions,
  LlmTextContentPart,
  LlmToolCall,
  LlmToolDefinition,
  ModelCatalogEntry,
  ModelCatalogProvider,
  ProviderConnectionSettings,
} from './types'
