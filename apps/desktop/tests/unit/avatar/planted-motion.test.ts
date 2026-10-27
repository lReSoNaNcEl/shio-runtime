import * as THREE from 'three'
import { expect, it } from 'vitest'

import { plantLeg } from '../../../src/renderer/avatar/rendering/three/plantLeg'

it('keeps the knee on its anatomical side when generated extension crosses zero', () => {
  const kneePositions: THREE.Vector3[] = []
  for (const perturbation of [-0.001, 0.001]) {
    const hip = new THREE.Object3D(),
      knee = new THREE.Object3D(),
      foot = new THREE.Object3D()
    hip.add(knee)
    knee.add(foot)
    hip.position.y = 1
    knee.position.y = -0.5
    foot.position.y = -0.5
    hip.rotation.x = perturbation
    hip.updateMatrixWorld(true)
    plantLeg(hip, knee, foot, new THREE.Vector3(0, 0.1, 0), new THREE.Quaternion())
    kneePositions.push(knee.getWorldPosition(new THREE.Vector3()))
  }
  expect(kneePositions[0].distanceTo(kneePositions[1])).toBeLessThan(0.001)
  expect(kneePositions.every((position) => position.z > 0)).toBe(true)
})

it.each([-1, 1])(
  'keeps its model-oriented knee pole under scene rotation, forward sign %s',
  (sign) => {
    const scene = new THREE.Object3D(),
      hip = new THREE.Object3D(),
      knee = new THREE.Object3D(),
      foot = new THREE.Object3D()
    scene.rotation.y = 1.1
    scene.position.set(2, 0, -1)
    scene.add(hip)
    hip.add(knee)
    knee.add(foot)
    hip.position.y = 1
    knee.position.y = -0.5
    foot.position.y = -0.5
    scene.updateMatrixWorld(true)
    const target = scene.localToWorld(new THREE.Vector3(0, 0.1, 0))
    const basis = scene.getWorldQuaternion(new THREE.Quaternion())
    plantLeg(hip, knee, foot, target, basis, new THREE.Vector3(0, 0, sign).applyQuaternion(basis))
    const localKnee = scene.worldToLocal(knee.getWorldPosition(new THREE.Vector3()))
    expect(localKnee.z * sign).toBeGreaterThan(0.2)
    expect(foot.getWorldPosition(new THREE.Vector3()).distanceTo(target)).toBeLessThan(0.001)
  },
)

it('plants a stationary foot after a generated knee lift without moving the root', () => {
  const scene = new THREE.Scene()
  const hip = new THREE.Object3D(),
    knee = new THREE.Object3D(),
    foot = new THREE.Object3D()
  scene.add(hip)
  hip.add(knee)
  knee.add(foot)
  hip.position.set(0, 1, 0)
  knee.position.set(0, -0.5, 0)
  foot.position.set(0, -0.5, 0)
  hip.rotation.x = 0.8
  knee.rotation.x = -1
  scene.updateMatrixWorld(true)
  const root = hip.position.clone(),
    target = new THREE.Vector3(0, 0.05, 0)
  plantLeg(hip, knee, foot, target, new THREE.Quaternion())
  expect(foot.getWorldPosition(new THREE.Vector3()).distanceTo(target)).toBeLessThan(0.001)
  expect(hip.position.equals(root)).toBe(true)
  expect(
    foot.getWorldQuaternion(new THREE.Quaternion()).angleTo(new THREE.Quaternion()),
  ).toBeLessThan(0.001)
})

it('does not retain source axial leg twist after solving identical planted support', () => {
  const results = []
  for (const twist of [-0.7, 0.7]) {
    const hip = new THREE.Object3D(),
      knee = new THREE.Object3D(),
      foot = new THREE.Object3D()
    hip.add(knee)
    knee.add(foot)
    hip.position.y = 1
    knee.position.y = -0.5
    foot.position.y = -0.5
    hip.rotation.y = twist
    knee.rotation.y = -twist * 0.5
    hip.updateMatrixWorld(true)
    plantLeg(hip, knee, foot, new THREE.Vector3(0, 0.05, 0), new THREE.Quaternion())
    results.push([hip.quaternion.clone(), knee.quaternion.clone()])
  }
  expect(results[0][0].angleTo(results[1][0])).toBeLessThan(0.001)
  expect(results[0][1].angleTo(results[1][1])).toBeLessThan(0.001)
})
