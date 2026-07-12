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

import type { ChatMessage, LlmProviderId } from '../../src/main/llm'
import { normalizeFinishReason, resolveCapabilities } from '../../src/main/llm/compatibility'
import {
  LlmResponseError,
  ModelFetchError,
  normalizeHttpErrorMessage,
} from '../../src/main/llm/errors'
import { runChatCompletion } from '../../src/main/llm/protocol'
import { MistralProvider } from '../../src/main/llm/providers/openai'

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
  http: AxiosInstance
  lastBody: () => Record<string, unknown>
} {
  let captured: Record<string, unknown> = {}
  const http = {
    post: async (path: string, body: Record<string, unknown>) => {
      captured = body
      const r = handler(path, body)
      if (r instanceof Error) throw r
      return { data: r }
    },
  } as unknown as AxiosInstance
  return { http, lastBody: () => captured }
}

function axiosErr(status: number): Error {
  return new axios.AxiosError(
    `HTTP ${status}`,
    'ERR_BAD_RESPONSE',
    undefined,
    {},
    {
      status,
      data: { error: { message: 'raw provider json', code: status } },
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
}

const PROVIDERS: ProviderCase[] = [
  {
    id: 'groq',
    reasoningModel: 'openai/gpt-oss-20b',
    plainModel: 'llama-3.3-70b-versatile',
    expectedPlainBudget: 512,
  },
  {
    id: 'cerebras',
    reasoningModel: 'zai-glm-4.7',
    plainModel: 'llama-3.3-70b',
    expectedPlainBudget: 1024,
  },
  {
    id: 'github',
    reasoningModel: 'deepseek/DeepSeek-R1',
    plainModel: 'openai/gpt-4.1',
    expectedPlainBudget: 1024,
  },
  {
    id: 'openrouter',
    reasoningModel: 'deepseek/deepseek-r1:free',
    plainModel: 'meta-llama/llama-3.3-70b-instruct:free',
    expectedPlainBudget: 1024,
  },
  {
    id: 'mistral',
    reasoningModel: 'magistral-medium-2509',
    plainModel: 'mistral-small-latest',
    expectedPlainBudget: 1024,
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

  // 1. System prompt delivered exactly once, not dropped/duplicated/converted.
  {
    const reply = '[happy] Привет, кожаный.'
    const { http, lastBody } = fakeHttp(() => okResponse(reply))
    const caps = resolveCapabilities(pc.id, pc.plainModel)
    const out = await runChatCompletion({
      provider: pc.id,
      http,
      chatPath: '/chat/completions',
      apiKey: 'test-key',
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
  {
    const { http, lastBody } = fakeHttp(() => okResponse('[neutral] ok'))
    const caps = resolveCapabilities(pc.id, pc.plainModel)
    await runChatCompletion({
      provider: pc.id,
      http,
      chatPath: '/c',
      apiKey: 'k',
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
    check('non-reasoning model flagged correctly', caps.supportsReasoning === false)
    check('supportsSystemPrompt true', caps.supportsSystemPrompt === true)
  }

  // 3. Reasoning model detection + 4096 budget without provider-specific code.
  {
    const { http, lastBody } = fakeHttp(() => okResponse('[calm] думаю'))
    const caps = resolveCapabilities(pc.id, pc.reasoningModel)
    await runChatCompletion({
      provider: pc.id,
      http,
      chatPath: '/c',
      apiKey: 'k',
      model: pc.reasoningModel,
      capabilities: caps,
      messages: baseMessages('hi'),
    })
    check('reasoning model detected', caps.supportsReasoning === true, pc.reasoningModel)
    check('reasoning budget = 4096', lastBody().max_tokens === 4096, `got ${lastBody().max_tokens}`)
  }
  for (const [label, text] of [
    ['russian', '[happy] Привет! Как дела, кожаный мешок?'],
    ['english', '[neutral] Hey there, what do you need?'],
    ['unicode', '[laugh] Ха! 🦊✨ +1 Strength / -1 Intelligence'],
  ] as const) {
    const { http } = fakeHttp(() => okResponse(text))
    const out = await runChatCompletion({
      provider: pc.id,
      http,
      chatPath: '/c',
      apiKey: 'k',
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
      http,
      chatPath: '/c',
      apiKey: 'k',
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
        http,
        chatPath: '/c',
        apiKey: 'k',
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
        http,
        chatPath: '/c',
        apiKey: 'k',
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
        http,
        chatPath: '/c',
        apiKey: 'k',
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
      err instanceof LlmResponseError && msg === normalizeHttpErrorMessage(pc.id, status),
    )
    check(
      `HTTP ${status} hides raw provider JSON`,
      !msg.includes('raw provider json') && !msg.includes('{'),
    )
  }
}

/** Mistral models API: fake `http.get` to exercise success/error/malformed paths. */
async function withMockedMistralGet<T>(
  handler: (path: string) => unknown,
  fn: (p: MistralProvider) => Promise<T>,
): Promise<T> {
  const provider = new MistralProvider('test-key', 'mistral-small-latest')
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
    const models = await withMockedMistralGet(
      () => ({
        object: 'list',
        data: [
          { id: 'mistral-small-latest', name: 'Mistral Small' },
          { id: 'mistral-large-latest' },
        ],
      }),
      (p) => p.fetchModels('test-key'),
    )
    check(
      'models API success returns parsed ids',
      models.length === 2 && models[0].id === 'mistral-small-latest',
    )
    check('models API preserves optional displayName', models[0].displayName === 'Mistral Small')
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
  await testMistralModelsApi()
  testFinishReasonNormalization()

  console.log(`\n===== SUMMARY =====`)
  console.log(`checks passed: ${passed}, failed: ${failed}`)
  if (failed > 0) {
    console.error('COMPATIBILITY MATRIX FAILED')
    process.exit(1)
  }
  console.log('COMPATIBILITY MATRIX PASSED ✓')
}

void main()
