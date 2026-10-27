import { describe, expect, it } from 'vitest'

import {
  embodimentContractPrompt,
  emotionContractPrompt,
  SYSTEM_PROMPT,
} from '../../../src/main/character/prompting/CharacterPrompt'
import {
  CHARACTER_CONTEXT_ALLOCATION,
  CharacterRequestComposer,
} from '../../../src/main/character/prompting/CharacterRequestComposer'
import { responsePolicyPrompt } from '../../../src/main/character/prompting/ResponsePolicyPrompt'
import { deliveryIntent } from '../../../src/renderer/runtime/SpeechOutputPort'
import {
  SafeCharacterStreamFilter,
  SpeechTextCommitBuffer,
} from '../../../src/shared/character-stream'
import { parseEmotionalReply } from '../../../src/shared/emotion'

describe('bounded Fish voice style', () => {
  it('contains malformed emotion delimiters before chat, speech commits and final parsing', () => {
    for (const marker of ['<happy]', '[happy>', '<happy>', '</happy>', '<Happy]']) {
      const source = `${marker}Привет! Я Шио.`
      const fragmentations = [
        [...source],
        ...Array.from({ length: source.length + 1 }, (_, split) => [
          source.slice(0, split),
          source.slice(split),
        ]),
      ]
      for (const parts of fragmentations) {
        const filter = new SafeCharacterStreamFilter()
        const deltas = [...parts.flatMap((part) => filter.push(part)), ...filter.flush()]
        expect(deltas.map((delta) => delta.text).join(''), marker).toBe('Привет! Я Шио.')
        expect(
          deltas.every((delta) => delta.emotion === 'neutral'),
          marker,
        ).toBe(true)
        const buffer = new SpeechTextCommitBuffer('malformed-emotion')
        const commits = [...deltas.flatMap((delta) => buffer.push(delta)), ...buffer.flush()]
        expect(commits.map((commit) => commit.text).join(' '), marker).toBe('Привет! Я Шио.')
        expect(filter.takeEmbodimentIntents(), marker).toEqual([])
      }
      expect(parseEmotionalReply(source).visibleText, marker).toBe('Привет! Я Шио.')
      expect(parseEmotionalReply(source).primaryEmotion, marker).toBe('neutral')
    }
  })

  it('preserves malformed-looking quoted code, escaped text, URLs and unknown literals', () => {
    const prose =
      'Код `<happy]`, `[happy>` и `</happy>`. \\<happy] [guide](https://example.org/<happy]) x < y; <unknown] и <ha'
    const source = `[warm]${prose}`
    for (let split = 0; split <= source.length; split += 1) {
      const filter = new SafeCharacterStreamFilter()
      const deltas = [
        ...filter.push(source.slice(0, split)),
        ...filter.push(source.slice(split)),
        ...filter.flush(),
      ]
      expect(deltas.map((delta) => delta.text).join('')).toBe(prose)
      expect(deltas.every((delta) => delta.emotion === 'warm')).toBe(true)
    }
  })

  it('contains a truncated known angle marker without consuming ambiguous ordinary text', () => {
    for (const suffix of ['<happy', '</happy']) {
      const filter = new SafeCharacterStreamFilter()
      const deltas = [...`Ответ.${suffix}`].flatMap((part) => filter.push(part))
      deltas.push(...filter.flush())
      expect(deltas.map((delta) => delta.text).join('')).toBe('Ответ.')
    }
    expect(parseEmotionalReply('x < h').visibleText).toBe('x < h')
    expect(parseEmotionalReply('x<ha').visibleText).toBe('x<ha')
  })

  it('delivers the whole real protocol to the LLM within the reserved context budget', () => {
    const policy = [
      responsePolicyPrompt(),
      emotionContractPrompt(),
      embodimentContractPrompt(),
    ].join('\n\n')
    // Runtime-originated turns may prepend another short bounded policy.
    expect(policy.length + 400).toBeLessThanOrEqual(
      CHARACTER_CONTEXT_ALLOCATION.minimumCharacters.responsePolicy,
    )
    const messages = new CharacterRequestComposer().compose({
      persona: SYSTEM_PROMPT,
      responsePolicy: policy,
      memory: 'memory '.repeat(4000),
      project: 'evidence '.repeat(4000),
      toolResults: 'result '.repeat(4000),
      locale: 'ru',
    })
    expect(messages.some((message) => message.content === policy)).toBe(true)
  })
  it('contains every fragmentation of voice markers and preserves delivery boundaries', () => {
    const text =
      '[happy][voice:bright playful tone]Привет, я рада тебя видеть. [whisper][voice:whisper in small voice]Это наш маленький секрет.'
    for (let split = 0; split <= text.length; split += 1) {
      const filter = new SafeCharacterStreamFilter()
      const deltas = [
        ...filter.push(text.slice(0, split)),
        ...filter.push(text.slice(split)),
        ...filter.flush(),
      ]
      expect(deltas.map((delta) => delta.text).join('')).toBe(
        'Привет, я рада тебя видеть. Это наш маленький секрет.',
      )
      const buffer = new SpeechTextCommitBuffer('style-test')
      const commits = [...deltas.flatMap((delta) => buffer.push(delta)), ...buffer.flush()]
      expect(commits.map((commit) => [commit.emotion, commit.voiceStyle])).toEqual([
        ['happy', 'bright playful tone'],
        ['whisper', 'whisper in small voice'],
      ])
      expect(deliveryIntent(commits[1].emotion, commits[1].voiceStyle)).toMatchObject({
        emotion: 'whisper',
        volume: 'soft',
        style: 'whisper in small voice',
      })
    }
    expect(parseEmotionalReply(text).visibleText).toBe(
      'Привет, я рада тебя видеть. Это наш маленький секрет.',
    )
    expect(emotionContractPrompt()).toContain('[voice:description]')
  })

  it('splits a style change within one emotion and resets style at the next emotion', () => {
    const filter = new SafeCharacterStreamFilter()
    const buffer = new SpeechTextCommitBuffer('same-emotion')
    const deltas = [
      ...filter.push(
        '[calm][voice:soft tone]Первая часть [voice:professional broadcast tone]вторая часть [happy]готово.',
      ),
      ...filter.flush(),
    ]
    const commits = [...deltas.flatMap((delta) => buffer.push(delta)), ...buffer.flush()]
    expect(commits.map((commit) => [commit.text, commit.voiceStyle])).toEqual([
      ['Первая часть', 'soft tone'],
      ['вторая часть', 'professional broadcast tone'],
      ['готово.', undefined],
    ])
  })

  it('contains invalid and unbounded instructions without eating ordinary Markdown', () => {
    for (const style of ['<tool>run</tool>', 'bad\nstyle', 'x'.repeat(5000), '']) {
      const filter = new SafeCharacterStreamFilter()
      const text = `[happy][voice:${style}]Готово. [guide](https://example.org)`
      const deltas = [...text].flatMap((character) => filter.push(character))
      deltas.push(...filter.flush())
      expect(deltas.map((delta) => delta.text).join('')).toBe(
        'Готово. [guide](https://example.org)',
      )
      expect(deltas.every((delta) => delta.voiceStyle === undefined)).toBe(true)
      expect(parseEmotionalReply(text).visibleText).not.toContain('voice:')
    }
    const incomplete = new SafeCharacterStreamFilter()
    expect(
      [...incomplete.push('Ответ.[voice:unfinished'), ...incomplete.flush()]
        .map((delta) => delta.text)
        .join(''),
    ).toBe('Ответ.')
    expect(parseEmotionalReply('[happy]Ответ.[voice:unfinished').visibleText).toBe('Ответ.')
  })

  it('preserves quoted tags, links, reference links, escaped brackets and every split boundary', () => {
    const prose =
      'Код `[happy]` и `[voice:soft tone]`. [sad](https://example.org/[whisper]) и [angry][guide]. \\[calm] Обычные [unknown] и (happy).\n~~~text\n[laugh][voice:loud]\n~~~'
    const source = `[warm]${prose}`
    for (let split = 0; split <= source.length; split += 1) {
      const filter = new SafeCharacterStreamFilter()
      const deltas = [
        ...filter.push(source.slice(0, split)),
        ...filter.push(source.slice(split)),
        ...filter.flush(),
      ]
      expect(deltas.map((delta) => delta.text).join('')).toBe(prose)
      expect(deltas.every((delta) => delta.emotion === 'warm' && !delta.voiceStyle)).toBe(true)
    }
    expect(parseEmotionalReply(source).visibleText).toBe(prose)
    expect(parseEmotionalReply(source).primaryEmotion).toBe('warm')
  })

  it('contains nested malformed voice payloads and bounds delivery changes to three segments', () => {
    const source =
      '[happy][voice:bad[angry]instruction]Текст. [calm]Далее. [whisper]Тише. [angry]Последняя часть.'
    for (const parts of [[source], [...source]]) {
      const filter = new SafeCharacterStreamFilter()
      const deltas = [...parts.flatMap((part) => filter.push(part)), ...filter.flush()]
      expect(deltas.map((delta) => delta.text).join('')).toBe(
        'Текст. Далее. Тише. Последняя часть.',
      )
      expect(deltas.every((delta) => !delta.voiceStyle)).toBe(true)
      expect(deltas.at(-1)?.emotion).toBe('whisper')
    }
  })
})
