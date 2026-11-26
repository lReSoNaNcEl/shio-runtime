import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

import { PERSONA_PROMPT_SECTIONS } from '../../src/main/character/prompting/persona.generated'
import { LlmResponseError } from '../../src/main/llm/errors'
import type { LLMProvider } from '../../src/main/llm/types'
import { InMemoryStore } from '../../src/main/memory/InMemoryStore'
import { Orchestrator } from '../../src/main/orchestrator'
import { WatchTogetherService } from '../../src/main/watch-together/WatchTogetherService'
import {
  containsPlaybackPhrase,
  textSimilarity,
} from '../../src/renderer/speech/continuous-listening/textAnalysis'
import { bargeInTuning } from '../../src/renderer/speech/continuous-listening/tuning'
import type { AppSettings } from '../../src/shared/config'
import {
  WATCH_FRAME_HEIGHT,
  WATCH_FRAME_WIDTH,
  type WatchBlockReason,
  watchReferenceUrl,
} from '../../src/shared/watchTogether'

const moment = (observation: string, reaction = 'quiet', line = '', evidenceIds = ['screen-1']) =>
  JSON.stringify({ observation, reaction, line, evidenceIds })

function dependencies(chat: LLMProvider['chat']) {
  return {
    language: () => 'ru',
    captureBlock: vi.fn<() => WatchBlockReason | undefined>(() => undefined),
    canComment: vi.fn(() => true),
    model: () => ({ chat }),
    admit: vi.fn(async (_at: number, current: () => boolean) => current()),
    react: vi.fn(),
    ended: vi.fn(),
  }
}

