import { describe, expect, it } from 'vitest'

import {
  SPECULATIVE_REPLY_MAX_CHARACTERS,
  SpeculativeDirectReply,
} from '../../src/main/character-tools/CharacterSpeculativeReply'
import {
  CharacterToolLoop,
  type CharacterToolLoopStreamEvent,
} from '../../src/main/character-tools/CharacterToolLoop'
import { CharacterToolRegistry } from '../../src/main/character-tools/CharacterToolRegistry'
import type {
  ChatMessage,
  LlmCapabilities,
  LlmCompletion,
  LlmRequestOptions,
  LlmStreamOptions,
} from '../../src/main/llm'
import { LlmResponseError } from '../../src/main/llm/errors'
import type { EmbodimentAvailability } from '../../src/shared/character-response'
import type { CharacterStreamEvent } from '../../src/shared/character-stream'
import { createDeferred, type Deferred } from '../support/Deferred'

const capabilities: LlmCapabilities = {
  supportsReasoning: false,
  supportsStreaming: true,
  supportsTemperature: true,
  supportsSystemPrompt: true,
  supportsToolCalling: false,
  supportsVision: false,
  supportsSchemaOutput: true,
  recommendedMaxTokens: 1_024,
}

const emptyRegistry = () =>
  new CharacterToolRegistry({
    projectAvailable: false,
    webAvailable: false,
    capabilityContext: null,
    browserObservation: null,
    actionsAvailable: false,
  })

const projectRegistry = () =>
  new CharacterToolRegistry({
    projectAvailable: true,
    capabilityContext: null,
    browserObservation: null,
    actionsAvailable: false,
  })

interface StreamCall {
  messages: readonly ChatMessage[]
  options: LlmStreamOptions
  events: Deferred<readonly CharacterStreamEvent[]>
  failure?: Deferred<never>
}

/** Fake provider: planning and each stream complete only when the test says so. */
function harness(plan: Record<string, unknown>, availability?: EmbodimentAvailability) {
  const planning = createDeferred<LlmCompletion>()
  const streams: StreamCall[] = []
  const seen: CharacterToolLoopStreamEvent[] = []
  const llm = {
    capabilities: () => capabilities,
    chat: async () => '[calm]unused',
    complete: async (_messages: readonly ChatMessage[], options?: { responseSchema?: unknown }) => {
      if (!options?.responseSchema) throw new Error('unexpected completion')
      const signal = (options as { signal?: AbortSignal }).signal
      return Promise.race([
        planning.promise,
        new Promise<never>((_, reject) =>
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true }),
        ),
      ])
    },
    stream: (messages: readonly ChatMessage[], options: LlmStreamOptions = {}) => {
      const call: StreamCall = { messages, options, events: createDeferred() }
      streams.push(call)
      return (async function* () {
        const events = await call.events.promise
        for (const event of events) {
          if (options.signal?.aborted)
            throw new LlmResponseError({
              provider: 'mistral',
              code: 'CANCELLED',
              message: 'aborted',
            })
          yield event
        }
      })()
    },
  }
  const controller = new AbortController()
  const run = (speculative: boolean) =>
    new CharacterToolLoop().run({
      llm,
      providerId: 'mistral',
      messages: [{ role: 'user', content: 'Привет!' }],
      registry: emptyRegistry,
      createDispatcher: () =>
        ({ registerPlannedTools: () => undefined, dispose: () => undefined }) as never,
      traceId: 'speculative',
      signal: controller.signal,
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      speculativeDirectReply: speculative,
      ...(availability ? { embodimentAvailability: availability } : {}),
      failureReply: 'FAILURE',
      limitReply: 'LIMIT',
      onStreamEvent: (event) => seen.push(event),
    })
  const resolvePlan = () =>
    planning.resolve({ content: JSON.stringify(plan), toolCalls: [], finishReason: 'stop' })
  return { streams, seen, run, resolvePlan, controller }
}

const reply = (text: string): CharacterStreamEvent[] => [
  { type: 'first-byte', at: 1 },
  { type: 'text-delta', at: 2, text },
  { type: 'completed', at: 3, finishReason: 'stop' },
]
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const texts = (events: readonly CharacterToolLoopStreamEvent[]) =>
  events.flatMap((event) => (event.type === 'text-delta' ? [event.delta.text] : []))

const DIRECT = { requirement: { type: 'direct-answer' }, plannedTools: [], embodiment: null }

