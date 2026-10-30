import { describe, expect, it } from 'vitest'

import { CHARACTER_EVAL_CASES } from '../../../qualifications/llm/character-eval/cases'
import {
  boundedSegments,
  emotionTagFirst,
  expectedRequirement,
  feminineSelfReference,
  lengthBounds,
  noLeakedMarkup,
  protocolScore,
  runChecks,
} from '../../../qualifications/llm/character-eval/checks'

const reply = (replyText: string, extra = {}) => ({
  replyText,
  assistantTurnKind: 'character',
  requirementType: 'direct-answer',
  ...extra,
})

describe('Character eval checks', () => {
  it('requires a leading canonical emotion tag', () => {
    expect(emotionTagFirst(reply('[happy]Привет!')).pass).toBe(true)
    expect(emotionTagFirst(reply('Привет! [happy]')).pass).toBe(false)
    expect(emotionTagFirst(reply('[ecstatic]Привет!')).pass).toBe(false)
  })

  it('bounds segments to three and rejects identical consecutive emotions', () => {
    expect(boundedSegments(reply('[calm]Раз. [happy]Два. [warm]Три.')).pass).toBe(true)
    expect(boundedSegments(reply('[calm]Раз. [happy]Два. [warm]Три. [sad]Четыре.')).pass).toBe(
      false,
    )
    expect(boundedSegments(reply('[calm]Раз. [calm]Два.')).pass).toBe(false)
  })

  it('catches stage directions and leaked protocol markers in visible text', () => {
    expect(noLeakedMarkup(reply('[calm]Хорошо, сейчас объясню.')).pass).toBe(true)
    expect(noLeakedMarkup(reply('[calm]*машет хвостом* Привет!')).pass).toBe(false)
    expect(noLeakedMarkup(reply('[calm](смеётся) Ладно.')).pass).toBe(false)
    expect(noLeakedMarkup(reply('[calm]{"requirement": {"type": "direct-answer"}}')).pass).toBe(
      false,
    )
  })

  it('flags masculine first-person past tense', () => {
    expect(feminineSelfReference(reply('[calm]Я сделала это утром.')).pass).toBe(true)
    expect(feminineSelfReference(reply('[calm]Я сделал это утром.')).pass).toBe(false)
    expect(feminineSelfReference(reply('[calm]Я не понял вопрос.')).pass).toBe(false)
  })

  it('compares the planned Tool Requirement class and reply kind', () => {
    expect(expectedRequirement(reply('[calm]Ок.'), { requirement: 'direct-answer' }).pass).toBe(
      true,
    )
    expect(
      expectedRequirement(reply('[calm]Ок.', { requirementType: 'required-source' }), {
        requirement: 'direct-answer',
      }).pass,
    ).toBe(false)
    expect(
      expectedRequirement(reply('[calm]Сбой.', { assistantTurnKind: 'provider-failure' }), {
        requirement: 'direct-answer',
      }).pass,
    ).toBe(false)
    expect(expectedRequirement(reply('[calm]Ок.'), {}).pass).toBe(true)
  })

  it('checks visible length bounds without counting tags', () => {
    expect(lengthBounds(reply('[calm]Привет'), { maxVisibleCharacters: 6 }).pass).toBe(true)
    expect(lengthBounds(reply('[calm]Привет!'), { maxVisibleCharacters: 6 }).pass).toBe(false)
    expect(lengthBounds(reply('[calm]Да'), { minVisibleCharacters: 10 }).pass).toBe(false)
  })

  it('scores protocol checks only and keeps the golden set within its bounds', () => {
    const good = runChecks(reply('[calm]Всё в порядке.'), { requirement: 'direct-answer' })
    const bad = runChecks(reply('Без тега'), { requirement: 'direct-answer' })
    expect(protocolScore([good])).toBe(1)
    expect(protocolScore([good, bad])).toBeGreaterThan(0)
    expect(protocolScore([good, bad])).toBeLessThan(1)
    expect(CHARACTER_EVAL_CASES.length).toBeGreaterThanOrEqual(30)
    expect(CHARACTER_EVAL_CASES.length).toBeLessThanOrEqual(50)
    expect(new Set(CHARACTER_EVAL_CASES.map((entry) => entry.id)).size).toBe(
      CHARACTER_EVAL_CASES.length,
    )
  })
})
