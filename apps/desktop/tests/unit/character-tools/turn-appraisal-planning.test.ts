import { describe, expect, it } from 'vitest'

import { CharacterToolRegistry } from '../../../src/main/character-tools/CharacterToolRegistry'
import {
  characterToolRequirementDefinition,
  constrainedPlanningSchema,
  parseToolPlanningResult,
  parseToolPlanningValue,
} from '../../../src/main/character-tools/CharacterToolRequirementPlanning'
import { turnAppraisalSchema } from '../../../src/shared/character-tools'

const registry = () =>
  new CharacterToolRegistry({
    projectAvailable: false,
    webAvailable: false,
    capabilityContext: null,
    browserObservation: null,
    actionsAvailable: false,
  })

const appraisal = {
  valence: 0.8,
  arousal: 0.3,
  socialRelevance: 0.9,
  novelty: 0.2,
  confidence: 0.7,
}
const plan = { requirement: { type: 'direct-answer' }, plannedTools: [], embodiment: null }

describe('turn appraisal in Tool Requirement planning', () => {
  it('accepts bounded appraisals and rejects out-of-range or extra fields', () => {
    expect(turnAppraisalSchema.safeParse(appraisal).success).toBe(true)
    for (const invalid of [
      { ...appraisal, valence: 1.2 },
      { ...appraisal, novelty: -0.1 },
      { ...appraisal, confidence: Number.NaN },
      { ...appraisal, text: 'praise' },
      { valence: 0.2 },
    ])
      expect(turnAppraisalSchema.safeParse(invalid).success).toBe(false)
  })

  it('keeps a plan valid when the appraisal is invalid or absent', () => {
    expect(parseToolPlanningValue({ ...plan, turnAppraisal: appraisal })?.turnAppraisal).toEqual(
      appraisal,
    )
    const invalid = parseToolPlanningValue({ ...plan, turnAppraisal: { valence: 7 } })
    expect(invalid?.requirement).toEqual({ type: 'direct-answer' })
    expect(invalid?.turnAppraisal).toBeUndefined()
    expect(parseToolPlanningValue({ ...plan, turnAppraisal: null })?.turnAppraisal).toBeUndefined()
    expect(parseToolPlanningValue(plan)?.turnAppraisal).toBeUndefined()
  })

  it('fits a full plan with appraisal inside the planning text limit', () => {
    const text = JSON.stringify({
      requirement: { type: 'required-source', source: 'project' },
      plannedTools: ['project.search'],
      embodiment: { intensity: 'normal', gestureHint: 'explain', gazeHint: 'user' },
      turnAppraisal: {
        valence: -0.25,
        arousal: 0.35,
        socialRelevance: 0.75,
        novelty: 0.45,
        confidence: 0.65,
      },
    })
    expect(text.length).toBeLessThan(1_000)
    expect(parseToolPlanningResult(text)?.turnAppraisal?.valence).toBe(-0.25)
  })

  it('offers the same appraisal field on the JSON Schema and native tool paths', () => {
    const native = characterToolRequirementDefinition(registry()).parameters as {
      properties: Record<string, unknown>
    }
    const constrained = constrainedPlanningSchema(registry()) as {
      properties: Record<string, unknown>
    }
    expect(native.properties.turnAppraisal).toBeDefined()
    expect(constrained.properties.turnAppraisal).toBeDefined()
    const appraisalObject = (schema: unknown): Record<string, unknown> | undefined => {
      if (!schema || typeof schema !== 'object') return undefined
      const record = schema as Record<string, unknown>
      const properties = record.properties as Record<string, unknown> | undefined
      if (properties?.valence) return properties
      for (const value of Object.values(record)) {
        const found = Array.isArray(value)
          ? value.map(appraisalObject).find(Boolean)
          : appraisalObject(value)
        if (found) return found
      }
      return undefined
    }
    expect(appraisalObject(native.properties.turnAppraisal)).toEqual(
      appraisalObject(constrained.properties.turnAppraisal),
    )
    for (const key of ['valence', 'arousal', 'socialRelevance', 'novelty', 'confidence']) {
      expect(JSON.stringify(native.properties.turnAppraisal)).toContain(key)
      expect(JSON.stringify(constrained.properties.turnAppraisal)).toContain(key)
    }
  })
})
