import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  type ChatMessage,
  type LLMProvider,
  type LlmCapabilities,
  type LlmCompletion,
  type LlmCompletionOptions,
  LlmResponseError,
} from '../../src/main/llm'
import { runChatCompletionDetailed } from '../../src/main/llm/openai-compatible/request'
import { parseChatCompletion } from '../../src/main/llm/openai-compatible/response'
import {
  createMemoryStore,
  createSemanticMemoryRuntime,
  MemoryPolicy,
  MemoryRuntime,
  MemoryToolBroker,
  type SemanticMemoryStore,
} from '../../src/main/memory'
import type { MemoryRetrievalStrategy } from '../../src/main/memory/MemoryRetrievalStrategy'
import type { NewMemoryRecord } from '../../src/main/memory/SemanticMemoryStore'
import { Orchestrator } from '../../src/main/orchestrator'
import type { SpeechSynthesisClient } from '../../src/main/speech/speechClient'
import type { AppSettings } from '../../src/shared/config'
import { MEMORY_LIMITS, type MemoryRecord, type MemoryToolRequest } from '../../src/shared/memory'

const TOOL_CAPABILITIES: LlmCapabilities = {
  supportsReasoning: false,
  supportsStreaming: true,
  supportsTemperature: true,
  supportsSystemPrompt: true,
  supportsToolCalling: true,
  supportsVision: false,
  recommendedMaxTokens: 1_024,
}

const FALLBACK_CAPABILITIES: LlmCapabilities = {
  ...TOOL_CAPABILITIES,
  supportsToolCalling: false,
}

const settings = (): AppSettings => ({ uiLocale: 'ru' }) as AppSettings
const speech = {} as SpeechSynthesisClient

function createOrchestrator(provider: LLMProvider, broker: MemoryToolBroker): Orchestrator {
  return new Orchestrator(
    provider,
    createMemoryStore(),
    speech,
    settings,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    broker,
  )
}

function toolCompletion(name: string, input: unknown, id = 'memory-call-1'): LlmCompletion {
  return {
    content: '',
    finishReason: 'tool_calls',
    toolCalls: [{ id, name, argumentsJson: JSON.stringify(input) }],
  }
}

class NativeStoreProvider implements LLMProvider {
  calls = 0

  capabilities(): LlmCapabilities {
    return TOOL_CAPABILITIES
  }

  async chat(): Promise<string> {
    throw new Error('Native path unexpectedly used chat()')
  }

  async complete(
    messages: readonly ChatMessage[],
    options: LlmCompletionOptions = {},
  ): Promise<LlmCompletion> {
    this.calls += 1
    if (this.calls === 1) {
      assert.equal(
        options.tools?.some((tool) => tool.name === 'memory_store'),
        true,
      )
      assert.equal(JSON.stringify(options.tools).includes('sourceTurnId'), false)
      assert.equal(JSON.stringify(messages).includes('current user source turn id'), false)
      assert.equal(
        messages.some(
          (message) =>
            message.role === 'system' &&
            typeof message.content === 'string' &&
            message.content.includes('explicit-persistence only'),
        ),
        true,
      )
      return toolCompletion('memory_store', {
        memories: [
          {
            kind: 'preference',
            text: 'Пользователь любит зелёный чай.',
          },
        ],
      })
    }
    const toolResult = messages.find((message) => message.role === 'tool')
    assert.equal(
      typeof toolResult?.content === 'string' && toolResult.content.includes('"ok":true'),
      true,
    )
    return {
      content: '[warm]Запомнила. Зелёный чай — твой выбор.',
      finishReason: 'stop',
      toolCalls: [],
    }
  }
}

class FallbackStoreProvider implements LLMProvider {
  calls = 0

  capabilities(): LlmCapabilities {
    return FALLBACK_CAPABILITIES
  }

  async chat(messages: readonly ChatMessage[]): Promise<string> {
    this.calls += 1
    if (this.calls === 1) {
      assert.equal(
        messages.some(
          (message) =>
            message.role === 'system' &&
            typeof message.content === 'string' &&
            message.content.includes('<shio-tools>'),
        ),
        true,
      )
      return '<shio-memory>{"operations":[{"name":"memory.store","input":{"memories":[{"kind":"preference","text":"Пользователь любит зелёный чай.","sourceTurnId":"model-forged-turn"}]}}]}</shio-memory>'
    }
    assert.equal(
      messages.some(
        (message) =>
          message.role === 'system' &&
          typeof message.content === 'string' &&
          message.content.includes('"ok":true'),
      ),
      true,
    )
    return '[warm]Запомнила. Зелёный чай — твой выбор.'
  }
}

class NativeRejectingFallbackProvider implements LLMProvider {
  chatCalls = 0
  completeCalls = 0

  capabilities(): LlmCapabilities {
    return TOOL_CAPABILITIES
  }

