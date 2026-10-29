import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

import type { LlmResponseError } from '../../../src/main/llm'
import {
  runChatCompletion,
  runChatCompletionDetailed,
} from '../../../src/main/llm/openai-compatible/request'
import { runChatCompletionStream } from '../../../src/main/llm/openai-compatible/stream'
import type { LlmStreamOptions } from '../../../src/main/llm/types'
import type { CharacterStreamEvent } from '../../../src/shared/character-stream'

const capabilities = {
  supportsReasoning: false,
  supportsStreaming: true,
  supportsTemperature: true,
  supportsSystemPrompt: true,
  supportsToolCalling: true,
  supportsVision: false,
  recommendedMaxTokens: 256,
}

function config(client: LanguageModel) {
  return {
    provider: 'groq' as const,
    displayName: 'Groq',
    client,
    model: 'test-model',
    capabilities,
    messages: [{ role: 'user' as const, content: 'hello' }],
    tools: [
      {
        name: 'memory_list',
        description: 'List',
        parameters: { type: 'object', properties: { limit: { type: 'number' } } },
      },
      {
        name: 'web_search',
        description: 'Search',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
      },
    ],
  }
}

function sdk(fetchImpl: typeof fetch): LanguageModel {
  return createOpenAICompatible({
    name: 'fixture',
    apiKey: 'sdk-test-key',
    baseURL: 'https://provider.example/v1',
    fetch: fetchImpl,
  }).chatModel('test-model')
}

async function collect(
  client: LanguageModel,
  options?: LlmStreamOptions,
): Promise<CharacterStreamEvent[]> {
  const events: CharacterStreamEvent[] = []
  for await (const event of runChatCompletionStream(config(client), options)) events.push(event)
  return events
}

