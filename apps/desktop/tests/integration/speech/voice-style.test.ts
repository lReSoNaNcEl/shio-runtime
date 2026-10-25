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
})
