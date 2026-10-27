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
import { currentEmbodimentAvailability } from '../../../src/main/character/prompting/EmbodimentAvailabilityPrompt'
import { responsePolicyPrompt } from '../../../src/main/character/prompting/ResponsePolicyPrompt'
import {
  EMBODIMENT_GESTURE_HINTS,
  EMBODIMENT_UNAVAILABLE_REASONS,
  normalizeCharacterEmbodimentIntent,
  parseCharacterEmbodimentResponse,
} from '../../../src/shared/character-response'
import { SafeCharacterStreamFilter } from '../../../src/shared/character-stream'
import { MOTION_CATALOG_REVISION } from '../../../src/shared/motion'
import type { AvatarRuntimeHealth } from '../../../src/shared/runtime'

const envelope =
  '<shio-intent>{"version":2,"intensity":"normal","gestureHint":"greeting"}</shio-intent>'
const intent = { intensity: 'normal', gestureHint: 'greeting' }

describe('versioned semantic embodiment', () => {
  it('parses a split envelope before speech without exposing internal fields', () => {
    const source = `[happy]${envelope}Привет!`
    for (let split = 0; split <= source.length; split += 1) {
      const filter = new SafeCharacterStreamFilter()
      const deltas = [
        ...filter.push(source.slice(0, split)),
        ...filter.push(source.slice(split)),
        ...filter.flush(),
      ]
      expect(deltas.map((delta) => delta.text).join('')).toBe('Привет!')
      expect(filter.takeEmbodimentIntents()).toEqual([{ intent, timing: 'early' }])
      expect(parseCharacterEmbodimentResponse(source)).toEqual({
        replyText: '[happy]Привет!',
        embodimentIntent: intent,
      })
    }
  })

  it('marks later intent as future-only input and accepts only one envelope', () => {
    const filter = new SafeCharacterStreamFilter()
    expect(
      filter
        .push('Already spoken.')
        .map((delta) => delta.text)
        .join(''),
    ).toBe('Already spoken.')
    filter.push(`${envelope + envelope} Future.`)
    expect(filter.takeEmbodimentIntents()).toEqual([{ intent, timing: 'late' }])
  })

  it('contains malformed, oversized, unknown, truncated and quoted controls', () => {
    for (const candidate of [
      envelope.replace('"version":2', '"version":3'),
      envelope.replace('"greeting"', '"run-script"'),
      envelope.replace('"version":2', '"version":2,"animationId":"unsafe"'),
      envelope.replace('"version":2', '"version":2,"intensity":"maximum"'),
      `<shio-intent>${'x'.repeat(2_000)}</shio-intent>`,
      envelope.slice(0, -10),
      '</shio-intent>',
      '<shio-intention>{"version":2}</shio-intention>',
      envelope.replace('<shio-intent>', '<shio-intent unsafe="true">'),
      `\x60${envelope}\x60`,
    ]) {
      const filter = new SafeCharacterStreamFilter()
      let visible = ''
      for (const character of candidate)
        visible += filter
          .push(character)
          .map((delta) => delta.text)
          .join('')
      visible += filter
        .flush()
        .map((delta) => delta.text)
        .join('')
      expect(filter.takeEmbodimentIntents(), candidate).toEqual([])
      expect(visible).not.toMatch(/shio-|version|animationId|run-script|x{10}/u)
    }
    expect(normalizeCharacterEmbodimentIntent({ intensity: 'normal', bones: [] })).toBeUndefined()
    expect(parseCharacterEmbodimentResponse('Plain answer.')).toEqual({
      replyText: 'Plain answer.',
    })
  })

  it('keeps every canonical semantic hint and the complete protocol under saturated context', () => {
    const responsePolicy = [
      responsePolicyPrompt(),
      emotionContractPrompt(),
      embodimentContractPrompt(),
    ].join('\n\n')
    expect(responsePolicy.length).toBeLessThan(
      CHARACTER_CONTEXT_ALLOCATION.minimumCharacters.responsePolicy,
    )
    for (const hint of EMBODIMENT_GESTURE_HINTS)
      expect(embodimentContractPrompt()).toContain(`${hint}=`)
    const messages = new CharacterRequestComposer()
      .compose({
        persona: SYSTEM_PROMPT,
        responsePolicy,
        memory: 'memory '.repeat(3_000),
        project: 'project '.repeat(3_000),
        toolResults: 'results '.repeat(3_000),
        embodimentAvailability: {
          version: 2,
          catalogRevision: MOTION_CATALOG_REVISION,
          modelGeneration: 3,
          availableSemanticIntents: [...EMBODIMENT_GESTURE_HINTS],
          unavailableReasons: [...EMBODIMENT_UNAVAILABLE_REASONS],
          qualification: 'draft',
        },
        locale: 'ru',
      })
      .map((message) => String(message.content))
    expect(messages).toContain(responsePolicy)
    const availability = messages.find((text) => text.startsWith('## Current Avatar')) ?? ''
    expect(availability).not.toContain('[truncated]')
    expect(availability).toContain(MOTION_CATALOG_REVISION)
    expect(messages.join('')).not.toContain('greet_wave_soft')
  })

  it('reads only a fresh, schema-valid projection of the current Avatar owner', () => {
    const now = Date.now()
    const health: AvatarRuntimeHealth = {
      contractVersion: 1,
      status: 'ready',
      modelLoaded: true,
      presentationAttached: true,
      operational: true,
      updatedAt: new Date(now).toISOString(),
      lastFailure: null,
      embodimentAvailability: {
        version: 2,
        catalogRevision: MOTION_CATALOG_REVISION,
        modelGeneration: 1,
        availableSemanticIntents: ['greeting'],
        unavailableReasons: [],
        qualification: 'draft',
      },
    }
    const availability = health.embodimentAvailability
    if (!availability) throw new Error('Missing fixture availability')
    expect(currentEmbodimentAvailability(health, now)?.availableSemanticIntents).toEqual([
      'greeting',
    ])
    expect(currentEmbodimentAvailability(health, now + 10_001)).toBeUndefined()
    expect(currentEmbodimentAvailability({ ...health, modelLoaded: false }, now)).toBeUndefined()
    expect(
      currentEmbodimentAvailability(
        {
          ...health,
          embodimentAvailability: { ...availability, catalogRevision: 'old' },
        },
        now,
      ),
    ).toBeUndefined()
  })
})
