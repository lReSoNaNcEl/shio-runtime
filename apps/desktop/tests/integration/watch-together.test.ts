import { createHash } from 'node:crypto'
import { join } from 'node:path'

import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

import { PERSONA_PROMPT_SECTIONS } from '../../src/main/character/prompting/persona.generated'
import { LlmResponseError } from '../../src/main/llm/errors'
import type { LLMProvider } from '../../src/main/llm/types'
import { createSemanticMemoryRuntime, MemoryToolBroker } from '../../src/main/memory'
import { InMemoryStore } from '../../src/main/memory/InMemoryStore'
import { Orchestrator } from '../../src/main/orchestrator'
import { WatchTogetherService } from '../../src/main/watch-together/WatchTogetherService'
import {
  containsPlaybackPhrase,
  textSimilarity,
} from '../../src/renderer/speech/continuous-listening/textAnalysis'
import { bargeInTuning } from '../../src/renderer/speech/continuous-listening/tuning'
import {
  SafeCharacterStreamFilter,
  SpeechTextCommitBuffer,
} from '../../src/shared/character-stream'
import type { AppSettings } from '../../src/shared/config'
import { parseEmotionalReply } from '../../src/shared/emotion'
import {
  WATCH_FRAME_HEIGHT,
  WATCH_FRAME_WIDTH,
  WATCH_TURN_MAX_BYTES,
  type WatchBlockReason,
  watchReferenceUrl,
} from '../../src/shared/watchTogether'
import { createTempDirectory } from '../support/createTempDirectory'