  async complete(): Promise<LlmCompletion> {
    this.completeCalls += 1
    throw new LlmResponseError({
      provider: 'mistral',
      code: 'PROVIDER_REJECTED',
      recoverable: false,
      message: 'Mistral rejected the tool-enabled request.',
    })
  }

  async chat(messages: readonly ChatMessage[]): Promise<string> {
    this.chatCalls += 1
    assert.equal(
      messages.some(
        (message) =>
          message.role === 'system' &&
          typeof message.content === 'string' &&
          message.content.includes('<shio-tools>'),
      ),
      true,
    )
    if (this.chatCalls === 1) {
      return '<shio-memory>{"operations":[{"name":"memory.store","input":{"memories":[{"kind":"preference","text":"Пользователь любит зелёный чай.","sourceTurnId":"turn-native-rejected"}]}}]}</shio-memory>'
    }
    if (this.chatCalls === 2) return '[warm]Запомнила зелёный чай.'
    return '[calm]120.'
  }
}

class NoMemoryProvider implements LLMProvider {
  calls = 0

  capabilities(): LlmCapabilities {
    return TOOL_CAPABILITIES
  }

  async chat(): Promise<string> {
    throw new Error('Native path unexpectedly used chat()')
  }

  async complete(): Promise<LlmCompletion> {
    this.calls += 1
    return { content: '[calm]120.', finishReason: 'stop', toolCalls: [] }
  }
}

class RecoverableNativeProvider implements LLMProvider {
  calls = 0

  capabilities(): LlmCapabilities {
    return TOOL_CAPABILITIES
  }

  async chat(): Promise<string> {
    throw new Error('Native path unexpectedly used chat()')
  }

  async complete(): Promise<LlmCompletion> {
    this.calls += 1
    if (this.calls === 1) {
      throw new LlmResponseError({
        provider: 'mistral',
        code: 'NETWORK_ERROR',
        recoverable: true,
        message: 'Connection reset by peer.',
      })
    }
    return { content: '[calm]120.', finishReason: 'stop', toolCalls: [] }
  }
}

class RecoverableFallbackProvider implements LLMProvider {
  calls = 0

  constructor(private readonly failuresBeforeSuccess: number) {}

  capabilities(): LlmCapabilities {
    return FALLBACK_CAPABILITIES
  }

  async chat(): Promise<string> {
    this.calls += 1
    if (this.calls <= this.failuresBeforeSuccess) {
      throw new LlmResponseError({
        provider: 'mistral',
        code: 'NETWORK_ERROR',
        recoverable: true,
        message: 'Connection reset by peer.',
      })
    }
    return '[calm]120.'
  }
}

type CompletionStep = (
  messages: readonly ChatMessage[],
  options: LlmCompletionOptions,
) => LlmCompletion

class ScriptedNativeProvider implements LLMProvider {
  calls = 0

  constructor(private readonly steps: readonly CompletionStep[]) {}

  capabilities(): LlmCapabilities {
    return TOOL_CAPABILITIES
  }

  async chat(): Promise<string> {
    throw new Error('Native path unexpectedly used chat()')
  }

  async complete(
    messages: readonly ChatMessage[],
    options: LlmCompletionOptions = {},
  ): Promise<LlmCompletion> {
    const step = this.steps[this.calls]
    assert.ok(step, `Unexpected native completion round ${this.calls + 1}`)
    this.calls += 1
    return step(messages, options)
  }
}

function assertUserTurn(messages: readonly ChatMessage[], expected: string): void {
  assert.equal(
    messages.some(
      (message) =>
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content === expected,
    ),
    true,
  )
}

function latestToolData(messages: readonly ChatMessage[]): Record<string, unknown> {
  const result = [...messages].reverse().find((message) => message.role === 'tool')
  assert.equal(typeof result?.content, 'string')
  const parsed = JSON.parse(result?.content as string) as {
    ok?: boolean
    data?: Record<string, unknown>
  }
  assert.equal(parsed.ok, true)
  assert.ok(parsed.data)
  return parsed.data
}

function firstMemoryId(data: Record<string, unknown>): string {
  const items = data.items as { id?: unknown }[] | undefined
  assert.equal(typeof items?.[0]?.id, 'string')
  return items?.[0]?.id as string
}

function storeRequest(_turnId: string, text: string): MemoryToolRequest {
  return {
    name: 'memory.store',
    input: { memories: [{ kind: 'preference', text }] },
  }
}

