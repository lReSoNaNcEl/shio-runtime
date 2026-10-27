import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import {
  gestureRegionsVisible,
  resolveConversationView,
} from '../../../src/renderer/avatar/rendering/three/ConversationFraming'
import { resolveOverlayCameraView } from '../../../src/renderer/avatar/tuning/cameraTuning'

describe('read-only conversational framing', () => {
  it('rejects an invisible lead hand and accepts a compact visible region without moving the camera', () => {
    const camera = new PerspectiveCamera(28, 450 / 700, 0.01, 10)
    camera.position.set(0, 1.5, -1.25)
    camera.lookAt(0, 1.4, 0)
    camera.updateMatrixWorld()
    const before = {
      position: camera.position.toArray(),
      quaternion: camera.quaternion.toArray(),
      fov: camera.fov,
    }
    const region = (x: number) => [
      new Vector3(x, 1.4, -0.1),
      new Vector3(x, 1.48, -0.1),
      new Vector3(x - 0.03, 1.4, -0.1),
      new Vector3(x + 0.03, 1.4, -0.1),
    ]
    expect(gestureRegionsVisible(camera, [region(0.5)])).toBe(false)
    expect(gestureRegionsVisible(camera, [region(0.1)])).toBe(true)
    expect(gestureRegionsVisible(camera, [])).toBe(false)
    expect(gestureRegionsVisible(camera, [region(0.1), region(0.5)])).toBe(false)
    expect({
      position: camera.position.toArray(),
      quaternion: camera.quaternion.toArray(),
      fov: camera.fov,
    }).toEqual(before)
  })
  it('preserves the existing preset calculation and partial configuration updates', () => {
    const view = resolveOverlayCameraView(
      'face',
      { height: 1.65, base: 0, headY: 1.5, frontSign: -1 },
      1,
    )
    expect(view).toEqual({
      position: { x: 0, y: 1.58, z: -1.25 },
      target: { x: 0, y: 1.43, z: 0 },
      fov: 28,
    })
    const initial = resolveConversationView({
      overlayViewMode: 'portrait',
      overlayWidth: '450',
      overlayHeight: '700',
      overlayScale: '1.2',
    })
    expect(resolveConversationView({ overlayViewMode: 'face' }, initial)).toEqual({
      ...initial,
      mode: 'face',
    })
    expect(resolveConversationView({ overlayWidth: 'NaN' }, initial).width).toBe(450)
  })
})
