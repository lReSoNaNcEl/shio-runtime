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
import type OpenAI from 'openai'
import { APIError, APIUserAbortError } from 'openai'
import { describe, it } from 'vitest'

import type { ChatMessage, LlmProviderId } from '../../src/main/llm'
import { normalizeLlmConfig } from '../../src/main/llm/config'
import {
  classifyHttpFailure,
  LlmResponseError,
  ModelFetchError,
  normalizeHttpErrorMessage,
} from '../../src/main/llm/errors'
import { prepareMessages } from '../../src/main/llm/openai-compatible/messageCompatibility'
import { OpenAICompatibleClient } from '../../src/main/llm/openai-compatible/OpenAICompatibleClient'
import {
  installLlmProxyResolver,
  proxyFromSystemRules,
  resolveLlmProxy,
} from '../../src/main/llm/openai-compatible/proxy'
import { runChatCompletion } from '../../src/main/llm/openai-compatible/request'
import { normalizeFinishReason } from '../../src/main/llm/openai-compatible/response'
import {
  enrichModelCatalog,
  getProviderDefinition,
  getProviderProfile,
  normalizeProviderAccountId,
  resolveModelCapabilities as resolveCapabilities,
  resolveProviderChatBaseUrl,
} from '../../src/main/llm/registry'

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
  http: Pick<OpenAI, 'chat'>
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
  } as unknown as Pick<OpenAI, 'chat'>
  return { http, lastBody: () => captured }
}

