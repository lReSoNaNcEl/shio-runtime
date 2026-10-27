import { describe, expect, it, vi } from 'vitest'

import { AvatarAnimationController } from '../../../src/renderer/avatar/AvatarAnimationController'
import type { AvatarBehaviorResolution } from '../../../src/renderer/avatar/AvatarBehaviorResolver'
import { AvatarController } from '../../../src/renderer/avatar/AvatarController'
import { AvatarPlaybackCoordinator } from '../../../src/renderer/avatar/AvatarPlaybackCoordinator'
import type { AvatarMode, AvatarStateEffect } from '../../../src/renderer/avatar/AvatarStateMachine'
import type { VrmModel } from '../../../src/renderer/avatar/rendering/three/VrmModel'

function fixture() {
  let active = true
  let outcome: string | null = null
  let runningProfileId = 'presence_poised'
  let executionId = 'execution-1'
  const play = vi.fn(async (animationId: string, _loop: boolean) => {
    runningProfileId = animationId
    executionId = `execution-${animationId}`
    outcome = null
  })
  const animations = {
    playManifest: play,
    getDebugState: () => ({
      isPlaybackActive: active,
      playbackStatus: active ? 'playing' : 'idle',
      activeAnimationId: runningProfileId,
    }),
  } as unknown as AvatarAnimationController
  const model = {
    setBodyMotionLayer: vi.fn(),
    getBodyMotionDebugState: () => ({
      transitionRemaining: 0,
      motionExecution: { outcome, executionId, runningProfileId, profileId: runningProfileId },
    }),
  } as unknown as VrmModel
  const owner = new AvatarPlaybackCoordinator(animations, model)
  const request = (
    animationId: string,
    mode: AvatarMode = 'idle',
    source: 'idle-orchestrator' | 'character-state' | 'debug-reroll' = 'idle-orchestrator',
    forceReplay = false,
  ) =>
    owner.requestResolvedBehavior({
      effect: { mode } as AvatarStateEffect,
      resolved: {
        animationId,
        behaviorId: mode,
        loop: true,
        motionLayer: 'base',
        fallbackAnimationId: 'presence_poised',
        selectionReason: 'test',
      } as AvatarBehaviorResolution,
      source,
      reason: 'test',
      frame: 1,
      interruptible: true,
      forceReplay,
    })
  request('presence_poised')
  return {
    owner,
    play,
    request,
    setOutcome: (value: string | null) => {
      outcome = value
    },
    setExecutionId: (value: string) => {
      executionId = value
    },
    setActive: (value: boolean) => {
      owner.advanceQueue(1)
      active = value
    },
  }
}

describe('manual generated-motion preview ownership', () => {
  it('admits an explicit new variation of the same presence profile', () => {
    const { request, play } = fixture()
    expect(request('presence_poised', 'idle', 'debug-reroll', true).action).toBe('play')
    expect(play).toHaveBeenCalledTimes(2)
    expect(play).toHaveBeenLastCalledWith(
      'presence_poised',
      true,
      expect.objectContaining({ forceReplay: true }),
    )
  })
  it.each(['failed', 'timed-out', 'cancelled'])(
    'releases %s presence and pending intents without retrying',
    (outcome) => {
      const { owner, play, request, setActive, setOutcome } = fixture()
      const current = owner.getQueue().getCurrent()
      if (!current) throw new Error('Missing presence fixture')
      owner.getQueue().replaceCurrent({ ...current, interruptible: false })
      expect(request('presence_listening').action).toBe('queue')
      setActive(false)
      setOutcome(outcome)
      owner.advanceQueue(2)
      expect(owner.getQueue().getCurrent()).toBeNull()
      expect(owner.getQueue().getDebugState().length).toBe(0)
      expect(owner.getCurrentContext()).toBeNull()
      expect(play).toHaveBeenCalledTimes(1)
      expect(request('presence_poised').action).toBe('play')
    },
  )

  it('does not finish a replacement from an earlier execution outcome', () => {
    const { owner, request, setActive, setOutcome, setExecutionId } = fixture()
    request('presence_listening')
    setActive(false)
    setExecutionId('previous-execution')
    setOutcome('completed')
    owner.advanceQueue(3)
    expect(owner.getCurrentContext()?.animationId).toBe('presence_listening')
  })

  it('does not infer completion from stopped playback without an outcome', () => {
    const { owner, setActive } = fixture()
    setActive(false)
    owner.advanceQueue(2)
    expect(owner.getQueue().getCurrent()?.animationId).toBe('presence_poised')
  })
  it('re-enters presence after its completed recovery instead of leaving a frozen looping item', () => {
    const { owner, play, setActive, setOutcome } = fixture()
    setActive(false)
    setOutcome('superseded')
    owner.advanceQueue(2)
    expect(play.mock.calls.at(-1)?.[0]).toBe('presence_poised')
    expect(play).toHaveBeenCalledTimes(2)
    expect(owner.getQueue().getCurrent()?.loop).toBe(true)
  })

  it('registers the preview in the canonical context and queue', () => {
    const { owner, play } = fixture()
    owner.previewAnimation({ animationId: 'fox_paw_single', loop: false, mode: 'idle', frame: 2 })
    expect(owner.getCurrentContext()?.animationId).toBe('fox_paw_single')
    expect(owner.getCurrentContext()?.behaviorId).toBe('debug-preview')
    expect(owner.getQueue().getCurrent()?.animationId).toBe('fox_paw_single')
    expect(play.mock.calls.at(-1)?.[0]).toBe('fox_paw_single')
  })

  it('holds the selected preview against the next automatic idle tick', () => {
    const { owner, play, request } = fixture()
    owner.previewAnimation({ animationId: 'peace_single', loop: false, mode: 'idle', frame: 2 })
    const count = play.mock.calls.length
    const result = request('presence_listening')
    expect(result.action).toBe('ignored')
    expect(play).toHaveBeenCalledTimes(count)
    expect(owner.getQueue().getCurrent()?.animationId).toBe('peace_single')
  })

  it('returns to the preceding base profile after a one-shot preview finishes', () => {
    const { owner, play, setActive, setOutcome } = fixture()
    owner.previewAnimation({ animationId: 'greet_wave_soft', loop: false, mode: 'idle', frame: 2 })
    setActive(false)
    setOutcome('completed')
    owner.advanceQueue(3)
    expect(play.mock.calls.at(-1)?.[0]).toBe('presence_poised')
    expect(owner.getCurrentContext()?.animationId).toBe('presence_poised')
    expect(owner.getQueue().getCurrent()?.loop).toBe(true)
  })

  it('allows a real conversation-mode transition to supersede preview', () => {
    const { owner, request } = fixture()
    owner.previewAnimation({ animationId: 'fox_paw_single', loop: false, mode: 'idle', frame: 2 })
    expect(request('presence_listening', 'listening', 'character-state').action).toBe('play')
    expect(owner.getCurrentContext()?.mode).toBe('listening')
  })
})

