import axios from 'axios'
import { OpenRouterModelsResponseSchema, type OpenRouterModel } from '../../../schemas'
import { ModelFetchError } from '../../errors/index'
import type { ModelInfo } from '../catalogTypes'
import { BaseOpenAIProvider } from './BaseOpenAIProvider'

function isFreeModel(model: OpenRouterModel): boolean {
  const promptPrice = Number(model.pricing?.prompt ?? NaN)
  const completionPrice = Number(model.pricing?.completion ?? NaN)
  return (
    model.id.includes(':free') ||
    (model.name?.toLowerCase().includes('free') ?? false) ||
    (promptPrice === 0 && completionPrice === 0)
  )
}

export class OpenRouterProvider extends BaseOpenAIProvider {
  constructor(apiKey: string, model: string) {
    super(apiKey, model, {
      providerId: 'openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      chatPath: '/chat/completions',
      chatHeaders: { 'HTTP-Referer': 'Shio Runtime', 'X-Title': 'Shio Runtime' }
    })
  }

  async fetchModels(): Promise<ModelInfo[]> {
    try {
      const res = await this.http.get('/models')
      const parsed = OpenRouterModelsResponseSchema.parse(res.data)
      return parsed.data.filter(isFreeModel).map((m) => ({ id: m.id, displayName: m.name }))
    } catch (e) {
      if (axios.isAxiosError(e)) {
        if (e.response?.status === 401 || e.response?.status === 403) {
          throw new ModelFetchError('auth', 'OpenRouter: недействительный API ключ.')
        }
        if (e.response) {
          throw new ModelFetchError('invalid_response', `OpenRouter models error ${e.response.status}`)
        }
        throw new ModelFetchError('network', 'Не удалось загрузить список моделей OpenRouter.')
      }
      throw new ModelFetchError('invalid_response', 'Некорректный ответ OpenRouter models API.')
    }
  }
}