function hangingHttp(): Pick<OpenAI, 'chat'> {
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
  } as unknown as Pick<OpenAI, 'chat'>
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
  {
    id: 'mistral',
    reasoningModel: 'magistral-medium-2509',
    plainModel: 'mistral-small-latest',
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

  // 2. Dynamic token budget + temperature from capabilities (non-reasoning).
  if (pc.id === 'mistral') {
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
    check('provider lifecycle uses the bounded non-streaming path', lastBody().stream === false)
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

/** Mistral models API: fake `http.get` to exercise success/error/malformed paths. */
async function withMockedMistralGet<T>(
  handler: (path: string) => unknown,
  fn: (p: OpenAICompatibleClient) => Promise<T>,
): Promise<T> {
  const provider = new OpenAICompatibleClient({
    definition: getProviderDefinition('mistral'),
    apiKey: 'test-key',
    model: 'mistral-small-latest',
  })
  ;(provider as unknown as { http: { get: (path: string) => Promise<unknown> } }).http = {
    get: async (path: string) => {
      const r = handler(path)
      if (r instanceof Error) throw r
      return { data: r }
    },
  }
  return fn(provider)
}

async function testMistralModelsApi(): Promise<void> {
  console.log('\n=== mistral models API ===')

  // Successful models list.
  {
    const rawModels = await withMockedMistralGet(
      () => ({
        object: 'list',
        data: [
          {
            id: 'mistral-medium-3.5',
            name: 'Mistral Medium 3.5',
            capabilities: { vision: true, tool_calling: true },
          },
          {
            id: 'mistral-medium-3-5',
            name: 'Mistral Medium 3.5 Chat',
            capabilities: { vision: true, tool_calling: true },
          },
          { id: 'mistral-large-latest' },
        ],
      }),
      (p) => p.fetchModels('test-key'),
    )
    const models = enrichModelCatalog('mistral', rawModels)
    check(
      'models API canonicalizes and deduplicates Mistral Medium 3.5 chat id',
      models.length === 2 && models[0].id === 'mistral-medium-3-5',
    )
    check(
      'models API preserves optional displayName',
      models[0].displayName === 'Mistral Medium 3.5 Chat',
    )
    check(
      'models API preserves authoritative Vision metadata',
      models[0].capabilities?.supportsVision === true,
    )
  }

  {
    const provider = new OpenAICompatibleClient({
      definition: getProviderDefinition('mistral'),
      apiKey: 'test-key',
      model: 'mistral-medium-3.5',
    })
    const { http, lastBody } = fakeHttp(() => okResponse('[calm]ok'))
    ;(provider as unknown as { client: Pick<OpenAI, 'chat'> }).client = http
    await provider.chat(baseMessages('hi'))
    check(
      'chat request canonicalizes persisted dotted Mistral Medium 3.5 id',
      lastBody().model === 'mistral-medium-3-5',
    )
  }

  // Auth failure.
  {
    let err: unknown
    try {
      await withMockedMistralGet(
        () => axiosErr(401),
        (p) => p.fetchModels('bad-key'),
      )
    } catch (e) {
      err = e
    }
    check(
      'models API 401 -> ModelFetchError(auth)',
      err instanceof ModelFetchError && err.kind === 'auth',
    )
  }

  // Access denied by provider policy or account permissions.
  {
    let err: unknown
    try {
      await withMockedMistralGet(
        () => axiosErr(403),
        (p) => p.fetchModels('valid-key'),
      )
    } catch (e) {
      err = e
    }
    check(
      'models API 403 -> ModelFetchError(access)',
      err instanceof ModelFetchError && err.kind === 'access',
    )
  }

  // Invalid request.
  {
    let err: unknown
    try {
      await withMockedMistralGet(
        () => axiosErr(400),
        (p) => p.fetchModels('test-key'),
      )
    } catch (e) {
      err = e
    }
    check(
      'models API 400 -> ModelFetchError(invalid_response)',
      err instanceof ModelFetchError && err.kind === 'invalid_response',
    )
  }

  // Rate limited.
  {
    let err: unknown
    try {
      await withMockedMistralGet(
        () => axiosErr(429),
        (p) => p.fetchModels('test-key'),
      )
    } catch (e) {
      err = e
    }
    check(
      'models API 429 -> ModelFetchError(invalid_response)',
      err instanceof ModelFetchError && err.kind === 'invalid_response',
    )
  }

  // Malformed response (fails Zod shape validation).
  {
    let err: unknown
    try {
      await withMockedMistralGet(
        () => ({ data: [{ notAnId: true }] }),
        (p) => p.fetchModels('test-key'),
      )
    } catch (e) {
      err = e
    }
    check(
      'malformed models response -> ModelFetchError(invalid_response)',
      err instanceof ModelFetchError && err.kind === 'invalid_response',
    )
  }

  // Missing key never reaches the network.
  {
    let err: unknown
    try {
      await withMockedMistralGet(
        () => ({ data: [] }),
        (p) => p.fetchModels(''),
      )
    } catch (e) {
      err = e
    }
    check(
      'missing key -> ModelFetchError(auth) without request',
      err instanceof ModelFetchError && err.kind === 'auth',
    )
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
    provider: 'mistral' as const,
    displayName: 'Mistral',
    client: hangingHttp(),
    model: 'mistral-small-latest',
    capabilities: resolveCapabilities('mistral', 'mistral-small-latest'),
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
        id: 'publisher/openrouter-opaque:free',
        name: 'OpenRouter Opaque',
        architecture: { input_modalities: ['text', 'image'] },
        supported_parameters: ['reasoning'],
        pricing: { prompt: '0', completion: '0' },
      },
    ],
  })
  check(
    'OpenRouter architecture metadata maps Vision and Reasoning',
    openRouter.capabilities?.supportsVision === true &&
      openRouter.capabilities.supportsReasoning === true,
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
  const models = enrichModelCatalog('mistral', [
    { id: 'mistral-small-2506', displayName: 'Mistral Small 3.1' },
    { id: 'magistral-small', displayName: 'Magistral Small' },
    { id: 'open-mistral-nemo', displayName: 'Mistral Nemo' },
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
  check('catalog preserves display name', models[0].displayName === 'Mistral Small 3.1')

  const [canonicalMedium] = enrichModelCatalog('mistral', [
    {
      id: 'mistral-medium-3.5',
      capabilities: { supportsToolCalling: true, supportsVision: true },
    },
  ])
  check(
    'catalog and persisted alias share canonical Mistral capabilities',
    canonicalMedium.id === 'mistral-medium-3-5' &&
      resolveCapabilities('mistral', 'mistral-medium-3.5').supportsToolCalling,
  )
  const normalizedConfig = normalizeLlmConfig({
    activeProvider: 'mistral',
    providers: { mistral: { model: 'mistral-medium-3.5' } },
  })
  check(
    'persisted Mistral Medium 3.5 alias is canonicalized on config load',
    normalizedConfig.providers.mistral.model === 'mistral-medium-3-5',
  )

  check(
    'Mistral Medium 2508 fallback is Vision-capable',
    resolveCapabilities('mistral', 'mistral-medium-2508').supportsVision,
  )
  check(
    'Groq Qwen 3.6 fallback is Vision-capable',
    resolveCapabilities('groq', 'qwen/qwen3.6-27b').supportsVision,
  )
}

function testFinishReasonNormalization(): void {
  console.log('\n=== finish_reason normalization (shared) ===')
  const map: [string, string][] = [
    ['stop', 'stop'],
    ['end_turn', 'stop'],
    ['length', 'length'],
    ['max_tokens', 'length'],
    ['tool_calls', 'tool_calls'],
    ['function_call', 'tool_calls'],
    ['content_filter', 'content_filter'],
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
  await testMistralModelsApi()
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
  it('passes the offline provider matrix', async () => {
    await main()
  })
})
