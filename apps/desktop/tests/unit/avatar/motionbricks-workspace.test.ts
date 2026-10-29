import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { GeneratedBodyPlayback } from '../../../src/renderer/avatar/rendering/three/GeneratedBodyPlayback'
import { GeneratedBodySafety } from '../../../src/renderer/avatar/rendering/three/GeneratedBodySafety'
import { getMotionProfile } from '../../../src/shared/motion'
import { greenFoxRig } from '../../support/avatar/greenFoxRig'

describe('MotionBricks anatomical close-workspace calibration', () => {
  it('uses actual view evidence for MotionBricks and continues to reject offscreen workspaces', () => {
    const body = new GeneratedBodyPlayback(() => undefined)
    body.attach(greenFoxRig())
    body.setConversationView({ overlayViewMode: 'face' })
    const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 100)
    camera.position.set(0, 1, -4)
    camera.lookAt(0, 1, 0)
    camera.updateMatrixWorld(true)
    Reflect.set(body, 'projectedConversationCamera', camera)
    expect(body.isConversationalMotionAvailable('explain_one_palm')).toBe(false)
    Reflect.set(body, 'appliedSourceProvider', 'motionbricks')
    expect(body.isConversationalMotionAvailable('explain_one_palm')).toBe(true)
    camera.fov = 1
    camera.updateProjectionMatrix()
    expect(body.isConversationalMotionAvailable('explain_one_palm')).toBe(false)
    body.detach()
  })
  it.each([0, Math.PI / 2])(
    'retains workspace size and safety while aligning its centre to the measured shoulder (%s)',
    (rotation) => {
      const vrm = greenFoxRig()
      vrm.scene.rotation.y = rotation
      vrm.scene.updateMatrixWorld(true)
      const safety = new GeneratedBodySafety()
      safety.attach(vrm)
      safety.setHandTargets(getMotionProfile('explain_point_close'), 'stroke')
      const access = safety as unknown as {
        sourceProvider: 'motionbricks' | undefined
        arms: Array<{ side: number; upper: THREE.Object3D }>
        handGoal(arm: unknown): {
          center: THREE.Vector3
          axes: THREE.Vector3[]
          extents: number[]
          palm: THREE.Vector3
          fingers: THREE.Vector3
        }
      }
      const arm = access.arms.find((entry) => entry.side === -1)
      expect(arm).toBeDefined()
      access.sourceProvider = undefined
      const before = access.handGoal(arm)
      access.sourceProvider = 'motionbricks'
      const after = access.handGoal(arm)
      expect(after.extents).toEqual(before.extents)
      expect(after.palm.toArray()).toEqual(before.palm.toArray())
      expect(after.fingers.toArray()).toEqual(before.fingers.toArray())
      const shoulder = arm?.upper.getWorldPosition(new THREE.Vector3())
      expect(shoulder).toBeDefined()
      if (shoulder)
        expect(Math.abs(after.center.clone().sub(shoulder).dot(after.axes[0]))).toBeLessThan(1e-7)
      expect(after.center.distanceTo(before.center)).toBeGreaterThan(0.02)
      safety.reset()
    },
  )
})
