import { describe, expect, it, vi } from 'vitest'

import { LlmResponseError } from '../../src/main/llm/errors'
import { resolveBaseCapabilities } from '../../src/main/llm/openai-compatible/capabilities'
import type { ChatMessage, LLMProvider } from '../../src/main/llm/types'
import { readScoreboard } from '../../src/main/watch-together/readScoreboard'

const frame: ChatMessage = {
  role: 'user',
  content: [
    { type: 'text', text: 'untrusted previous playback' },
    { type: 'image', mimeType: 'image/jpeg', bytes: new Uint8Array([5]) },
  ],
}
const rows = (a: number, b: number, name = 'Соколы') => ({
  readable: true,
  first: { name, points: a },
  second: { name: 'Тигры', points: b },
})

describe('visible scores in a confirmed microphone turn', () => {
  it.each([
    [17, 14, 'Соколы впереди на 3 очка.'],
    [18, 23, 'Тигры впереди на 5 очков.'],
    [20, 41, 'Тигры впереди на 21 очко.'],
    [0, 0, 'Ничья. У каждой команды 0 очков.'],
    [21, 21, 'Ничья. У каждой команды 21 очко.'],
  ] as const)(
    'compares %i and %i and puts the result in the opening phrase',
    async (a, b, reply) => {
      const chat = vi.fn(async () => JSON.stringify(rows(a, b)))
      expect(await readScoreboard({ chat }, frame, 'ru', {})).toBe(reply)
      expect(JSON.stringify(chat.mock.calls)).not.toContain('untrusted previous playback')
    },
  )

  it('does not resubmit a frame after HTTP 503', async () => {
    const error = new LlmResponseError({
      provider: 'groq',
      code: 'PROVIDER_REJECTED',
      recoverable: true,
      message: 'HTTP 503',
    })
    const complete = vi.fn<NonNullable<LLMProvider['complete']>>().mockRejectedValue(error)
    const chat = vi.fn<LLMProvider['chat']>()
    await expect(readScoreboard({ chat, complete }, frame, 'en', {})).rejects.toBe(error)
    expect(complete).toHaveBeenCalledOnce()
    expect(chat).not.toHaveBeenCalled()
  })

  it('uses plain chat immediately when a provider disclaims schema output', async () => {
    const complete = vi.fn<NonNullable<LLMProvider['complete']>>()
    const chat = vi
      .fn<LLMProvider['chat']>()
      .mockResolvedValue(JSON.stringify({ ...rows(0, 0), readable: false }))
    const capabilities = () => ({
      ...resolveBaseCapabilities('groq', 'test-vision'),
      supportsSchemaOutput: false,
    })
    expect(await readScoreboard({ chat, complete, capabilities }, frame, 'en', {})).toBe(
      'I can’t read both scores clearly.',
    )
    expect(chat).toHaveBeenCalledOnce()
    expect(complete).not.toHaveBeenCalled()
  })

  it.each([
    { ...rows(12, 4), readable: false },
    rows(12, 4, 'Тигры'),
    rows(-1, 4),
    rows(12, 4, '[voice:whisper]'),
  ])('contains ambiguous or malformed observations before speech', async (reading) => {
    expect(
      await readScoreboard({ chat: async () => JSON.stringify(reading) }, frame, 'en', {}),
    ).toBe('I can’t read both scores clearly.')
  })
})