function sse(...values: unknown[]): Response {
  return new Response(`${values.map((value) => `data: ${JSON.stringify(value)}\n\n`).join('')}`, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('official Vercel AI SDK transport', () => {
  it('sends a strict response schema and rejects prose instead of a planning object', async () => {
    let request: Record<string, unknown> = {}
    let content = '{"decision":"direct"}'
    const client = createOpenAICompatible({
      name: 'fixture',
      baseURL: 'https://fixture.invalid/v1',
      supportsStructuredOutputs: true,
      fetch: async (_input, init) => {
        request = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      },
    }).chatModel('fixture-model')
    const responseSchema = {
      name: 'planning',
      schema: {
        type: 'object',
        properties: { decision: { type: 'string' } },
        required: ['decision'],
        additionalProperties: false,
      },
    }
    const run = () =>
      runChatCompletionDetailed({ ...config(client), tools: [] }, { responseSchema })
    expect((await run()).content).toBe(content)
    expect(request.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'planning', schema: responseSchema.schema },
    })
    expect(request.tools).toBeUndefined()
    content = 'Let me continue the story.'
    await expect(run()).rejects.toMatchObject({ code: 'PROVIDER_REJECTED' })
  })
  it('distinguishes a model that omits a required tool from a transport rejection', async () => {
    const client = sdk(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'A plain answer instead of the required tool.',
                },
                finish_reason: 'stop',
              },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    )
    await expect(
      runChatCompletion({ ...config(client), toolChoice: 'required' }),
    ).rejects.toMatchObject({ code: 'INCOMPLETE_TOOL_CALL', recoverable: false })
  })

  it('delivers no text after cancellation at the first-byte boundary', async () => {
    const controller = new AbortController()
    const client = sdk(async () =>
      sse(
        { choices: [{ delta: { content: 'must-not-leak' }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ),
    )
    const delivered: string[] = []
    await expect(async () => {
      for await (const event of runChatCompletionStream(config(client), {
        signal: controller.signal,
      })) {
        if (event.type === 'first-byte') controller.abort()
        if (event.type === 'text-delta') delivered.push(event.text)
      }
    }).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(delivered).toEqual([])
  })
  it('uses Chat Completions with maxRetries=0 and Shio HTTP normalization', async () => {
    let attempts = 0
    let requestedPath = ''
    const client = sdk(async (input) => {
      attempts += 1
      requestedPath = new URL(input instanceof Request ? input.url : String(input)).pathname
      return new Response(JSON.stringify({ error: { message: 'provider detail' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    await expect(runChatCompletion(config(client))).rejects.toMatchObject({
      code: 'PROVIDER_REJECTED',
      recoverable: true,
    } satisfies Partial<LlmResponseError>)
    expect(attempts).toBe(1)
    expect(requestedPath).toBe('/v1/chat/completions')
  })

  it('completes an SSE stream that closes without a DONE sentinel', async () => {
    const payload = [
      'data: {"choices":[{"delta":{"content":"[warm]Готово "},"finish_reason":null}]}',
      '',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"memory_list","arguments":"{\\"limit\\":"}}]},"finish_reason":null}]}',
      '',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"8}"}}]},"finish_reason":"tool_calls"}],"usage":{"total_tokens":12}}',
      '',
      '',
    ].join('\n')
    const client = sdk(
      async () => new Response(payload, { headers: { 'Content-Type': 'text/event-stream' } }),
    )
    const events: CharacterStreamEvent[] = []
    for await (const event of runChatCompletionStream(config(client))) events.push(event)

    expect(events.find((event) => event.type === 'text-delta')).toMatchObject({
      text: '[warm]Готово ',
    })
    expect(events.find((event) => event.type === 'tool-call-complete')).toMatchObject({
      call: { id: 'call-1', name: 'memory_list', argumentsJson: '{"limit":8}' },
    })
    expect(events.at(-1)).toMatchObject({ type: 'completed', finishReason: 'tool_calls' })
  })

  it('preserves multiple text deltas, usage, and length finish state', async () => {
    const client = sdk(async () =>
      sse(
        { choices: [{ delta: { content: 'one ' }, finish_reason: null }] },
        { choices: [{ delta: { content: 'two' }, finish_reason: null }] },
        {
          choices: [{ delta: {}, finish_reason: 'length' }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        },
      ),
    )
    const events = await collect(client)
    expect(
      events
        .filter((event) => event.type === 'text-delta')
        .map((event) => event.text)
        .join(''),
    ).toBe('one two')
    expect(events.find((event) => event.type === 'usage')).toMatchObject({
      usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
    })
    expect(events.at(-1)).toMatchObject({ type: 'completed', finishReason: 'length' })
  })

  it('cancels provider work when the stream consumer exits early', async () => {
    let cancelled = false
    const client = sdk(
      async (_input, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                'abort',
                () => {
                  cancelled = true
                  controller.close()
                },
                { once: true },
              )
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"choices":[{"delta":{"content":"one"},"finish_reason":null}]}\n\n',
                ),
              )
            },
            cancel() {
              cancelled = true
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
    )
    const stream = runChatCompletionStream(config(client))
    expect((await stream.next()).value).toMatchObject({ type: 'connected' })
    expect((await stream.next()).value).toMatchObject({ type: 'first-byte' })
    await stream.return(undefined)

    expect(cancelled).toBe(true)
  })

  it('assembles multiple fragmented tool calls in index order', async () => {
    const client = sdk(async () =>
      sse(
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-a',
                    function: { name: 'memory_list', arguments: '{"limit":' },
                  },
                  {
                    index: 1,
                    id: 'call-b',
                    function: { name: 'web_search', arguments: '{"query":"' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call-a', function: { arguments: '8}' } },
                  { index: 1, function: { arguments: 'now"}' } },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
      ),
    )
    const calls = (await collect(client))
      .filter((event) => event.type === 'tool-call-complete')
      .map((event) => event.call)
    expect(calls).toEqual([
      { id: 'call-a', name: 'memory_list', argumentsJson: '{"limit":8}' },
      { id: 'call-b', name: 'web_search', argumentsJson: '{"query":"now"}' },
    ])
  })

  it('contains malformed SDK SSE as a provider rejection', async () => {
    const client = sdk(
      async () =>
        new Response('data: {not-json}\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    )
    await expect(async () => {
      for await (const _event of runChatCompletionStream(config(client))) {
        // Consume the SDK stream so malformed SSE reaches Shio normalization.
      }
    }).rejects.toMatchObject({ code: 'PROVIDER_REJECTED', recoverable: false })
  })

  it.each([
    ['empty protocol stream', [{ choices: [{ delta: {}, finish_reason: null }] }], 'EMPTY_STREAM'],
    ['unknown-only stream', [{ unexpected: true }], 'INVALID_STREAM_CHUNK'],
    [
      'incomplete tool call',
      [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-incomplete',
                    function: { name: 'web_search', arguments: '{' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
      ],
      'INCOMPLETE_TOOL_CALL',
    ],
  ] as const)('rejects %s with a typed protocol code', async (_label, chunks, code) => {
    const client = sdk(async () => sse(...chunks))
    await expect(collect(client)).rejects.toMatchObject({ code, recoverable: false })
  })

  it('rejects an unsupported wire chunk even when valid content follows', async () => {
    const client = sdk(async () =>
      sse(
        { provider_bookkeeping: true },
        { choices: [{ delta: { content: 'valid' }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ),
    )
    await expect(collect(client)).rejects.toMatchObject({ code: 'INVALID_STREAM_CHUNK' })
  })

  it.each([
    [401, 'AUTH_ERROR'],
    [403, 'ACCESS_DENIED'],
    [429, 'RATE_LIMITED'],
    [500, 'PROVIDER_REJECTED'],
  ] as const)('normalizes streaming HTTP %i without retry', async (status, code) => {
    let attempts = 0
    const client = sdk(async () => {
      attempts += 1
      return new Response(JSON.stringify({ error: { message: 'private detail' } }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    await expect(collect(client)).rejects.toMatchObject({ code })
    expect(attempts).toBe(1)
  })

  it('distinguishes connection, first-byte, idle, total, abort, and disconnect failures', async () => {
    const deadline = (overrides: Partial<NonNullable<LlmStreamOptions['deadlines']>>) => ({
      deadlines: { connectionMs: 10, firstByteMs: 10, idleMs: 10, totalMs: 100, ...overrides },
    })
    const pendingFetch = sdk(
      async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        }),
    )
    await expect(collect(pendingFetch, deadline({ connectionMs: 5 }))).rejects.toMatchObject({
      code: 'TIMEOUT',
    })

    const stalledBody = () =>
      new Response(new ReadableStream({ start: () => undefined }), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    await expect(
      collect(
        sdk(async () => stalledBody()),
        deadline({}),
      ),
    ).rejects.toMatchObject({
      code: 'TIMEOUT',
    })

    const oneThenStall = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"one"},"finish_reason":null}]}\n\n',
              ),
            )
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    await expect(
      collect(
        sdk(async () => oneThenStall()),
        deadline({ idleMs: 5 }),
      ),
    ).rejects.toMatchObject({
      code: 'TIMEOUT',
    })
    await expect(
      collect(
        sdk(async () => oneThenStall()),
        deadline({ idleMs: 100, totalMs: 5 }),
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT' })

    const caller = new AbortController()
    setTimeout(() => caller.abort(), 5)
    await expect(
      collect(
        sdk(async () => stalledBody()),
        { ...deadline({ firstByteMs: 100 }), signal: caller.signal },
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' })

    await expect(
      collect(
        sdk(async () => {
          throw new TypeError('socket disconnected')
        }),
      ),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })
})
