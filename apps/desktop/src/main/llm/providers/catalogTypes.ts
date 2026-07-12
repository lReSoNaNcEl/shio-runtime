import type { ModelInfo } from '../../../shared/llmProviders'

export type { ModelInfo }

/**
 * Capability implemented by providers that can list their available models.
 * Kept separate from `LLMProvider` because it is a Settings/Adapter concern,
 * not something the Runtime ever calls.
 */
export interface ModelCatalogProvider {
  fetchModels(apiKey: string): Promise<ModelInfo[]>
}