const moment = (
  observation: string,
  reaction = 'quiet',
  line = '',
  evidenceIds = ['screen-1'],
  focus = 'source-content',
  alternateLine = '',
) => JSON.stringify({ observation, focus, reaction, line, alternateLine, evidenceIds })

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
  it('keeps playback interruptions out of commentary and the next observation context', async () => {
    const chat = vi
      .fn<LLMProvider['chat']>()
      .mockResolvedValueOnce(
        moment(
          'player stopped buffering',
          'comment',
          'Опять плеер сдох.',
          ['screen-1'],
          'playback-status',
        ),
      )
      .mockResolvedValueOnce(
        moment('new scene in the video', 'comment', 'Да у кота лицензия на хаос!', ['screen-2']),
      )
    const { watch, id, deps, input } = await fixture(chat)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(input.endedAt)
    try {
      watch.takeGrant()
      expect(await watch.observe(input)).toEqual({ kind: 'quiet' })
      expect(deps.admit).not.toHaveBeenCalled()
      expect(deps.react).not.toHaveBeenCalled()
      clock.mockReturnValue(input.endedAt + 4000)
      expect(await watch.observe({ ...input, endedAt: Date.now() })).toMatchObject({
        kind: 'comment',
      })
      const content = chat.mock.lastCall?.[0].at(-1)?.content
      if (!Array.isArray(content) || content[0]?.type !== 'text')
        throw new Error('Expected observation context')
      expect(JSON.parse(content[0].text).recent).toEqual([])
    } finally {
      clock.mockRestore()
      watch.stop(id)
    }
  })

  it.each([
    { firstLine: 'Ну всё, занавес.', repeat: 'Ну все! Вот это прыжок.' },
    { firstLine: 'Ебать, какой занавес.', repeat: 'ЕБАТЬ вот это прыжок.' },
  ])(
    'uses a distinct alternate after "$firstLine" and remembers completed playback',
    async ({ firstLine, repeat }) => {
      const chat = vi
        .fn<LLMProvider['chat']>()
        .mockResolvedValueOnce(moment('first scene', 'comment', firstLine))
        .mockResolvedValueOnce(
          moment(
            'second scene',
            'comment',
            repeat,
            ['screen-2'],
            'source-content',
            'Кот, блядь, сам себе трамплин нашёл.',
          ),
        )
        .mockResolvedValueOnce(
          moment(
            'third scene',
            'comment',
            'Кот, ещё один поворот.',
            ['screen-3'],
            'source-content',
            firstLine,
          ),
        )
        .mockResolvedValueOnce(
          moment(
            'fourth scene',
            'comment',
            firstLine,
            ['screen-4'],
            'source-content',
            'Кот, снова в деле.',
          ),
        )
      const { watch, id, deps, input } = await fixture(chat)
      const clock = vi.spyOn(Date, 'now').mockReturnValue(input.endedAt)
      const observe = () => watch.observe({ ...input, endedAt: Date.now() })
      try {
        watch.takeGrant()
        const first = await observe()
        if (first.kind !== 'comment') throw new Error('Expected first comment')
        expect(watch.takeReply(first.turnId)).toBe(firstLine)
        watch.finishComment(id, first.turnId, true)
        clock.mockReturnValue(input.endedAt + 10_000)
        const second = await observe()
        if (second.kind !== 'comment') throw new Error('Expected alternate comment')
        expect(watch.takeReply(second.turnId)).toBe('Кот, блядь, сам себе трамплин нашёл.')
        watch.finishComment(id, second.turnId, false)
        clock.mockReturnValue(input.endedAt + 15_000)
        const third = await observe()
        if (third.kind !== 'comment')
          throw new Error('Expected unchanged opening after cancellation')
        expect(watch.takeReply(third.turnId)).toBe('Кот, ещё один поворот.')
        watch.finishComment(id, third.turnId, true)
        clock.mockReturnValue(input.endedAt + 25_000)
        expect(await observe()).toEqual({ kind: 'quiet' })
        expect(deps.admit).toHaveBeenCalledTimes(3)
      } finally {
        clock.mockRestore()
        watch.stop(id)
      }
    },
  )

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
          details: [Uint8Array.from(red).buffer],
        })
        expect(chat).toHaveBeenCalledTimes(calls)
      }
    } finally {
      watch.stop(id)
      clock.mockRestore()
    }
  })

  it('varies a repeated trailing filler while retaining profanity that carries the joke', async () => {
    const chat = vi
      .fn<LLMProvider['chat']>()
      .mockResolvedValueOnce(moment('first detail', 'comment', 'Вот это разнос, блядь.'))
      .mockResolvedValueOnce(
        moment(
          'second detail',
          'comment',
          'Коробка играет против нас, блять.',
          ['screen-2'],
          'source-content',
          'Эта коробка знает, кто здесь лох.',
        ),
      )
      .mockResolvedValueOnce(
        moment('third detail', 'comment', 'Какой ёбаный квест, бля!', ['screen-3']),
      )
    const { watch, id, input } = await fixture(chat)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(input.endedAt)
    try {
      watch.takeGrant()
      for (const [index, line] of [
        'Вот это разнос, блядь.',
        'Эта коробка знает, кто здесь лох.',
        'Какой ёбаный квест!',
      ].entries()) {
        clock.mockReturnValue(input.endedAt + index * 10_000)
        const result = await watch.observe({ ...input, endedAt: Date.now() })
        if (result.kind !== 'comment') throw new Error('Expected an admitted comment')
        expect(watch.takeReply(result.turnId)).toBe(line)
        watch.finishComment(id, result.turnId, true)
      }
    } finally {
      clock.mockRestore()
      watch.stop(id)
    }
  })

  it('chooses a plain alternate and stays quiet when autonomous drafts recycle familiar slang', async () => {
    const opening = 'Кожаный, у этой сцены странный вайб.'
    const alternate = 'Тесты наконец прошли.'
    const chat = vi
      .fn<LLMProvider['chat']>()
      .mockResolvedValueOnce(moment('first detail', 'comment', opening))
      .mockResolvedValueOnce(
        moment(
          'second detail',
          'comment',
          'У сборки теперь совсем другой ВАЙБ.',
          ['screen-2'],
          'source-content',
          alternate,
        ),
      )
      .mockResolvedValueOnce(
        moment(
          'third detail',
          'comment',
          'Смотрите, Кожаные, сколько окон открыто.',
          ['screen-3'],
          'source-content',
          'Кринж, очередной кринж.',
        ),
      )
    const { watch, id, input, deps } = await fixture(chat)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(input.endedAt)
    try {
      watch.takeGrant()
      for (const [index, line] of [opening, alternate].entries()) {
        clock.mockReturnValue(input.endedAt + index * 10_000)
        const result = await watch.observe({ ...input, endedAt: Date.now() })
        if (result.kind !== 'comment') throw new Error('Expected an admitted comment')
        expect(watch.takeReply(result.turnId)).toBe(line)
        watch.finishComment(id, result.turnId, true)
      }
      clock.mockReturnValue(input.endedAt + 20_000)
      expect(await watch.observe({ ...input, endedAt: Date.now() })).toEqual({ kind: 'quiet' })
      expect(deps.admit).toHaveBeenCalledTimes(2)
    } finally {
      clock.mockRestore()
      watch.stop(id)
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
        hasFrame: false,
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

  it('keeps a confirmed score question grounded when its captured JPEG fails to decode', async () => {
    const text = 'Кто лидирует и на сколько очков?'
    const classify = vi
      .fn<LLMProvider['chat']>()
      .mockResolvedValue('{"disposition":"score-readout","summary":""}')
    const watch = new WatchTogetherService(dependencies(classify))
    const session = watch.start('screen:1:0')
    if (session.kind !== 'started') throw new Error('Expected watch session')
    watch.takeGrant()
    try {
      const sample = {
        utteranceId: 'damaged-score-frame',
        frame: new ArrayBuffer(300),
        playbackTranscript: '',
      }
      expect(await watch.classifySpeech(session.id, text, false, sample)).toBe('addressed')
      const context = watch.takeUserTurn(sample.utteranceId, text)
      expect(context).toMatchObject({ addressedVoice: true, directVoice: true, scoreReadout: true })
      expect(context?.frame).toBeUndefined()
      const chat = vi.fn<LLMProvider['chat']>().mockResolvedValue('Выигрывают Соколы.')
      const character = new Orchestrator(
        { chat },
        new InMemoryStore(),
        () => ({ uiLocale: 'ru' }) as AppSettings,
      )
      const answer = await character.createReply({
        origin: 'watch-user',
        userText: text,
        watchContext: context,
      })
      expect(answer.replyText).toBe('Не могу уверенно прочитать оба счёта.')
      expect(chat).not.toHaveBeenCalled()
    } finally {
      watch.stop(session.id)
    }
  })

  it('does not repeat speech classification without a schema after a service outage', async () => {
    const chat = vi.fn<LLMProvider['chat']>()
    const error = new LlmResponseError({
      provider: 'groq',
      code: 'PROVIDER_REJECTED',
      recoverable: true,
      message: 'HTTP 503',
    })
    const complete = vi.fn<NonNullable<LLMProvider['complete']>>().mockRejectedValue(error)
    const watch = new WatchTogetherService({
      ...dependencies(chat),
      model: () => ({ chat, complete }),
    })
    const session = watch.start('screen:1:0')
    if (session.kind !== 'started') throw new Error('Expected watch session')
    watch.takeGrant()
    try {
      expect(await watch.classifySpeech(session.id, 'Кто впереди?', false)).toBeUndefined()
      expect(complete).toHaveBeenCalledOnce()
      expect(chat).not.toHaveBeenCalled()
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
    const frameTiles = { columns: 2, images: [new Uint8Array([4]), new Uint8Array([5])] }
    const history = new InMemoryStore()
    const chat = vi.fn<LLMProvider['chat']>(async () => 'Вижу мост и синий шар.')
    const browser = vi.fn()
    const orchestrator = new Orchestrator(
      { chat },
      history,
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
      watchContext: { frame, frameTiles, fromMicrophone: true },
    })
    expect(result.replyText).toBe('Вижу мост и синий шар.')
    expect(browser).not.toHaveBeenCalled()
    expect(chat.mock.calls[0][0].at(-1)?.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          userRequest: userText,
          inputFromMicrophone: true,
          frameTileColumns: 2,
        }),
      },
      { type: 'image', mimeType: 'image/jpeg', bytes: frame },
      ...frameTiles.images.map((bytes) => ({ type: 'image', mimeType: 'image/jpeg', bytes })),
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
      create: { width: 3440, height: 1440, channels: 3, background: 'blue' },
    })
      .jpeg()
      .toBuffer()
    await watch.prepareTurn(id, 'before-capture', true, Uint8Array.from(frame).buffer)
    expect(watch.takeUserTurn('before-capture')).toBeUndefined()
    watch.takeGrant()
    await watch.prepareTurn(id, 'user-1', true, Uint8Array.from(frame).buffer)
    expect(watch.takeUserTurn('user-2')).toBeUndefined()
    const context = watch.takeUserTurn('user-1')
    expect(await sharp(context?.frame).metadata()).toMatchObject({
      format: 'jpeg',
      width: 960,
      height: 402,
    })
    expect(context?.frameTiles?.columns).toBe(3)
    expect(context?.frameTiles?.images).toHaveLength(3)
    expect(context?.fromMicrophone).toBe(true)
    expect(watch.takeUserTurn('user-1')).toBeUndefined()
    watch.stop(id)
    expect(context?.signal.aborted).toBe(true)
  })

  it.each([
    [3414, 1292, 3, 1],
    [1440, 3200, 1, 3],
    [3200, 2160, 3, 2],
  ])(
    'preserves one-pixel details at the edges and seams of a %i×%i desktop',
    async (width, height, columns, rows) => {
      const { watch, id } = await fixture(vi.fn())
      watch.takeGrant()
      // Each original edge and shared seam gets a small 1px alternating black/white pattern.
      const markers = (length: number, parts: number) => [
        2,
        ...Array.from({ length: parts - 1 }, (_, i) => Math.floor(((i + 1) * length) / parts) - 2),
        length - 10,
      ]
      const xs = markers(width, columns)
      const ys = markers(height, rows)
      const raw = Buffer.alloc(width * height, 220)
      for (const [j, y] of ys.entries()) {
        for (const [i, x] of xs.entries()) {
          for (let dy = 0; dy < 8; dy++) {
            for (let dx = 0; dx < 8; dx++)
              raw[(y + dy) * width + x + dx] = (dx + dy + i + j) % 2 ? 255 : 0
          }
        }
      }
      try {
        const source = await sharp(raw, { raw: { width, height, channels: 1 } })
          .jpeg({ quality: 97 })
          .toBuffer()
        await watch.prepareTurn(id, 'edge-detail', true, Uint8Array.from(source).buffer)
        const ctx = watch.takeUserTurn('edge-detail')
        if (!ctx?.frame || !ctx.frameTiles) throw new Error('Missing detailed frame')
        const overview = await sharp(ctx.frame).metadata()
        expect(Math.max(overview.width, overview.height)).toBe(960)
        expect(ctx.frameTiles.columns).toBe(columns)
        expect(ctx.frameTiles.images).toHaveLength(columns * rows)
        expect(
          ctx.frame.byteLength + ctx.frameTiles.images.reduce((n, tile) => n + tile.byteLength, 0),
        ).toBeLessThanOrEqual(4 * 1024 * 1024)
        for (const [i, tile] of ctx.frameTiles.images.entries()) {
          const col = i % columns,
            row = Math.floor(i / columns)
          const left = col === 0 ? 0 : Math.floor((col * width) / columns) - 32
          const top = row === 0 ? 0 : Math.floor((row * height) / rows) - 32
          const right = col + 1 === columns ? width : Math.floor(((col + 1) * width) / columns) + 32
          const bottom = row + 1 === rows ? height : Math.floor(((row + 1) * height) / rows) + 32
          const { data, info } = await sharp(tile)
            .greyscale()
            .raw()
            .toBuffer({ resolveWithObject: true })
          expect([info.width, info.height]).toEqual([right - left, bottom - top])
          for (const y of ys.slice(row, row + 2)) {
            for (const x of xs.slice(col, col + 2)) {
              for (let dx = 0; dx < 8; dx++) {
                const actual = data[(y - top) * info.width + x - left + dx]
                expect(Math.abs(actual - raw[y * width + x + dx])).toBeLessThan(42)
              }
            }
          }
        }
      } finally {
        watch.stop(id)
      }
    },
  )

  it('passes through a small desktop, falls back to one source JPEG over budget, and drops superseded work', async () => {
    const { watch, id } = await fixture(vi.fn())
    watch.takeGrant()
    try {
      const small = await sharp({
        create: { width: 1920, height: 1080, channels: 3, background: 'white' },
      })
        .jpeg()
        .toBuffer()
      await watch.prepareTurn(id, 'small', false, Uint8Array.from(small).buffer)
      const smallContext = watch.takeUserTurn('small')
      expect(smallContext?.frameTiles).toBeUndefined()
      expect(smallContext?.frame && small.equals(smallContext.frame)).toBe(true)
      const width = 3840,
        height = 2160
      const noise = createHash('shake256', { outputLength: width * height * 3 })
        .update('bounded noise')
        .digest()
      const jpeg = await sharp(noise, { raw: { width, height, channels: 3 } })
        .jpeg({ quality: 34 })
        .toBuffer()
      expect(jpeg.byteLength).toBeLessThan(WATCH_TURN_MAX_BYTES)
      const input = Uint8Array.from(jpeg).buffer
      await watch.prepareTurn(id, 'over-budget', false, input)
      const original = watch.takeUserTurn('over-budget')
      expect(original?.frameTiles).toBeUndefined()
      expect(original?.frame && jpeg.equals(original.frame)).toBe(true)
      const superseded = watch.prepareTurn(id, 'old', true, input)
      await watch.prepareTurn(id, 'new', true)
      await superseded
      expect(watch.takeUserTurn('old')).toBeUndefined()
      expect(watch.takeUserTurn('new')?.fromMicrophone).toBe(true)
      const draining = watch.prepareTurn(id, 'stopped', true, input)
      watch.stop(id)
      await draining
      expect(watch.takeUserTurn('stopped')).toBeUndefined()
    } finally {
      watch.stop(id)
    }
  })

  it('rejects invalid explicit frames while keeping the spoken turn usable', async () => {
    const { watch, id } = await fixture(vi.fn())
    watch.takeGrant()
    for (const [width, height, format] of [
      [3841, 200, 'jpeg'],
      [3000, 3000, 'jpeg'],
      [900, 1600, 'png'],
    ] as const) {
      const bytes = await sharp({ create: { width, height, channels: 3, background: 'blue' } })
        .toFormat(format)
        .toBuffer()
      await watch.prepareTurn(id, 'invalid', true, Uint8Array.from(bytes).buffer)
      expect(watch.takeUserTurn('invalid')).toMatchObject({
        fromMicrophone: true,
        frame: undefined,
      })
    }
    await watch.prepareTurn(id, 'oversize', false, new ArrayBuffer(WATCH_TURN_MAX_BYTES + 1))
    expect(watch.takeUserTurn('oversize')?.frame).toBeUndefined()
  })

  it('requires a one-use capture grant and policy approval before sampling, then admits a model-selected moment', async () => {
    const line = 'Ебать, мост сложился.'
    const chat = vi.fn<LLMProvider['chat']>(async () => moment('bridge fell', 'comment', line))
    const { watch, input, id, deps } = await fixture(chat)
    expect(await watch.observe(input)).toEqual({ kind: 'stopped' })
    expect(watch.takeGrant()).toMatchObject({
      id,
      sourceId: 'window:1:0',
      signal: expect.any(AbortSignal),
    })
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
  it.each([
    ['ru', 'chuckle', 'Хе-хе.'],
    ['ru', 'sigh', 'Ах…'],
    ['en', 'chuckle', 'Heh.'],
    ['en', 'sigh', 'Ah…'],
  ] as const)(
    'ends a %s %s with one Fish commit and a look at the user',
    async (uiLocale, vocal, sound) => {
      const chat = vi.fn<LLMProvider['chat']>(async () =>
        moment('bridge fell', vocal, 'Unwanted explanation.'),
      )
      const { watch, input, id, deps } = await fixture(chat)
      watch.takeGrant()
      try {
        const decision = await watch.observe(input)
        if (decision.kind !== 'comment') throw new Error('Expected admitted vocal reaction')
        expect(deps.admit).toHaveBeenCalledOnce()
        const orchestrator = new Orchestrator(
          { chat },
          new InMemoryStore(),
          () => ({ uiLocale }) as AppSettings,
        )
        const { replyText, embodimentIntent, emotionKey } = await orchestrator.createReply({
          origin: 'watch-together',
          userText: '',
          approvedWatchReply: watch.takeReply(decision.turnId),
        })
        expect(watch.takeReply(decision.turnId)).toBeUndefined()
        expect(chat).toHaveBeenCalledOnce()
        expect(embodimentIntent).toEqual({ intensity: 'subtle', gazeHint: 'user' })
        expect(emotionKey).toBe(vocal)
        expect(parseEmotionalReply(replyText).visibleText).toBe(sound)
        const filter = new SafeCharacterStreamFilter()
        const buffer = new SpeechTextCommitBuffer(decision.turnId)
        const commits = [...filter.push(replyText), ...filter.flush()].flatMap((delta) =>
          buffer.push(delta),
        )
        expect([...commits, ...buffer.flush()]).toEqual([
          expect.objectContaining({ text: sound, emotion: vocal, voiceStyle: 'soft and brief' }),
        ])
      } finally {
        watch.stop(id)
      }
    },
  )

  it('yields a pending vocal reaction when the user speaks', async () => {
    const { watch, input, id } = await fixture(async () => moment('bridge fell', 'sigh'))
    watch.takeGrant()
    try {
      const decision = await watch.observe(input)
      if (decision.kind !== 'comment') throw new Error('Expected admitted vocal reaction')
      watch.yield(id, 'speech')
      expect(watch.takeReply(decision.turnId)).toBeUndefined()
    } finally {
      watch.stop(id)
    }
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
  it('analyzes timed speech and image detail during a comment without admitting a second one', async () => {
    const chat = vi
      .fn<LLMProvider['chat']>()
      .mockResolvedValueOnce(moment('first reversal', 'comment', 'Вот и развязка.'))
      .mockResolvedValueOnce(moment('next reversal', 'comment', 'И сразу вторая.', ['screen-2']))
    const { watch, deps, id, input } = await fixture(chat)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(input.endedAt)
    try {
      watch.takeGrant()
      const first = await watch.observe(input)
      if (first.kind !== 'comment') throw new Error('Expected admitted commentary')
      expect(watch.takeReply(first.turnId)).toBe('Вот и развязка.')
      deps.canComment.mockReturnValue(false)
      clock.mockReturnValue(input.endedAt + 4000)
      const peak = await sharp(Buffer.from(input.frames))
        .extract({ top: 0, left: 0, width: WATCH_FRAME_WIDTH, height: WATCH_FRAME_HEIGHT })
        .jpeg()
        .toBuffer()
      const detail = await sharp({
        create: { width: 960, height: 760, channels: 3, background: 'red' },
      })
        .png()
        .toBuffer()
      const phrases = [{ startMs: -2200, endMs: -600, text: 'Он меня видит.', final: false }]
      const timing = { earlierMs: -2000, peakMs: -800, currentMs: 0 }
      expect(
        await watch.observe({
          ...input,
          endedAt: Date.now(),
          timing,
          peak: Uint8Array.from(peak).buffer,
          details: [Uint8Array.from(detail).buffer],
          phrases,
        }),
      ).toEqual({ kind: 'quiet' })
      const parts = chat.mock.lastCall?.[0].at(-1)?.content
      if (!Array.isArray(parts)) throw new Error('Expected multimodal evidence')
      const [note] = parts
      if (note?.type !== 'text') throw new Error('Expected a timed observation')
      expect(JSON.parse(note.text)).toMatchObject({
        speechAllowed: false,
        playbackPhrases: phrases,
        frames: { times: timing },
      })
      expect(parts.filter((part) => part.type === 'image')).toHaveLength(3)
      expect(parts.at(-1)).toMatchObject({ type: 'image', mimeType: 'image/png' })
      expect(deps.admit).toHaveBeenCalledOnce()
      watch.finishComment(id, first.turnId, true)
    } finally {
      clock.mockRestore()
      watch.stop(id)
    }
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

describe('recording episode continuity', () => {
  it('keeps one sourced episode through twenty minutes and stores only an explicitly selected anecdote', async () => {
    const directory = await createTempDirectory('shio-recording-episode-')
    const db = join(directory.path, 'moments.sqlite')
    const memory = createSemanticMemoryRuntime(db)
    let closed = false
    const line = 'Продашь ботинок ради варда?'
    const chat = vi.fn<LLMProvider['chat']>().mockResolvedValueOnce(
      JSON.stringify({
        ...JSON.parse(moment('Саппорт решает, продавать ли ботинок.', 'comment', line)),
        episodeUpdate: 'open',
      }),
    )
    const { watch, id, input } = await fixture(chat)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(input.endedAt)
    try {
      watch.takeGrant()
      watch.describeGrant(id, 'Запись матча')
      const first = await watch.observe(input)
      if (first.kind !== 'comment') throw Error('Expected grounded comment')
      expect(watch.takeReply(first.turnId)).toBe(line)
      watch.finishComment(id, first.turnId, true)
      clock.mockReturnValue(input.endedAt + 20 * 60_000)
      chat.mockResolvedValueOnce(
        JSON.stringify({
          ...JSON.parse(
            moment('Саппорт отдал золото на вард.', 'quiet', '', ['screen-1', 'screen-2']),
          ),
          episodeUpdate: 'resolve',
        }),
      )
      await watch.observe({ ...input, endedAt: Date.now() })
      const content = chat.mock.lastCall?.[0][1].content
      if (!Array.isArray(content) || content[0].type !== 'text')
        throw Error('Missing episode evidence')
      expect(JSON.parse(content[0].text)).toMatchObject({
        recent: [],
        unfinishedRecordingEpisode: {
          sourceLabel: 'Запись матча',
          observationId: 'screen-1',
          spokenLine: line,
        },
      })
      expect(memory.listForUi({}).items).toHaveLength(0)
      const request = 'Сохрани этот момент из записи на следующую встречу.'
      await watch.prepareTurn(id, 'save', false, undefined, 'private capture canary')
      const context = watch.takeUserTurn('save', request)
      expect(context?.episode?.outcome?.observationId).toBe('screen-2')
      if (!context?.episode) throw Error('No current recording moment')
      const resultText =
        'На записи «Запись матча» Шио предложила саппорту продать ботинок ради варда.'
      const model = vi
        .fn<LLMProvider['chat']>()
        .mockResolvedValueOnce(
          JSON.stringify({
            requirement: { type: 'explicit-tool', tool: 'memory.store' },
            plannedTools: ['memory.store'],
            embodiment: null,
          }),
        )
        .mockImplementationOnce(async (messages) => {
          const serialized = JSON.stringify(messages)
          expect(serialized).toContain(context.episode?.sourceLabel)
          expect(serialized).toContain(line)
          expect(serialized).not.toContain('private capture canary')
          return (
            '<shio-tools>' +
            JSON.stringify({
              calls: [
                {
                  tool: 'memory.store',
                  arguments: { memories: [{ kind: 'fact', text: resultText }] },
                },
              ],
            }) +
            '</shio-tools>'
          )
        })
        .mockResolvedValue('[warm]Запомнила.')
      const character = new Orchestrator(
        { chat: model },
        new InMemoryStore(),
        () => ({ uiLocale: 'ru' }) as AppSettings,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        new MemoryToolBroker(memory),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enforceRequirements: true },
      )
      await character.createReply(
        { userText: request, origin: 'watch-user', watchContext: context },
        { traceId: 'save-recording' },
      )
      expect(JSON.stringify(model.mock.calls[0][0])).not.toContain(line)
      expect(memory.listForUi({}).items.map((x) => x.text)).toEqual([resultText])
      watch.stop(id)
      expect(watch.takeUserTurn('save', request)).toBeUndefined()
      memory.close()
      closed = true
      const reopened = createSemanticMemoryRuntime(db)
      try {
        const recall = vi
          .fn<LLMProvider['chat']>()
          .mockResolvedValueOnce(
            '<shio-tools>' +
              JSON.stringify({
                calls: [{ tool: 'memory.search', arguments: { query: 'саппорт ботинок' } }],
              }) +
              '</shio-tools>',
          )
          .mockImplementationOnce(async (messages) => {
            expect(JSON.stringify(messages)).toContain(resultText)
            return `[warm]${resultText}`
          })
        const nextMeeting = new Orchestrator(
          { chat: recall },
          new InMemoryStore(),
          () => ({ uiLocale: 'ru' }) as AppSettings,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          new MemoryToolBroker(reopened),
        )
        expect(
          (
            await nextMeeting.createReply(
              { userText: 'Что за история про саппорта и ботинок?' },
              { traceId: 'next-meeting' },
            )
          ).replyText,
        ).toContain(resultText)
      } finally {
        reopened.close()
      }
    } finally {
      watch.stop(id)
      clock.mockRestore()
      if (!closed) memory.close()
      await directory.cleanup()
    }
  })
})