async function fixture(
  chat: LLMProvider['chat'],
  reference?: NonNullable<ConstructorParameters<typeof WatchTogetherService>[0]['reference']>,
  url?: string,
) {
  const deps = { ...dependencies(chat), reference }
  const watch = new WatchTogetherService(deps)
  const result = watch.start('window:1:0', url)
  if (result.kind !== 'started') throw new Error('Expected a watch session')
  const { id } = result
  const jpeg = await sharp({
    create: {
      width: WATCH_FRAME_WIDTH * 2,
      height: WATCH_FRAME_HEIGHT,
      channels: 3,
      background: 'blue',
    },
  })
    .jpeg()
    .toBuffer()
  const input = {
    sessionId: id,
    endedAt: Date.now(),
    frames: Uint8Array.from(jpeg).buffer,
    pcm: new Int16Array(32000).fill(2000).buffer,
    playbackTranscript: 'The bridge is solid.',
  }
  return { watch, id, deps, input }
}
describe('Watch Together', () => {
  it('skips repeated silent frames and a settled transition without suppressing a later change', async () => {
    const chat = vi.fn<LLMProvider['chat']>(async () => moment('scene'))
    const { watch, id, input } = await fixture(chat)
    const red = await sharp({
      create: {
        width: WATCH_FRAME_WIDTH,
        height: WATCH_FRAME_HEIGHT,
        channels: 3,
        background: 'red',
      },
    })
      .png()
      .toBuffer()
    const transition = await sharp(Buffer.from(input.frames))
      .composite([{ input: red, left: 0, top: 0 }])
      .jpeg()
      .toBuffer()
    const back = await sharp(Buffer.from(input.frames))
      .composite([{ input: red, left: WATCH_FRAME_WIDTH, top: 0 }])
      .jpeg()
      .toBuffer()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(input.endedAt)
    try {
      watch.takeGrant()
      for (const [image, calls] of [
        [transition, 1],
        [transition, 1],
        [Buffer.from(input.frames), 1],
        [back, 2],
      ] as const) {
        clock.mockReturnValue(Date.now() + 5_000)
        await watch.observe({
          ...input,
          endedAt: Date.now(),
          pcm: new ArrayBuffer(0),
          playbackTranscript: '',
          frames: Uint8Array.from(image).buffer,
        })
        expect(chat).toHaveBeenCalledTimes(calls)
      }
    } finally {
      watch.stop(id)
      clock.mockRestore()
    }
  })

  it('only accepts an exact HTTPS destination for a reference', () => {
    expect(watchReferenceUrl('https://example.com')).toBe('https://example.com/')
    expect(watchReferenceUrl('https://example.com/docs?mode=all#details')).toBe(
      'https://example.com/docs?mode=all#details',
    )
    for (const value of [
      'https:example.com',
      'https://name:secret@example.com/',
      'https://@example.com/',
      'file:///path',
      'https:////example.com/',
    ]) {
      expect(watchReferenceUrl(value)).toBeUndefined()
    }
  })

  it('keeps screen evidence and Shio’s spoken line out of microphone address classification', async () => {
    const chat = vi
      .fn<LLMProvider['chat']>()
      .mockResolvedValueOnce(moment('external scene canary', 'comment', 'spoken canary'))
      .mockResolvedValueOnce(JSON.stringify({ disposition: 'addressed', summary: '' }))
    const { watch, id, input } = await fixture(chat)
    watch.takeGrant()
    try {
      const observed = await watch.observe(input)
      if (observed.kind !== 'comment') throw new Error('Expected comment on capture')
      watch.finishComment(id, observed.turnId, true)
      expect(await watch.classifySpeech(id, 'Can you see the screen?', false)).toBe('addressed')
      const classification = chat.mock.calls[1][0]
      expect(JSON.parse(String(classification[1].content))).toEqual({
        utterance: 'Can you see the screen?',
        recentAddress: false,
        recentlyCommented: true,
      })
      expect(JSON.stringify(classification)).not.toContain('canary')
      await watch.prepareTurn(id, 'reply', true)
      expect(watch.takeUserTurn('reply', 'Can you see the screen?')).toMatchObject({
        addressedVoice: true,
        recentScenes: ['external scene canary'],
      })
    } finally {
      watch.stop(id)
    }
  })

  it('binds a direct plan to one addressed utterance from this microphone and session', async () => {
    const direct = {
      disposition: 'direct-answer',
      summary: '',
    }
    const chat = vi.fn<LLMProvider['chat']>().mockResolvedValue(JSON.stringify(direct))
    const { watch, id } = await fixture(chat)
    watch.takeGrant()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(120)
    try {
      for (const [fromMic, text, advanceMs, expected] of [
        [false, 'Look', 0, false],
        [true, 'Other', 0, false],
        [true, 'Look', 12_001, false],
        [true, 'Look', 0, true],
      ] as const) {
        expect(await watch.classifySpeech(id, 'Look', false)).toBe('addressed')
        clock.mockReturnValue(Date.now() + advanceMs)
        await watch.prepareTurn(id, 'reply', fromMic)
        const context = watch.takeUserTurn('reply', text)
        expect(context?.addressedVoice).toBe(expected)
        expect(context?.directVoice).toBe(expected)
        await watch.prepareTurn(id, 'next', true)
        expect(watch.takeUserTurn('next', 'Other')?.directVoice).toBe(false)
      }
      chat.mockResolvedValueOnce(
        JSON.stringify({
          ...direct,
          directPlan: { requirement: { type: 'direct-answer' }, plannedTools: ['shell.execute'] },
        }),
      )
      expect(await watch.classifySpeech(id, 'Look', false)).toBeUndefined()
      await watch.prepareTurn(id, 'invalid-plan', true)
      expect(watch.takeUserTurn('invalid-plan', 'Look')).toMatchObject({
        directVoice: false,
        addressedVoice: false,
      })
    } finally {
      watch.stop(id)
      clock.mockRestore()
    }
  })

  it('classifies a first screen question with a constrained decision and no wake word', async () => {
    const text = 'Что видно на экране?'
    const chat = vi.fn<LLMProvider['chat']>().mockResolvedValue('{"disposition":"direct-answer"}')
    const complete = vi.fn<NonNullable<LLMProvider['complete']>>().mockResolvedValue({
      content: '{"disposition":"direct-answer","summary":""}',
      toolCalls: [],
      finishReason: 'stop',
    })
    const watch = new WatchTogetherService({
      ...dependencies(chat),
      model: () => ({ chat, complete }),
    })
    const session = watch.start('screen:1:0')
    if (session.kind !== 'started') throw new Error('Expected watch session')
    watch.takeGrant()
    try {
      expect(await watch.classifySpeech(session.id, text, false)).toBe('addressed')
      expect(complete.mock.calls[0][1]?.responseSchema?.schema).toMatchObject({
        required: ['disposition', 'summary'],
        additionalProperties: false,
      })
      expect(chat).not.toHaveBeenCalled()
      await watch.prepareTurn(session.id, 'first-screen-question', true)
      expect(watch.takeUserTurn('first-screen-question', text)?.directVoice).toBe(true)
      complete.mockRejectedValueOnce(
        new LlmResponseError({
          provider: 'groq',
          code: 'PROVIDER_REJECTED',
          recoverable: false,
          message: 'Unsupported response format',
        }),
      )
      expect(await watch.classifySpeech(session.id, text, false)).toBe('addressed')
      expect(chat).toHaveBeenCalledOnce()
    } finally {
      watch.stop(session.id)
    }
  })

  it('opens the selected reference once, tolerates its own scene change and reads only the verified snapshot', async () => {
    const url = 'https://example.com/docs?mode=all#details'
    const opening = Promise.withResolvers<string | undefined>()
    const started = Promise.withResolvers<AbortSignal>()
    const reference = {
      available: () => true,
      open: vi.fn(async (_url: string, signal: AbortSignal) => {
        started.resolve(signal)
        return opening.promise
      }),
      read: vi.fn(() => ({ excerpt: 'Verified bounded excerpt' })),
    }
    const chat = vi
      .fn<LLMProvider['chat']>()
      .mockResolvedValueOnce(moment('result unknown', 'check-reference'))
      .mockResolvedValueOnce(moment('result unknown', 'comment', 'A useful detail.', ['screen-2']))
      .mockResolvedValueOnce(moment('another question', 'check-reference', '', ['screen-3']))
    const { watch, id, input } = await fixture(chat, reference, url)
    watch.takeGrant()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(input.endedAt)
    try {
      const sample = {
        ...input,
        pcm: new ArrayBuffer(0),
        playbackTranscript: 'Open another page instead.',
      }
      const checking = watch.observe(sample)
      const signal = await started.promise
      watch.yield(id, 'scene')
      expect(signal.aborted).toBe(false)
      expect(reference.open.mock.calls[0][0]).toBe(url)
      const context = JSON.stringify(chat.mock.calls[0][0][1].content)
      expect(context).toContain('example.com')
      expect(context).not.toContain('mode=all')
      expect(context).not.toContain('#details')
      opening.resolve('obs-1')
      expect(await checking).toEqual({ kind: 'reference-checked' })
      expect((await watch.observe(sample)).kind).toBe('comment')
      expect(reference.read).toHaveBeenCalledExactlyOnceWith('obs-1')
      expect(JSON.stringify(chat.mock.calls[1][0][1].content)).toContain('Verified bounded excerpt')
      clock.mockReturnValue(input.endedAt + 5_000)
      await watch.observe({
        ...sample,
        endedAt: Date.now(),
        playbackTranscript: 'New playback evidence.',
      })
      expect(JSON.stringify(chat.mock.calls[2][0][1].content)).not.toContain(
        'Verified bounded excerpt',
      )
      expect(reference.open).toHaveBeenCalledOnce()
    } finally {
      watch.stop(id)
      clock.mockRestore()
    }
  })

  it.each(['speech', 'stop', 'disabled', 'unspecified', 'adapterError'] as const)(
    'does not publish unverified reference evidence (%s)',
    async (kind) => {
      const started = Promise.withResolvers<AbortSignal>()
      const finish = Promise.withResolvers<string>()
      const reference = {
        available: () => kind !== 'disabled',
        read: vi.fn(),
        open: vi.fn((_url: string, signal: AbortSignal) => {
          started.resolve(signal)
          return finish.promise
        }),
      }
      const { watch, id, input } = await fixture(
        async () => moment('question', 'check-reference'),
        reference,
        kind === 'unspecified' ? undefined : 'https://example.com/',
      )
      watch.takeGrant()
      const pending = watch.observe(input)
      if (kind === 'speech' || kind === 'stop' || kind === 'adapterError') {
        const signal = await started.promise
        if (kind === 'adapterError') finish.reject(new Error('navigation failed'))
        else {
          if (kind === 'speech') watch.yield(id)
          else watch.stop(id)
          expect(signal.aborted).toBe(true)
          finish.resolve('late')
        }
      } else {
        expect(reference.open).not.toHaveBeenCalled()
      }
      expect(await pending).toEqual({ kind: 'quiet' })
      expect(reference.read).not.toHaveBeenCalled()
      watch.stop(id)
    },
  )

  it('recognizes spoken echo without suppressing follow-ups that reuse words from the reply', () => {
    const reply = 'У тебя открыта страница Spaces. Это каталог, где видно, что ещё можно открыть.'
    const followUp = 'Что это за страница у меня открыта?'
    expect(textSimilarity(followUp, reply)).toBeGreaterThanOrEqual(
      bargeInTuning.selfEchoSimilarityThreshold,
    )
    expect(containsPlaybackPhrase(followUp, reply)).toBe(false)
    expect(containsPlaybackPhrase('Это каталог где видно что еще можно открыть', reply)).toBe(true)
    expect(containsPlaybackPhrase('каталог где', 'Это каталоги, где много приложений.')).toBe(false)
  })

  it('binds source speech to the user turn during cooldown and remembers their take within this session', async () => {
    const chat = vi.fn<LLMProvider['chat']>(async () => moment('bridge fell'))
    const { watch, deps, id, input } = await fixture(chat)
    watch.takeGrant()
    deps.canComment.mockReturnValue(false)
    await watch.prepareTurn(id, 'voice', true, undefined, 'The bridge is solid.')
    expect(watch.takeUserTurn('voice', 'So much for that bridge!')?.transcript).toBe(
      'The bridge is solid.',
    )
    expect(watch.takeUserTurn('voice')).toBeUndefined()
    deps.canComment.mockReturnValue(true)
    await watch.observe(input)
    expect(JSON.stringify(chat.mock.calls[0][0])).toContain('So much for that bridge!')
    await watch.prepareTurn(id, 'question', false)
    expect(watch.takeUserTurn('question')?.recentScenes).toEqual(['bridge fell'])
    watch.stop(id)
    const next = watch.start('screen:2:0')
    if (next.kind !== 'started') throw new Error('Expected next session')
    watch.takeGrant()
    await watch.prepareTurn(next.id, 'new', false)
    expect(watch.takeUserTurn('new')?.recentScenes).toEqual([])
    await watch.observe({ ...input, sessionId: next.id, endedAt: Date.now() })
    expect(JSON.stringify(chat.mock.calls[1][0])).not.toContain('So much for that bridge!')
  })

  it('grounds the user reply in the shared frame without consulting browser tools', async () => {
    const frame = new Uint8Array([1, 2, 3])
    const history = new InMemoryStore()
    const chat = vi.fn<LLMProvider['chat']>(async () => 'Вижу мост и синий шар.')
    const browser = vi.fn()
    const orchestrator = new Orchestrator(
      { chat },
      history,
      undefined,
      () => ({ uiLocale: 'ru' }) as AppSettings,
      undefined,
      undefined,
      undefined,
      browser,
    )
    const userText = 'Что сейчас на трансляции?'
    const result = await orchestrator.createReply({
      userText,
      origin: 'watch-user',
      watchContext: { frame, fromMicrophone: true },
    })
    expect(result.replyText).toBe('Вижу мост и синий шар.')
    expect(browser).not.toHaveBeenCalled()
    expect(chat.mock.calls[0][0].at(-1)?.content).toEqual([
      { type: 'text', text: JSON.stringify({ userRequest: userText, inputFromMicrophone: true }) },
      { type: 'image', mimeType: 'image/jpeg', bytes: frame },
    ])
    expect((await history.getHistory('default'))[0].content).toBe(userText)
  })

  it.each(['suspended', 'off', 'private'] as const)(
    'reports the %s block without creating a capture grant',
    (reason) => {
      const chat = vi.fn()
      const deps = dependencies(chat)
      deps.captureBlock.mockReturnValue(reason)
      const watch = new WatchTogetherService(deps)
      expect(watch.start('window:1:0')).toEqual({ kind: 'blocked', reason })
      expect(watch.takeGrant()).toBeUndefined()
      expect(chat).not.toHaveBeenCalled()
    },
  )

  it('shares the policy reason when revoking an active session', async () => {
    const { watch, deps, id, input } = await fixture(vi.fn())
    watch.takeGrant()
    deps.captureBlock.mockReturnValue('suspended')
    expect(await watch.observe(input)).toEqual({ kind: 'stopped' })
    watch.stop(undefined, 'suspended')
    expect(deps.ended).toHaveBeenCalledExactlyOnceWith({ id, reason: 'suspended' })
    expect(deps.admit).not.toHaveBeenCalled()
  })

  it('leases a valid current frame to one exact user turn and revokes it on stop', async () => {
    const { watch, id } = await fixture(vi.fn())
    const frame = await sharp({
      create: { width: 768, height: 432, channels: 3, background: 'blue' },
    })
      .jpeg()
      .toBuffer()
    await watch.prepareTurn(id, 'before-capture', true, Uint8Array.from(frame).buffer)
    expect(watch.takeUserTurn('before-capture')).toBeUndefined()
    watch.takeGrant()
    await watch.prepareTurn(id, 'user-1', true, Uint8Array.from(frame).buffer)
    expect(watch.takeUserTurn('user-2')).toBeUndefined()
    const context = watch.takeUserTurn('user-1')
    expect(context?.frame).toEqual(frame)
    expect(context?.fromMicrophone).toBe(true)
    expect(watch.takeUserTurn('user-1')).toBeUndefined()
    watch.stop(id)
    expect(context?.signal.aborted).toBe(true)
  })

  it('requires a one-use capture grant and policy approval before sampling, then admits a model-selected moment', async () => {
    const line = 'Ебать, мост сложился.'
    const chat = vi.fn<LLMProvider['chat']>(async () => moment('bridge fell', 'comment', line))
    const { watch, input, id, deps } = await fixture(chat)
    expect(await watch.observe(input)).toEqual({ kind: 'stopped' })
    expect(watch.takeGrant()).toEqual({ id, sourceId: 'window:1:0' })
    expect(watch.takeGrant()).toBeUndefined()
    deps.canComment.mockReturnValueOnce(false)
    expect(await watch.observe(input)).toEqual({ kind: 'quiet' })
    expect(chat).not.toHaveBeenCalled()
    const choice = await watch.observe(input)
    expect(chat.mock.calls[0][0][0].content).toContain(
      PERSONA_PROMPT_SECTIONS.personality.join('\n'),
    )
    expect(choice.kind).toBe('comment')
    if (choice.kind !== 'comment') throw new Error('Expected admitted commentary')
    expect(watch.takeReply('another-turn')).toBeUndefined()
    expect(watch.takeReply(choice.turnId)).toBe(line)
    expect(watch.takeReply(choice.turnId)).toBeUndefined()
    expect(deps.admit).toHaveBeenCalledOnce()
    watch.stop(id)
    expect(await watch.observe(input)).toEqual({ kind: 'stopped' })
  })
  it('lets the model stay silent and discards expired packets before inference', async () => {
    const { watch, deps, input } = await fixture(async () => moment('same shot'))
    watch.takeGrant()
    expect(await watch.observe({ ...input, endedAt: Date.now() - 40000 })).toEqual({
      kind: 'quiet',
    })
    expect(deps.admit).not.toHaveBeenCalled()
    expect(await watch.observe(input)).toEqual({ kind: 'quiet' })
    expect(deps.admit).not.toHaveBeenCalled()
  })
  it.each(['yield', 'stop'] as const)(
    'aborts in-flight inference and drops even an uncancellable late result on %s',
    async (action) => {
      let started!: () => void, finish!: (s: string) => void
      const ready = new Promise<void>((resolve) => {
        started = resolve
      })
      let signal: AbortSignal | undefined
      const { watch, deps, id, input } = await fixture(async (_messages, opts) => {
        signal = opts?.signal
        started()
        return new Promise<string>((resolve) => {
          finish = resolve
        })
      })
      watch.takeGrant()
      const result = watch.observe(input)
      await ready
      watch[action](id)
      expect(signal?.aborted).toBe(true)
      finish(moment('late event', 'comment', 'Too late'))
      expect(await result).toEqual({ kind: 'quiet' })
      expect(deps.admit).not.toHaveBeenCalled()
    },
  )

  it('connects screen observations to a recent aside without requiring playback audio', async () => {
    const chat = vi
      .fn<LLMProvider['chat']>()
      .mockResolvedValueOnce(moment('Build failed'))
      .mockResolvedValueOnce(JSON.stringify({ disposition: 'aside', summary: 'One more try' }))
      .mockResolvedValueOnce(
        moment('Build passed', 'comment', 'It was all planned.', ['screen-1', 'screen-2']),
      )
    const { watch, input, id, deps } = await fixture(chat)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(input.endedAt)
    const silent = { ...input, pcm: new ArrayBuffer(0), playbackTranscript: '' }
    try {
      watch.takeGrant()
      expect(await watch.observe({ ...silent, pcm: new Int16Array(32000).buffer })).toEqual({
        kind: 'quiet',
      })
      expect(chat.mock.calls[0][0][0].content).not.toContain('playback spectrogram')
      expect(chat.mock.calls[0][0][1].content).toEqual(
        expect.arrayContaining([
          { type: 'image', mimeType: 'image/jpeg', bytes: Buffer.from(silent.frames) },
        ]),
      )
      expect(await watch.classifySpeech(id, 'Ну, ещё разок', false)).toBe('aside')
      clock.mockReturnValue(input.endedAt + 30_000)
      const result = await watch.observe({ ...silent, endedAt: Date.now() })
      expect(result.kind).toBe('comment')
      const request = JSON.stringify(chat.mock.calls[2][0])
      expect(request).toContain('Build failed')
      expect(request).toContain('One more try')
      expect(request).not.toContain('Ну, ещё разок')
      expect(deps.admit).toHaveBeenCalledOnce()
    } finally {
      watch.stop(id)
      clock.mockRestore()
    }
  })

  it('keeps the first spoken request while yielding, deduplicates repeats and processes the latest distinct request', async () => {
    const first = Promise.withResolvers<string>()
    const addressed = JSON.stringify({ disposition: 'addressed', summary: '' })
    const chat = vi.fn<LLMProvider['chat']>().mockReturnValueOnce(first.promise)
    chat.mockResolvedValueOnce(addressed)
    const { watch, id } = await fixture(chat)
    watch.takeGrant()
    const request = watch.classifySpeech(id, 'Расскажи, что сейчас на экране.', false)
    const queued = watch.classifySpeech(id, 'А что там открыто?', false)
    watch.yield(id)
    watch.yield(id, 'scene')
    expect(await watch.classifySpeech(id, 'Расскажи, что сейчас на экране?', false)).toBe('ignore')
    const latest = watch.classifySpeech(id, 'Что это за страница?', false)
    expect(await queued).toBe('ignore')
    expect(chat).toHaveBeenCalledOnce()
    expect(chat.mock.calls[0][1]?.timeoutMs).toBeGreaterThan(5_000)
    expect(chat.mock.calls[0][1]?.signal?.aborted).toBe(false)
    first.resolve(addressed)
    expect(await Promise.all([request, queued, latest])).toEqual([
      'addressed',
      'ignore',
      'addressed',
    ])
    expect(chat).toHaveBeenCalledTimes(2)
    expect(chat.mock.calls[1][0][1].content).toContain('Что это за страница?')
    watch.stop(id)
  })

  it('lets the caller distinguish a provider timeout from a stopped session', async () => {
    const deadline = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    const first = Promise.withResolvers<string>()
    const second = Promise.withResolvers<string>()
    const addressed = JSON.stringify({ disposition: 'addressed', summary: '' })
    const chat = vi.fn<LLMProvider['chat']>().mockReturnValueOnce(first.promise)
    chat.mockReturnValueOnce(second.promise)
    const { watch, id } = await fixture(chat)
    try {
      watch.takeGrant()
      const request = watch.classifySpeech(id, 'Что на экране?', false)
      deadline.abort()
      first.resolve(addressed)
      expect(await request).toBeUndefined()
      timeout.mockRestore()
      const next = watch.classifySpeech(id, 'Что я открыл?', false)
      const queued = watch.classifySpeech(id, 'Расскажи подробнее', true)
      watch.stop(id)
      expect(chat.mock.calls[1][1]?.signal?.aborted).toBe(true)
      expect(await queued).toBe('ignore')
      second.resolve(addressed)
      expect(await Promise.all([next, queued])).toEqual(['ignore', 'ignore'])
      expect(chat).toHaveBeenCalledTimes(2)
    } finally {
      timeout.mockRestore()
      watch.stop(id)
    }
  })

  it('only offers one nonverbal reaction for a grounded moment', async () => {
    const chat = vi
      .fn<LLMProvider['chat']>()
      .mockResolvedValueOnce(moment('A result appeared', 'glance'))
      .mockResolvedValueOnce(moment('A result appeared', 'surprise', '', ['screen-2']))
      .mockResolvedValueOnce(moment('Different result', 'surprise', '', ['unknown', 'screen-3']))
    const { watch, input, id, deps } = await fixture(chat)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(input.endedAt)
    try {
      watch.takeGrant()
      await watch.observe(input)
      for (const offset of [4_000, 8_000]) {
        clock.mockReturnValue(input.endedAt + offset)
        await watch.observe({ ...input, endedAt: Date.now() })
      }
      expect(deps.react).toHaveBeenCalledExactlyOnceWith(id, 'glance', input.endedAt + 8_000)
      expect(deps.admit).not.toHaveBeenCalled()
    } finally {
      watch.stop(id)
      clock.mockRestore()
    }
  })

  it('backs off from the same rate-limited model for both screen and microphone', async () => {
    const chat = vi.fn<LLMProvider['chat']>().mockRejectedValue(
      new LlmResponseError({
        provider: 'groq',
        code: 'RATE_LIMITED',
        recoverable: true,
        message: 'rate limited',
      }),
    )
    const { watch, input, id } = await fixture(chat)
    watch.takeGrant()
    expect(await watch.observe(input)).toEqual({ kind: 'unavailable', reason: 'rateLimited' })
    expect(await watch.classifySpeech(id, 'More speech', false)).toBeUndefined()
    expect(await watch.observe(input)).toEqual({ kind: 'unavailable', reason: 'rateLimited' })
    expect(chat).toHaveBeenCalledOnce()
    watch.stop(id)
  })

  it('replaces a scene as soon as the original sampling interval expires', async () => {
    const chat = vi
      .fn<LLMProvider['chat']>()
      .mockResolvedValueOnce(moment('Previous scene'))
      .mockResolvedValueOnce(moment('Current scene'))
    const { watch, input, id } = await fixture(chat)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(input.endedAt)
    try {
      watch.takeGrant()
      await watch.observe(input)
      clock.mockReturnValue(input.endedAt + 3_800)
      watch.yield(id, 'scene')
      await watch.observe({ ...input, endedAt: Date.now() })
      expect(chat).toHaveBeenCalledOnce()
      clock.mockReturnValue(input.endedAt + 4_100)
      await watch.observe({ ...input, endedAt: Date.now() })
      expect(chat).toHaveBeenCalledTimes(2)
    } finally {
      watch.stop(id)
      clock.mockRestore()
    }
  })
})
