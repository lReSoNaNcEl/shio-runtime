import type { ModelCatalogProvider } from '../providers/catalogTypes'
import {
  type BaseOpenAIProvider,
  CerebrasProvider,
  GithubModelsProvider,
  GroqProvider,
  MistralProvider,
  OpenRouterProvider,
} from '../providers/openai'
import type { LLMProvider } from '../public/chatTypes'
import type { LlmProviderId } from './providerProfiles'

export function instantiateProvider(
  id: LlmProviderId,
  apiKey: string,
  model: string,
): BaseOpenAIProvider {
  switch (id) {
    case 'groq':
      return new GroqProvider(apiKey, model)
    case 'cerebras':
      return new CerebrasProvider(apiKey, model)
    case 'github':
      return new GithubModelsProvider(apiKey, model)
    case 'openrouter':
      return new OpenRouterProvider(apiKey, model)
    case 'mistral':
      return new MistralProvider(apiKey, model)
  }
}

export function createLLMProvider(config: {
  provider: LlmProviderId
  apiKey: string
  model: string
}): LLMProvider {
  return instantiateProvider(config.provider, config.apiKey, config.model)
}

export function createModelCatalog(id: LlmProviderId): ModelCatalogProvider {
  return instantiateProvider(id, '', '')
}
