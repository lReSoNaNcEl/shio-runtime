import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import type { AvatarAnimationController } from '../../../src/renderer/avatar/AvatarAnimationController'
import { AvatarController } from '../../../src/renderer/avatar/AvatarController'
import type {
  LipSync,
  LipSyncStartRequest,
} from '../../../src/renderer/avatar/embodiment/speech/LipSync'
import type { VrmModel } from '../../../src/renderer/avatar/rendering/three/VrmModel'
import { cloneCharacterState, INITIAL_CHARACTER_STATE } from '../../../src/shared/runtime'

describe('VRM replacement during streamed speech', () => {
  it('preserves the active AudioPlayer analyser instead of detaching through idle bootstrap', async () => {
    const owner = new AvatarController()
    const internals = owner as unknown as {
      vrmModel: VrmModel
      animations: AvatarAnimationController
      lipSync: LipSync
    }
    vi.spyOn(internals.vrmModel, 'load').mockResolvedValue()
    vi.spyOn(internals.animations, 'waitForLatestPlaybackRequest').mockResolvedValue(true)
    const state = cloneCharacterState(INITIAL_CHARACTER_STATE)
    state.mode = 'speaking'
    const request: LipSyncStartRequest = {
      text: 'Continuous prepared speech during model replacement.',
      emotionKey: 'happy',
      session: {
        turnId: 'turn',
        playbackId: 'pcm',
        playbackItemId: 'item',
        startedAt: 0,
        normalizationReference: 0.1,
        durationMs: 30000,
        durationFinal: false,
        analyser: {
          fftSize: 512,
          smoothingTimeConstant: 0,
          getByteTimeDomainData: (target: Uint8Array) => target.fill(128),
        } as unknown as AnalyserNode,
      },
    }
    owner.applyCharacterState(state, { lipSyncStart: request })
    const detach = vi.spyOn(internals.lipSync, 'detach')
    const restoreEnvelope = vi.spyOn(internals.vrmModel, 'startSpeechPhrase')
    await owner.loadVrm(new THREE.Scene(), new ArrayBuffer(0))
    expect(detach).not.toHaveBeenCalled()
    expect(restoreEnvelope).toHaveBeenCalledOnce()
    expect(internals.lipSync.getActiveSession()?.playbackId).toBe('pcm')
    expect(owner.getMode()).toBe('speaking')
    owner.dispose()
  })
})