async function nativeAndFallbackPaths(root: string): Promise<void> {
  const nativeDb = join(root, 'native.sqlite')
  const nativeRuntime = createSemanticMemoryRuntime(nativeDb)
  const nativeProvider = new NativeStoreProvider()
  const nativeReply = await createOrchestrator(
    nativeProvider,
    new MemoryToolBroker(nativeRuntime),
  ).createReply(
    { userText: 'Слушай, в будущих разговорах учитывай, что мой любимый напиток — зелёный чай.' },
    { traceId: 'turn-native' },
  )
  assert.match(nativeReply.replyText, /Зелёный чай/u)
  assert.equal(nativeRuntime.listForUi({}).items.length, 1)
  assert.equal(nativeRuntime.listForUi({}).items[0]?.source.turnId, 'turn-native')
  assert.equal(nativeProvider.calls, 2)
  nativeRuntime.close()

  const reopened = createSemanticMemoryRuntime(nativeDb)
  const recalled = reopened.searchForUi({ query: 'предпочтения пользователя напитки чай' })
  assert.equal(recalled.items[0]?.text, 'Пользователь любит зелёный чай.')
  reopened.close()

  const fallbackRuntime = createSemanticMemoryRuntime(join(root, 'fallback.sqlite'))
  const fallbackProvider = new FallbackStoreProvider()
  await createOrchestrator(fallbackProvider, new MemoryToolBroker(fallbackRuntime)).createReply(
    { userText: 'Мне бы хотелось, чтобы ты помнила, что я люблю зелёный чай.' },
    { traceId: 'turn-fallback' },
  )
  assert.equal(fallbackRuntime.listForUi({}).items[0]?.text, 'Пользователь любит зелёный чай.')
  assert.equal(fallbackRuntime.listForUi({}).items[0]?.source.turnId, 'turn-fallback')
  assert.equal(fallbackProvider.calls, 2)
  fallbackRuntime.close()
}

async function rejectedNativeToolsDowngradeToFallback(root: string): Promise<void> {
  const runtime = createSemanticMemoryRuntime(join(root, 'native-rejected.sqlite'))
  const provider = new NativeRejectingFallbackProvider()
  const orchestrator = createOrchestrator(provider, new MemoryToolBroker(runtime))
  const reply = await orchestrator.createReply(
    { userText: 'В будущих разговорах учитывай, что я люблю зелёный чай.' },
    { traceId: 'turn-native-rejected' },
  )
  assert.match(reply.replyText, /Запомнила/u)
  assert.equal(runtime.listForUi({}).items[0]?.text, 'Пользователь любит зелёный чай.')
  assert.equal(provider.completeCalls, 1)
  assert.equal(provider.chatCalls, 2)

  await orchestrator.createReply(
    { userText: 'Сколько будет 5!?' },
    { traceId: 'turn-after-reject' },
  )
  assert.equal(provider.completeCalls, 1)
  assert.equal(provider.chatCalls, 3)
  runtime.close()
}

async function recoverableProviderRequestsRetryOnce(root: string): Promise<void> {
  const nativeRuntime = createSemanticMemoryRuntime(join(root, 'recoverable-native.sqlite'))
  const nativeProvider = new RecoverableNativeProvider()
  const nativeReply = await createOrchestrator(
    nativeProvider,
    new MemoryToolBroker(nativeRuntime),
  ).createReply({ userText: 'Сколько будет 5!?' }, { traceId: 'turn-recoverable-native' })
  assert.equal(nativeReply.replyText, '[calm]120.')
  assert.equal(nativeProvider.calls, 2)
  nativeRuntime.close()

  const fallbackRuntime = createSemanticMemoryRuntime(join(root, 'recoverable-fallback.sqlite'))
  const fallbackProvider = new RecoverableFallbackProvider(1)
  const fallbackReply = await createOrchestrator(
    fallbackProvider,
    new MemoryToolBroker(fallbackRuntime),
  ).createReply({ userText: 'Сколько будет 5!?' }, { traceId: 'turn-recoverable-fallback' })
  assert.equal(fallbackReply.replyText, '[calm]120.')
  assert.equal(fallbackProvider.calls, 2)
  fallbackRuntime.close()

  const boundedRuntime = createSemanticMemoryRuntime(join(root, 'recoverable-bounded.sqlite'))
  const boundedProvider = new RecoverableFallbackProvider(2)
  await assert.rejects(
    createOrchestrator(boundedProvider, new MemoryToolBroker(boundedRuntime)).createReply(
      { userText: 'Сколько будет 5!?' },
      { traceId: 'turn-recoverable-bounded' },
    ),
    (error: unknown) => error instanceof LlmResponseError && error.code === 'NETWORK_ERROR',
  )
  assert.equal(boundedProvider.calls, 2)
  boundedRuntime.close()
}

