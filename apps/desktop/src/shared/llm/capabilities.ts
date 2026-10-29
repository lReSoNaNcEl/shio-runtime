export interface LlmCapabilities {
  supportsReasoning: boolean
  /** Whether native tool continuation needs an unavailable reasoning transcript. */
  requiresReasoningReplay?: boolean
  /** Transport supports constrained JSON Schema output for internal planning. */
  supportsSchemaOutput?: boolean
  supportsStreaming: boolean
  supportsTemperature: boolean
  supportsSystemPrompt: boolean
  supportsToolCalling: boolean
  supportsVision: boolean
  recommendedMaxTokens: number
}
