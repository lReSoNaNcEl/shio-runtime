import axios from 'axios'

import { CerebrasModelsResponseSchema } from '../../../schemas'
import { ModelFetchError } from '../../errors'
import type { ModelInfo } from '../catalogTypes'
import { BaseOpenAIProvider } from './BaseOpenAIProvider'

export class CerebrasProvider extends BaseOpenAIProvider {
  constructor(apiKey: string, model: string) {
    super(apiKey, model, {
      providerId: 'cerebras',
      baseURL: 'https://api.cerebras.ai',
      chatPath: '/v1/chat/completions',
    })
  }

  async fetchModels(): Promise<ModelInfo[]> {
    try {
      const res = await this.http.get('/public/v1/models')
      const parsed = CerebrasModelsResponseSchema.parse(res.data)
      return parsed.data.map((m) => ({ id: m.id }))
    } catch (e) {
      if (axios.isAxiosError(e)) {
        if (e.response) {
          throw new ModelFetchError(
            'invalid_response',
            `Cerebras models error ${e.response.status}`,
          )
        }
        throw new ModelFetchError('network', 'Не удалось загрузить список моделей Cerebras.')
      }
      throw new ModelFetchError('invalid_response', 'Некорректный ответ Cerebras models API.')
    }
  }
}