async function semanticStorePhrasingMatrix(root: string): Promise<void> {
  const phrases = [
    'Запомни, что я люблю зелёный чай.',
    'Имей это в виду на будущее: я люблю зелёный чай.',
    'Мне бы хотелось, чтобы ты помнила, что я люблю зелёный чай.',
    'В следующих разговорах учитывай, что мой любимый напиток — зелёный чай.',
    'Remember for later that I prefer green tea.',
  ] as const

  for (const [index, phrase] of phrases.entries()) {
    const traceId = `turn-store-matrix-${index}`
    const runtime = createSemanticMemoryRuntime(join(root, `store-matrix-${index}.sqlite`))
    const provider = new ScriptedNativeProvider([
      (messages) => {
        assertUserTurn(messages, phrase)
        return toolCompletion('memory_store', {
          memories: [
            {
              kind: 'preference',
              text: 'Пользователь любит зелёный чай.',
            },
          ],
        })
      },
      (messages) => {
        latestToolData(messages)
        return { content: '[warm]Учту это.', finishReason: 'stop', toolCalls: [] }
      },
    ])
    await createOrchestrator(provider, new MemoryToolBroker(runtime)).createReply(
      { userText: phrase },
      { traceId },
    )
    assert.equal(runtime.listForUi({}).items[0]?.text, 'Пользователь любит зелёный чай.')
    runtime.close()
  }
}

async function questionFormPersistenceContract(root: string): Promise<void> {
  const phrase = 'Можешь запомнить что я люблю пиццу?'
  const traceId = 'turn-question-form-store'
  const runtime = createSemanticMemoryRuntime(join(root, 'question-form-store.sqlite'))
  const provider = new ScriptedNativeProvider([
    (messages, options) => {
      assertUserTurn(messages, phrase)
      assert.equal(options.toolChoice, 'auto')
      assert.equal(
        messages.some(
          (message) =>
            message.role === 'system' &&
            typeof message.content === 'string' &&
            message.content.includes('do not require a second confirmation') &&
            message.content.includes('Можешь запомнить, что я люблю пиццу?') &&
            message.content.includes('Do not answer with only a promise'),
        ),
        true,
      )
      return toolCompletion('memory_store', {
        memories: [
          {
            kind: 'preference',
            text: 'Пользователь любит пиццу.',
          },
        ],
      })
    },
    (messages) => {
      latestToolData(messages)
      return { content: '[warm]Запомнила: ты любишь пиццу.', finishReason: 'stop', toolCalls: [] }
    },
  ])
  const reply = await createOrchestrator(provider, new MemoryToolBroker(runtime)).createReply(
    { userText: phrase },
    { traceId },
  )
  assert.match(reply.replyText, /Запомнила/u)
  assert.equal(runtime.listForUi({}).items[0]?.text, 'Пользователь любит пиццу.')
  assert.equal(provider.calls, 2)
  runtime.close()
}

async function semanticForgetPhrasingMatrix(root: string): Promise<void> {
  const phrases = [
    'Забудь моё старое предпочтение по теме.',
    'Больше не учитывай, что мне нравилась тёмная тема.',
    'Удали из памяти то, что я предпочитаю dark mode.',
    'Я передумал насчёт темы. Старое предпочтение можешь забыть.',
  ] as const

  for (const [index, phrase] of phrases.entries()) {
    const runtime = createSemanticMemoryRuntime(join(root, `forget-matrix-${index}.sqlite`))
    const broker = new MemoryToolBroker(runtime)
    const seed = broker.executeDirective(
      storeRequest(
        `turn-forget-seed-${index}`,
        'Пользователь предпочитает тёмную тему (dark mode).',
      ),
      { sourceTurnId: `turn-forget-seed-${index}` },
    )
    assert.equal(seed.ok, true)
    const provider = new ScriptedNativeProvider([
      (messages) => {
        assertUserTurn(messages, phrase)
        return toolCompletion('memory_search', { query: 'предпочтение по теме dark mode' })
      },
      (messages) =>
        toolCompletion('memory_forget', { ids: [firstMemoryId(latestToolData(messages))] }),
      () => ({
        content: '[calm]Старое предпочтение удалено.',
        finishReason: 'stop',
        toolCalls: [],
      }),
    ])
    await createOrchestrator(provider, broker).createReply(
      { userText: phrase },
      { traceId: `turn-forget-matrix-${index}` },
    )
    assert.equal(runtime.listForUi({}).items.length, 0)
    runtime.close()
  }
}

