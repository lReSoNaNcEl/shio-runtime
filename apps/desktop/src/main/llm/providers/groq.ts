import axios from 'axios'

import { GROQ_DEFAULT_MODEL } from '../config'
import { ModelFetchError } from '../errors'
import { GroqModelsResponseSchema } from '../openai-compatible/schemas'
import type { ProviderDefinition } from '../types'

export const groqProvider: ProviderDefinition = {
  profile: {
    id: 'groq',
    displayName: 'Groq',
    requiresApiKey: true,
    modelsRequireApiKey: true,
  },
  defaultModel: GROQ_DEFAULT_MODEL,
  chat: {
    baseUrl: 'https://api.groq.com/openai/v1',
    path: '/chat/completions',
    useEnvironmentProxy: true,
  },
  fetchModels: async (http, apiKey) => {
    const key = apiKey.trim()
    if (!key) {
      throw new ModelFetchError('auth', 'Введите API ключ для загрузки списка моделей Groq.')
    }
    try {
      const response = await http.get('/models', {
        headers: { Authorization: `Bearer ${key}` },
      })
      const parsed = GroqModelsResponseSchema.parse(response.data)
      return parsed.data.map((model) => ({
        id: model.id,
        capabilities: {
          supportsVision:
            model.capabilities?.vision ??
            model.architecture?.input_modalities?.includes('image') ??
            model.architecture?.modality?.toLowerCase().includes('image'),
          supportsReasoning: model.capabilities?.reasoning,
        },
      }))
    } catch (error) {
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 401 || error.response?.status === 403)
      ) {
        throw new ModelFetchError('auth', 'Groq: недействительный API ключ.')
      }
      if (axios.isAxiosError(error)) {
        if (error.response) {
          throw new ModelFetchError(
            'invalid_response',
            `Groq models error ${error.response.status}`,
          )
        }
        throw new ModelFetchError('network', 'Не удалось загрузить список моделей Groq.')
      }
      throw new ModelFetchError('invalid_response', 'Некорректный ответ Groq models API.')
    }
  },
}
