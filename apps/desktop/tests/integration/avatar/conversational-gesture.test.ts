import { afterEach, describe, expect, it, vi } from 'vitest'

import { AvatarController } from '../../../src/renderer/avatar/AvatarController'
import type { AvatarPlaybackCoordinator } from '../../../src/renderer/avatar/AvatarPlaybackCoordinator'
import type {
  LipSync,
  LipSyncSession,
} from '../../../src/renderer/avatar/embodiment/speech/LipSync'
import type { MotionLibraryDebug } from '../../../src/renderer/avatar/MotionLibraryDebug'
import type { VrmModel } from '../../../src/renderer/avatar/rendering/three/VrmModel'
import { MOTION_CATALOG_REVISION } from '../../../src/shared/motion'
import { createDeferred, type Deferred } from '../../support/Deferred'
import { createPcmPlaybackClock } from '../../support/speech/pcmClock'

const controllers: AvatarController[] = []
const requests: Deferred<void>[] = []

function fixture() {
  const controller = new AvatarController()
  controller.setConversationView({ overlayViewMode: 'bust' })
  controllers.push(controller)
  const {
    vrmModel: model,
    lipSync,
    playback,
  } = controller as unknown as {
    vrmModel: VrmModel
    lipSync: LipSync
    playback: AvatarPlaybackCoordinator
  }
  let session: LipSyncSession | null = null
  const clock = createPcmPlaybackClock()
  const motion: MotionLibraryDebug = {
    profileId: 'presence_poised',
    runningProfileId: 'presence_poised',
    posture: 'standing',
    phase: 'hold',
    handPhase: 'hold',
    transitionRoute: [],
    rejectedReason: null,
    profiles: {},
    executionId: 'presence-1',
    outcome: null,
    blendRemaining: 0,
    underruns: 0,
  }
  vi.spyOn(model, 'isLoaded').mockReturnValue(true)
  vi.spyOn(model, 'update').mockImplementation(() => undefined)
  vi.spyOn(lipSync, 'update').mockImplementation(() => undefined)
  vi.spyOn(lipSync, 'getActiveSession').mockImplementation(() => session)
  vi.spyOn(lipSync, 'attach').mockImplementation((request) => {
    session = request.session
  })
  vi.spyOn(model, 'getMotionLibraryDebug').mockReturnValue(motion)
  vi.spyOn(model, 'getEmbodimentAvailability').mockReturnValue({
    version: 2,
    catalogRevision: MOTION_CATALOG_REVISION,
    modelGeneration: 1,
    availableSemanticIntents: ['greeting', 'fox-paw'],
    unavailableReasons: [],
    qualification: 'qualified',
  })
  const request = vi.spyOn(model, 'requestGeneratedMotion').mockImplementation(() => {
    const pending = createDeferred<void>()
    requests.push(pending)
    return pending.promise
  })
  const propose = (eligibility: 'opening' | 'future-only' = 'opening', turnId = 'turn-a') =>
    controller.setEmbodimentIntent(
      { intensity: 'normal', gestureHint: 'greeting' },
      {
        turnId,
        receivedAt: Date.now(),
        eligibility,
      },
    )
  const start = () =>
    controller.startSpeaking(
      {
        session: { turnId: 'turn-a', playbackId: 'pcm-a' } as LipSyncSession,
        text: 'Привет!',
        emotionKey: 'happy',
      },
      'happy',
    )
  controller.setPcmClock(clock)
  return { controller, model, playback, request, propose, start, clock, motion }
}

afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.dispose()
  const pending = requests.splice(0)
  for (const request of pending) request.resolve()
  await Promise.all(pending.map((request) => request.promise))
  vi.restoreAllMocks()
})

