import { describe, expect, it, vi } from 'vitest'

import { AvatarController } from '../../../src/renderer/avatar/AvatarController'
import type { MotionLibraryDebug } from '../../../src/renderer/avatar/MotionLibraryDebug'
import type { VrmModel } from '../../../src/renderer/avatar/rendering/three/VrmModel'

function debug(overrides: Partial<MotionLibraryDebug> = {}): MotionLibraryDebug {
  return {
    profileId: 'agree_soft',
    runningProfileId: 'agree_soft',
    posture: 'standing',
    phase: 'recover',
    handPhase: 'recover',
    transitionRoute: [],
    rejectedReason: null,
    profiles: {},
    executionId: 'old-execution',
    outcome: 'completed',
    blendRemaining: 0,
    underruns: 0,
    ...overrides,
  }
}
const sequence = ['greet_wave_soft', 'agree_soft', 'reassure_palm']
function fixture() {
  const controller = new AvatarController()
  const model = (controller as unknown as { vrmModel: VrmModel }).vrmModel
  vi.spyOn(model, 'isLoaded').mockReturnValue(true)
  vi.spyOn(model, 'requestGeneratedMotion').mockImplementation(() => new Promise(() => undefined))
  let state = debug()
  vi.spyOn(controller, 'getMotionLibraryDebug').mockImplementation(() => state)
  const preview = vi.spyOn(controller, 'previewAnimation')
  return {
    controller,
    preview,
    setState: (value: MotionLibraryDebug) => {
      state = value
    },
  }
}

describe('preview sequence execution ownership', () => {
  it('does not advance from the completed execution that preceded an async preview request', () => {
    const { controller, preview } = fixture()
    controller.previewSequence(sequence)
    controller.update(0)
    expect(preview.mock.calls.map(([id]) => id)).toEqual([sequence[0]])
  })

  it('does not continue a preview sequence after a foreign conversation execution supersedes it', () => {
    const { controller, preview, setState } = fixture()
    controller.previewSequence(sequence)
    setState(
      debug({
        executionId: 'preview-execution',
        runningProfileId: sequence[0],
        phase: 'prepare',
        outcome: null,
      }),
    )
    controller.update(0)
    controller.showSpeaking('calm')
    setState(
      debug({
        executionId: 'conversation-execution',
        runningProfileId: 'thank_heart_hover',
        phase: 'stroke',
        outcome: null,
      }),
    )
    controller.update(0)
    setState(
      debug({
        executionId: 'conversation-execution',
        runningProfileId: 'thank_heart_hover',
        outcome: 'completed',
      }),
    )
    controller.update(0)
    expect(preview.mock.calls.map(([id]) => id)).toEqual([sequence[0]])
  })

  it('never adopts a later foreign execution merely because its profile matches the pending preview', () => {
    const { controller, preview, setState } = fixture()
    controller.previewSequence(sequence)
    controller.showSpeaking('calm')
    setState(
      debug({
        executionId: 'conversation-first',
        runningProfileId: 'thank_heart_hover',
        phase: 'stroke',
        outcome: null,
      }),
    )
    controller.update(0)
    setState(
      debug({
        executionId: 'conversation-greeting',
        runningProfileId: sequence[0],
        phase: 'prepare',
        outcome: null,
      }),
    )
    controller.update(0)
    setState(
      debug({
        executionId: 'conversation-greeting',
        runningProfileId: sequence[0],
        outcome: 'completed',
      }),
    )
    controller.update(0)
    expect(preview.mock.calls.map(([id]) => id)).toEqual([sequence[0]])
  })
})