describe('generated preview startup lifecycle', () => {
  function pending() {
    let active = false
    let resolve!: () => void
    let reject!: (error: Error) => void
    const generated = new Promise<void>((ready, failed) => {
      resolve = ready
      reject = failed
    })
    const model = {
      isLoaded: () => true,
      isAnimationPlaying: () => active,
      requestGeneratedMotion: () => generated,
      stopAnimation: vi.fn(),
      setBodyMotionLayer: vi.fn(),
      getBodyMotionDebugState: () => ({
        transitionRemaining: 0,
        motionExecution: {
          executionId: 'pending-1',
          profileId: 'fox_paw_single',
          runningProfileId: 'fox_paw_single',
          outcome: active ? null : 'completed',
        },
      }),
    } as unknown as VrmModel
    const animations = new AvatarAnimationController(model)
    const owner = new AvatarPlaybackCoordinator(animations, model)
    return {
      animations,
      owner,
      resolve,
      reject,
      setActive: (value: boolean) => {
        active = value
      },
    }
  }

  it('keeps the preview loading and queued until its actual first horizon is ready', async () => {
    const { animations, owner, resolve, setActive } = pending()
    owner.previewAnimation({ animationId: 'fox_paw_single', loop: false, mode: 'idle', frame: 1 })
    expect(animations.getDebugState().playbackStatus).toBe('loading')
    owner.advanceQueue(2)
    expect(owner.getQueue().getCurrent()?.animationId).toBe('fox_paw_single')
    setActive(true)
    resolve()
    await animations.waitForLatestPlaybackRequest(100)
    expect(animations.getDebugState().playbackStatus).toBe('playing')
    setActive(false)
    owner.advanceQueue(3)
    expect(owner.getQueue().getCurrent()).toBeNull()
  })

  it('releases a skipped startup only after its body recovery, without a duplicate blocker', async () => {
    const { animations, owner, reject, setActive } = pending()
    owner.previewAnimation({
      animationId: 'greet_wave_soft',
      loop: false,
      mode: 'speaking',
      frame: 1,
    })
    setActive(true)
    reject(new Error('ARDY_SPEECH_WINDOW_MISSED'))
    await animations.waitForLatestPlaybackRequest(100)
    owner.advanceQueue(2)
    expect(owner.getQueue().getCurrent()?.animationId).toBe('greet_wave_soft')
    setActive(false)
    owner.advanceQueue(3)
    expect(owner.getQueue().getCurrent()).toBeNull()
    expect(owner.getCurrentContext()).toBeNull()
    expect(animations.getDebugState().failedAnimationIds).toEqual([])
  })

  it('does not resurrect a cancelled preview when an earlier readiness result arrives', async () => {
    const { animations, resolve, setActive } = pending()
    const request = animations.playManifest('fox_paw_single', false, {
      requestSource: 'debug-preview',
    })
    animations.stop()
    setActive(true)
    resolve()
    await request
    expect(animations.getDebugState().playbackStatus).toBe('idle')
    expect(animations.getDebugState().activeAnimationId).toBeNull()
  })

  it('reports a failed generated horizon instead of claiming playback started', async () => {
    const { animations, owner, reject } = pending()
    owner.previewAnimation({ animationId: 'greet_wave_soft', loop: false, mode: 'idle', frame: 1 })
    reject(new Error('ARDY_INFERENCE_FAILED'))
    await animations.waitForLatestPlaybackRequest(100)
    expect(animations.getDebugState().playbackStatus).toBe('failed')
    owner.advanceQueue(2)
    expect(owner.getQueue().getCurrent()).toBeNull()
  })

  it('releases a failed presence startup without leaving a duplicate blocker', async () => {
    const { animations, owner, reject } = pending()
    owner.previewAnimation({ animationId: 'presence_poised', loop: true, mode: 'idle', frame: 1 })
    reject(new Error('ARDY_INFERENCE_FAILED'))
    await animations.waitForLatestPlaybackRequest(100)
    owner.advanceQueue(2)
    expect(owner.getQueue().getCurrent()).toBeNull()
    expect(owner.getCurrentContext()).toBeNull()
  })
})

