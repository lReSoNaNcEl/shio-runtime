export interface LlmCapabilities {
  supportsReasoning: boolean
  supportsStreaming: boolean
  supportsTemperature: boolean
  supportsSystemPrompt: boolean
  supportsVision: boolean
  recommendedMaxTokens: number
}
