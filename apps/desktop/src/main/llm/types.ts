import type { AxiosInstance } from 'axios'

import type { LlmCapabilities } from '../../shared/llm/capabilities'
import type { LlmProviderId, ProviderProfile } from '../../shared/llm/providers'

export type { LlmCapabilities } from '../../shared/llm/capabilities'

export interface LlmTextContentPart {
  type: 'text'
  text: string
}

export interface LlmImageContentPart {
  type: 'image'
  mimeType: 'image/jpeg' | 'image/png'
  bytes: Uint8Array
}

export type LlmContentPart = LlmTextContentPart | LlmImageContentPart

export type LlmMessageContent = string | readonly LlmContentPart[]

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: LlmMessageContent
}

export interface LlmRequestOptions {
  signal?: AbortSignal
}

export interface LLMProvider {
  chat(messages: readonly ChatMessage[], options?: LlmRequestOptions): Promise<string>
}

export interface ModelCatalogEntry {
  id: string
  displayName?: string
  capabilities?: {
    supportsVision?: boolean
    supportsReasoning?: boolean
  }
}

export interface ModelCatalogProvider {
  fetchModels(apiKey: string): Promise<ModelCatalogEntry[]>
}

export interface ProviderDefinition {
  profile: ProviderProfile
  defaultModel: string
  chat: {
    baseUrl: string
    path: string
    headers?: Record<string, string>
    useEnvironmentProxy?: boolean
  }
  fetchModels(http: AxiosInstance, apiKey: string): Promise<ModelCatalogEntry[]>
  resolveCapabilities?(modelId: string, base: LlmCapabilities): LlmCapabilities
}

export interface LlmGatewaySettings {
  provider: LlmProviderId
  apiKey: string
  model: string
}
