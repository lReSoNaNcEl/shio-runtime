import axios from 'axios'

import { GithubModelsResponseSchema } from '../../../schemas'
import { ModelFetchError } from '../../errors/index'
import type { ModelInfo } from '../catalogTypes'
import { BaseOpenAIProvider } from './BaseOpenAIProvider'

export class GithubModelsProvider extends BaseOpenAIProvider {
  constructor(apiKey: string, model: string) {
    super(apiKey, model, {
      providerId: 'github',
      baseURL: 'https://models.github.ai',
      chatPath: '/inference/chat/completions',
    })
  }

  async fetchModels(apiKey: string): Promise<ModelInfo[]> {
    const key = apiKey.trim()
    if (!key) {
      throw new ModelFetchError('auth', 'Введите API ключ для загрузки списка моделей.')
    }
    try {
      const res = await this.http.get('/catalog/models', {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/vnd.github+json' },
      })
      const parsed = GithubModelsResponseSchema.parse(res.data)
      return parsed.map((m) => ({ id: m.id, displayName: m.name }))
    } catch (e) {
      if (axios.isAxiosError(e)) {
        if (e.response?.status === 401 || e.response?.status === 403) {
          throw new ModelFetchError('auth', 'GitHub Models: аутентификация не пройдена.')
        }
        if (e.response) {
          throw new ModelFetchError('invalid_response', `GitHub Models error ${e.response.status}`)
        }
        throw new ModelFetchError('network', 'Не удалось загрузить каталог GitHub Models.')
      }
      throw new ModelFetchError('invalid_response', 'Некорректный ответ GitHub Models catalog API.')
    }
  }
}
