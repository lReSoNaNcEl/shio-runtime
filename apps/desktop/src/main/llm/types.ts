import type { AxiosInstance } from 'axios'

import type { LlmCapabilities, LlmProviderId, ProviderProfile } from '../../shared/llm'

export type { LlmCapabilities } from '../../shared/llm'

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
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: LlmMessageContent
  toolCalls?: readonly LlmToolCall[]
  toolCallId?: string
  name?: string
}

export interface LlmRequestOptions {
  signal?: AbortSignal
  traceId?: string
}

export interface LlmToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface LlmToolCall {
  id: string
  name: string
  argumentsJson: string
}

export type LlmFinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | 'error'
  | 'unknown'

export interface LlmCompletion {
  content: string
  toolCalls: readonly LlmToolCall[]
  finishReason: LlmFinishReason
}

export interface LlmCompletionOptions extends LlmRequestOptions {
  tools?: readonly LlmToolDefinition[]
  toolChoice?: 'auto' | 'none'
}

export interface LLMProvider {
  chat(messages: readonly ChatMessage[], options?: LlmRequestOptions): Promise<string>
  complete?(
    messages: readonly ChatMessage[],
    options?: LlmCompletionOptions,
  ): Promise<LlmCompletion>
  capabilities?(): LlmCapabilities
}

export interface ModelCatalogEntry {
  id: string
  displayName?: string
  capabilities?: {
    supportsVision?: boolean
    supportsReasoning?: boolean
    supportsToolCalling?: boolean
  }
}

export interface ModelCatalogProvider {
  fetchModels(apiKey: string): Promise<ModelCatalogEntry[]>
}

export interface ProviderDefinition {
  profile: ProviderProfile
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
