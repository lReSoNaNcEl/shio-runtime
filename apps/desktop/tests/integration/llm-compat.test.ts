/**
 * WI — LLM Provider Compatibility test matrix (offline self-test).
 *
 * Runs ONE logical battery against EVERY provider through the real shared
 * compatibility layer (capabilities, request building, response parsing,
 * finish-reason + error normalization). No network: a fake axios instance
 * feeds canned responses / errors so the tests are deterministic.
 *
 * Verifies per provider: system prompt delivery, greeting/persona pass-through,
 * emotion tag preservation, max-sentence pass-through, Unicode, Russian,
 * English, reasoning + non-reasoning models, and empty-response handling.
 */

import axios, { type AxiosInstance } from 'axios'
import { describe, expect, it, vi } from 'vitest'

import type { ChatMessage, LlmProviderId } from '../../src/main/llm'
import { createAiSdkAdapter, createModelCatalogClient } from '../../src/main/llm/AiSdkAdapter'
import {
  classifyHttpFailure,
  LlmResponseError,
  ModelFetchError,
  normalizeHttpErrorMessage,
} from '../../src/main/llm/errors'
import { prepareMessages } from '../../src/main/llm/openai-compatible/messageCompatibility'
import {
  installLlmProxyResolver,
  proxyFromSystemRules,
  resolveLlmProxy,
} from '../../src/main/llm/openai-compatible/proxy'
import { normalizeFinishReason } from '../../src/main/llm/openai-compatible/response'
import {
  enrichModelCatalog,
  getProviderDefinition,
  getProviderProfile,
  normalizeProviderAccountId,
  resolveModelCapabilities as resolveCapabilities,
  resolveProviderChatBaseUrl,
} from '../../src/main/llm/registry'
import type { WireClient } from '../support/llm/wireFixture'
import {
  WireHttpError as APIError,
  WireAbortError as APIUserAbortError,
  runChatCompletion,
} from '../support/llm/wireFixture'

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`)
  }
}

/** Fake AxiosInstance: `handler` returns response data or an Error to throw. */
function fakeHttp(handler: (path: string, body: Record<string, unknown>) => unknown): {
  http: WireClient
  lastBody: () => Record<string, unknown>
} {
  let captured: Record<string, unknown> = {}
  const http = {
    chat: {
      completions: {
        create: async (body: Record<string, unknown>) => {
          captured = body
          const result = handler('/chat/completions', body)
          if (axios.isAxiosError(result) && result.response) {
            throw APIError.generate(
              result.response.status,
              result.response.data as object,
              result.message,
              new Headers(),
            )
          }
          if (result instanceof Error) throw result
          return result
        },
      },
    },
  } as unknown as WireClient
  return { http, lastBody: () => captured }
}

function hangingHttp(): WireClient {
  return {
    chat: {
      completions: {
        create: async (_body: unknown, options?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            const signal = options?.signal
            const rejectCancelled = (): void => reject(new APIUserAbortError())
            if (signal?.aborted) rejectCancelled()
            else signal?.addEventListener('abort', rejectCancelled, { once: true })
          }),
      },
    },
  } as unknown as WireClient
}

function axiosErr(status: number, data?: unknown): Error {
  return new axios.AxiosError(
    `HTTP ${status}`,
    'ERR_BAD_RESPONSE',
    undefined,
    {},
    {
      status,
      data: data ?? { error: { message: 'raw provider json', code: status } },
      statusText: '',
      headers: {},
      config: {} as never,
    },
  )
}

interface ProviderCase {
  id: LlmProviderId
  reasoningModel: string
  plainModel: string
  expectedPlainBudget: number
  expectedReasoningBudget: number
}

const PROVIDERS: ProviderCase[] = [
  {
    id: 'groq',
    reasoningModel: 'openai/gpt-oss-20b',
    plainModel: 'llama-3.3-70b-versatile',
    expectedPlainBudget: 512,
    expectedReasoningBudget: 2048,
  },
  {
    id: 'cloudflare',
    reasoningModel: '@cf/qwen/qwen3.8-27b',
    plainModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    expectedPlainBudget: 1024,
    expectedReasoningBudget: 4096,
  },
  {
    id: 'openrouter',
    reasoningModel: 'deepseek/deepseek-r1:free',
    plainModel: 'meta-llama/llama-3.3-70b-instruct:free',
    expectedPlainBudget: 1024,
    expectedReasoningBudget: 4096,
  },
]

const SYSTEM_PROMPT = 'You are Shio, a witty anime foxgirl. Max 3 sentences.'
const EMOTION_CONTRACT = 'Start every reply with exactly one emotion tag.'

function baseMessages(userText: string): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: EMOTION_CONTRACT },
    { role: 'user', content: userText },
  ]
}

function okResponse(content: string, finishReason = 'stop'): unknown {
  return {
    choices: [{ finish_reason: finishReason, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }
}

async function runProviderBattery(pc: ProviderCase): Promise<void> {
  console.log(`\n=== ${pc.id} ===`)
  const displayName = getProviderProfile(pc.id).displayName

  // 1. System prompt delivered exactly once, not dropped/duplicated/converted.
  {
    const reply = '[happy] Привет, кожаный.'
    const { http, lastBody } = fakeHttp(() => okResponse(reply))
    const caps = resolveCapabilities(pc.id, pc.plainModel)
    const out = await runChatCompletion({
      provider: pc.id,
      displayName,
      client: http,
      model: pc.plainModel,
      capabilities: caps,
      messages: baseMessages('Hello Shio'),
    })
    const sent = lastBody().messages as ChatMessage[]
    const systemCount = sent.filter((m) => m.role === 'system').length
    check('system prompt present and not dropped', systemCount >= 1)
    check('system prompt not duplicated (matches input)', systemCount === 2 && sent.length === 3)
    check('first message role is system', sent[0]?.role === 'system')
    check('system content unchanged (not converted to user)', sent[0]?.content === SYSTEM_PROMPT)
    check('greeting/persona content returned intact', out === reply)
    check('emotion tag preserved', out.startsWith('[happy]'))
  }

  // Explicit null tool_calls is valid in an OpenAI-compatible response.
  {
    const { http } = fakeHttp(() => ({
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: '[calm] Привет.', tool_calls: null },
        },
      ],
    }))
    const out = await runChatCompletion({
      provider: pc.id,
      displayName,
      client: http,
      model: pc.plainModel,
      capabilities: resolveCapabilities(pc.id, pc.plainModel),
      messages: baseMessages('Привет'),
    })
    check('explicit null tool_calls is treated as no tool calls', out === '[calm] Привет.')
  }

  // 2. Dynamic token budget + temperature from capabilities (non-reasoning).
  {
    const { http, lastBody } = fakeHttp(() => okResponse('[neutral] ok'))
    const caps = resolveCapabilities(pc.id, pc.plainModel)
    await runChatCompletion({
      provider: pc.id,
      displayName,
      client: http,
      model: pc.plainModel,
      capabilities: caps,
      messages: baseMessages('hi'),
    })
    check(
      `non-reasoning budget = ${pc.expectedPlainBudget}`,
      lastBody().max_tokens === pc.expectedPlainBudget,
      `got ${lastBody().max_tokens}`,
    )
    check('temperature sent for standard model', lastBody().temperature === 0.7)
    check('provider lifecycle uses the bounded non-streaming path', lastBody().stream !== true)
    check('non-reasoning model flagged correctly', caps.supportsReasoning === false)
    check('supportsSystemPrompt true', caps.supportsSystemPrompt === true)
  }

  // 3. Reasoning model detection + provider-safe completion budget.
  {
    const { http, lastBody } = fakeHttp(() => okResponse('[calm] думаю'))
    const caps = resolveCapabilities(pc.id, pc.reasoningModel)
    await runChatCompletion({
      provider: pc.id,
      displayName,
      client: http,
      model: pc.reasoningModel,
      capabilities: caps,
      messages: baseMessages('hi'),
    })
    check('reasoning model detected', caps.supportsReasoning === true, pc.reasoningModel)
    check(
      `reasoning budget = ${pc.expectedReasoningBudget}`,
      lastBody().max_tokens === pc.expectedReasoningBudget,
      `got ${lastBody().max_tokens}`,
    )
  }

  // 4. Internal callers may apply a smaller latency budget to bounded tool rounds.
  {
    const { http, lastBody } = fakeHttp(() => okResponse('[calm] bounded'))
    await runChatCompletion(
      {
        provider: pc.id,
        displayName,
        client: http,
        model: pc.reasoningModel,
        capabilities: resolveCapabilities(pc.id, pc.reasoningModel),
        messages: baseMessages('select one tool'),
      },
      { maxTokens: 1_024, timeoutMs: 15_000 },
    )
    check(
      'request-specific token budget overrides the model default',
      lastBody().max_tokens === 1_024,
    )
  }
  for (const [label, text] of [
    ['russian', '[happy] Привет! Как дела, кожаный мешок?'],
    ['english', '[neutral] Hey there, what do you need?'],
    ['unicode', '[laugh] Ха! 🦊✨ +1 Strength / -1 Intelligence'],
  ] as const) {
    const { http } = fakeHttp(() => okResponse(text))
    const out = await runChatCompletion({
      provider: pc.id,
      displayName,
      client: http,
      model: pc.plainModel,
      capabilities: resolveCapabilities(pc.id, pc.plainModel),
      messages: baseMessages('x'),
    })
    check(`${label} content preserved`, out === text)
  }

  // 5. Max-sentence-length reply passes through unchanged (no adapter truncation).
  {
    const three = '[happy] Раз. Два. Три.'
    const { http } = fakeHttp(() => okResponse(three))
    const out = await runChatCompletion({
      provider: pc.id,
      displayName,
      client: http,
      model: pc.plainModel,
      capabilities: resolveCapabilities(pc.id, pc.plainModel),
      messages: baseMessages('x'),
    })
    check('multi-sentence reply not truncated by adapter', out === three)
  }

  // 6. Empty reasoning content + finish_reason length -> readable Runtime error.
  {
    const raw = {
      choices: [
        { finish_reason: 'length', message: { reasoning: 'long thinking...', content: null } },
      ],
    }
    const { http } = fakeHttp(() => raw)
    let err: unknown
    try {
      await runChatCompletion({
        provider: pc.id,
        displayName,
        client: http,
        model: pc.reasoningModel,
        capabilities: resolveCapabilities(pc.id, pc.reasoningModel),
        messages: baseMessages('x'),
      })
    } catch (e) {
      err = e
    }
    const isRuntimeErr = err instanceof LlmResponseError
    const msg = err instanceof Error ? err.message : ''
    check('empty+length throws normalized LlmResponseError', isRuntimeErr)
    check('length error message is readable', /лимит генерации/.test(msg))
    check('no raw JSON leaked in message', !msg.includes('{') && !msg.includes('choices'))
  }

  // 7. Empty content without length -> generic readable empty-response error.
  {
    const raw = { choices: [{ finish_reason: 'stop', message: { content: null } }] }
    const { http } = fakeHttp(() => raw)
    let err: unknown
    try {
      await runChatCompletion({
        provider: pc.id,
        displayName,
        client: http,
        model: pc.plainModel,
        capabilities: resolveCapabilities(pc.id, pc.plainModel),
        messages: baseMessages('x'),
      })
    } catch (e) {
      err = e
    }
    check('empty content throws LlmResponseError', err instanceof LlmResponseError)
    check(
      'empty content message readable',
      err instanceof Error && /пустой ответ/.test(err.message),
    )
  }
  for (const status of [401, 403, 429, 500]) {
    const { http } = fakeHttp(() => axiosErr(status))
    let err: unknown
    try {
      await runChatCompletion({
        provider: pc.id,
        displayName,
        client: http,
        model: pc.plainModel,
        capabilities: resolveCapabilities(pc.id, pc.plainModel),
        messages: baseMessages('x'),
      })
    } catch (e) {
      err = e
    }
    const msg = err instanceof Error ? err.message : ''
    check(
      `HTTP ${status} normalized`,
      err instanceof LlmResponseError &&
        msg === normalizeHttpErrorMessage(getProviderProfile(pc.id).displayName, status),
    )
    check(
      `HTTP ${status} hides raw provider JSON`,
      !msg.includes('raw provider json') && !msg.includes('{'),
    )
    if (status === 401 || status === 403) {
      check(
        `HTTP ${status} has distinct failure code`,
        err instanceof LlmResponseError &&
          err.code === (status === 401 ? 'AUTH_ERROR' : 'ACCESS_DENIED'),
      )
    }
  }
  if (pc.id === 'groq') {
    const responseData = {
      error: {
        message: 'Request too large for model: requested 9395 tokens, limit 8000',
        code: 'rate_limit_exceeded',
      },
    }
    const { http } = fakeHttp(() => axiosErr(413, responseData))
    let err: unknown
    try {
      await runChatCompletion({
        provider: pc.id,
        displayName,
        client: http,
        model: pc.reasoningModel,
        capabilities: resolveCapabilities(pc.id, pc.reasoningModel),
        messages: baseMessages('x'),
      })
    } catch (caught) {
      err = caught
    }
    check(
      'Groq HTTP 413 rate_limit_exceeded is classified as recoverable rate limiting',
      err instanceof LlmResponseError && err.code === 'RATE_LIMITED' && err.recoverable,
    )
    check(
      'Groq HTTP 413 rate-limit response remains provider-safe',
      err instanceof Error && !err.message.includes('9395') && !err.message.includes('raw'),
    )
  }
}

async function testNemotronPlanning(): Promise<void> {
  {
    const { http, lastBody } = fakeHttp(() => okResponse('{"ready":true}'))
    const provider = createAiSdkAdapter({
      definition: getProviderDefinition('openrouter'),
      apiKey: 'test-key',
      model: 'nvidia/nemotron-3.5-super-vl:free',
      fetch: async (_input, init) =>
        new Response(
          JSON.stringify(await http.chat.completions.create(JSON.parse(String(init?.body)))),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    })
    await provider.complete(baseMessages('hi'), {
      responseSchema: {
        name: 'test_plan',
        schema: {
          type: 'object',
          properties: { ready: { type: 'boolean' } },
          required: ['ready'],
          additionalProperties: false,
        },
      },
    })
    const format = lastBody().response_format
    check(
      'Nemotron planning sends the response schema',
      JSON.stringify(format).includes('"type":"json_schema"'),
    )
    check(
      'Nemotron planning suppresses reasoning',
      JSON.stringify(lastBody().reasoning) === '{"enabled":false}',
    )
    await provider.chat(baseMessages('hi'))
    check('Nemotron prose leaves provider reasoning at its default', !lastBody().reasoning)
  }
}

async function testProxyResolution(): Promise<void> {
  console.log('\n=== Main-owned proxy resolution ===')

  const environmentProxy = await resolveLlmProxy('https://openrouter.ai/api/v1/models', {
    environment: { HTTPS_PROXY: 'http://proxy-user:proxy-pass@127.0.0.1:10809' },
    resolveSystemProxy: async () => 'PROXY should-not-be-used.invalid:8080',
  })
  check(
    'HTTPS_PROXY has priority and preserves credentials',
    environmentProxy !== false &&
      environmentProxy.host === '127.0.0.1' &&
      environmentProxy.port === 10_809 &&
      environmentProxy.auth?.username === 'proxy-user' &&
      environmentProxy.auth.password === 'proxy-pass',
  )

  const systemProxy = await resolveLlmProxy('https://api.groq.com/openai/v1/models', {
    environment: {},
    resolveSystemProxy: async () => 'PROXY 127.0.0.1:10809; DIRECT',
  })
  check(
    'Windows/Chromium proxy rule is converted for Axios',
    systemProxy !== false && systemProxy.host === '127.0.0.1' && systemProxy.port === 10_809,
  )
  check('DIRECT system rule disables proxy', proxyFromSystemRules('DIRECT') === false)

  let resolvedUrl = ''
  const http = axios.create({
    baseURL: 'https://openrouter.ai/api/v1',
    adapter: async (config) => ({
      config,
      data: {},
      headers: {},
      status: 200,
      statusText: 'OK',
    }),
  })
  installLlmProxyResolver(http, async (url) => {
    resolvedUrl = url
    return false
  })
  await http.get('/models')
  check(
    'all provider requests resolve proxy against the complete provider URL',
    resolvedUrl === 'https://openrouter.ai/api/v1/models',
    resolvedUrl,
  )

  check('401 classifies as AUTH_ERROR', classifyHttpFailure(401).code === 'AUTH_ERROR')
  check('403 classifies as ACCESS_DENIED', classifyHttpFailure(403).code === 'ACCESS_DENIED')
  check(
    'ordinary HTTP 413 remains REQUEST_TOO_LARGE',
    classifyHttpFailure(413).code === 'REQUEST_TOO_LARGE',
  )
  check(
    'HTTP 413 with structured provider rate-limit code becomes RATE_LIMITED',
    classifyHttpFailure(413, { error: { code: 'rate_limit_exceeded' } }).code === 'RATE_LIMITED',
  )
}

async function testProviderModelAccessErrors(): Promise<void> {
  console.log('\n=== provider model catalog access errors ===')
  for (const providerId of ['groq', 'openrouter'] as const) {
    for (const [status, expectedKind] of [
      [401, 'auth'],
      [403, 'access'],
    ] as const) {
      const http = {
        get: async () => {
          throw axiosErr(status)
        },
      } as unknown as AxiosInstance
      let error: unknown
      try {
        await getProviderDefinition(providerId).fetchModels(http, 'valid-key')
      } catch (caught) {
        error = caught
      }
      check(
        `${providerId} models API ${status} -> ModelFetchError(${expectedKind})`,
        error instanceof ModelFetchError && error.kind === expectedKind,
      )
    }
  }
}

async function testRequestDeadline(): Promise<void> {
  console.log('\n=== request deadline ===')
  const config = {
    provider: 'openrouter' as const,
    displayName: 'OpenRouter',
    client: hangingHttp(),
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    capabilities: resolveCapabilities('openrouter', 'meta-llama/llama-3.3-70b-instruct:free'),
    messages: baseMessages('Project context question'),
  }

  let timeoutError: unknown
  try {
    await runChatCompletion(config, { timeoutMs: 10 })
  } catch (error) {
    timeoutError = error
  }
  check(
    'hard deadline normalizes a hanging request as TIMEOUT',
    timeoutError instanceof LlmResponseError && timeoutError.code === 'TIMEOUT',
  )

  const caller = new AbortController()
  caller.abort()
  let cancellationError: unknown
  try {
    await runChatCompletion({ ...config, requestTimeoutMs: 1_000 }, { signal: caller.signal })
  } catch (error) {
    cancellationError = error
  }
  check(
    'caller cancellation remains CANCELLED',
    cancellationError instanceof LlmResponseError && cancellationError.code === 'CANCELLED',
  )
}

async function testCatalogCapabilityMetadata(): Promise<void> {
  console.log('\n=== provider catalog capability metadata ===')
  const cloudflareAccountId = '1874c9f91457fd5af98cb0b9c46005b9'
  check(
    'Cloudflare Account ID is normalized and provider URL stays main-owned',
    normalizeProviderAccountId('cloudflare', cloudflareAccountId.toUpperCase()) ===
      cloudflareAccountId &&
      resolveProviderChatBaseUrl('cloudflare', { accountId: cloudflareAccountId }) ===
        `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai/v1`,
  )
  const cloudflareDefinition = getProviderDefinition('cloudflare')
  const cloudflareCapabilities = resolveCapabilities('cloudflare', '@cf/qwen/qwen3.8-27b')
  const cloudflarePreparedMessages = prepareMessages(
    [
      { role: 'system', content: 'System one.' },
      { role: 'system', content: 'System two.' },
      { role: 'user', content: 'Hello.' },
    ],
    cloudflareCapabilities,
    cloudflareDefinition.chat.singleLeadingSystemMessage,
  )
  check(
    'Cloudflare combines leading system blocks into one provider-compatible message',
    cloudflarePreparedMessages.length === 2 &&
      cloudflarePreparedMessages[0].role === 'system' &&
      cloudflarePreparedMessages[0].content === 'System one.\n\nSystem two.' &&
      cloudflarePreparedMessages[1].role === 'user',
  )
  const cloudflareContinuationMessages = prepareMessages(
    [
      { role: 'system', content: 'System policy.' },
      { role: 'user', content: 'Use a tool.' },
      { role: 'assistant', content: '<shio-tools>...</shio-tools>' },
      { role: 'system', content: 'Trusted runtime tool result.' },
    ],
    cloudflareCapabilities,
    cloudflareDefinition.chat.singleLeadingSystemMessage,
  )
  check(
    'Cloudflare preserves continuation order without a late system role',
    cloudflareContinuationMessages.map((message) => message.role).join(',') ===
      'system,user,assistant,user' &&
      cloudflareContinuationMessages[3].content === 'Trusted runtime tool result.',
  )
  const fetch = (
    provider: LlmProviderId,
    response: unknown,
  ): Promise<import('../../src/main/llm').ModelCatalogEntry[]> =>
    getProviderDefinition(provider).fetchModels(
      {
        get: async () => ({ data: response }),
      } as unknown as AxiosInstance,
      'test-key',
    )

  const [openRouter] = await fetch('openrouter', {
    data: [
      {
        id: 'mistralai/mistral-catalog-fixture:free',
        name: 'OpenRouter catalog model',
        architecture: {
          input_modalities: ['text', 'image'],
          output_modalities: ['text', 'image'],
        },
        supported_parameters: ['reasoning', 'tools'],
        pricing: { prompt: '0', completion: '0' },
      },
    ],
  })
  const [openRouterModel] = enrichModelCatalog('openrouter', [openRouter])
  check(
    'OpenRouter retains the catalog model ID and maps image generation, Vision, Reasoning and tools',
    openRouterModel.id === 'mistralai/mistral-catalog-fixture:free' &&
      openRouterModel.capabilities.supportsImageGeneration &&
      openRouterModel.capabilities.supportsVision &&
      openRouterModel.capabilities.supportsReasoning &&
      openRouterModel.capabilities.supportsToolCalling,
  )

  const cloudflareModels = await getProviderDefinition('cloudflare').fetchModels(
    {
      get: async () => ({
        data: {
          success: true,
          errors: [],
          messages: [],
          result: [
            {
              id: 'cloudflare-qwen',
              source: 1,
              name: '@cf/qwen/qwen3.8-27b',
              task: { name: 'Text Generation' },
              properties: [
                { property_id: 'vision', value: 'true' },
                { property_id: 'reasoning', value: 'true' },
                { property_id: 'function_calling', value: 'true' },
              ],
            },
            {
              id: 'third-party-openai',
              source: 2,
              name: 'openai/gpt-5',
              task: { name: 'Text Generation' },
              properties: [{ property_id: 'function_calling', value: 'true' }],
            },
            {
              id: 'wrong-prefix',
              source: 1,
              name: 'third-party/opaque',
              task: { name: 'Text Generation' },
            },
            {
              id: 'embedding',
              source: 1,
              name: '@cf/baai/bge-m3',
              task: { name: 'Text Embeddings' },
            },
          ],
          result_info: { count: 4, page: 1, per_page: 100, total_count: 4 },
        },
      }),
    } as unknown as AxiosInstance,
    'test-key',
    { accountId: cloudflareAccountId },
  )
  const [cloudflare] = cloudflareModels
  check(
    'Cloudflare catalog keeps only Cloudflare-hosted text-generation models',
    cloudflareModels.length === 1 && cloudflare.id === '@cf/qwen/qwen3.8-27b',
  )
  check(
    'Cloudflare property metadata maps Vision, Reasoning, and tool calling',
    cloudflare.capabilities?.supportsVision === true &&
      cloudflare.capabilities.supportsReasoning === true &&
      cloudflare.capabilities.supportsToolCalling === true,
  )

  const [groq] = await fetch('groq', {
    data: [
      {
        id: 'groq/opaque-multimodal',
        architecture: { input_modalities: ['text', 'image'] },
      },
    ],
  })
  check('Groq modality metadata maps Vision', groq.capabilities?.supportsVision === true)
  check(
    'Groq Qwen reasoning budget leaves TPM headroom for character context',
    resolveCapabilities('groq', 'qwen/qwen3.8-27b').recommendedMaxTokens === 2048,
  )

  let groqMissingKeyError: unknown
  try {
    await getProviderDefinition('groq').fetchModels(
      { get: async () => ({ data: { data: [] } }) } as unknown as AxiosInstance,
      '',
    )
  } catch (error) {
    groqMissingKeyError = error
  }
  check(
    'Groq catalog requires an API key instead of returning a fallback list',
    groqMissingKeyError instanceof ModelFetchError && groqMissingKeyError.kind === 'auth',
  )
}

function testEnrichedModelCatalog(): void {
  console.log('\n=== enriched model catalog ===')
  const models = enrichModelCatalog('openrouter', [
    { id: 'google/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
    { id: 'deepseek/deepseek-r1:free', displayName: 'DeepSeek R1' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', displayName: 'Llama 3.3' },
  ])

  check(
    'catalog includes Vision capability summary',
    models[0].capabilities.supportsVision && !models[0].capabilities.supportsReasoning,
  )
  check(
    'catalog includes Reasoning capability summary',
    !models[1].capabilities.supportsVision && models[1].capabilities.supportsReasoning,
  )
  check(
    'unconfirmed capabilities stay false',
    !models[2].capabilities.supportsVision && !models[2].capabilities.supportsReasoning,
  )
  check('catalog preserves display name', models[0].displayName === 'Gemini 2.5 Flash')
  check(
    'Groq Qwen 3.6 fallback is Vision-capable',
    resolveCapabilities('groq', 'qwen/qwen3.6-27b').supportsVision,
  )
}

function testFinishReasonNormalization(): void {
  console.log('\n=== finish_reason normalization (shared) ===')
  const map: [string, string][] = [
    ['stop', 'stop'],
    ['length', 'length'],
    ['tool-calls', 'tool_calls'],
    ['content-filter', 'content_filter'],
    ['error', 'error'],
    ['something_weird', 'unknown'],
  ]
  for (const [raw, expected] of map) {
    check(`${raw} -> ${expected}`, normalizeFinishReason(raw) === expected)
  }
}

async function main(): Promise<void> {
  console.log('===== LLM Provider Compatibility Matrix =====')
  for (const pc of PROVIDERS) {
    await runProviderBattery(pc)
  }
  await testRequestDeadline()
  await testNemotronPlanning()
  await testProxyResolution()
  await testProviderModelAccessErrors()
  await testCatalogCapabilityMetadata()
  testEnrichedModelCatalog()
  testFinishReasonNormalization()

  console.log(`\n===== SUMMARY =====`)
  console.log(`checks passed: ${passed}, failed: ${failed}`)
  if (failed > 0) {
    throw new Error('COMPATIBILITY MATRIX FAILED')
  }
  console.log('COMPATIBILITY MATRIX PASSED ✓')
}

describe('LLM provider compatibility', () => {
  it.each([
    ['groq', 'https://api.groq.com/openai/v1/models'],
    ['openrouter', 'https://openrouter.ai/api/v1/models'],
  ] as const)('loads the %s catalog from its provider API', async (provider, expectedUrl) => {
    const create = axios.create.bind(axios)
    const requests: string[] = []
    const transport = vi.spyOn(axios, 'create').mockImplementation((config) => {
      const client = create({
        ...config,
        adapter: async (request) => {
          requests.push(client.getUri(request))
          return {
            config: request,
            data: { data: [{ id: 'test-model:free' }] },
            headers: {},
            status: 200,
            statusText: 'OK',
          }
        },
      })
      return client
    })
    try {
      const catalog = createModelCatalogClient({ definition: getProviderDefinition(provider) })
      await expect(catalog.fetchModels('test-key')).resolves.toMatchObject([
        { id: 'test-model:free' },
      ])
      expect(requests).toEqual([expectedUrl])
    } finally {
      transport.mockRestore()
    }
  })

  it('passes the offline provider matrix', async () => {
    await main()
  })

  it('sends the OpenRouter model list request to the provider API', async () => {
    const create = axios.create.bind(axios)
    const request = vi.fn(async (config: import('axios').InternalAxiosRequestConfig) => ({
      config,
      data: { data: [{ id: 'publisher/model:free' }] },
      headers: {},
      status: 200,
      statusText: 'OK',
    }))
    const factory = vi
      .spyOn(axios, 'create')
      .mockImplementationOnce((config) => create({ ...config, adapter: request }))
    try {
      const catalog = createModelCatalogClient({ definition: getProviderDefinition('openrouter') })
      await expect(catalog.fetchModels('fixture-key')).resolves.toMatchObject([
        { id: 'publisher/model:free' },
      ])
      await catalog.fetchModels('')
      const [authenticated, anonymous] = request.mock.calls.map(([config]) => config)
      expect(axios.getUri(authenticated)).toBe('https://openrouter.ai/api/v1/models')
      expect(authenticated.headers.get('Authorization')).toBe('Bearer fixture-key')
      expect(anonymous.headers.has('Authorization')).toBe(false)
    } finally {
      factory.mockRestore()
    }
  })
})