async function semanticUpdatePhrasingMatrix(root: string): Promise<void> {
  const cases = [
    {
      phrase: 'Теперь вместо тёмной темы я предпочитаю светлую. Обнови это у себя.',
      before: 'Пользователь предпочитает тёмную тему.',
      query: 'пользователь предпочитает тёмную тему светлую',
      after: 'Пользователь предпочитает светлую тему.',
    },
    {
      phrase: 'Мои вкусы поменялись: чай теперь пью без сахара.',
      before: 'Пользователь пьёт чай с сахаром.',
      query: 'пользователь пьёт чай с сахаром без сахара',
      after: 'Пользователь пьёт чай без сахара.',
    },
    {
      phrase: 'То, что ты помнишь про мой любимый напиток, уже устарело — теперь это улун.',
      before: 'Любимый напиток пользователя — зелёный чай.',
      query: 'любимый напиток пользователя зелёный чай улун',
      after: 'Любимый напиток пользователя — улун.',
    },
  ] as const

  for (const [index, testCase] of cases.entries()) {
    const runtime = createSemanticMemoryRuntime(join(root, `update-matrix-${index}.sqlite`))
    const broker = new MemoryToolBroker(runtime)
    const seedTurn = `turn-update-seed-${index}`
    assert.equal(
      broker.executeDirective(storeRequest(seedTurn, testCase.before), {
        sourceTurnId: seedTurn,
      }).ok,
      true,
    )
    const provider = new ScriptedNativeProvider([
      (messages) => {
        assertUserTurn(messages, testCase.phrase)
        return toolCompletion('memory_search', { query: testCase.query })
      },
      (messages) =>
        toolCompletion('memory_update', {
          id: firstMemoryId(latestToolData(messages)),
          text: testCase.after,
        }),
      () => ({ content: '[warm]Обновила.', finishReason: 'stop', toolCalls: [] }),
    ])
    await createOrchestrator(provider, broker).createReply(
      { userText: testCase.phrase },
      { traceId: `turn-update-matrix-${index}` },
    )
    const items = runtime.listForUi({}).items
    assert.equal(items.length, 1)
    assert.equal(items[0]?.text, testCase.after)
    runtime.close()
  }
}

async function semanticRecallPhrasingMatrix(root: string): Promise<void> {
  const cases = [
    ['Какой чай я люблю?', 'Пользователь любит зелёный чай.', 'предпочтение чай напиток'],
    [
      'Ты помнишь мои предпочтения по интерфейсу?',
      'Пользователь предпочитает светлый интерфейс.',
      'предпочтение интерфейс тема',
    ],
    [
      'Что мы решили насчёт Desktop Control?',
      'Для Desktop Control выбран режим с подтверждением.',
      'решение Desktop Control',
    ],
    [
      'Что я хотел потом сделать с Blender?',
      'Пользователь хочет позже заняться Blender.',
      'намерение Blender позже',
    ],
  ] as const

  for (const [index, [phrase, fact, query]] of cases.entries()) {
    const runtime = createSemanticMemoryRuntime(join(root, `recall-matrix-${index}.sqlite`))
    runtime.createManual({
      kind: index === 2 ? 'decision' : index === 3 ? 'commitment' : 'preference',
      text: fact,
    })
    const provider = new ScriptedNativeProvider([
      (messages) => {
        assertUserTurn(messages, phrase)
        return toolCompletion('memory_search', { query })
      },
      (messages) => {
        assert.equal(firstMemoryId(latestToolData(messages)).length, 36)
        return { content: `[warm]${fact}`, finishReason: 'stop', toolCalls: [] }
      },
    ])
    await createOrchestrator(provider, new MemoryToolBroker(runtime)).createReply(
      { userText: phrase },
      { traceId: `turn-recall-matrix-${index}` },
    )
    assert.equal(provider.calls, 2)
    runtime.close()
  }
}

async function irrelevantTurnDoesNotInvokeMemory(root: string): Promise<void> {
  const runtime = createSemanticMemoryRuntime(join(root, 'irrelevant.sqlite'))
  const provider = new NoMemoryProvider()
  const orchestrator = createOrchestrator(provider, new MemoryToolBroker(runtime))
  const phrases = [
    '2 + 2?',
    'Открой example.com.',
    'Какая версия Node установлена?',
    'Переведи hello.',
  ] as const
  for (const [index, phrase] of phrases.entries()) {
    const reply = await orchestrator.createReply(
      { userText: phrase },
      { traceId: `turn-irrelevant-${index}` },
    )
    assert.equal(reply.replyText, '[calm]120.')
  }
  assert.equal(provider.calls, phrases.length)
  assert.equal(runtime.listForUi({}).items.length, 0)
  runtime.close()
}

