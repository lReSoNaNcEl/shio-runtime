import { describe, expect, it } from 'vitest'

import { DEFAULT_MOOD_STATE } from '../../../src/main/alive/AliveStore'
import {
  ExperiencePolicy,
  TURN_APPRAISAL_MAX_SHIFT,
} from '../../../src/main/alive/ExperiencePolicy'
import { TurnAppraisalRegistry } from '../../../src/main/alive/TurnAppraisalRegistry'
import type { ExperienceEvent } from '../../../src/shared/alive'

const completed = (turnId: string): ExperienceEvent => ({
  type: 'conversation-completed',
  at: 1_000,
  turnId,
})
const neutral = { valence: 0, arousal: 0, socialRelevance: 0.7, novelty: 0.1, confidence: 0 }

function appraise(turnAppraisal?: typeof neutral, event: ExperienceEvent = completed('t')) {
  return new ExperiencePolicy().appraise(event, {
    currentMood: DEFAULT_MOOD_STATE,
    ...(turnAppraisal ? { turnAppraisal } : {}),
  })
}

describe('turn appraisal as a bounded Experience modifier', () => {
  it('leaves the deterministic appraisal byte-identical without a model nuance', () => {
    expect(JSON.stringify(appraise())).toBe(JSON.stringify(appraise()))
    expect(appraise(neutral)).toEqual(appraise())
  })

  it('raises valence for praise and lowers it for teasing', () => {
    const base = appraise().valence
    const praise = appraise({ ...neutral, valence: 0.9, confidence: 0.8 }).valence
    const tease = appraise({ ...neutral, valence: -0.9, confidence: 0.8 }).valence
    expect(praise).toBeGreaterThan(base)
    expect(tease).toBeLessThan(base)
    expect(Math.sign(praise)).not.toBe(Math.sign(tease))
  })

  it('caps every shift and weights it by confidence', () => {
    const base = appraise()
    const extreme = appraise({
      valence: 1,
      arousal: 1,
      socialRelevance: 0,
      novelty: 1,
      confidence: 1,
    })
    expect(extreme.valence - base.valence).toBeLessThanOrEqual(TURN_APPRAISAL_MAX_SHIFT + 1e-9)
    expect(extreme.arousal - base.arousal).toBeLessThanOrEqual(TURN_APPRAISAL_MAX_SHIFT + 1e-9)
    expect(base.socialRelevance - extreme.socialRelevance).toBeLessThanOrEqual(
      TURN_APPRAISAL_MAX_SHIFT + 1e-9,
    )
    const unsure = appraise({ ...neutral, valence: 1, confidence: 0.2 })
    expect(unsure.valence - base.valence).toBeCloseTo(0.2, 6)
  })

  it('applies only to completed conversation turns', () => {
    const interrupted: ExperienceEvent = {
      type: 'conversation-interrupted',
      at: 1_000,
      turnId: 't',
    }
    expect(appraise({ ...neutral, valence: 1, confidence: 1 }, interrupted)).toEqual(
      appraise(undefined, interrupted),
    )
  })
})

describe('turn appraisal registry', () => {
  it('hands one appraisal over once, expires stale entries and stays bounded', () => {
    const registry = new TurnAppraisalRegistry()
    registry.record('a', { ...neutral, confidence: 0.5 }, 0)
    expect(registry.take('a', 10)?.confidence).toBe(0.5)
    expect(registry.take('a', 10)).toBeUndefined()
    registry.record('stale', neutral, 0)
    expect(registry.take('stale', 5 * 60_000 + 1)).toBeUndefined()
    for (let index = 0; index < 40; index++) registry.record(`turn-${index}`, neutral, 0)
    expect(registry.take('turn-0', 1)).toBeUndefined()
    expect(registry.take('turn-39', 1)).toBeDefined()
    registry.clear()
    expect(registry.take('turn-38', 1)).toBeUndefined()
  })
})
