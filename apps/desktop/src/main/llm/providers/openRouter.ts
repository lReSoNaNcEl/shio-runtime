import axios from 'axios'

import { ModelFetchError } from '../errors'
import { type OpenRouterModel, OpenRouterModelsResponseSchema } from '../openai-compatible/schemas'
import type { ProviderDefinition } from '../types'

function isFreeModel(model: OpenRouterModel): boolean {
  const promptPrice = Number(model.pricing?.prompt ?? Number.NaN)
  const completionPrice = Number(model.pricing?.completion ?? Number.NaN)
  return (
    model.id.includes(':free') ||
    (model.name?.toLowerCase().includes('free') ?? false) ||
    (promptPrice === 0 && completionPrice === 0)
  )
}

export const openRouterProvider: ProviderDefinition = {
  profile: {
    id: 'openrouter',
    displayName: 'OpenRouter',
    requiresApiKey: true,
    modelsRequireApiKey: false,
  },
  chat: {
    baseUrl: 'https://openrouter.ai/api/v1',
    supportsStreaming: true,
    headers: { 'HTTP-Referer': 'Shio Runtime', 'X-Title': 'Shio Runtime' },
  },
  fetchModels: async (http) => {
    try {
      const response = await http.get('/models')
      const parsed = OpenRouterModelsResponseSchema.parse(response.data)
      return parsed.data.filter(isFreeModel).map((model) => ({
        id: model.id,
        displayName: model.name,
        capabilities: {
          supportsVision: model.architecture?.input_modalities?.includes('image'),
          supportsReasoning:
            model.supported_parameters?.includes('reasoning') ||
            model.supported_parameters?.includes('include_reasoning'),
          supportsToolCalling: model.supported_parameters?.includes('tools'),
        },
      }))
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new ModelFetchError('auth', 'OpenRouter: недействительный API ключ.')
        }
        if (error.response?.status === 403) {
          throw new ModelFetchError(
            'access',
            'OpenRouter: доступ запрещён политикой провайдера или ограничениями аккаунта/региона.',
          )
        }
        if (error.response) {
          throw new ModelFetchError(
            'invalid_response',
            `OpenRouter models error ${error.response.status}`,
          )
        }
        throw new ModelFetchError('network', 'Не удалось загрузить список моделей OpenRouter.')
      }
      throw new ModelFetchError('invalid_response', 'Некорректный ответ OpenRouter models API.')
    }
  },
}
