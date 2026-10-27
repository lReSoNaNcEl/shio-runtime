import type { VRMHumanBoneName } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  calibrateFingerSpreadSigns,
  GeneratedHandPose,
} from '../../../src/renderer/avatar/rendering/three/GeneratedHandPose'
import { HAND_BONE_NAMES, MOTION_PROFILES } from '../../../src/shared/motion'
import { greenFoxRig } from '../../support/avatar/greenFoxRig'

it('uses the loaded finger calibration when judging an already matched transition', () => {
  const composer = new GeneratedHandPose(new Map(), new Map([['rightIndexProximal', -1]]))
  composer.sampleScore('peace_single', 'matched', 'prepare', 1)
  expect(composer.transitionError('peace_single')).toBeLessThan(0.000001)
})

function settled(profile: string, version = '1') {
  const hands = new GeneratedHandPose()
  return hands.sampleScore(profile, 'execution', 'hold', 1, version)
}
function rotation(pose: ReturnType<GeneratedHandPose['sampleScore']>, bone: VRMHumanBoneName) {
  const result = pose.get(bone)
  if (!result) throw new Error(`Missing hand bone ${bone}`)
  return result
}

describe('phase-bound bilateral hand composition', () => {
  it('forms the V and folds ring/little fingers on the actual normalized bind hierarchy', () => {
    const vrm = greenFoxRig(process.env.SHIO_TEST_VRM_PATH)
    const position = (name: VRMHumanBoneName) => {
      const node = vrm.humanoid.getNormalizedBoneNode(name)
      if (!node) throw new Error(`Missing real finger: ${name}`)
      return node.getWorldPosition(new THREE.Vector3())
    }
    const bindDirections = new Map<string, THREE.Vector3>()
    for (const side of ['left', 'right'] as const) {
      const inverse = vrm.humanoid
        .getNormalizedBoneNode(`${side}Hand`)
        ?.getWorldQuaternion(new THREE.Quaternion())
        .invert()
      if (!inverse) throw new Error('Missing hand basis')
      for (const finger of ['Index', 'Middle', 'Ring', 'Little'] as const)
        bindDirections.set(
          `${side}${finger}`,
          position(`${side}${finger}Intermediate`)
            .sub(position(`${side}${finger}Proximal`))
            .normalize()
            .applyQuaternion(inverse),
        )
    }
    const rest = new Map(
      HAND_BONE_NAMES.map((name) => [
        name,
        vrm.humanoid.getNormalizedBoneNode(name)?.quaternion.clone() ?? new THREE.Quaternion(),
      ]),
    )
    const composer = new GeneratedHandPose(rest, calibrateFingerSpreadSigns(vrm))
    const pose = composer.sampleScore('peace_single', 'v-bind', 'hold', 1, vrm.meta.metaVersion)
    for (const [name, q] of pose) vrm.humanoid.getNormalizedBoneNode(name)?.quaternion.copy(q)
    vrm.scene.updateMatrixWorld(true)
    for (const side of ['left', 'right'] as const) {
      const inverse = vrm.humanoid
        .getNormalizedBoneNode(`${side}Hand`)
        ?.getWorldQuaternion(new THREE.Quaternion())
        .invert()
      if (!inverse) throw new Error('Missing hand basis')
      const flexion: Record<string, number> = {}
      for (const finger of ['Index', 'Middle', 'Ring', 'Little'] as const) {
        const direction = position(`${side}${finger}Intermediate`)
          .sub(position(`${side}${finger}Proximal`))
          .normalize()
        const baseline = bindDirections.get(`${side}${finger}`)
        if (!baseline) throw new Error('Missing individual finger baseline')
        flexion[finger] = THREE.MathUtils.radToDeg(
          baseline.angleTo(direction.applyQuaternion(inverse)),
        )
      }
      if (side === 'right') {
        const indexDirection = position('rightIndexIntermediate')
          .sub(position('rightIndexProximal'))
          .normalize()
        const middleDirection = position('rightMiddleIntermediate')
          .sub(position('rightMiddleProximal'))
          .normalize()
        const opening = THREE.MathUtils.radToDeg(indexDirection.angleTo(middleDirection))
        expect(opening).toBeGreaterThan(12)
        expect(opening).toBeLessThan(45)
        expect(flexion.Index).toBeLessThan(20)
        expect(flexion.Middle).toBeLessThan(20)
        expect(flexion.Ring).toBeGreaterThan(50)
        expect(flexion.Little).toBeGreaterThan(50)
      } else expect(Math.max(...Object.values(flexion))).toBeLessThan(35)
    }
    vrm.scene.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
    })
  })

  it('makes a V only on the designated right hand and leaves its supporting hand relaxed', () => {
    const pose = settled('peace_single')
    const index = rotation(pose, 'rightIndexProximal')
    const middle = rotation(pose, 'rightMiddleProximal')
    expect(index.angleTo(new THREE.Quaternion())).toBeLessThan(0.17)
    expect(middle.angleTo(new THREE.Quaternion())).toBeLessThan(0.17)
    expect(Math.sign(index.y)).toBe(-Math.sign(middle.y))
    for (const finger of ['Ring', 'Little'] as const) {
      expect(
        rotation(pose, `right${finger}Proximal`).angleTo(new THREE.Quaternion()),
      ).toBeGreaterThan(1)
      expect(rotation(pose, `left${finger}Proximal`).angleTo(new THREE.Quaternion())).toBeLessThan(
        0.5,
      )
    }
  })
  it.each(['0', '1'])('curls fingers toward their palm for VRM %s', (version) => {
    const pose = settled('peace_single', version)
    const direction = -1 * (version === '0' ? -1 : 1)
    const tip = new THREE.Vector3(direction, 0, 0).applyQuaternion(
      rotation(pose, 'rightRingProximal'),
    )
    expect(tip.y).toBeLessThan(-0.8)
  })
  it('samples the common phase cursor only and holds fingers and wrists during buffering', () => {
    const hands = new GeneratedHandPose()
    hands.sampleScore('fox_paw_single', 'e', 'prepare', 0)
    const first = hands.sampleScore('fox_paw_single', 'e', 'prepare', 0.5)
    const wrists = new Map([...hands.getWristOffsets()].map(([name, q]) => [name, q.toArray()]))
    for (let repeat = 0; repeat < 20; repeat++) {
      const held = hands.sampleScore('fox_paw_single', 'e', 'prepare', 0.5)
      for (const name of HAND_BONE_NAMES)
        expect(rotation(held, name).toArray()).toEqual(rotation(first, name).toArray())
      for (const [name, q] of hands.getWristOffsets()) expect(q.toArray()).toEqual(wrists.get(name))
    }
    expect(hands.targetsReached()).toBe(false)
    const moved = hands.sampleScore('fox_paw_single', 'e', 'prepare', 1)
    expect(
      rotation(moved, 'rightRingProximal').angleTo(rotation(first, 'rightRingProximal')),
    ).toBeGreaterThan(0.1)
    expect(hands.targetsReached()).toBe(true)
  })
  it('does not accumulate render-dependent rotations or introduce random motion during a held phase', () => {
    const sparse = new GeneratedHandPose()
    const frequent = new GeneratedHandPose()
    sparse.sampleScore('presence_poised', 'e', 'hold', 0)
    frequent.sampleScore('presence_poised', 'e', 'hold', 0)
    for (let frame = 1; frame <= 600; frame++)
      frequent.sampleScore('presence_poised', 'e', 'hold', frame / 600)
    const a = sparse.sampleScore('presence_poised', 'e', 'hold', 1)
    const b = frequent.sampleScore('presence_poised', 'e', 'hold', 1)
    for (const name of HAND_BONE_NAMES) {
      expect(rotation(a, name).toArray()).toEqual(rotation(b, name).toArray())
      expect(rotation(a, name).length()).toBeCloseTo(1)
      expect(rotation(a, name).angleTo(new THREE.Quaternion())).toBeLessThan(0.5)
    }
  })
  it('starts a new execution from the actually composed hand pose and recovers continuously', () => {
    const hands = new GeneratedHandPose()
    const paw = hands.sampleScore('fox_paw_single', 'paw', 'hold', 1)
    const switched = hands.sampleScore('peace_single', 'peace', 'prepare', 0)
    for (const name of HAND_BONE_NAMES)
      expect(rotation(switched, name).angleTo(rotation(paw, name))).toBeCloseTo(0)
    const half = hands.sampleScore('peace_single', 'peace', 'prepare', 0.5)
    const done = hands.sampleScore('peace_single', 'peace', 'prepare', 1)
    expect(
      rotation(half, 'rightMiddleProximal').angleTo(rotation(paw, 'rightMiddleProximal')),
    ).toBeGreaterThan(0.3)
    expect(
      rotation(half, 'rightMiddleProximal').angleTo(rotation(done, 'rightMiddleProximal')),
    ).toBeGreaterThan(0.3)
    const recovering = hands.sampleScore('peace_single', 'peace', 'recover', 0)
    for (const name of HAND_BONE_NAMES)
      expect(rotation(recovering, name).angleTo(rotation(done, name))).toBeCloseTo(0)
    const recovered = hands.sampleScore('peace_single', 'peace', 'recover', 1)
    expect(rotation(recovered, 'rightRingProximal').angleTo(new THREE.Quaternion())).toBeLessThan(
      0.5,
    )
    expect(hands.targetsReached()).toBe(true)
  })
  it('composes with calibrated rest rotations and never mutates borrowed poses', () => {
    const rest = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2)
    const saved = rest.toArray()
    const hands = new GeneratedHandPose(new Map([['rightIndexProximal', rest]]))
    const starting = hands.sampleScore('peace_single', 'e', 'prepare', 0)
    expect(rotation(starting, 'rightIndexProximal').angleTo(rest)).toBeCloseTo(0)
    const pose = hands.sampleScore('peace_single', 'e', 'prepare', 1)
    expect(rest.toArray()).toEqual(saved)
    expect(pose.size).toBe(30)
    expect(rotation(pose, 'rightIndexProximal').angleTo(rest)).toBeGreaterThan(0.1)
  })
  it('can evaluate every standing profile through all phases with finite unit quaternions', () => {
    for (const profile of MOTION_PROFILES) {
      const hands = new GeneratedHandPose()
      for (const phase of profile.phases) {
        for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
          const pose = hands.sampleScore(profile.id, profile.id, phase.id, progress)
          for (const q of [...pose.values(), ...hands.getWristOffsets().values()]) {
            expect(q.toArray().every(Number.isFinite)).toBe(true)
            expect(q.length()).toBeCloseTo(1)
          }
        }
      }
    }
  })
})
it('opens comparison palms sequentially using one phase progress and freezes them together', () => {
  const hands = new GeneratedHandPose()
  const prepared = hands.sampleScore('explain_balance', 'comparison', 'prepare', 1)
  const leftBefore = rotation(prepared, 'leftRingProximal').clone()
  const first = hands.sampleScore('explain_balance', 'comparison', 'stroke', 0.2)
  expect(rotation(first, 'leftRingProximal').angleTo(leftBefore)).toBeCloseTo(0)
  expect(rotation(first, 'rightRingProximal').angleTo(new THREE.Quaternion())).toBeLessThan(
    rotation(first, 'leftRingProximal').angleTo(new THREE.Quaternion()),
  )
  expect(hands.targetsReached()).toBe(false)
  const frozen = hands.sampleScore('explain_balance', 'comparison', 'stroke', 0.2)
  for (const name of HAND_BONE_NAMES)
    expect(rotation(frozen, name).toArray()).toEqual(rotation(first, name).toArray())
  const second = hands.sampleScore('explain_balance', 'comparison', 'stroke', 0.8)
  expect(rotation(second, 'leftRingProximal').angleTo(leftBefore)).toBeGreaterThan(0.15)
  hands.sampleScore('explain_balance', 'comparison', 'stroke', 1)
  expect(hands.targetsReached()).toBe(true)
})
