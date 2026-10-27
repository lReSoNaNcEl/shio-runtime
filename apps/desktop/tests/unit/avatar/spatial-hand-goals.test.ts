import * as THREE from 'three'
import { expect, it } from 'vitest'

import { GeneratedBodyPlayback } from '../../../src/renderer/avatar/rendering/three/GeneratedBodyPlayback'
import { GeneratedBodySafety } from '../../../src/renderer/avatar/rendering/three/GeneratedBodySafety'
import { getMotionProfile, MOTION_PROFILES } from '../../../src/shared/motion'
import { greenFoxRig } from '../../support/avatar/greenFoxRig'

it('clears moving-parent contact during a bounded change of hand workspace', () => {
  const vrm = greenFoxRig(process.env.SHIO_TEST_VRM_PATH)
  const owner = new GeneratedBodyPlayback(() => undefined)
  owner.attach(vrm)
  const safety = new GeneratedBodySafety()
  safety.attach(vrm)
  safety.apply()
  const base = new Map(
    Object.entries(vrm.humanoid.normalizedHumanBones).map(([name, { node }]) => [
      name,
      { node, rotation: node.quaternion.clone() },
    ]),
  )
  const chest = vrm.humanoid.getNormalizedBoneNode('chest')
  if (!chest) throw new Error('Missing chest')
  const chestY = chest.position.y
  let consecutiveContacts = 0,
    longestContact = 0
  const profiles = ['curious_lean', 'surprise_small', 'laugh_soft', 'shy_gather']
  const reached = profiles.map(() => false)
  for (let frame = 0; frame < 780; frame++) {
    for (const [name, { node, rotation }] of base) {
      node.quaternion.copy(rotation)
      if (name === 'spine')
        node.quaternion.multiply(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              0.05 * Math.sin(frame * 0.03),
              0.03 * Math.cos(frame * 0.07),
              0.04 * Math.sin(frame * 0.05),
            ),
          ),
        )
      if (name.includes('UpperArm'))
        node.quaternion.multiply(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              0.4 * Math.sin(frame * 0.031),
              0.3 * Math.cos(frame * 0.011),
              0.2 * Math.sin(frame * 0.043),
            ),
          ),
        )
      if (name.includes('LowerArm'))
        node.quaternion.multiply(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              0.3 * Math.sin(frame * 0.027),
              0.8 * Math.cos(frame * 0.017),
              0.15 * Math.sin(frame * 0.021),
            ),
          ),
        )
      if (name.includes('Shoulder'))
        node.quaternion.multiply(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              0.15 * Math.sin(frame * 0.021),
              0.2 * Math.cos(frame * 0.017),
              0.15 * Math.sin(frame * 0.014),
            ),
          ),
        )
    }
    chest.position.y = chestY + 0.008 * Math.sin(frame * 0.02)
    const index = Math.min(profiles.length - 1, Math.floor(frame / 180))
    safety.setHandTargets(getMotionProfile(profiles[index]), 'prepare')
    safety.apply(1 / 60)
    if (safety.handTargetsReached()) reached[index] = true
    consecutiveContacts =
      safety.getDebugState().unresolvedArmContacts > 0 ? consecutiveContacts + 1 : 0
    longestContact = Math.max(longestContact, consecutiveContacts)
  }
  expect(longestContact).toBeLessThanOrEqual(3)
  expect(reached).toEqual(profiles.map(() => true))
  owner.detach()
  vrm.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
  })
})

it.each(
  MOTION_PROFILES.filter((profile) => profile.kind === 'gesture').map((profile) => profile.id),
)('reaches every calibrated hand workspace continuously for %s', (id) => {
  const vrm = greenFoxRig(process.env.SHIO_TEST_VRM_PATH)
  const owner = new GeneratedBodyPlayback(() => undefined)
  owner.attach(vrm)
  const safety = new GeneratedBodySafety()
  safety.attach(vrm)
  safety.apply()
  const base = new Map(
    Object.values(vrm.humanoid.normalizedHumanBones).map(({ node }) => [
      node,
      node.quaternion.clone(),
    ]),
  )
  const profile = getMotionProfile(id)
  if (!profile) throw new Error('Missing profile')
  for (const phase of ['prepare', 'stroke', 'hold'] as const) {
    safety.setHandTargets(profile, phase)
    let reachedAt = null
    let previous = new Map([...base].map(([bone]) => [bone, bone.quaternion.clone()]))
    let maximumStep = 0
    let settlingStep = 0
    for (let frame = 0; frame < 140; frame++) {
      for (const [bone, rotation] of base) bone.quaternion.copy(rotation)
      safety.apply(0.025)
      if (safety.handTargetsReached()) reachedAt ??= (frame + 1) * 25
      for (const [bone, rotation] of previous) {
        const step = rotation.angleTo(bone.quaternion)
        maximumStep = Math.max(maximumStep, step)
        if (frame >= 120) settlingStep = Math.max(settlingStep, step)
      }
      previous = new Map([...base].map(([bone]) => [bone, bone.quaternion.clone()]))
      expect(safety.getDebugState().unresolvedArmContacts).toBe(0)
    }
    expect(safety.handTargetsReached()).toBe(true)
    expect(reachedAt).not.toBeNull()
    expect(reachedAt).toBeLessThanOrEqual(
      profile.phases.find((value) => value.id === phase)?.maxMs ?? 0,
    )
    expect(maximumStep).toBeLessThanOrEqual(0.04)
    expect(settlingStep).toBeLessThan(0.0005)
    if (profile.accentHands === 'heart') {
      const wrist = vrm.humanoid.getNormalizedBoneNode('rightHand')
      const chest = vrm.humanoid.getNormalizedBoneNode('chest')
      const elbow = vrm.humanoid.getNormalizedBoneNode('rightLowerArm')
      const shoulder = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')
      if (!wrist || !chest || !elbow || !shoulder) throw new Error('Missing heart hand anchors')
      const position = wrist.getWorldPosition(new THREE.Vector3())
      const length =
        shoulder
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(elbow.getWorldPosition(new THREE.Vector3())) +
        elbow.getWorldPosition(new THREE.Vector3()).distanceTo(position)
      expect(position.y - chest.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(length * 0.2)
    }
    if (id === 'fox_paw_single') {
      const wrist = vrm.humanoid.getNormalizedBoneNode('rightHand')
      const chest = vrm.humanoid.getNormalizedBoneNode('chest')
      if (!wrist || !chest) throw new Error('Missing fox paw anchors')
      expect(wrist.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(
        chest.getWorldPosition(new THREE.Vector3()).y - 0.02,
      )
    }
    if (id === 'shy_gather') {
      const position = (name: 'leftHand' | 'rightHand' | 'rightUpperArm' | 'rightLowerArm') => {
        const bone = vrm.humanoid.getNormalizedBoneNode(name)
        if (!bone) throw new Error('Missing gathered hand chain')
        return bone.getWorldPosition(new THREE.Vector3())
      }
      const length =
        position('rightUpperArm').distanceTo(position('rightLowerArm')) +
        position('rightLowerArm').distanceTo(position('rightHand'))
      expect(position('leftHand').distanceTo(position('rightHand'))).toBeLessThan(length * 0.55)
    }
  }
  owner.detach()
  vrm.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
  })
})