function policyAndMutationSafety(root: string): void {
  const runtime = createSemanticMemoryRuntime(join(root, 'policy.sqlite'))
  const broker = new MemoryToolBroker(runtime)
  const secret = broker.executeDirective(
    storeRequest('turn-secret', 'API key: sk-super-secret-value-1234567890'),
    { sourceTurnId: 'turn-secret' },
  )
  assert.equal(secret.ok, false)
  if (!secret.ok) assert.equal(secret.error.code, 'SENSITIVE_CONTENT')
  assert.equal(runtime.listForUi({}).items.length, 0)

  const stored = broker.executeDirective(
    storeRequest('turn-theme', 'Пользователь предпочитает тёмную тему.'),
    { sourceTurnId: 'turn-theme' },
  )
  assert.equal(stored.ok, true)
  const id = runtime.listForUi({}).items[0]?.id
  assert.ok(id)
  const updated = broker.executeDirective(
    {
      name: 'memory.update',
      input: { id, text: 'Пользователь предпочитает светлую тему.' },
    },
    { sourceTurnId: 'turn-theme-update' },
  )
  assert.equal(updated.ok, true)
  assert.equal(runtime.listForUi({}).items[0]?.text, 'Пользователь предпочитает светлую тему.')

  const hallucinated = broker.executeDirective(
    { name: 'memory.forget', input: { ids: ['00000000-0000-4000-8000-000000000000'] } },
    { sourceTurnId: 'turn-forget' },
  )
  assert.equal(hallucinated.ok, false)
  if (!hallucinated.ok) assert.equal(hallucinated.error.code, 'NOT_FOUND')
  assert.equal(runtime.listForUi({}).items.length, 1)

  runtime.setEnabled(false)
  assert.equal(broker.availableTools().length, 0)
  runtime.setEnabled(true)
  runtime.close()
}

async function multiOperationFallback(root: string): Promise<void> {
  const runtime = createSemanticMemoryRuntime(join(root, 'multi.sqlite'))
  const broker = new MemoryToolBroker(runtime)
  const seeded = broker.executeDirective(storeRequest('turn-seed', 'Пользователь любит кофе.'), {
    sourceTurnId: 'turn-seed',
  })
  assert.equal(seeded.ok, true)
  const coffeeId = runtime.listForUi({}).items[0]?.id
  assert.ok(coffeeId)

  let call = 0
  const provider: LLMProvider = {
    capabilities: () => FALLBACK_CAPABILITIES,
    chat: async () => {
      call += 1
      if (call === 1) {
        return '<shio-memory>{"operations":[{"name":"memory.search","input":{"query":"предпочтение пользователя кофе"}}]}</shio-memory>'
      }
      if (call === 2) {
        return `<shio-memory>{"operations":[{"name":"memory.forget","input":{"ids":["${coffeeId}"]}},{"name":"memory.store","input":{"memories":[{"kind":"preference","text":"Пользователь предпочитает зелёный чай.","sourceTurnId":"turn-multi"}]}}]}</shio-memory>`
      }
      return '[warm]Кофе забыла, зелёный чай запомнила.'
    },
  }
  await createOrchestrator(provider, broker).createReply(
    {
      userText:
        'Я больше не люблю кофе — старое можешь забыть. Теперь предпочитаю зелёный чай, это сохрани на будущее.',
    },
    { traceId: 'turn-multi' },
  )
  const items = runtime.listForUi({}).items
  assert.equal(items.length, 1)
  assert.equal(items[0]?.text, 'Пользователь предпочитает зелёный чай.')
  runtime.close()
}

async function committedForgetSurvivesNarrationFailure(root: string): Promise<void> {
  const runtime = createSemanticMemoryRuntime(join(root, 'forget-narration-failure.sqlite'))
  runtime.createManual({ kind: 'preference', text: 'Пользователь любит пиццу.' })
  const memoryId = runtime.listForUi({}).items[0]?.id
  assert.ok(memoryId)

  let calls = 0
  const provider: LLMProvider = {
    capabilities: () => FALLBACK_CAPABILITIES,
    chat: async () => {
      calls += 1
      if (calls === 1) {
        return '<shio-tools>{"calls":[{"tool":"memory.search","arguments":{"query":"любимая еда пользователя пицца"}}]}</shio-tools>'
      }
      if (calls === 2) {
        return `<shio-tools>{"calls":[{"tool":"memory.forget","arguments":{"ids":["${memoryId}"]}}]}</shio-tools>`
      }
      throw new LlmResponseError({
        provider: 'mistral',
        code: 'NETWORK_ERROR',
        recoverable: true,
        message: 'Connection reset after the committed memory mutation.',
      })
    },
  }

  const reply = await createOrchestrator(provider, new MemoryToolBroker(runtime)).createReply(
    { userText: 'Удали из памяти, что я люблю пиццу.' },
    { traceId: 'turn-forget-narration-failure' },
  )
  assert.equal(runtime.listForUi({}).items.length, 0)
  assert.match(reply.replyText, /удалила запись из долговременной памяти/u)
  assert.equal(calls, 3, 'committed memory mutation must not retry failed narration')
  runtime.close()
}