describe('conversational gesture preparation and late admission', () => {
  it('accepts a fresh same-turn proposal after an unperformed preparation expired', () => {
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const f = fixture()
    f.propose()
    now += 10001
    f.controller.update(0)
    f.request.mockClear()
    f.propose()
    expect(f.request).toHaveBeenCalledWith(
      'greet_wave_soft',
      expect.objectContaining({ speechBound: true }),
    )
    f.start()
    expect(f.request.mock.calls.filter(([id]) => id === 'greet_wave_soft')).toHaveLength(1)
  })
  it('releases an anticipatory preparation when its admitted turn clears the proposal', () => {
    const f = fixture()
    const release = vi.spyOn(f.model, 'releaseSpeechPreparation')
    f.propose()
    f.controller.setEmbodimentIntent(undefined)
    expect(release).toHaveBeenCalledWith('greet_wave_soft')
    f.request.mockClear()
    f.start()
    expect(f.request.mock.calls.some(([id]) => id === 'greet_wave_soft')).toBe(false)
  })
  it('prepares before PCM and adopts the exact pending execution once, despite its own cooldown', () => {
    const f = fixture()
    f.propose()
    expect(f.request).toHaveBeenCalledWith(
      'greet_wave_soft',
      expect.objectContaining({ speechBound: true }),
    )
    const pending = f.playback.getCurrentContext()
    f.controller.setMode('thinking')
    f.controller.prepareSpeaking('happy')
    vi.mocked(f.model.getEmbodimentAvailability).mockReturnValue({
      ...f.model.getEmbodimentAvailability(),
      availableSemanticIntents: [],
    })
    f.start()
    f.controller.showSpeaking('happy')
    f.controller.setEmotion('calm')
    expect(f.playback.getCurrentContext()).toBe(pending)
    expect(pending?.mode).toBe('speaking')
    expect(f.request).toHaveBeenCalledTimes(1)
  })

  it('admits a late intent once at a hold boundary, never during stroke or buffering', () => {
    const f = fixture()
    f.start()
    f.request.mockClear()
    f.propose('future-only')
    f.controller.update(0.1)
    expect(f.request).not.toHaveBeenCalled()
    f.clock.state = 'playing'
    f.clock.sourceSampleOffset = 4410
    f.motion.phase = 'stroke'
    f.controller.update(0.1)
    expect(f.request).not.toHaveBeenCalled()
    f.motion.phase = 'hold'
    f.controller.update(0.1)
    expect(f.request).toHaveBeenCalledWith(
      'greet_wave_soft',
      expect.objectContaining({ speechBound: true }),
    )
    f.controller.update(0.1)
    f.controller.showSpeaking('happy')
    expect(f.request).toHaveBeenCalledTimes(1)
  })

  it.each(['ended', 'cancelled'] as const)(
    'does not start a late gesture after PCM is %s',
    (state) => {
      const f = fixture()
      f.start()
      f.request.mockClear()
      f.propose('future-only')
      f.clock.state = state
      f.clock.sourceSampleOffset = 44100
      f.controller.update(0.1)
      expect(f.request).not.toHaveBeenCalled()
    },
  )

  it('does not replay prepared intent after manual preview or speech stop', () => {
    const f = fixture()
    f.propose()
    f.controller.previewAnimation('fox_paw_single')
    f.request.mockClear()
    f.start()
    expect(f.request.mock.calls.some(([id]) => id === 'greet_wave_soft')).toBe(false)
    f.controller.stopSpeaking()
    f.request.mockClear()
    f.start()
    expect(f.request.mock.calls.some(([id]) => id === 'greet_wave_soft')).toBe(false)
  })

  it('releases an expired preparation and never adopts it for a subsequent speech', () => {
    let now = 20000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const f = fixture()
    const release = vi.spyOn(f.model, 'releaseSpeechPreparation')
    f.propose()
    f.controller.setBehaviorEmbodimentIntent({ intensity: 'subtle', gestureHint: 'fox-paw' })
    now += 10001
    f.controller.update(0)
    expect(release).toHaveBeenCalledWith('greet_wave_soft')
    f.request.mockClear()
    f.start()
    expect(f.request.mock.calls.some(([id]) => id === 'greet_wave_soft')).toBe(false)
  })

  it('releases old preparation when a new turn clears or replaces its proposal', () => {
    const f = fixture()
    const release = vi.spyOn(f.model, 'releaseSpeechPreparation')
    f.propose()
    f.controller.setEmbodimentIntent(undefined)
    expect(release).toHaveBeenCalledOnce()
    const old = f.playback.getCurrentContext()
    f.propose('opening', 'turn-b')
    expect(f.playback.getCurrentContext()).not.toBe(old)
    expect(f.request).toHaveBeenCalledTimes(2)
  })
})
