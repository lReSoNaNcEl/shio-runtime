import axios, { type AxiosInstance } from 'axios'
import { describe, expect, it, vi } from 'vitest'

import { createAiSdkAdapter, createModelCatalogClient } from '../../src/main/llm/AiSdkAdapter'
import { normalizeLlmConfig } from '../../src/main/llm/config'
import {
  getProviderDefinition,
  getProviderProfile,
  resolveModelCapabilities,
} from '../../src/main/llm/registry'

const definition = getProviderDefinition('ollama')
const model = 'gemma4:e4b'

describe('Ollama provider', () => {
  it('adds the local model to existing settings without replacing the active provider', () => {
    const config = normalizeLlmConfig({
      activeProvider: 'openrouter',
      providers: { openrouter: { model: 'example/model' } },
    })
    expect(config.activeProvider).toBe('openrouter')
    expect(config.providers.openrouter.model).toBe('example/model')
    expect(config.providers.ollama.model).toBe(model)
    expect(getProviderProfile('ollama').requiresApiKey).toBe(false)
    expect(resolveModelCapabilities('ollama', model)).toMatchObject({
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsVision: true,
      supportsSchemaOutput: true,
    })
    expect(resolveModelCapabilities('ollama', 'gemma4:12b').supportsToolCalling).toBe(true)
    expect(resolveModelCapabilities('ollama', 'unknown').supportsToolCalling).toBe(false)
  })

  it('lists installed models, excludes remote entries and distinguishes invalid data from downtime', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        data: { models: [{ model }, { model: 'remote', remote_host: 'https://ollama.com' }] },
      })
      .mockResolvedValueOnce({ data: { models: [] } })
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(new axios.AxiosError('connection refused', 'ECONNREFUSED'))
    const catalog = createModelCatalogClient({
      definition,
      http: { get } as unknown as AxiosInstance,
    })

    await expect(catalog.fetchModels('')).resolves.toEqual([{ id: model }])
    expect(get).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags')
    await expect(catalog.fetchModels('')).resolves.toEqual([])
    await expect(catalog.fetchModels('')).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(catalog.fetchModels('')).rejects.toMatchObject({ kind: 'network' })
  })

  it('uses the local chat endpoint with JSON schema and without credentials', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        choices: [
          { message: { role: 'assistant', content: '{"answer":"OK"}' }, finish_reason: 'stop' },
        ],
      }),
    )
    const adapter = createAiSdkAdapter({ definition, model, apiKey: 'unused', fetch })
    const schema = {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    }
    await expect(
      adapter.complete([{ role: 'user', content: 'Return OK.' }], {
        responseSchema: { name: 'answer', schema },
      }),
    ).resolves.toMatchObject({ content: '{"answer":"OK"}', finishReason: 'stop' })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, request] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions')
    expect(new Headers(request?.headers).has('Authorization')).toBe(false)
    expect(JSON.parse(String(request?.body))).toMatchObject({
      model,
      reasoning_effort: 'none',
      response_format: { type: 'json_schema', json_schema: { name: 'answer', schema } },
    })
  })
})
