import axios from 'axios'
import { z } from 'zod'

import { ModelFetchError } from '../errors'
import type { ProviderDefinition } from '../types'

export const OLLAMA_ORIGIN = 'http://127.0.0.1:11434'
export const OLLAMA_DEFAULT_MODEL = 'gemma4:e4b'
const gemma4ChatModels = new Set([
  'gemma4',
  'gemma4:latest',
  'gemma4:e2b',
  OLLAMA_DEFAULT_MODEL,
  'gemma4:12b',
  'gemma4:26b',
  'gemma4:31b',
])

const modelList = z.object({
  models: z.array(
    z.object({
      model: z.string().trim().min(1),
      remote_host: z.string().optional(),
    }),
  ),
})

export function isLocalGemmaModel(model: string): boolean {
  return gemma4ChatModels.has(model)
}

export const ollamaProvider: ProviderDefinition = {
  profile: {
    id: 'ollama',
    displayName: 'Ollama',
    requiresApiKey: false,
    modelsRequireApiKey: false,
    schemaCapabilities: { oneOf: false },
  },
  chat: {
    baseUrl: `${OLLAMA_ORIGIN}/v1`,
    supportsStreaming: true,
    localOnly: true,
    // The first request may wait for Ollama to load the model and initialize its GPU runner.
    requestTimeoutMs: 90_000,
    singleLeadingSystemMessage: true,
    requestOptions: (model) => (gemma4ChatModels.has(model) ? { reasoning_effort: 'none' } : {}),
  },
  resolveCapabilities: (model, base) => ({
    ...base,
    supportsStreaming: true,
    supportsVision: gemma4ChatModels.has(model),
    supportsToolCalling: gemma4ChatModels.has(model),
    supportsSchemaOutput: true,
  }),
  fetchModels: async (http) => {
    try {
      const { data } = await http.get(`${OLLAMA_ORIGIN}/api/tags`)
      return modelList
        .parse(data)
        .models.filter(({ remote_host }) => !remote_host)
        .map(({ model }) => ({ id: model }))
    } catch (error) {
      if (axios.isAxiosError(error) && !error.response && error.code !== 'ERR_BAD_RESPONSE') {
        throw new ModelFetchError('network', 'Ollama is unavailable at 127.0.0.1:11434.')
      }
      throw new ModelFetchError('invalid_response', 'Invalid response from Ollama /api/tags.')
    }
  },
}
