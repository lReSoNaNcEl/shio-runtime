// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/renderer/audio/audioPlayer', () => ({ AudioPlayer: class {} }))
vi.mock('../../../src/renderer/audio/MicrophoneGateController', () => ({
  MicrophoneGateController: class {},
}))

import { Controller } from '../../../src/renderer/Controller'

describe('overlay motion HUD projection', () => {
  it('shows the applied active profile and clears it when motion ends or the HUD is unavailable', () => {
    const state = { overlayAnimationHudEnabled: true, overlayMotionProfileId: '' }
    let overlay = true
    let pose: { profileId: string; outcome: string | null } | null = {
      profileId: 'presence_warm',
      outcome: null,
    }
    const context = {
      state,
      overlayRuntime: { isOverlayWindow: () => overlay },
      avatarRuntime: { getDebugState: () => ({ bodyMotion: { appliedPose: pose } }) },
      set: (patch: Partial<typeof state>) => Object.assign(state, patch),
    }
    const update = (
      Controller.prototype as unknown as {
        updateOverlayMotionHud: (this: typeof context) => void
      }
    ).updateOverlayMotionHud
    update.call(context)
    expect(state.overlayMotionProfileId).toBe('presence_warm')
    pose = { profileId: 'presence_warm', outcome: 'completed' }
    update.call(context)
    expect(state.overlayMotionProfileId).toBe('')
    pose = { profileId: 'presence_poised', outcome: null }
    update.call(context)
    expect(state.overlayMotionProfileId).toBe('presence_poised')
    overlay = false
    update.call(context)
    expect(state.overlayMotionProfileId).toBe('')
    overlay = true
    state.overlayAnimationHudEnabled = false
    update.call(context)
    expect(state.overlayMotionProfileId).toBe('')
  })
})
