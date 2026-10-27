import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { AvatarController } from '../../../src/renderer/avatar/AvatarController'
import { previewHandBounds } from '../../../src/renderer/avatar/rendering/three/previewHandBounds'
import { SceneManager } from '../../../src/renderer/avatar/rendering/three/SceneManager'
import { HAND_BONE_NAMES } from '../../../src/shared/motion'
import { greenFoxRig } from '../../support/avatar/greenFoxRig'

function cameraFixture() {
  const controls = {
    target: new THREE.Vector3(0, 1, 0),
    minDistance: 0.6,
    update: vi.fn(),
    dispose: vi.fn(),
  }
  const manager = Object.assign(Object.create(SceneManager.prototype), {
    camera: new THREE.PerspectiveCamera(),
    controls,
    lookAtAnchor: new THREE.Object3D(),
    modelHeight: 1.65,
    modelBase: 0,
    modelHeadY: null,
    modelFrontSign: -1,
    framedPosition: { x: 0, y: 1, z: -3 },
    framedTarget: { x: 0, y: 1, z: 0 },
  }) as SceneManager
  return { manager, controls }
}

describe('Preview hand camera', () => {
  it.each([
    { metaVersion: '0', front: -1 },
    { metaVersion: '1', front: 1 },
  ] as const)('shows VRM $metaVersion from its front in all presets', ({ metaVersion, front }) => {
    const avatar = Object.assign(Object.create(AvatarController.prototype), {
      vrmModel: { vrm: { meta: { metaVersion } } },
    }) as AvatarController
    const { manager, controls } = cameraFixture()
    manager.setAvatarFrontSign(avatar.getAvatarFrontSign())
    manager.scene = new THREE.Scene()
    const geometry = new THREE.BoxGeometry(0.6, 1.7, 0.3)
    manager.scene.add(new THREE.Mesh(geometry))
    manager.frameLoadedModel()
    expect(Math.sign(manager.camera.position.z - controls.target.z)).toBe(front)
    for (const preset of ['bust', 'face', 'portrait'] as const) {
      manager.setOverlayCameraPreset(preset)
      expect(Math.sign(manager.camera.position.z - controls.target.z)).toBe(front)
    }
    const hand = new THREE.Sphere(new THREE.Vector3(0.3, 1.2, -0.1), 0.1)
    manager.frameHand(() => hand)
    expect(Math.sign(manager.camera.position.z - hand.center.z)).toBe(front)
    geometry.dispose()
  })
  it('frames the composed hand and follows its translation without changing the pose', () => {
    const { manager, controls } = cameraFixture()
    const hand = new THREE.Vector3(0.3, 1.2, -0.1)
    manager.frameHand(() => new THREE.Sphere(hand.clone(), 0.1))
    expect(controls.target.toArray()).toEqual(hand.toArray())
    expect(controls.minDistance).toBeLessThan(0.6)
    const before = manager.camera.position.clone()
    const displacement = new THREE.Vector3(0.1, -0.05, 0.2)
    hand.add(displacement)
    Reflect.apply(Reflect.get(manager, 'updateHandCamera'), manager, [])
    expect(manager.camera.position.distanceTo(before.add(displacement))).toBeLessThan(1e-8)
    expect(controls.target.toArray()).toEqual(hand.toArray())
    expect(hand.toArray()).toEqual([0.4, 1.15, 0.1])
  })

  it('releases hand tracking and restores ordinary camera bounds on preset or model loss', () => {
    const { manager, controls } = cameraFixture()
    let hand: THREE.Vector3 | null = new THREE.Vector3(0.3, 1.2, 0)
    manager.frameHand(() => (hand ? new THREE.Sphere(hand.clone(), 0.1) : null))
    manager.resetCamera()
    expect(controls.minDistance).toBe(0.6)
    const reset = manager.camera.position.clone()
    hand.set(2, 2, 2)
    Reflect.apply(Reflect.get(manager, 'updateHandCamera'), manager, [])
    expect(manager.camera.position.toArray()).toEqual(reset.toArray())
    manager.frameHand(() => (hand ? new THREE.Sphere(hand.clone(), 0.1) : null))
    hand = null
    Reflect.apply(Reflect.get(manager, 'updateHandCamera'), manager, [])
    expect(controls.minDistance).toBe(0.6)
  })

  it.each([0.55, 1.8])('keeps actual finger chains inside a viewport of aspect %s', (aspect) => {
    const vrm = greenFoxRig(process.env.SHIO_TEST_VRM_PATH)
    const hand = vrm.humanoid.getNormalizedBoneNode('rightHand')
    if (!hand) throw new Error('Missing hand')
    hand.rotation.z = -Math.PI / 2
    vrm.scene.updateMatrixWorld(true)
    const bones = HAND_BONE_NAMES.filter((name) => name.startsWith('right')).flatMap((name) => {
      const bone = vrm.humanoid.getNormalizedBoneNode(name)
      return bone ? [bone] : []
    })
    const before = bones.map((bone) => [bone.position.toArray(), bone.quaternion.toArray()])
    const { manager } = cameraFixture()
    manager.camera.fov = 30
    manager.camera.aspect = aspect
    manager.frameHand(() => previewHandBounds(vrm, 'right'))
    manager.camera.updateMatrixWorld(true)
    for (const bone of bones) {
      const point = bone.getWorldPosition(new THREE.Vector3()).project(manager.camera)
      expect(Math.abs(point.x)).toBeLessThan(0.95)
      expect(Math.abs(point.y)).toBeLessThan(0.95)
      expect(point.z).toBeGreaterThan(-1)
      expect(point.z).toBeLessThan(1)
    }
    expect(bones.map((bone) => [bone.position.toArray(), bone.quaternion.toArray()])).toEqual(
      before,
    )
    vrm.scene.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh) node.geometry.dispose()
    })
  })

  it('does not pump the zoom when the inspected fingers close', () => {
    const { manager } = cameraFixture()
    const bounds = new THREE.Sphere(new THREE.Vector3(0.2, 1.2, 0), 0.15)
    manager.frameHand(() => bounds.clone())
    const distance = manager.camera.position.distanceTo(bounds.center)
    bounds.radius = 0.07
    Reflect.apply(Reflect.get(manager, 'updateHandCamera'), manager, [])
    expect(manager.camera.position.distanceTo(bounds.center)).toBeCloseTo(distance, 8)
    bounds.radius = 0.19
    Reflect.apply(Reflect.get(manager, 'updateHandCamera'), manager, [])
    expect(manager.camera.position.distanceTo(bounds.center)).toBeGreaterThan(distance)
    const expanded = manager.camera.position.distanceTo(bounds.center)
    manager.camera.aspect = 0.4
    Reflect.apply(Reflect.get(manager, 'updateHandCamera'), manager, [])
    expect(manager.camera.position.distanceTo(bounds.center)).toBeGreaterThan(expanded)
  })
})
