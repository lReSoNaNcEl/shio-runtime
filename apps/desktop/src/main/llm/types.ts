import type { AxiosInstance } from 'axios'

import type { CharacterStreamDeadlines, CharacterStreamEvent } from '../../shared/character-stream'
import type { TurnToolEvidenceSummary } from '../../shared/character-tools'
import type { AssistantTurnKind } from '../../shared/conversation'
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
  /** Main-owned metadata used only to ground later conversational claims about prior tool use. */
  toolEvidence?: TurnToolEvidenceSummary
  /** Main-owned presentation origin; Runtime fallbacks are not semantic Character evidence. */
  assistantTurnKind?: AssistantTurnKind
}

export interface LlmRequestOptions {
  signal?: AbortSignal
  traceId?: string
  maxTokens?: number
  timeoutMs?: number
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
  toolChoice?: 'auto' | 'none' | 'required'
}

export interface LlmStreamOptions extends LlmCompletionOptions {
  deadlines?: Partial<CharacterStreamDeadlines>
}

export interface LLMProvider {
  chat(messages: readonly ChatMessage[], options?: LlmRequestOptions): Promise<string>
  complete?(
    messages: readonly ChatMessage[],
    options?: LlmCompletionOptions,
  ): Promise<LlmCompletion>
  stream?(
    messages: readonly ChatMessage[],
    options?: LlmStreamOptions,
  ): AsyncIterable<CharacterStreamEvent>
  capabilities?(): LlmCapabilities
}

export interface ModelCatalogEntry {
  id: string
  displayName?: string
  capabilities?: {
    supportsImageGeneration?: boolean
    supportsVision?: boolean
    supportsReasoning?: boolean
    supportsStreaming?: boolean
    supportsToolCalling?: boolean
  }
}

export interface ModelCatalogProvider {
  fetchModels(apiKey: string): Promise<ModelCatalogEntry[]>
}

export interface ProviderConnectionSettings {
  accountId?: string
}

export interface ProviderDefinition {
  profile: ProviderProfile
  chat: {
    baseUrl: string
    supportsStreaming: boolean
    headers?: Record<string, string>
    singleLeadingSystemMessage?: boolean
    resolveBaseUrl?(connection: ProviderConnectionSettings): string
  }
  normalizeAccountId?(accountId: string): string
  normalizeModelId?(modelId: string): string
  fetchModels(
    http: AxiosInstance,
    apiKey: string,
    connection?: ProviderConnectionSettings,
  ): Promise<ModelCatalogEntry[]>
  resolveCapabilities?(modelId: string, base: LlmCapabilities): LlmCapabilities
}

export interface LlmGatewaySettings {
  provider: LlmProviderId
  apiKey: string
  model: string
  accountId?: string
}