function textOnlyHarness(registry: () => CharacterToolRegistry) {
  const calls: {
    messages: readonly ChatMessage[]
    options: LlmRequestOptions
    content: Deferred<string>
  }[] = []
  const run = (speculative: boolean) =>
    new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({
          ...capabilities,
          supportsStreaming: false,
          supportsSchemaOutput: false,
        }),
        chat: (messages, options = {}) => {
          const content = createDeferred<string>()
          calls.push({ messages, options, content })
          return content.promise
        },
      },
      providerId: 'codex-cli',
      messages: [{ role: 'user', content: 'Как дела?' }],
      registry,
      createDispatcher: () =>
        ({ registerPlannedTools: () => undefined, dispose: () => undefined }) as never,
      traceId: 'text-only-speculation',
      requestOptions: { maxTokens: 1000 },
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      speculativeDirectReply: speculative,
      failureReply: 'FAILURE',
      limitReply: 'LIMIT',
    })
  return { calls, run }
}

describe('speculative direct reply', () => {
  it.each([
    { path: 'direct', registry: emptyRegistry },
    { path: 'structured', registry: projectRegistry },
  ])(
    'runs the exact non-streaming $path answer while the plan is pending',
    async ({ registry }) => {
      const speculative = textOnlyHarness(registry)
      const turn = speculative.run(true)
      let finished = false
      const completion = turn.then((result) => {
        finished = true
        return result
      })
      expect(speculative.calls).toHaveLength(2)
      const [draft, planner] = speculative.calls
      draft.content.resolve('[calm]Хорошо.')
      await flush()
      expect(finished).toBe(false)
      planner.content.resolve(JSON.stringify(DIRECT))
      expect((await completion).replyText).toBe('[calm]Хорошо.')
      expect(speculative.calls).toHaveLength(2)

      const sequential = textOnlyHarness(registry)
      const sequentialTurn = sequential.run(false)
      expect(sequential.calls).toHaveLength(1)
      sequential.calls[0].content.resolve(JSON.stringify(DIRECT))
      await flush()
      expect(sequential.calls).toHaveLength(2)
      const actual = sequential.calls[1]
      const { signal: _draftSignal, ...draftOptions } = draft.options
      const { signal: _actualSignal, ...actualOptions } = actual.options
      expect(draft.messages).toEqual(actual.messages)
      expect(draftOptions).toEqual(actualOptions)
      actual.content.resolve('[calm]Хорошо.')
      expect((await sequentialTurn).replyText).toBe('[calm]Хорошо.')
    },
  )

  it('discards a non-streaming draft when the plan permits a tool', async () => {
    const { calls, run } = textOnlyHarness(projectRegistry)
    const turn = run(true)
    calls[0].content.resolve('[calm]Неподходящий черновик.')
    calls[1].content.resolve(JSON.stringify({ ...DIRECT, plannedTools: ['project.search'] }))
    await flush()
    expect(calls[0].options.signal?.aborted).toBe(true)
    expect(calls).toHaveLength(3)
    calls[2].content.resolve('[calm]Отвечаю по плану.')
    expect((await turn).replyText).toBe('[calm]Отвечаю по плану.')
  })

  it('starts the reply before the plan and releases it in order on a direct plan', async () => {
    const { streams, seen, run, resolvePlan } = harness(DIRECT)
    const turn = run(true)
    await flush()
    expect(streams).toHaveLength(1)
    streams[0].events.resolve(reply('[calm]Привет!'))
    await flush()
    expect(texts(seen)).toEqual([])
    resolvePlan()
    const result = await turn
    expect(streams).toHaveLength(1)
    expect(result.replyText).toBe('[calm]Привет!')
    expect(texts(seen).join('')).toBe('Привет!')
  })

  it('sends exactly the request the turn would send without speculation', async () => {
    const speculative = harness(DIRECT)
    const first = speculative.run(true)
    await flush()
    speculative.streams[0].events.resolve(reply('[calm]Ок.'))
    speculative.resolvePlan()
    await first
    const plain = harness(DIRECT)
    const second = plain.run(false)
    plain.resolvePlan()
    await flush()
    plain.streams[0].events.resolve(reply('[calm]Ок.'))
    await second
    expect(speculative.streams[0].messages).toEqual(plain.streams[0].messages)
    const { signal: _a, ...speculativeOptions } = speculative.streams[0].options
    const { signal: _b, ...plainOptions } = plain.streams[0].options
    expect(speculativeOptions).toEqual(plainOptions)
  })

  it('aborts the speculation without showing it when the plan wants a gesture or tools', async () => {
    const { streams, seen, run, resolvePlan } = harness(
      { ...DIRECT, embodiment: { intensity: 'normal', gestureHint: 'greeting' } },
      {
        version: 2,
        catalogRevision: 'fixture',
        modelGeneration: 1,
        availableSemanticIntents: ['greeting'],
        unavailableReasons: [],
        qualification: 'qualified',
      },
    )
    const turn = run(true)
    await flush()
    resolvePlan()
    await flush()
    expect(streams[0].options.signal?.aborted).toBe(true)
    streams[0].events.resolve(reply('[calm]СПЕКУЛЯЦИЯ'))
    await flush()
    expect(streams).toHaveLength(2)
    streams[1].events.resolve(reply('[calm]Настоящий ответ.'))
    const result = await turn
    expect(result.replyText).toBe('[calm]Настоящий ответ.')
    expect(texts(seen).join('')).not.toContain('СПЕКУЛЯЦИЯ')
  })

  it('falls back to a fresh request without duplication when the speculation fails', async () => {
    const { streams, seen, run, resolvePlan } = harness(DIRECT)
    const turn = run(true)
    await flush()
    streams[0].events.reject(
      new LlmResponseError({ provider: 'mistral', code: 'PROVIDER_REJECTED', message: 'bad' }),
    )
    await flush()
    resolvePlan()
    await flush()
    expect(streams).toHaveLength(2)
    streams[1].events.resolve(reply('[calm]Одна копия.'))
    const result = await turn
    expect(result.replyText).toBe('[calm]Одна копия.')
    expect(texts(seen).join('')).toBe('Одна копия.')
  })

  it('cancels both requests when the turn is cancelled', async () => {
    const { streams, run, controller } = harness(DIRECT)
    const turn = run(true)
    await flush()
    controller.abort()
    await expect(turn).rejects.toBeDefined()
    expect(streams[0].options.signal?.aborted).toBe(true)
  })

  it('stays off by default', async () => {
    const { streams, run, resolvePlan } = harness(DIRECT)
    const turn = run(false)
    await flush()
    expect(streams).toHaveLength(0)
    resolvePlan()
    await flush()
    streams[0].events.resolve(reply('[calm]Ок.'))
    await turn
    expect(streams).toHaveLength(1)
  })
})

