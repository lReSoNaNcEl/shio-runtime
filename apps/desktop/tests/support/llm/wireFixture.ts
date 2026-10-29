import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

import {
  type ChatRunConfig,
  runChatCompletion as chat,
  runChatCompletionDetailed as complete,
} from '../../../src/main/llm/openai-compatible/request'
import { runChatCompletionStream as stream } from '../../../src/main/llm/openai-compatible/stream'
import type {
  LlmCompletionOptions,
  LlmRequestOptions,
  LlmStreamOptions,
} from '../../../src/main/llm/types'

/** Legacy canned wire fixtures feed the real AI SDK parser; never shipped. */
export interface WireClient {
  chat: {
    completions: {
      create(body: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>
    }
  }
}
export class WireHttpError extends Error {
  constructor(
    readonly status: number,
    readonly error: unknown,
  ) {
    super('fixture HTTP error')
  }
  static generate(status: number, error: unknown, _message: string, _headers: Headers) {
    return new WireHttpError(status, error)
  }
}
export class WireAbortError extends Error {
  constructor() {
    super('aborted')
    this.name = 'AbortError'
  }
}

export function wireModel(client: WireClient, model = 'fixture'): LanguageModel {
  return createOpenAICompatible({
    name: 'fixture',
    baseURL: 'https://fixture.invalid/v1',
    transformRequestBody: (body) => ({
      ...body,
      ...(body.tools ? { parallel_tool_calls: false } : {}),
    }),
    fetch: async (_input, init) => {
      let raw: unknown
      try {
        raw = await client.chat.completions.create(JSON.parse(String(init?.body)), {
          signal: init?.signal ?? undefined,
        })
      } catch (error) {
        if (error && typeof error === 'object' && 'status' in error)
          return new Response(JSON.stringify('error' in error ? error.error : {}), {
            status: Number(error.status),
            headers: { 'Content-Type': 'application/json' },
          })
        throw error
      }
      if (raw && typeof raw === 'object' && Symbol.asyncIterator in raw) {
        const sequence = raw as AsyncIterable<unknown> & { controller?: AbortController }
        const iterator = sequence[Symbol.asyncIterator]()
        const abort = () => {
          sequence.controller?.abort()
          void iterator.return?.().catch(() => undefined)
        }
        init?.signal?.addEventListener('abort', abort, { once: true })
        return new Response(
          new ReadableStream({
            async pull(controller) {
              const next = await iterator.next()
              if (next.done) {
                init?.signal?.removeEventListener('abort', abort)
                controller.close()
              } else
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify(next.value)}\n\n`),
                )
            },
            cancel: abort,
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        )
      }
      return new Response(JSON.stringify(raw), { headers: { 'Content-Type': 'application/json' } })
    },
  }).chatModel(model)
}

const config = (value: Omit<ChatRunConfig, 'client'> & { client: unknown }): ChatRunConfig => ({
  ...value,
  client:
    value.client && typeof value.client === 'object' && 'chat' in value.client
      ? wireModel(value.client as WireClient, value.model)
      : (value.client as LanguageModel),
})
export const runChatCompletion = (
  value: Parameters<typeof config>[0],
  options?: LlmRequestOptions,
) => chat(config(value), options)
export const runChatCompletionDetailed = (
  value: Parameters<typeof config>[0],
  options?: LlmCompletionOptions,
) => complete(config(value), options)
export const runChatCompletionStream = (
  value: Parameters<typeof config>[0],
  options?: LlmStreamOptions,
) => stream(config(value), options)
export const parseChatCompletion = (
  provider: ChatRunConfig['provider'],
  displayName: string,
  raw: unknown,
) =>
  complete(
    {
      provider,
      displayName,
      client: wireModel({ chat: { completions: { create: async () => raw } } }),
      model: 'fixture',
      capabilities: {
        supportsReasoning: true,
        supportsStreaming: true,
        supportsSystemPrompt: true,
        supportsTemperature: true,
        supportsVision: false,
        supportsToolCalling: true,
        recommendedMaxTokens: 100,
      },
      messages: [{ role: 'user', content: 'fixture' }],
    },
    {
      tools: [
        {
          name: 'memory_list',
          description: 'List',
          parameters: { type: 'object', properties: {} },
        },
      ],
    },
  )