async function ambiguityDoesNotDelete(root: string): Promise<void> {
  const runtime = createSemanticMemoryRuntime(join(root, 'ambiguous.sqlite'))
  runtime.createManual({ kind: 'preference', text: 'Пользователь любит зелёный чай.' })
  runtime.createManual({ kind: 'preference', text: 'Пользователь любит чай улун.' })
  const provider = new ScriptedNativeProvider([
    () => toolCompletion('memory_search', { query: 'предпочтения чай' }),
    (messages) => {
      const items = latestToolData(messages).items as unknown[]
      assert.equal(items.length, 2)
      return {
        content: '[calm]У меня записаны зелёный чай и улун. Какое предпочтение убрать?',
        finishReason: 'stop',
        toolCalls: [],
      }
    },
  ])
  const reply = await createOrchestrator(provider, new MemoryToolBroker(runtime)).createReply(
    { userText: 'Забудь про чай.' },
    { traceId: 'turn-ambiguous' },
  )
  assert.match(reply.replyText, /Какое предпочтение убрать/u)
  assert.equal(runtime.listForUi({}).items.length, 2)
  runtime.close()
}

async function boundedToolLoop(root: string): Promise<void> {
  const runtime = createSemanticMemoryRuntime(join(root, 'bounded-loop.sqlite'))
  runtime.createManual({ kind: 'fact', text: 'Проверочная запись.' })
  let calls = 0
  const provider: LLMProvider = {
    capabilities: () => TOOL_CAPABILITIES,
    chat: async () => {
      throw new Error('unexpected chat')
    },
    complete: async () => {
      calls += 1
      return toolCompletion('memory_search', { query: 'проверочная запись' }, `loop-${calls}`)
    },
  }
  const reply = await createOrchestrator(provider, new MemoryToolBroker(runtime)).createReply(
    { userText: 'Продолжай искать бесконечно.' },
    { traceId: 'turn-bounded-loop' },
  )
  assert.equal(calls, 9)
  assert.match(reply.replyText, /пределах текущего лимита/u)
  runtime.close()
}

async function controlMarkersAreContained(root: string): Promise<void> {
  const disabledRuntime = createSemanticMemoryRuntime(join(root, 'disabled-marker.sqlite'))
  disabledRuntime.setEnabled(false)
  const disabledProvider: LLMProvider = {
    capabilities: () => TOOL_CAPABILITIES,
    chat: async () =>
      '<shio-memory>{"operations":[{"name":"memory.list","input":{}}]}</shio-memory>',
  }
  const disabledReply = await createOrchestrator(
    disabledProvider,
    new MemoryToolBroker(disabledRuntime),
  ).createReply({ userText: 'Что ты помнишь?' })
  assert.doesNotMatch(disabledReply.replyText, /shio-memory/u)
  assert.match(disabledReply.replyText, /Не смогла безопасно завершить/u)
  disabledRuntime.close()

  const nativeRuntime = createSemanticMemoryRuntime(join(root, 'native-marker.sqlite'))
  const nativeProvider = new ScriptedNativeProvider([
    () => ({
      content: '<shio-memory>{"operations":[{"name":"memory.list","input":{}}]}</shio-memory>',
      finishReason: 'stop',
      toolCalls: [],
    }),
  ])
  const nativeReply = await createOrchestrator(
    nativeProvider,
    new MemoryToolBroker(nativeRuntime),
  ).createReply({ userText: 'Обычный ответ.' })
  assert.doesNotMatch(nativeReply.replyText, /shio-memory/u)
  assert.match(nativeReply.replyText, /Не смогла безопасно завершить/u)
  nativeRuntime.close()
}