describe('speculative reply buffer', () => {
  it('does not keep an oversized completed draft while planning is still pending', async () => {
    const reply = new SpeculativeDirectReply(new AbortController().signal, async () => ({
      content: 'x'.repeat(SPECULATIVE_REPLY_MAX_CHARACTERS + 1),
      toolCalls: [],
      finishReason: 'stop',
    }))
    await expect(reply.completion).rejects.toThrow('buffer-overflow')
    expect(reply.signal.aborted).toBe(true)
    expect(reply.release(() => undefined)).toBeNull()
  })

  it('cancels upstream after a draft has been released', async () => {
    const parent = new AbortController()
    const seen: CharacterToolLoopStreamEvent[] = []
    let emit!: (value: CharacterToolLoopStreamEvent) => void
    const reply = new SpeculativeDirectReply(parent.signal, (onEvent, signal) => {
      emit = onEvent
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      )
    })
    const completion = reply.release((value) => seen.push(value))
    emit(event('before'))
    parent.abort(new Error('cancelled after release'))
    emit(event('late'))
    await expect(completion).rejects.toThrow('cancelled after release')
    expect(texts(seen)).toEqual(['before'])
  })

  const event = (text: string): CharacterToolLoopStreamEvent => ({
    type: 'text-delta',
    at: 1,
    llmRound: 0,
    delta: { text, emotion: 'calm' } as never,
  })

  it('holds events until release and forwards later ones live', async () => {
    let emit!: (event: CharacterToolLoopStreamEvent) => void
    const done = createDeferred<LlmCompletion>()
    const reply = new SpeculativeDirectReply(new AbortController().signal, (onEvent) => {
      emit = onEvent
      return done.promise
    })
    emit(event('a'))
    const seen: string[] = []
    const pending = reply.release((value) => {
      if (value.type === 'text-delta') seen.push(value.delta.text)
    })
    emit(event('b'))
    done.resolve({ content: 'ab', toolCalls: [], finishReason: 'stop' })
    expect(await pending).toMatchObject({ content: 'ab' })
    expect(seen).toEqual(['a', 'b'])
    expect(reply.hasForwardedText()).toBe(true)
  })

  it('discards on overflow, expiry and parent abort, and never releases afterwards', () => {
    let emit!: (event: CharacterToolLoopStreamEvent) => void
    const overflow = new SpeculativeDirectReply(new AbortController().signal, (onEvent, signal) => {
      emit = onEvent
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      )
    })
    emit(event('x'.repeat(SPECULATIVE_REPLY_MAX_CHARACTERS + 1)))
    expect(overflow.signal.aborted).toBe(true)
    expect(overflow.release(() => undefined)).toBeNull()

    let now = 0
    const expired = new SpeculativeDirectReply(
      new AbortController().signal,
      () => new Promise(() => undefined),
      () => now,
    )
    now = 60_000
    expect(expired.release(() => undefined)).toBeNull()
    expect(expired.signal.aborted).toBe(true)

    const parent = new AbortController()
    const cancelled = new SpeculativeDirectReply(parent.signal, () => new Promise(() => undefined))
    parent.abort()
    expect(cancelled.signal.aborted).toBe(true)
    cancelled.discard('cancelled')
  })
})
