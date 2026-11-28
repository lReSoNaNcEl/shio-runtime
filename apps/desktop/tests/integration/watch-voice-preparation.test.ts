import { describe, expect, it, vi } from 'vitest'

import type { CharacterToolLoopStreamEvent } from '../../src/main/character-tools'
import type { LLMProvider } from '../../src/main/llm'
import { InMemoryStore } from '../../src/main/memory/InMemoryStore'
import { type CharacterReplyInput, Orchestrator } from '../../src/main/orchestrator'
import type { AppSettings } from '../../src/shared/config'
import { createDeferred } from '../support/Deferred'

const source = {
  sessionId: 'session-one',
  utteranceId: 'voice-one',
  userText: 'What is on my screen?',
  frame: new Uint8Array([61]),
  frameTiles: { columns: 1, images: [new Uint8Array([62])] },
  transcript: 'sound from the selected source',
  recentScenes: ['A blue rectangle appeared.'],
}
const watch = { ...source, fromMicrophone: true, addressedVoice: true, directVoice: true }
const answer = '[calm]A blue rectangle is on screen.'
const fresh = '[calm]A fresh reply.'

function harness(provider?: LLMProvider) {
  const chat = vi.fn<LLMProvider['chat']>().mockResolvedValueOnce(answer).mockResolvedValue(fresh)
  const memory = new InMemoryStore()
  const providerSettings = {
    model: 'gpt-6-luna',
    accountId: 'original',
    codexReasoningByModel: { 'gpt-6-luna': 'low' },
  }
  const settings = {
    uiLocale: 'en',
    llm: { activeProvider: 'codex-cli', providers: { 'codex-cli': providerSettings } },
  } as unknown as AppSettings
  const sideEffect = vi.fn()
  const runtime = new Orchestrator(
    provider ?? { chat },
    memory,
    () => settings,
    sideEffect,
    { snapshot: sideEffect },
    sideEffect,
    sideEffect,
  )
  const owner = new AbortController()
  const held = runtime.prepareWatchVoiceReply(source, owner.signal)
  const events: CharacterToolLoopStreamEvent[] = []
  const admit = (
    overrides: Partial<CharacterReplyInput> = {},
    traceId = source.utteranceId,
    signal = owner.signal,
  ) =>
    runtime.createReply(
      {
        userText: source.userText,
        origin: 'watch-user',
        watchContext: { ...watch, preparedReply: held },
        ...overrides,
      },
      { traceId, signal, onStreamEvent: (event) => events.push(event) },
    )
  return { chat, memory, owner, held, admit, events, sideEffect, providerSettings }
}

