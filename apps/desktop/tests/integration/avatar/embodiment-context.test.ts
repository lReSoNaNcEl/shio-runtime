import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AvatarBehaviorResolver } from '../../../src/renderer/avatar/AvatarBehaviorResolver'
import { AvatarController } from '../../../src/renderer/avatar/AvatarController'
import type { VrmModel } from '../../../src/renderer/avatar/rendering/three/VrmModel'
import type { CharacterEmbodimentIntent } from '../../../src/shared/character-response'
import { MOTION_CATALOG_REVISION } from '../../../src/shared/motion'

const intent: CharacterEmbodimentIntent = { intensity: 'normal', gestureHint: 'greeting' }
interface Inspection {
  effectiveEmbodimentIntent(): CharacterEmbodimentIntent | undefined
  lipSync: { getActiveSession(): { turnId: string } | null }
  behaviorResolver: AvatarBehaviorResolver
  vrmModel: VrmModel
}

afterEach(() => vi.restoreAllMocks())

describe('Avatar embodiment context validity', () => {
  it('expires a proposal without using its opening accent later', () => {
    let now = 20_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const controller = new AvatarController()
    const inspect = controller as unknown as Inspection
    controller.setEmbodimentIntent(intent, {
      turnId: 'turn-a',
      receivedAt: now,
      eligibility: 'opening',
    })
    expect(inspect.effectiveEmbodimentIntent()).toEqual(intent)
    now += 10_001
    expect(inspect.effectiveEmbodimentIntent()).toBeUndefined()
  })

  it('rejects stale, future-dated and foreign-turn proposals', () => {
    vi.spyOn(Date, 'now').mockReturnValue(20_000)
    const controller = new AvatarController()
    const inspect = controller as unknown as Inspection
    vi.spyOn(inspect.lipSync, 'getActiveSession').mockReturnValue({ turnId: 'turn-a' })
    for (const context of [
      { turnId: 'turn-a', receivedAt: 1, eligibility: 'opening' as const },
      { turnId: 'turn-a', receivedAt: 21_001, eligibility: 'opening' as const },
      { turnId: 'turn-b', receivedAt: 20_000, eligibility: 'opening' as const },
    ]) {
      controller.setEmbodimentIntent(intent, context)
      expect(inspect.effectiveEmbodimentIntent()).toBeUndefined()
    }
  })

  it('keeps a future-only proposal from becoming a new opening gesture', () => {
    const controller = new AvatarController()
    const inspect = controller as unknown as Inspection
    const semantic = vi.spyOn(inspect.behaviorResolver, 'resolveEmbodimentIntent')
    controller.setEmbodimentIntent(intent, {
      turnId: 'turn-a',
      receivedAt: Date.now(),
      eligibility: 'future-only',
    })
    controller.showSpeaking('calm')
    expect(semantic).not.toHaveBeenCalled()
  })

  it('follows the turn’s gaze through a consumed pause and retires it with the turn', () => {
    const controller = new AvatarController()
    const inspect = controller as unknown as Inspection
    const model = inspect.vrmModel
    vi.spyOn(model, 'supportsContextualMotion').mockReturnValue(true)
    const scheduled = vi.spyOn(inspect.behaviorResolver, 'resolveAnimationTags')
    const speaking = vi.spyOn(inspect.behaviorResolver, 'resolveSpeakingPresence')
    const apply = vi.spyOn(model, 'setConversationPerformance')
    const pause = vi.spyOn(model, 'isSpeechPause').mockReturnValue(false)
    const performance = {
      lean: 0.2,
      lateralLean: -0.1,
      gestureAmount: 0.5,
      handBias: 0.4,
      pauseGaze: 'away' as const,
    }
    const clock = {
      playbackId: 'turn-a:playback-1',
      turnId: 'turn-a',
      sourceSampleOffset: 4410,
      sourceSampleRate: 44100,
      state: 'playing' as const,
    }
    controller.setEmbodimentIntent(
      { intensity: 'normal', gazeHint: 'user', performance },
      {
        turnId: clock.turnId,
        receivedAt: Date.now(),
        eligibility: 'opening',
      },
    )
    controller.setPcmClock(clock)
    controller.showSpeaking('calm')
    expect(apply).toHaveBeenLastCalledWith(performance)
    expect(speaking).toHaveBeenCalledOnce()
    expect(scheduled).not.toHaveBeenCalled()
    expect(model.getLookAtDebugState().mode).toBe('userFocus')
    pause.mockReturnValue(true)
    controller.update(1 / 60)
    expect(model.getLookAtDebugState().mode).toBe('away')
    controller.setPcmClock({ ...clock, turnId: 'turn-b' })
    controller.update(1 / 60)
    expect(apply).toHaveBeenLastCalledWith(undefined)
    expect(model.getLookAtDebugState().mode).toBe('speaking')
    controller.setEmbodimentIntent(undefined)
    expect(model.getLookAtDebugState().mode).toBe('speaking')
  })

  it('keeps an explicit wave on the body track when speech starts and ends', () => {
    const controller = new AvatarController()
    const { vrmModel } = controller as unknown as Inspection
    vi.spyOn(vrmModel, 'isLoaded').mockReturnValue(true)
    vi.spyOn(vrmModel, 'supportsContextualMotion').mockReturnValue(true)
    vi.spyOn(vrmModel, 'isConversationalMotionAvailable').mockImplementation(
      (id) => id === 'greet_wave_soft',
    )
    vi.spyOn(vrmModel, 'getEmbodimentAvailability').mockReturnValue({
      version: 2,
      catalogRevision: MOTION_CATALOG_REVISION,
      modelGeneration: 1,
      availableSemanticIntents: ['greeting'],
      unavailableReasons: [],
      qualification: 'qualified',
      contextualMotion: true,
    })
    const play = vi.spyOn(vrmModel, 'requestGeneratedMotion').mockResolvedValue()
    controller.setEmbodimentIntent(intent, {
      turnId: 'turn-a',
      receivedAt: Date.now(),
      eligibility: 'opening',
    })
    controller.showSpeaking('happy')
    controller.stopSpeaking()
    expect(play).toHaveBeenCalledExactlyOnceWith(
      'greet_wave_soft',
      expect.objectContaining({ speechBound: false, source: 'character-state' }),
    )
  })
})
