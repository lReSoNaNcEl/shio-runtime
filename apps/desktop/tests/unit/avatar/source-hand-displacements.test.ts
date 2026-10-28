import * as THREE from 'three'
import { expect, it } from 'vitest'

import { sourceHandDisplacements } from '../../../src/renderer/avatar/rendering/three/SourceHandDisplacements'
import { createMotionChunk } from '../../support/avatar/motionFixtures'

it('derives a bounded neural wrist arc from rig lengths without mutating the live pose', () => {
  const upper = new THREE.Object3D(),
    lower = new THREE.Object3D(),
    hand = new THREE.Object3D()
  upper.add(lower)
  lower.add(hand)
  lower.position.x = 0.3
  hand.position.x = 0.25
  upper.rotation.z = 0.2
  upper.updateMatrixWorld(true)
  const before = [upper.quaternion.toArray(), lower.quaternion.toArray()]
  const chunk = createMotionChunk()
  const quarter = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
  chunk.rotations[1][11] = quarter.toArray()
  chunk.rotations[1][12] = quarter.toArray()
  const segments = [
    { bone: upper, child: lower, index: 11, restInModel: new THREE.Quaternion() },
    { bone: lower, child: hand, index: 12, restInModel: new THREE.Quaternion() },
  ]
  for (const vrm0 of [false, true]) {
    const points = sourceHandDisplacements(chunk, segments, new THREE.Quaternion(), vrm0, 0, 2)
    expect(points).toHaveLength(2)
    expect(points[0].length()).toBeLessThan(1e-8)
    expect(points[1].x).toBeCloseTo(-0.55)
    expect(points[1].y).toBeCloseTo(vrm0 ? -0.55 : 0.55)
  }
  expect([upper.quaternion.toArray(), lower.quaternion.toArray()]).toEqual(before)
  expect(
    sourceHandDisplacements(chunk, segments, new THREE.Quaternion(), false, 59, 60),
  ).toHaveLength(1)
})
