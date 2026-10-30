import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  type KeyposeRigSample,
  keyposeFromRig,
  wristTargetFromKeypose,
} from '../../../src/renderer/avatar/rendering/three/KeyposeAuthoring'
import { motionHandTargetSchema, motionKeyposeSchema } from '../../../src/shared/motion'

function rig(side: 'left' | 'right', scale: number, handedness: 1 | -1): KeyposeRigSample {
  // VRM1 keeps the character's left at +X; a normalized VRM0 rig is the same body
  // turned 180 degrees about Y, so its lateral and forward axes both flip.
  const lateral = side === 'left' ? handedness : -handedness
  const forward = handedness
  const shoulder = new THREE.Vector3(0.18 * lateral * scale, 1.4 * scale, 0)
  const elbow = shoulder
    .clone()
    .add(new THREE.Vector3(0.05 * lateral, -0.24, 0.08 * forward).multiplyScalar(scale))
  const wrist = elbow
    .clone()
    .add(new THREE.Vector3(0.02 * lateral, 0.05, 0.22 * forward).multiplyScalar(scale))
  return {
    side,
    anchor: new THREE.Vector3(0, 1.3 * scale, 0),
    shoulder,
    elbow,
    wrist,
    across: new THREE.Vector3(handedness, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    palm: new THREE.Vector3(0, 1, 0),
  }
}

describe('keypose authoring', () => {
  it('round-trips a rig pose through a keypose back to the same wrist target', () => {
    const sample = rig('right', 1, 1)
    const keypose = keyposeFromRig(sample, 'chest')
    expect(motionKeyposeSchema.safeParse(keypose).success).toBe(true)
    const armLength =
      sample.shoulder.distanceTo(sample.elbow) + sample.elbow.distanceTo(sample.wrist)
    const target = wristTargetFromKeypose(keypose, { ...sample, armLength })
    expect(target.distanceTo(sample.wrist)).toBeLessThan(0.002)
  })

  it('yields the same keypose for a scaled rig and for mirrored hands and handedness', () => {
    const base = keyposeFromRig(rig('right', 1, 1), 'chest')
    expect(keyposeFromRig(rig('right', 1.4, 1), 'chest').offset).toEqual(base.offset)
    expect(keyposeFromRig(rig('left', 1, 1), 'chest').offset).toEqual(base.offset)
    expect(keyposeFromRig(rig('right', 1, -1), 'chest').offset).toEqual(base.offset)
    expect(base.palmNormal?.[1]).toBeCloseTo(1, 3)
  })

  it('rejects keyposes outside the bounded catalog schema', () => {
    for (const invalid of [
      { anchor: 'chest', offset: [1.6, 0, 0] },
      { anchor: 'shoulder', offset: [0, 0, 0] },
      { anchor: 'chest', offset: [0, 0, 0], palmNormal: [0, 2, 0] },
      { anchor: 'chest', offset: [0, 0, Number.NaN] },
      { anchor: 'chest', offset: [0, 0, 0], extra: true },
    ])
      expect(motionKeyposeSchema.safeParse(invalid).success).toBe(false)
  })

  it('admits one to four keyposes on a hand target', () => {
    const target = {
      role: 'lead',
      workspace: 'front',
      palmFacing: 'free',
      fingerDirection: 'free',
      timing: { start: 0, end: 1 },
      wristEuler: [0, 0, 0],
      fingers: Object.fromEntries(
        ['thumb', 'index', 'middle', 'ring', 'little'].map((name) => [
          name,
          { curl: [0, 0, 0], spread: 0, opposition: 0 },
        ]),
      ),
    }
    const keypose = { anchor: 'chest', offset: [0.2, 0.3, 0.4] }
    expect(motionHandTargetSchema.safeParse({ ...target, keyposes: [keypose] }).success).toBe(true)
    expect(motionHandTargetSchema.safeParse({ ...target, keyposes: [] }).success).toBe(false)
    expect(
      motionHandTargetSchema.safeParse({ ...target, keyposes: Array(5).fill(keypose) }).success,
    ).toBe(false)
  })
})
