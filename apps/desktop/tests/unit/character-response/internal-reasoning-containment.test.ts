import { describe, expect, it } from 'vitest'

import {
  containInternalReasoning,
  InternalReasoningStreamContainment,
  parseCharacterEmbodimentResponse,
} from '../../../src/shared/character-response'
import { SafeCharacterStreamFilter } from '../../../src/shared/character-stream'

describe('internal character reasoning containment', () => {
  it.each([
    '<think>private plan</think>[calm]Привет!',
    '\\<think>private plan\\</think>[calm]Привет!',
    '<analysis>private plan</analysis>[calm]Привет!',
    '<reasoning>private plan</reasoning>[calm]Привет!',
  ])('removes complete provider reasoning from a final response', (input) => {
    const result = containInternalReasoning(input)

    expect(result).toEqual({ text: '[calm]Привет!', contained: true })
    expect(parseCharacterEmbodimentResponse(input).replyText).toBe('[calm]Привет!')
  })

  it('contains an unclosed or partial reasoning marker instead of exposing its payload', () => {
    expect(containInternalReasoning('[warm]Видимый ответ.<think>private plan')).toEqual({
      text: '[warm]Видимый ответ.',
      contained: true,
    })
    expect(containInternalReasoning('[warm]Видимый ответ.<thi')).toEqual({
      text: '[warm]Видимый ответ.',
      contained: true,
    })
  })

  it('removes a stray closing marker', () => {
    expect(containInternalReasoning('[calm]Привет!</think>').text).toBe('[calm]Привет!')
    expect(containInternalReasoning('[calm]Привет!\\</think>').text).toBe('[calm]Привет!')
  })

  it.each(['2 <', 'Windows path\\', '<th'])(
    'preserves an ambiguous non-protocol suffix',
    (input) => {
      expect(containInternalReasoning(input)).toEqual({ text: input, contained: false })
    },
  )

  it.each([
    '<think>private plan</think>[warm]Привет!',
    '\\<think>private plan\\</think>[warm]Привет!',
  ])('does not emit reasoning for arbitrarily split streamed output', (input) => {
    const filter = new SafeCharacterStreamFilter()
    const deltas = [...input].flatMap((character) => filter.push(character))
    deltas.push(...filter.flush())

    expect(deltas.map((delta) => delta.text).join('')).toBe('Привет!')
    expect(deltas.every((delta) => delta.emotion === 'warm')).toBe(true)
    expect(JSON.stringify(deltas)).not.toMatch(/private plan|think/u)
  })

  it('keeps all reasoning buffered when the streamed block never closes', () => {
    const containment = new InternalReasoningStreamContainment()
    const output = [
      ...containment.push('\\<thi'),
      ...containment.push('nk>private plan'),
      ...containment.flush(),
    ]

    expect(output.join('')).toBe('')
    expect(containment.didContain()).toBe(true)
  })
})
