import { describe, expect, it, vi } from 'vitest'

import { AvatarBehaviorResolver } from '../../../src/renderer/avatar/AvatarBehaviorResolver'
import { AvatarController } from '../../../src/renderer/avatar/AvatarController'
import type { AvatarStateEffect } from '../../../src/renderer/avatar/AvatarStateMachine'
import { resolveEmotionEmbodimentProfile } from '../../../src/renderer/avatar/EmotionEmbodimentProfile'
import { AvatarModel } from '../../../src/renderer/avatar/rendering/two/AvatarModel'
import { cloneCharacterState, INITIAL_CHARACTER_STATE } from '../../../src/shared/runtime'
import { SPEECH_EMOTIONS } from '../../../src/shared/speech'

function start(avatar: AvatarController) {
  const analyser = {
    fftSize: 512,
    frequencyBinCount: 256,
    smoothingTimeConstant: 0,
    getByteTimeDomainData: (values: Uint8Array) =>
      values.forEach((_, i) => {
        values[i] = 128 + Math.round(Math.sin(i * 0.2) * 28)
      }),
    getByteFrequencyData: (values: Uint8Array) => values.fill(90),
  } as unknown as AnalyserNode
  const state = cloneCharacterState(INITIAL_CHARACTER_STATE)
  state.mode = 'speaking'
  state.emotion = 'happy'
  const session = {
    turnId: 'active-turn',
    playbackId: 'pcm-1',
    playbackItemId: 'pcm-1',
    analyser,
    startedAt: performance.now(),
    normalizationReference: 0.12,
    durationMs: 60000,
  }
  avatar.applyCharacterState(state, {
    lipSyncStart: { session, text: 'Речь продолжается при открытии аватара.', emotionKey: 'happy' },
  })
  return state
}

describe('S22 presentation attachment during speech', () => {
  it('preserves the analyser, state and mouth when attaching and reopening a canvas', async () => {
    vi.spyOn(AvatarModel.prototype, 'load').mockResolvedValue(undefined)
    const avatar = new AvatarController()
    try {
      const state = start(avatar)
      for (let i = 0; i < 20; i += 1) avatar.update(0.016, state)
      expect(Math.max(...Object.values(avatar.getMouthWeights()))).toBeGreaterThan(0.02)
      for (let i = 0; i < 2; i += 1) {
        avatar.unloadPresentation()
        await avatar.loadPuppet({} as HTMLCanvasElement)
        avatar.update(0.016, state)
        expect(avatar.getMode()).toBe('speaking')
        expect(avatar.getSpeechPhraseSnapshot().turnId).toBe('active-turn')
        expect(Math.max(...Object.values(avatar.getMouthWeights()))).toBeGreaterThan(0.02)
        expect(avatar.getSpeakingGestureSnapshot().active).toBe(true)
      }
      avatar.setSpeechDelivery('angry')
      avatar.update(0.016, state)
      expect(avatar.getDebugState().model2d.audibleEmotion).toBe('angry')
      expect(avatar.getSpeakingGestureSnapshot().phase).toBe('emphasis')
      expect(state.emotion).toBe('happy')
      avatar.stopSpeaking()
      expect(avatar.getSpeechPhraseSnapshot().turnId).toBeNull()
    } finally {
      avatar.dispose()
    }
  })

  it('uses the latest state if playback ends while the canvas loads', async () => {
    let finishLoad: (() => void) | undefined
    vi.spyOn(AvatarModel.prototype, 'load').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishLoad = resolve
        }),
    )
    const avatar = new AvatarController()
    try {
      start(avatar)
      const loading = avatar.loadPuppet({} as HTMLCanvasElement)
      const idle = cloneCharacterState(INITIAL_CHARACTER_STATE)
      avatar.applyCharacterState(idle)
      finishLoad?.()
      await loading
      expect(avatar.getMode()).toBe('idle')
      expect(avatar.getSpeechPhraseSnapshot().turnId).toBeNull()
    } finally {
      avatar.dispose()
    }
  })

  it('resolves every supported gesture hint and emotional peaks to native gestures', () => {
    for (const emotion of SPEECH_EMOTIONS) {
      if (emotion === 'neutral') continue
      expect(resolveEmotionEmbodimentProfile(emotion).id, emotion).not.toBe('neutral')
    }
    const effect: AvatarStateEffect = {
      mode: 'speaking',
      proceduralMode: 'speaking',
      emotionKey: 'happy',
      behaviorId: 'happy',
      loop: true,
      attachLipSync: true,
    }
    for (const gestureHint of [
      'explain',
      'agree',
      'disagree',
      'tease',
      'surprise',
      'think',
      'celebrate',
    ] as const) {
      const result = new AvatarBehaviorResolver().resolveEmbodimentIntent(
        effect,
        { intensity: 'normal', gestureHint },
        'speaking',
      )
      expect(result?.animationId, gestureHint).toBeTruthy()
      expect(result?.animationId).not.toBe('neutral2')
    }
    for (const emotion of ['happy', 'sad', 'angry', 'surprised', 'fear', 'whisper']) {
      const result = new AvatarBehaviorResolver().resolveAnimationTags(
        effect,
        [`behavior:${emotion}`],
        'happy',
        'speaking',
      )
      expect(result?.animationId, emotion).toBeTruthy()
      expect(result?.animationId).not.toBe('neutral2')
    }
  })
})