describe('prepared direct watch voice reply', () => {
  it.each(['prepared', 'unprepared'] as const)(
    'uses ordinary chat once after an invalid %s opening',
    async (mode) => {
      const complete = vi.fn<NonNullable<LLMProvider['complete']>>().mockResolvedValue({
        content: '{"opening":false,"more":true}',
        finishReason: 'stop',
        toolCalls: [],
      })
      const chat = vi.fn<LLMProvider['chat']>().mockResolvedValue(fresh)
      const t = harness({ chat, complete })
      await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce())
      if (mode === 'unprepared') {
        t.held.discard()
        complete.mockClear()
      }
      const result = await t.admit(mode === 'unprepared' ? { watchContext: watch } : {})
      expect(result.replyText).toBe(fresh)
      expect(complete).toHaveBeenCalledOnce()
      expect(chat).toHaveBeenCalledOnce()
      expect(t.events.some((e) => e.type === 'text-delta')).toBe(false)
    },
  )

  it('releases the first meaningful sentence before its continuation and waits for admission to start the second call', async () => {
    const complete = vi.fn<NonNullable<LLMProvider['complete']>>().mockResolvedValue({
      content: JSON.stringify({ opening: '[calm]A blue rectangle.', more: true }),
      finishReason: 'stop',
      toolCalls: [],
    })
    const tail = createDeferred<string>()
    const chat = vi.fn<LLMProvider['chat']>().mockImplementation(() => tail.promise)
    const t = harness({ chat, complete })
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce())
    expect(chat).not.toHaveBeenCalled()
    expect(t.events).toEqual([])
    const pending = t.admit()
    await vi.waitFor(() => expect(chat).toHaveBeenCalledOnce())
    const spoken = () =>
      t.events.flatMap((e) => (e.type === 'text-delta' ? [e.delta.text] : [])).join('')
    expect(spoken()).toBe('A blue rectangle. ')
    expect(
      chat.mock.calls[0][0].some(
        (m) => m.role === 'assistant' && m.content === '[calm]A blue rectangle.',
      ),
    ).toBe(true)
    tail.resolve('Its sides have equal length.')
    expect((await pending).replyText).toBe('[calm]A blue rectangle. Its sides have equal length.')
    expect(spoken()).toBe('A blue rectangle. Its sides have equal length.')
    expect(await t.memory.getHistory('default')).toHaveLength(2)
    expect(t.sideEffect).not.toHaveBeenCalled()
  })

  it('keeps a short answer in one CLI call', async () => {
    const complete = vi.fn<NonNullable<LLMProvider['complete']>>().mockResolvedValue({
      content: JSON.stringify({ opening: answer, more: false }),
      finishReason: 'stop',
      toolCalls: [],
    })
    const chat = vi.fn<LLMProvider['chat']>()
    const t = harness({ chat, complete })
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce())
    expect((await t.admit()).replyText).toBe(answer)
    expect(chat).not.toHaveBeenCalled()
  })

  it.each(['prepared', 'unprepared'] as const)(
    'does not repeat a published %s opening if the continuation fails',
    async (mode) => {
      const complete = vi.fn<NonNullable<LLMProvider['complete']>>().mockResolvedValue({
        content: JSON.stringify({ opening: '[calm]A blue rectangle.', more: true }),
        finishReason: 'stop',
        toolCalls: [],
      })
      const chat = vi.fn<LLMProvider['chat']>().mockRejectedValue(new Error('continuation stopped'))
      const t = harness({ chat, complete })
      await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce())
      if (mode === 'unprepared') {
        t.held.discard()
        complete.mockClear()
      }
      await t.admit(mode === 'unprepared' ? { watchContext: watch } : {}).catch(() => undefined)
      expect(complete).toHaveBeenCalledOnce()
      expect(chat).toHaveBeenCalledOnce()
      expect(
        t.events.flatMap((e) => (e.type === 'text-delta' ? [e.delta.text] : [])).join(''),
      ).toBe('A blue rectangle. ')
      expect(t.sideEffect).not.toHaveBeenCalled()
    },
  )

  it('discards an unadmitted opening without asking for its continuation', async () => {
    const complete = vi.fn<NonNullable<LLMProvider['complete']>>().mockResolvedValue({
      content: JSON.stringify({ opening: '[calm]A blue rectangle.', more: true }),
      finishReason: 'stop',
      toolCalls: [],
    })
    const chat = vi.fn<LLMProvider['chat']>()
    const t = harness({ chat, complete })
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce())
    t.held.discard()
    await Promise.resolve()
    expect(complete.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(chat).not.toHaveBeenCalled()
    expect(t.events).toEqual([])
  })

  it('holds a completed CLI response before admission, exposes only filtered prose and records the admitted turn once', async () => {
    const test = harness()
    await vi.waitFor(() => expect(test.chat).toHaveBeenCalledTimes(1))
    expect(test.chat.mock.calls[0][1]?.traceId).toBe(source.utteranceId)
    expect(await test.memory.getHistory('default')).toEqual([])
    expect(test.events).toEqual([])
    expect(test.sideEffect).not.toHaveBeenCalled()
    const result = await test.admit()
    expect(result.replyText).toBe(answer)
    expect(
      test.events
        .flatMap((event) => (event.type === 'text-delta' ? [event.delta.text] : []))
        .join(''),
    ).toBe(answer.slice(6))
    expect(test.chat).toHaveBeenCalledTimes(1)
    expect(test.sideEffect).not.toHaveBeenCalled()
    const history = await test.memory.getHistory('default')
    expect(history).toHaveLength(2)
    expect(JSON.stringify(history)).not.toContain(source.transcript)
    expect((await test.admit()).replyText).toBe(fresh)
    expect(test.chat).toHaveBeenCalledTimes(2)
  })

  it('replays a held sentence and forwards further safe deltas after the verified turn starts', async () => {
    const waiting = createDeferred<void>()
    const rest = createDeferred<void>()
    const stream = vi.fn<NonNullable<LLMProvider['stream']>>(() =>
      (async function* () {
        yield { type: 'text-delta' as const, text: '[calm]One sentence for the user. ', at: 1 }
        waiting.resolve()
        await rest.promise
        yield { type: 'text-delta' as const, text: 'It is blue.', at: Date.now() }
        yield { type: 'completed' as const, finishReason: 'stop' as const, at: Date.now() }
      })(),
    )
    const test = harness({
      chat: vi.fn(),
      stream,
      capabilities: () =>
        ({ supportsStreaming: true }) as ReturnType<NonNullable<LLMProvider['capabilities']>>,
    })
    await waiting.promise
    expect(test.events).toEqual([])
    const admittedAt = Date.now()
    const result = test.admit()
    await vi.waitFor(() =>
      expect(test.events.some((event) => event.type === 'text-delta')).toBe(true),
    )
    expect(test.events[0].at).toBeGreaterThanOrEqual(admittedAt)
    expect(await test.memory.getHistory('default')).toEqual([])
    rest.resolve()
    expect((await result).replyText).toContain('It is blue.')
    expect(stream).toHaveBeenCalledTimes(1)
    expect(
      test.events
        .flatMap((event) => (event.type === 'text-delta' ? [event.delta.text] : []))
        .join(''),
    ).toBe('One sentence for the user. It is blue.')
  })

  it.each([
    'session',
    'turn',
    'trace',
    'words',
    'frame',
    'tiles',
    'scene',
    'playback',
    'unconfirmed',
    'interrupted',
    'model',
    'effort',
    'account',
    'history',
  ] as const)('discards a held answer if the admitted %s differs', async (mismatch) => {
    const t = harness()
    await vi.waitFor(() => expect(t.chat).toHaveBeenCalledTimes(1))
    const context = { ...watch, preparedReply: t.held }
    const overrides: Partial<CharacterReplyInput> = { watchContext: context }
    let traceId = source.utteranceId
    switch (mismatch) {
      case 'session':
        context.sessionId = 'another'
        break
      case 'turn':
        context.utteranceId = 'new-utterance'
        traceId = context.utteranceId
        break
      case 'trace':
        traceId = 'another-request'
        break
      case 'words':
        overrides.userText = 'What now?'
        break
      case 'frame':
        context.frame = new Uint8Array([61])
        break
      case 'tiles':
        context.frameTiles = { columns: 1, images: [new Uint8Array([63])] }
        break
      case 'scene':
        context.recentScenes = []
        break
      case 'playback':
        context.transcript = 'Another observation.'
        break
      case 'unconfirmed':
        context.addressedVoice = false
        break
      case 'interrupted':
        overrides.interruptedTurn = {
          userText: 'earlier words',
          visibleReply: 'interrupted answer',
        }
        break
      case 'model':
        t.providerSettings.model = 'updated-model'
        break
      case 'effort':
        t.providerSettings.codexReasoningByModel['gpt-6-luna'] = 'medium'
        break
      case 'account':
        t.providerSettings.accountId = 'new-account'
        break
      case 'history':
        await t.memory.appendTurn('default', {
          user: { role: 'user', content: 'other input' },
          assistant: { role: 'assistant', content: 'other response' },
        })
        break
    }
    expect((await t.admit(overrides, traceId)).replyText).toBe(fresh)
    expect(t.chat).toHaveBeenCalledTimes(2)
    expect(t.events).toEqual([])
  })

  it('discards a structured tool instruction from the candidate and falls back once without publishing it', async () => {
    const chat = vi
      .fn<LLMProvider['chat']>()
      .mockResolvedValueOnce(
        '<shio-tools>{"calls":[{"name":"web.search","arguments":{"query":"ignored"}}]}</shio-tools>',
      )
      .mockResolvedValue(fresh)
    const t = harness({ chat })
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1))
    expect((await t.admit()).replyText).toBe(fresh)
    expect(chat).toHaveBeenCalledTimes(2)
    expect(t.events).toEqual([])
    expect(t.sideEffect).not.toHaveBeenCalled()
  })

  it('expires held work even when no admission or explicit discard arrives', async () => {
    vi.useFakeTimers()
    try {
      const t = harness()
      await vi.advanceTimersByTimeAsync(0)
      const signal = t.chat.mock.calls[0][1]?.signal
      expect(signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(20_001)
      expect(signal?.aborted).toBe(true)
      expect(t.events).toEqual([])
      expect(await t.memory.getHistory('default')).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['aside', 'session shutdown', 'admitted cancellation'] as const)(
    'aborts actual provider work on %s and leaves no stored or visible reply',
    async (reason) => {
      const pending = createDeferred<string>()
      const started = createDeferred<AbortSignal>()
      const chat = vi.fn<LLMProvider['chat']>(async (_messages, options) => {
        const signal = options?.signal
        if (!signal) throw new Error('Missing cancellation')
        signal.addEventListener('abort', () => pending.reject(signal.reason), { once: true })
        started.resolve(signal)
        return pending.promise
      })
      const t = harness({ chat })
      const upstream = await started.promise
      if (reason === 'admitted cancellation') {
        const admitted = new AbortController()
        const response = t.admit({}, source.utteranceId, admitted.signal)
        await new Promise((resolve) => setTimeout(resolve, 0))
        admitted.abort()
        await expect(response).rejects.toThrow()
      } else if (reason === 'aside') t.held.discard()
      else t.owner.abort()
      expect(upstream.aborted).toBe(true)
      expect(chat).toHaveBeenCalledTimes(1)
      expect(t.events).toEqual([])
      expect(t.sideEffect).not.toHaveBeenCalled()
      expect(await t.memory.getHistory('default')).toEqual([])
    },
  )
})
