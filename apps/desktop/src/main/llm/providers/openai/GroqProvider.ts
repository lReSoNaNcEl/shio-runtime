import axios from 'axios'
import { GroqModelsResponseSchema } from '../../../schemas'
import { ModelFetchError } from '../../errors/index'
import type { ModelInfo } from '../catalogTypes'
import { BaseOpenAIProvider } from './BaseOpenAIProvider'
import { proxyFromEnv } from './proxy'

const GROQ_FALLBACK_MODELS: ModelInfo[] = [
  { id: 'qwen/qwen3.6-27b', displayName: 'Qwen 3.6 27B' },
  { id: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B Versatile' },
  { id: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B Instant' },
  { id: 'openai/gpt-oss-20b', displayName: 'GPT-OSS 20B' }
]

export class GroqProvider extends BaseOpenAIProvider {
  constructor(apiKey: string, model: string) {
    super(apiKey, model, {
      providerId: 'groq',
      baseURL: 'https://api.groq.com/openai/v1',
      chatPath: '/chat/completions',
      proxy: proxyFromEnv()
    })
  }

  async fetchModels(apiKey: string): Promise<ModelInfo[]> {
    const key = apiKey.trim()
    if (!key) return GROQ_FALLBACK_MODELS
    try {
      const res = await this.http.get('/models', { headers: { Authorization: `Bearer ${key}` } })
      const parsed = GroqModelsResponseSchema.parse(res.data)
      if (parsed.data.length === 0) return GROQ_FALLBACK_MODELS
      return parsed.data.map((m) => ({ id: m.id }))
    } catch (e) {
      if (axios.isAxiosError(e) && (e.response?.status === 401 || e.response?.status === 403)) {
        throw new ModelFetchError('auth', 'Groq: недействительный API ключ.')
      }
      return GROQ_FALLBACK_MODELS
    }
  }
}
