import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { GeneratedHandPose } from '../../../src/renderer/avatar/rendering/three/GeneratedHandPose'
import { HAND_BONE_NAMES } from '../../../src/shared/motion'

function angle(
  a: ReadonlyMap<string, THREE.Quaternion>,
  b: ReadonlyMap<string, THREE.Quaternion>,
): number {
  return Math.max(
    ...HAND_BONE_NAMES.map((name) =>
      (a.get(name) ?? new THREE.Quaternion()).angleTo(b.get(name) ?? new THREE.Quaternion()),
    ),
  )
}

describe('execution-bound hand score', () => {
  it('keeps fingers continuous across phase changes and superseding intent', () => {
    const hands = new GeneratedHandPose()
    const peace = hands.sampleScore('peace_single', 'execution-1', 'hold', 1)
    expect(hands.targetsReached()).toBe(true)
    const recoveryStart = hands.sampleScore('peace_single', 'execution-1', 'recover', 0)
    expect(angle(peace, recoveryStart)).toBeLessThan(1e-6)
    const partialRecovery = hands.sampleScore('peace_single', 'execution-1', 'recover', 0.4)
    const nextPreparation = hands.sampleScore('greet_wave_soft', 'execution-2', 'prepare', 0)
    expect(angle(partialRecovery, nextPreparation)).toBeLessThan(1e-6)
    expect(hands.targetsReached()).toBe(false)
    hands.sampleScore('greet_wave_soft', 'execution-2', 'prepare', 1)
    expect(hands.targetsReached()).toBe(true)
  })

  it('keeps the exact leading-hand shape separate from the supporting hand', () => {
    const hands = new GeneratedHandPose()
    const score = hands.sampleScore('peace_single', 'execution-1', 'hold', 1)
    const rightIndex = score.get('rightIndexProximal') ?? new THREE.Quaternion()
    const rightRing = score.get('rightRingProximal') ?? new THREE.Quaternion()
    const leftRing = score.get('leftRingProximal') ?? new THREE.Quaternion()
    expect(rightIndex.angleTo(rightRing)).toBeGreaterThan(0.3)
    expect(Math.abs(rightRing.z)).toBeGreaterThan(Math.abs(leftRing.z) + 0.1)
    const repeated = hands.sampleScore('peace_single', 'execution-1', 'hold', 1)
    expect(angle(score, repeated)).toBeLessThan(1e-6)
  })

  it('does not change finger pose when the selected source cursor holds', () => {
    const hands = new GeneratedHandPose()
    const held = hands.sampleScore('fox_paw_single', 'execution-1', 'stroke', 0.4)
    for (let index = 0; index < 100; index += 1)
      expect(
        angle(held, hands.sampleScore('fox_paw_single', 'execution-1', 'stroke', 0.4)),
      ).toBeLessThan(1e-6)
  })
})
