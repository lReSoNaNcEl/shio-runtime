import { afterEach, expect, it, vi } from 'vitest'

import { AvatarFacialRuntime } from '../../../src/renderer/avatar/embodiment/AvatarFacialRuntime'
import { VrmModel } from '../../../src/renderer/avatar/rendering/three/VrmModel'

afterEach(() => vi.restoreAllMocks())

it('composes procedural and secondary motion exactly once per rendered frame', () => {
  const events: string[] = []
  vi.spyOn(AvatarFacialRuntime.prototype, 'removeProceduralMotion').mockImplementation(() => {
    events.push('remove')
  })
  vi.spyOn(AvatarFacialRuntime.prototype, 'updateProceduralMotion').mockImplementation(() => {
    events.push('procedural')
  })
  vi.spyOn(AvatarFacialRuntime.prototype, 'update').mockImplementation(() => {
    events.push('face')
  })
  const model = new VrmModel()
  model.vrm = { update: () => events.push('vrm') } as never
  model.update(1 / 60)
  expect(events).toEqual(['remove', 'procedural', 'face', 'vrm'])
})
