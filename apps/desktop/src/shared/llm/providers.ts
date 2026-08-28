/**
 * Provider-agnostic LLM types shared between the main process (Adapter /
 * Settings) and the renderer (Settings UI). Single source of truth for the
 * shape of a "provider", a "model", and the persisted LLM configuration -
 * neither side should redefine these.
 */

export const LLM_PROVIDER_IDS = ['groq', 'cloudflare', 'openrouter', 'mistral'] as const

export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number]

export interface ModelCapabilitySummary {
  supportsImageGeneration: boolean
  supportsVision: boolean
  supportsReasoning: boolean
  supportsStreaming: boolean
  supportsToolCalling: boolean
}

export interface ModelInfo {
  id: string
  displayName?: string
  capabilities: ModelCapabilitySummary
}

export interface ProviderProfile {
  id: LlmProviderId
  displayName: string
  /** Whether a chat request needs an API key. */
  requiresApiKey: boolean
  /** Whether listing the model catalog needs an API key (independent of chat). */
  modelsRequireApiKey: boolean
  /** Whether this provider needs an account-scoped identifier in addition to its credential. */
  requiresAccountId?: boolean
  /** Conservative JSON Schema features accepted by this provider's tool endpoint. */
  schemaCapabilities: ProviderSchemaCapabilities
}

export interface ProviderSchemaCapabilities {
  oneOf: boolean
}

export type ModelFetchErrorKind =
  | 'network'
  | 'auth'
  | 'access'
  | 'configuration'
  | 'invalid_response'
  | 'unknown'

export interface FetchModelsResult {
  ok: boolean
  models?: ModelInfo[]
  error?: string
  kind?: ModelFetchErrorKind
}

export type LlmCredentialSource = 'secure_store' | 'environment' | 'none'

export interface LlmCredentialStatus {
  configured: boolean
  source: LlmCredentialSource
  secureStorageAvailable: boolean
  lastError?: string
}

export type LlmReadinessReason =
  | 'ready'
  | 'missing-account-id'
  | 'missing-credential'
  | 'auth-error'
  | 'access-error'
  | 'model-missing'
  | 'network-error'
  | 'checking'

export interface LlmReadiness {
  reason: LlmReadinessReason
  providerId: LlmProviderId
  providerDisplayName: string
}

export interface LlmProviderPersistedSettings {
  model: string
  accountId?: string
}

export interface LlmProviderPublicSettings extends LlmProviderPersistedSettings {
  credential: LlmCredentialStatus
}

export interface BacklogSelectorRoleConfig {
  enabled: boolean
  providerId: LlmProviderId | ''
  model: string
  timeoutMs: number
  minimumConfidence: number
}

export interface ComputerUseVisionRoleConfig {
  /** Empty means: use the active Character provider/model when it supports vision. */
  providerId: LlmProviderId | ''
  model: string
  timeoutMs: number
  maxSteps: number
}

/**
 * Persisted, provider-independent LLM configuration. `activeProvider` selects
 * which entry of `providers` the Runtime uses. Switching provider never
 * overwrites another provider's stored credentials.
 */
export interface LlmPersistedConfig {
  activeProvider: LlmProviderId
  providers: Record<LlmProviderId, LlmProviderPersistedSettings>
  roles: {
    backlogSelector: BacklogSelectorRoleConfig
    computerUseVision: ComputerUseVisionRoleConfig
  }
}

export interface LlmPublicConfig {
  activeProvider: LlmProviderId
  providers: Record<LlmProviderId, LlmProviderPublicSettings>
  roles: {
    backlogSelector: BacklogSelectorRoleConfig
    computerUseVision: ComputerUseVisionRoleConfig
  }
}
