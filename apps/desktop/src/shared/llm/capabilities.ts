export interface LlmCapabilities {
  supportsReasoning: boolean
  supportsStreaming: boolean
  supportsTemperature: boolean
  supportsSystemPrompt: boolean
  supportsToolCalling: boolean
  supportsVision: boolean
  recommendedMaxTokens: number
}