describe('generated fallback request context', () => {
  it.each(['ARDY_SPEECH_WINDOW_MISSED', 'ARDY_SPEECH_ENDED', 'ARDY_superseded'])(
    'does not blacklist a valid gesture or start a failure fallback for %s',
    async (reason) => {
      const requestGeneratedMotion = vi.fn(async () => {
        throw new Error(reason)
      })
      const model = {
        isLoaded: () => true,
        isAnimationPlaying: () => false,
        getBodyMotionDebugState: () => ({}),
        requestGeneratedMotion,
      } as unknown as VrmModel
      const animations = new AvatarAnimationController(model)
      await animations.playManifest('greet_wave_soft', false, {
        speechBound: true,
        fallbackId: 'presence_speaking',
      })
      expect(animations.getDebugState().failedAnimationIds).toEqual([])
      expect(animations.getDebugState().playbackStatus).toBe('idle')
      expect(requestGeneratedMotion).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['agree_soft', 'missing-profile'])(
    'preserves speech binding and provenance when %s falls back',
    async (profileId) => {
      const requestGeneratedMotion = vi.fn(async (id: string) => {
        if (id === 'agree_soft') throw new Error('ARDY_cooldown')
      })
      const model = {
        isLoaded: () => true,
        isAnimationPlaying: () => false,
        requestGeneratedMotion,
      } as unknown as VrmModel
      const animations = new AvatarAnimationController(model)
      await animations.playManifest(profileId, false, {
        fallbackId: 'presence_speaking',
        speechBound: true,
        requestSource: 'speaking-gesture-scheduler',
        requestReason: 'speech start',
        behaviorId: 'neutral',
        frame: 42,
        seed: 17,
        blendDuration: 0.6,
        motionLayer: 'gesture',
      })
      expect(requestGeneratedMotion.mock.calls.at(-1)).toEqual([
        'presence_speaking',
        expect.objectContaining({
          speechBound: true,
          source: 'speaking-gesture-scheduler',
          behaviorId: 'neutral',
          frame: 42,
          seed: 17,
          blendDuration: 0.6,
          motionLayer: 'base',
          reason: `speech start; fallback from ${profileId}`,
        }),
      ])
    },
  )
})

describe('preview variation routing', () => {
  it('rerolls the currently selected manual profile through the same queue owner', () => {
    const { owner, play } = fixture()
    owner.previewAnimation({ animationId: 'fox_paw_single', loop: false, mode: 'idle', frame: 2 })
    const semantic = vi.fn()
    const controller = Object.assign(Object.create(AvatarController.prototype), {
      playback: owner,
      frame: 3,
      lastEffect: { mode: 'idle' },
      playResolvedBehavior: semantic,
    }) as AvatarController
    controller.rerollAnimation()
    expect(play).toHaveBeenCalledTimes(3)
    expect(play.mock.calls.at(-1)?.[0]).toBe('fox_paw_single')
    expect(owner.getCurrentContext()?.completionFallbackAnimationId).toBe('presence_poised')
    expect(semantic).not.toHaveBeenCalled()
  })

  it('preserves semantic reroll selection outside manual preview', () => {
    const { owner } = fixture()
    const semantic = vi.fn()
    const effect = { mode: 'idle' }
    const controller = Object.assign(Object.create(AvatarController.prototype), {
      playback: owner,
      frame: 3,
      lastEffect: effect,
      playResolvedBehavior: semantic,
    }) as AvatarController
    controller.rerollAnimation()
    expect(semantic).toHaveBeenCalledWith(effect, 'debug-reroll', 'manual reroll', true)
  })
})
