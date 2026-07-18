import axios from 'axios'

import type { ModelInfo } from '../../../shared/llmProviders'
import { GROQ_DEFAULT_MODEL } from '../config'
import { ModelFetchError } from '../errors'
import { GroqModelsResponseSchema } from '../openai-compatible/schemas'
import type { ProviderDefinition } from '../types'

const GROQ_FALLBACK_MODELS: ModelInfo[] = [
  { id: 'qwen/qwen3.6-27b', displayName: 'Qwen 3.6 27B' },
  { id: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B Versatile' },
  { id: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B Instant' },
  { id: 'openai/gpt-oss-20b', displayName: 'GPT-OSS 20B' },
]

export const groqProvider: ProviderDefinition = {
  profile: {
    id: 'groq',
    displayName: 'Groq',
    requiresApiKey: true,
    modelsRequireApiKey: false,
  },
  defaultModel: GROQ_DEFAULT_MODEL,
  chat: {
    baseUrl: 'https://api.groq.com/openai/v1',
    path: '/chat/completions',
    useEnvironmentProxy: true,
  },
  fetchModels: async (http, apiKey) => {
    const key = apiKey.trim()
    if (!key) return GROQ_FALLBACK_MODELS
    try {
      const response = await http.get('/models', {
        headers: { Authorization: `Bearer ${key}` },
      })
      const parsed = GroqModelsResponseSchema.parse(response.data)
      if (parsed.data.length === 0) return GROQ_FALLBACK_MODELS
      return parsed.data.map((model) => ({ id: model.id }))
    } catch (error) {
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 401 || error.response?.status === 403)
      ) {
        throw new ModelFetchError('auth', 'Groq: недействительный API ключ.')
      }
      return GROQ_FALLBACK_MODELS
    }
  },
}
