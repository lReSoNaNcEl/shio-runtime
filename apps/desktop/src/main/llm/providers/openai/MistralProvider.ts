import axios from 'axios'
import { MistralModelsResponseSchema } from '../../../schemas'
import { ModelFetchError } from '../../errors'
import type { ModelInfo } from '../catalogTypes'
import { BaseOpenAIProvider } from './BaseOpenAIProvider'

export class MistralProvider extends BaseOpenAIProvider {
  constructor(apiKey: string, model: string) {
    super(apiKey, model, {
      providerId: 'mistral',
      baseURL: 'https://api.mistral.ai/v1',
      chatPath: '/chat/completions'
    })
  }

  async fetchModels(apiKey: string): Promise<ModelInfo[]> {
    const key = apiKey.trim()
    if (!key) {
      throw new ModelFetchError('auth', 'Введите API ключ для загрузки списка моделей.')
    }
    try {
      const res = await this.http.get('/models', {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
      })
      const parsed = MistralModelsResponseSchema.parse(res.data)
      return parsed.data.map((m) => ({ id: m.id, displayName: m.name }))
    } catch (e) {
      if (axios.isAxiosError(e)) {
        if (e.response?.status === 401 || e.response?.status === 403) {
          throw new ModelFetchError('auth', 'Mistral: недействительный API ключ.')
        }
        if (e.response) {
          throw new ModelFetchError('invalid_response', `Mistral models error ${e.response.status}`)
        }
        throw new ModelFetchError('network', 'Не удалось загрузить список моделей Mistral.')
      }
      throw new ModelFetchError('invalid_response', 'Некорректный ответ Mistral models API.')
    }
  }
}