function boundedPayloads(root: string): void {
  const runtime = createSemanticMemoryRuntime(join(root, 'bounded-payloads.sqlite'))
  const broker = new MemoryToolBroker(runtime)
  const oversizedStore = broker.executeNative(
    {
      id: 'oversized-store',
      name: 'memory_store',
      argumentsJson: JSON.stringify({
        memories: Array.from({ length: MEMORY_LIMITS.maxRecordsPerStore + 1 }, (_, index) => ({
          kind: 'fact',
          text: `fact ${index}`,
        })),
      }),
    },
    { sourceTurnId: 'turn-limits' },
  )
  assert.equal(oversizedStore.result?.ok, false)
  if (oversizedStore.result && !oversizedStore.result.ok) {
    assert.equal(oversizedStore.result.error.code, 'INVALID_REQUEST')
  }
  const oversizedSearch = broker.executeNative(
    {
      id: 'oversized-search',
      name: 'memory_search',
      argumentsJson: JSON.stringify({ query: 'fact', limit: MEMORY_LIMITS.maxSearchResults + 1 }),
    },
    { sourceTurnId: 'turn-limits' },
  )
  assert.equal(oversizedSearch.result?.ok, false)
  const oversizedList = broker.executeNative(
    {
      id: 'oversized-list',
      name: 'memory_list',
      argumentsJson: JSON.stringify({ limit: MEMORY_LIMITS.maxListResults + 1 }),
    },
    { sourceTurnId: 'turn-limits' },
  )
  assert.equal(oversizedList.result?.ok, false)
  const oversizedForget = broker.executeNative(
    {
      id: 'oversized-forget',
      name: 'memory_forget',
      argumentsJson: JSON.stringify({
        ids: Array.from(
          { length: MEMORY_LIMITS.maxForgetIds + 1 },
          (_, index) => `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
        ),
      }),
    },
    { sourceTurnId: 'turn-limits' },
  )
  assert.equal(oversizedForget.result?.ok, false)
  assert.equal(runtime.listForUi({}).items.length, 0)
  runtime.close()
}

class FailingStore implements SemanticMemoryStore {
  close(): void {}
  getEnabled(): boolean {
    return true
  }
  setEnabled(): void {}
  count(): number {
    return 0
  }
  getById(): MemoryRecord | null {
    return null
  }
  insertMany(_records: readonly NewMemoryRecord[]): readonly MemoryRecord[] {
    throw new Error('database failed')
  }
  update(): MemoryRecord | null {
    return null
  }
  deleteMany(): readonly string[] {
    return []
  }
  list(): readonly MemoryRecord[] {
    return []
  }
  searchLexical(): readonly MemoryRecord[] {
    return []
  }
  clear(): void {}
}

class EmptyRetrieval implements MemoryRetrievalStrategy {
  search(): readonly MemoryRecord[] {
    return []
  }
}

async function noFalseSuccess(): Promise<void> {
  const runtime = new MemoryRuntime(new FailingStore(), new EmptyRetrieval(), new MemoryPolicy())
  const broker = new MemoryToolBroker(runtime)
  let call = 0
  const provider: LLMProvider = {
    capabilities: () => TOOL_CAPABILITIES,
    chat: async () => {
      throw new Error('unexpected chat')
    },
    complete: async (messages) => {
      call += 1
      if (call === 1) {
        return toolCompletion('memory_store', {
          memories: [
            {
              kind: 'preference',
              text: 'Пользователь любит зелёный чай.',
            },
          ],
        })
      }
      const result = messages.find((message) => message.role === 'tool')
      assert.equal(
        typeof result?.content === 'string' && result.content.includes('MEMORY_UNAVAILABLE'),
        true,
      )
      return {
        content: '[calm]Сейчас не получилось сохранить это в долговременной памяти.',
        finishReason: 'stop',
        toolCalls: [],
      }
    },
  }
  const reply = await createOrchestrator(provider, broker).createReply(
    { userText: 'Учти на будущее, что я люблю зелёный чай.' },
    { traceId: 'turn-failure' },
  )
  assert.match(reply.replyText, /не получилось сохранить/u)
  runtime.close()
}

async function transportToolContract(): Promise<void> {
  const raw = {
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'memory_list', arguments: '{"limit":8}' },
            },
          ],
        },
      },
    ],
  }
  const parsed = parseChatCompletion('groq', 'Groq', raw)
  assert.equal(parsed.toolCalls[0]?.name, 'memory_list')

  let requestBody: Record<string, unknown> | null = null
  const http = {
    post: async (_path: string, body: Record<string, unknown>) => {
      requestBody = body
      return { data: raw }
    },
  }
  await runChatCompletionDetailed(
    {
      provider: 'groq',
      displayName: 'Groq',
      http: http as never,
      chatPath: '/chat/completions',
      apiKey: 'test-key',
      model: 'llama-3.3-70b-versatile',
      capabilities: TOOL_CAPABILITIES,
      messages: [{ role: 'user', content: 'list memory' }],
    },
    {
      tools: [
        {
          name: 'memory_list',
          description: 'List memory',
          parameters: { type: 'object', properties: {} },
        },
      ],
      toolChoice: 'auto',
    },
  )
  assert.equal(Array.isArray(requestBody?.tools), true)
  assert.equal(requestBody?.tool_choice, 'auto')
  assert.equal(requestBody?.parallel_tool_calls, false)
}

async function run(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'shio-memory-repro-'))
  try {
    await nativeAndFallbackPaths(root)
    await rejectedNativeToolsDowngradeToFallback(root)
    await recoverableProviderRequestsRetryOnce(root)
    await semanticStorePhrasingMatrix(root)
    await questionFormPersistenceContract(root)
    await semanticForgetPhrasingMatrix(root)
    await semanticUpdatePhrasingMatrix(root)
    await semanticRecallPhrasingMatrix(root)
    await irrelevantTurnDoesNotInvokeMemory(root)
    policyAndMutationSafety(root)
    await multiOperationFallback(root)
    await committedForgetSurvivesNarrationFailure(root)
    await ambiguityDoesNotDelete(root)
    await boundedToolLoop(root)
    await controlMarkersAreContained(root)
    boundedPayloads(root)
    await noFalseSuccess()
    await transportToolContract()
  } finally {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    } catch (error) {
      console.warn('Memory repro temporary cleanup failed', {
        code: error && typeof error === 'object' && 'code' in error ? error.code : 'UNKNOWN',
      })
    }
  }
  console.log('Semantic long-term memory repro passed')
}

void run()
