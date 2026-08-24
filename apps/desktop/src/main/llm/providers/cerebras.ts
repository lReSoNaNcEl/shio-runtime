import axios from 'axios'

import { ModelFetchError } from '../errors'
import { CerebrasModelsResponseSchema } from '../openai-compatible/schemas'
import type { ProviderDefinition } from '../types'

export const cerebrasProvider: ProviderDefinition = {
  profile: {
    id: 'cerebras',
    displayName: 'Cerebras',
    requiresApiKey: true,
    modelsRequireApiKey: false,
  },
  chat: {
    baseUrl: 'https://api.cerebras.ai',
    path: '/v1/chat/completions',
  },
  fetchModels: async (http) => {
    try {
      const response = await http.get('/public/v1/models')
      const parsed = CerebrasModelsResponseSchema.parse(response.data)
      return parsed.data.map((model) => ({
        id: model.id,
        displayName: model.name,
        capabilities: {
          supportsVision: model.capabilities?.vision,
          supportsReasoning: model.capabilities?.reasoning,
          supportsToolCalling:
            model.capabilities?.tool_calling ?? model.capabilities?.function_calling,
        },
      }))
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          throw new ModelFetchError(
            'invalid_response',
            `Cerebras models error ${error.response.status}`,
          )
        }
        throw new ModelFetchError('network', 'Не удалось загрузить список моделей Cerebras.')
      }
      throw new ModelFetchError('invalid_response', 'Некорректный ответ Cerebras models API.')
    }
  },
}
