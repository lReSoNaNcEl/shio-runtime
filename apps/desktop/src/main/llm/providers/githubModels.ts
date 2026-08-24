import axios from 'axios'

import { ModelFetchError } from '../errors'
import { GithubModelsResponseSchema } from '../openai-compatible/schemas'
import type { ProviderDefinition } from '../types'

export const githubModelsProvider: ProviderDefinition = {
  profile: {
    id: 'github',
    displayName: 'GitHub Models',
    requiresApiKey: true,
    modelsRequireApiKey: true,
  },
  chat: {
    baseUrl: 'https://models.github.ai',
    path: '/inference/chat/completions',
  },
  fetchModels: async (http, apiKey) => {
    const key = apiKey.trim()
    if (!key) {
      throw new ModelFetchError('auth', 'Введите API ключ для загрузки списка моделей.')
    }
    try {
      const response = await http.get('/catalog/models', {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/vnd.github+json' },
      })
      const parsed = GithubModelsResponseSchema.parse(response.data)
      return parsed.map((model) => ({
        id: model.id,
        displayName: model.name,
        capabilities: {
          supportsVision: model.supported_input_modalities?.includes('image'),
          supportsReasoning:
            model.capabilities?.includes('reasoning') || model.tags?.includes('reasoning'),
          supportsToolCalling:
            model.capabilities?.some((capability) =>
              ['tools', 'tool-calling', 'function-calling'].includes(capability.toLowerCase()),
            ) ||
            model.tags?.some((tag) =>
              ['tools', 'tool-calling', 'function-calling'].includes(tag.toLowerCase()),
            ),
        },
      }))
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new ModelFetchError('auth', 'GitHub Models: аутентификация не пройдена.')
        }
        if (error.response?.status === 403) {
          throw new ModelFetchError(
            'access',
            'GitHub Models: доступ запрещён политикой провайдера или правами аккаунта.',
          )
        }
        if (error.response) {
          throw new ModelFetchError(
            'invalid_response',
            `GitHub Models error ${error.response.status}`,
          )
        }
        throw new ModelFetchError('network', 'Не удалось загрузить каталог GitHub Models.')
      }
      throw new ModelFetchError('invalid_response', 'Некорректный ответ GitHub Models catalog API.')
    }
  },
}
