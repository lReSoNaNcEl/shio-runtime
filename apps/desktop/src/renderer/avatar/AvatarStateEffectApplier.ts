import type { EmbodimentGazeHint } from '../../shared/character-response'
import type { CharacterState } from '../../shared/runtime'
import { toHeadMotionProfile, toLookAtMode } from './AvatarRuntimeMappers'
import type { AvatarStateEffect } from './AvatarStateMachine'
import type { LipSync, LipSyncStartRequest } from './embodiment/speech/LipSync'
import type { VrmModel } from './rendering/three/VrmModel'

export class AvatarStateEffectApplier {
  constructor(
    private readonly vrmModel: VrmModel,
    private readonly lipSync: LipSync,
  ) {}

  apply(input: {
    effect: AvatarStateEffect
    vrmEmotion?: string
    lipSyncStart?: LipSyncStartRequest
    stopLipSyncTurnId?: string
    state?: CharacterState
    gazeHint?: EmbodimentGazeHint
  }): void {
    const { effect, vrmEmotion, lipSyncStart, stopLipSyncTurnId, state, gazeHint } = input
    this.vrmModel.setProceduralMode(effect.proceduralMode)
    const lookAtMode = toLookAtMode(effect, state, gazeHint)
    this.vrmModel.setLookAtMode(lookAtMode)
    this.vrmModel.setHeadMotionProfile(toHeadMotionProfile(lookAtMode))
    this.vrmModel.applyEmotion(effect.emotionKey, vrmEmotion)

    if (effect.detachLipSync) this.lipSync.detach(stopLipSyncTurnId)
    if (effect.resetMouth) this.vrmModel.setMouthWeights({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 })
    if (effect.attachLipSync && lipSyncStart)
      this.lipSync.attach({
        ...lipSyncStart,
        emotionKey: lipSyncStart.emotionKey || effect.emotionKey,
      })
    else if (effect.attachLipSync) this.lipSync.setEmotion(effect.emotionKey)
  }
}
