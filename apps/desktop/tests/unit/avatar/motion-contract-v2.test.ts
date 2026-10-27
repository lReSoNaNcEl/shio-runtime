import { describe, expect, it } from 'vitest'

import {
  generatedMotionHealthSchema,
  MOTION_CATALOG,
  MOTION_PROFILE_IDS,
  MOTION_PROFILES,
  motionCatalogSchema,
  motionChunkSchema,
  motionNextSchema,
  motionVariationSchema,
} from '../../../src/shared/motion'

function catalogCopy() {
  return structuredClone(MOTION_CATALOG)
}

describe('standing motion contract v2', () => {
  it('rejects missing workspaces and physically parallel hand orientation constraints', () => {
    const missing = catalogCopy()
    Reflect.deleteProperty(missing.profiles[0].handScore.phases.stroke.right, 'workspace')
    expect(motionCatalogSchema.safeParse(missing).success).toBe(false)
    for (const [palmFacing, fingerDirection] of [
      ['up', 'up'],
      ['forward', 'forward'],
      ['inward', 'forward'],
    ] as const) {
      const parallel = catalogCopy()
      const hand = parallel.profiles[0].handScore.phases.stroke.right
      hand.palmFacing = palmFacing
      hand.fingerDirection = fingerDirection
      expect(motionCatalogSchema.safeParse(parallel).success).toBe(false)
    }
  })
  it('accepts all six constrained joints and still rejects excess correction authority', () => {
    const health = {
      error: null,
      state: 'ready',
      queueFrames: 0,
      lateChunks: 0,
      inferenceMs: 1,
      epoch: 1,
      seed: 17,
      safety: { jointCorrections: 6, armCorrections: 2, unresolvedArmContacts: 0 },
    }
    expect(generatedMotionHealthSchema.safeParse(health).success).toBe(true)
    health.safety.jointCorrections = 7
    expect(generatedMotionHealthSchema.safeParse(health).success).toBe(false)
  })

  it('derives exactly the new standing preset with both complete hands and honest qualification', () => {
    expect(MOTION_PROFILE_IDS).toHaveLength(28)
    expect(MOTION_PROFILES.map((p) => p.id)).toEqual([...MOTION_PROFILE_IDS])
    for (const profile of MOTION_PROFILES) {
      expect(profile.exitPosture).toBe('standing')
      expect(profile.qualification.state).toBe('qualified')
      expect(profile.phases.map((p) => p.id)).toEqual(['prepare', 'stroke', 'hold', 'recover'])
      for (const score of Object.values(profile.handScore.phases)) {
        expect(Object.keys(score).sort()).toEqual(['left', 'right'])
        for (const hand of Object.values(score))
          expect(Object.keys(hand.fingers).sort()).toEqual([
            'index',
            'little',
            'middle',
            'ring',
            'thumb',
          ])
      }
    }
  })
  it('rejects incomplete finger and recovery contracts instead of silently degrading exact gestures', () => {
    const missing = catalogCopy()
    Reflect.deleteProperty(missing.profiles[0].handScore.phases.stroke.right.fingers, 'index')
    expect(motionCatalogSchema.safeParse(missing).success).toBe(false)
    const incomplete = catalogCopy()
    incomplete.profiles[0].phases[3].exitConditions = ['standing-stable']
    expect(motionCatalogSchema.safeParse(incomplete).success).toBe(false)
  })
  it('rejects unexpected authority, unsupported posture and duplicate identities', () => {
    const authority = catalogCopy()
    Reflect.set(authority.profiles[0], 'face', 'smile')
    expect(motionCatalogSchema.safeParse(authority).success).toBe(false)
    const posture = catalogCopy()
    Reflect.set(posture.profiles[0], 'exitPosture', 'sitting')
    expect(motionCatalogSchema.safeParse(posture).success).toBe(false)
    const duplicate = catalogCopy()
    duplicate.profiles[1].id = duplicate.profiles[0].id
    expect(motionCatalogSchema.safeParse(duplicate).success).toBe(false)
  })
  it('requires execution identity and exact named bounded contacts on the transport', () => {
    expect(
      motionNextSchema.safeParse({
        profileId: 'presence_poised',
        lease: { sessionId: 'x', epoch: 1, seed: 1, modelGeneration: 1, avatarGeneration: 1 },
      }).success,
    ).toBe(false)
    expect(motionChunkSchema.safeParse({ footContacts: [[1, 1, 1, 1]] }).success).toBe(false)
  })
})

it('rejects unreleased hand exits and unreachable preparation/recovery zones', () => {
  const unreleased = catalogCopy()
  unreleased.profiles[0].handScore.phases.recover.right.fingers.ring.curl = [1.1, 1, 0.9]
  expect(motionCatalogSchema.safeParse(unreleased).success).toBe(false)
  const unreachable = catalogCopy()
  unreachable.transitionGraph.preparationEdges = [['relaxed', 'relaxed']]
  expect(motionCatalogSchema.safeParse(unreachable).success).toBe(false)
  const forbidden = catalogCopy()
  forbidden.transitionGraph.directEdges.push(['raised', 'heart'])
  expect(motionCatalogSchema.safeParse(forbidden).success).toBe(false)
})
it('allows only bounded integer variation seeds on an exact lease', () => {
  const lease = { sessionId: 'lease', epoch: 1, modelGeneration: 1, avatarGeneration: 1, seed: 42 }
  expect(motionVariationSchema.safeParse({ lease, seed: 0 }).success).toBe(true)
  expect(motionVariationSchema.safeParse({ lease }).success).toBe(true)
  for (const seed of [-1, 0.5, NaN, Infinity, 2_147_483_648, '42'])
    expect(motionVariationSchema.safeParse({ lease, seed }).success).toBe(false)
  expect(motionVariationSchema.safeParse({ lease, seed: 42, script: 'unsafe' }).success).toBe(false)
})
it('rejects inverted hand timing and preserves the sequential comparison preparation', () => {
  const inverted = catalogCopy()
  inverted.profiles[0].handScore.phases.stroke.left.timing = { start: 0.8, end: 0.2 }
  expect(motionCatalogSchema.safeParse(inverted).success).toBe(false)
  const comparison = MOTION_PROFILES.find((p) => p.id === 'explain_balance')
  expect(comparison?.handScore.phases.stroke.left.timing.start).toBe(0.35)
  expect(comparison?.handScore.phases.stroke.right.timing.start).toBe(0)
})
