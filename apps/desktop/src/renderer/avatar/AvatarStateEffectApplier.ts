import type { EmbodimentGazeHint } from '../../shared/character-response'
import type { CharacterState } from '../../shared/runtime'
import { toHeadMotionProfile, toLookAtMode } from './AvatarRuntimeMappers'
import type { AvatarStateEffect } from './AvatarStateMachine'
import type { LipSync, LipSyncStartRequest } from './embodiment/speech/LipSync'
import type { AvatarModel } from './rendering/two/AvatarModel'

export class AvatarStateEffectApplier {
  constructor(
    private readonly avatarModel: AvatarModel,
    private readonly lipSync: LipSync,
  ) {}

  apply(input: {
    effect: AvatarStateEffect
    avatarEmotion?: string
    lipSyncStart?: LipSyncStartRequest
    stopLipSyncTurnId?: string
    state?: CharacterState
    gazeHint?: EmbodimentGazeHint
  }): void {
    const { effect, avatarEmotion, lipSyncStart, stopLipSyncTurnId, state, gazeHint } = input
    this.avatarModel.setProceduralMode(effect.proceduralMode)
    this.applyGaze(effect.mode, state, gazeHint)
    this.avatarModel.applyEmotion(effect.emotionKey, avatarEmotion)

    if (effect.detachLipSync) this.lipSync.detach(stopLipSyncTurnId)
    if (effect.resetMouth) this.avatarModel.setMouthWeights({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 })
    if (effect.attachLipSync && lipSyncStart)
      this.lipSync.attach({
        ...lipSyncStart,
        emotionKey: lipSyncStart.emotionKey || effect.emotionKey,
      })
    else if (effect.attachLipSync) this.lipSync.setEmotion(effect.emotionKey)
  }

  applyGaze(
    mode: AvatarStateEffect['mode'],
    state?: CharacterState,
    gazeHint?: EmbodimentGazeHint,
  ): void {
    const lookAtMode = toLookAtMode({ mode }, state, gazeHint)
    this.avatarModel.setLookAtMode(lookAtMode)
    this.avatarModel.setHeadMotionProfile(toHeadMotionProfile(lookAtMode))
  }
}
