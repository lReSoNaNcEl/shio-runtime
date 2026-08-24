import axios from 'axios'

import { ModelFetchError } from '../errors'
import { MistralModelsResponseSchema } from '../openai-compatible/schemas'
import type { ProviderDefinition } from '../types'

const MISTRAL_MODEL_ID_ALIASES: Readonly<Record<string, string>> = {
  'mistral-medium-3.5': 'mistral-medium-3-5',
}

function normalizeMistralModelId(modelId: string): string {
  const normalized = modelId.trim()
  return MISTRAL_MODEL_ID_ALIASES[normalized.toLowerCase()] ?? normalized
}

export const mistralProvider: ProviderDefinition = {
  profile: {
    id: 'mistral',
    displayName: 'Mistral',
    requiresApiKey: true,
    modelsRequireApiKey: true,
  },
  chat: {
    baseUrl: 'https://api.mistral.ai/v1',
    path: '/chat/completions',
  },
  normalizeModelId: normalizeMistralModelId,
  fetchModels: async (http, apiKey) => {
    const key = apiKey.trim()
    if (!key) {
      throw new ModelFetchError('auth', 'Введите API ключ для загрузки списка моделей.')
    }
    try {
      const response = await http.get('/models', {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      })
      const parsed = MistralModelsResponseSchema.parse(response.data)
      return parsed.data.map((model) => ({
        id: model.id,
        displayName: model.name,
        capabilities: {
          supportsVision:
            model.capabilities?.vision ??
            model.architecture?.input_modalities?.includes('image') ??
            model.architecture?.modality?.toLowerCase().includes('image'),
          supportsReasoning: model.capabilities?.reasoning,
          supportsToolCalling:
            model.capabilities?.tool_calling ?? model.capabilities?.function_calling,
        },
      }))
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401 || error.response?.status === 403) {
          throw new ModelFetchError('auth', 'Mistral: недействительный API ключ.')
        }
        if (error.response) {
          throw new ModelFetchError(
            'invalid_response',
            `Mistral models error ${error.response.status}`,
          )
        }
        throw new ModelFetchError('network', 'Не удалось загрузить список моделей Mistral.')
      }
      throw new ModelFetchError('invalid_response', 'Некорректный ответ Mistral models API.')
    }
  },
}
