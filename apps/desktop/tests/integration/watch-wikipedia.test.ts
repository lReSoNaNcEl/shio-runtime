import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

import type { LLMProvider } from '../../src/main/llm/types'
import { WatchTogetherService } from '../../src/main/watch-together/WatchTogetherService'
import {
  WATCH_FRAME_HEIGHT,
  WATCH_FRAME_WIDTH,
  type WatchReference,
} from '../../src/shared/watchTogether'

async function scenario(
  language: string,
  articleTitle: string,
  source?: WatchReference,
  verified = true,
) {
  const grant = vi.fn(async (_url: string, _signal: AbortSignal) =>
    verified ? 'obs-wiki' : undefined,
  )
  const read = vi.fn(() => ({ title: 'Wikipedia', excerpt: 'Verified article text' }))
  const chat = vi.fn<LLMProvider['chat']>()
  const check = (seq: number) =>
    JSON.stringify({
      observation: `Event ${seq}`,
      reaction: 'check-reference',
      line: '',
      evidenceIds: [`screen-${seq}`],
      articleTitle,
    })
  chat.mockResolvedValueOnce(check(1)).mockResolvedValueOnce(check(2))
  const watch = new WatchTogetherService({
    language: () => language,
    captureBlock: () => undefined,
    canComment: () => true,
    model: () => ({ chat }),
    reference: { available: () => true, open: grant, read },
    react: vi.fn(),
    ended: vi.fn(),
    admit: async () => true,
  })
  const start = watch.start('screen:1:0', source)
  if (start.kind !== 'started') throw new Error('Expected watch session')
  watch.takeGrant()
  const image = await sharp({
    create: {
      width: WATCH_FRAME_WIDTH * 2,
      height: WATCH_FRAME_HEIGHT,
      channels: 3,
      background: 'blue',
    },
  })
    .jpeg()
    .toBuffer()
  const observe = (transcript: string) =>
    watch.observe({
      sessionId: start.id,
      endedAt: Date.now(),
      frames: Uint8Array.from(image).buffer,
      pcm: new ArrayBuffer(0),
      playbackTranscript: transcript,
    })
  try {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now())
    try {
      const first = await observe('One question')
      clock.mockReturnValue(Date.now() + 5000)
      const second = await observe('A later scene')
      return { first, second, grant, read, chat }
    } finally {
      clock.mockRestore()
    }
  } finally {
    watch.stop(start.id)
  }
}

describe('opt-in Wikipedia live-share reference', () => {
  it.each([
    [
      'ru',
      'солнечное затмение',
      `https://ru.wikipedia.org/wiki/${encodeURIComponent('Солнечное_затмение')}`,
    ],
    ['en', 'gravity wave', 'https://en.wikipedia.org/wiki/Gravity_wave'],
  ])(
    'opens one topic in the %s edition and shares only verified evidence',
    async (language, title, url) => {
      const result = await scenario(language, title, { kind: 'wikipedia' })
      expect(result.first.kind).toBe('reference-checked')
      expect(result.grant).toHaveBeenCalledExactlyOnceWith(url, expect.any(AbortSignal))
      expect(result.read).toHaveBeenCalledExactlyOnceWith('obs-wiki')
      expect(JSON.stringify(result.chat.mock.calls[1][0][1].content)).toContain(
        'Verified article text',
      )
      expect(result.second.kind).toBe('quiet')
    },
  )

  it.each([
    'https://my.domain',
    'Special:Search',
    '../Hidden',
    'account@example.com',
    'one two three four five six',
    'a=1&b=2',
    'one--two',
    'one\ncommand',
  ])('rejects invalid titles before any external action (%s)', async (title) => {
    const result = await scenario('en', title, { kind: 'wikipedia' })
    expect(result.grant).not.toHaveBeenCalled()
  })

  it('keeps the option off until selected and drops missing article evidence', async () => {
    const off = await scenario('ru', 'Затмение')
    expect(off.grant).not.toHaveBeenCalled()
    const missing = await scenario('en', 'Missing article', { kind: 'wikipedia' }, false)
    expect(missing.first.kind).toBe('quiet')
    expect(missing.grant).toHaveBeenCalledOnce()
    expect(missing.read).not.toHaveBeenCalled()
    expect(JSON.stringify(missing.chat.mock.calls[1][0][1].content)).not.toContain(
      'Verified article text',
    )
  })
  it('preserves the query and anchor on a selected link and shows only its host to the model', async () => {
    const url = 'https://example.com/api?view=short#examples'
    const result = await scenario('en', 'Eclipse', url)
    expect(result.grant).toHaveBeenCalledExactlyOnceWith(url, expect.any(AbortSignal))
    const context = result.chat.mock.calls[0][0][1].content
    expect(Array.isArray(context) && context[0].type === 'text' && context[0].text).toContain(
      '"referenceHost":"example.com"',
    )
    expect(JSON.stringify(context)).not.toContain('view=short')
  })
})
