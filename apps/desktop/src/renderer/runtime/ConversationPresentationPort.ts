import type { CharacterEmbodimentIntent } from '../../shared/character-response'
import type { CharacterState } from '../../shared/runtime'
import type { ReactionGestureTrigger } from '../avatar/AvatarController'
import type { EarImpulse } from '../avatar/embodiment/secondary-motion/EarBehaviorRuntime'
import type { LipSyncStartRequest } from '../avatar/embodiment/speech/LipSync'
import type { AvatarRuntime } from './AvatarRuntime'
import type { OverlayRuntime, SyncedAvatarState } from './OverlayRuntime'

export type ConversationAvatarProjection = SyncedAvatarState

export interface ConversationPresentationPort {
  setSpeechDelivery?(emotion: string | null): void
  applyCharacterState(
    state: CharacterState,
    options?: { lipSyncStart?: LipSyncStartRequest; stopLipSyncTurnId?: string },
  ): void
  publishAvatarState(state: SyncedAvatarState, intent?: CharacterEmbodimentIntent): void
  setEmbodimentIntent(intent: CharacterEmbodimentIntent | undefined): void
  setBehaviorEmbodimentIntent(intent: CharacterEmbodimentIntent | undefined): void
  setBrowserScreenGaze(sessionId: string, active: boolean): void
  interruptLipSync(turnId: string): void
  stopLipSync(turnId: string): void
  triggerUserInterruption(): void
  triggerEarImpulse(trigger: EarImpulse, correlationId?: string): boolean
  triggerReactionGesture(trigger: ReactionGestureTrigger): void
}

/** Presentation adapter. Failures are contained and cannot fail a conversation turn. */
export class AvatarConversationPresentationPort implements ConversationPresentationPort {
  private lastAvatarState: SyncedAvatarState | null = null
  private conversationIntent: CharacterEmbodimentIntent | undefined
  private behaviorIntent: CharacterEmbodimentIntent | undefined
  private browserScreenGazeSessionId: string | undefined
  private browserScreenGazeActive = false
  private speechDeliveryEmotion: string | null = null

  constructor(
    private readonly avatar: AvatarRuntime,
    private readonly overlay: OverlayRuntime,
    private readonly reportFailure: (operation: string, error: unknown) => void,
  ) {}

  applyCharacterState(
    state: CharacterState,
    options: { lipSyncStart?: LipSyncStartRequest; stopLipSyncTurnId?: string } = {},
  ): void {
    this.contain('apply character state', () => this.avatar.applyCharacterState(state, options))
  }

  publishAvatarState(state: SyncedAvatarState, intent?: CharacterEmbodimentIntent): void {
    this.lastAvatarState = state
    this.conversationIntent = intent
    this.publishOverlayProjection()
  }

  setEmbodimentIntent(intent: CharacterEmbodimentIntent | undefined): void {
    this.conversationIntent = intent
    this.behaviorIntent = undefined
    this.contain('set embodiment intent', () => this.avatar.setEmbodimentIntent(intent))
    this.publishOverlayProjection()
  }

  setBehaviorEmbodimentIntent(intent: CharacterEmbodimentIntent | undefined): void {
    this.behaviorIntent = intent
    this.contain('set Behavior embodiment intent', () =>
      this.avatar.setBehaviorEmbodimentIntent(intent),
    )
    this.publishOverlayProjection()
  }

  setBrowserScreenGaze(sessionId: string, active: boolean): void {
    if (active) {
      this.browserScreenGazeSessionId = sessionId
      this.browserScreenGazeActive = true
    } else if (this.browserScreenGazeSessionId === sessionId) {
      this.browserScreenGazeActive = false
    }
    this.contain('set browser screen gaze', () =>
      this.avatar.setBrowserScreenGaze(sessionId, active),
    )
    this.publishOverlayProjection()
  }

  interruptLipSync(turnId: string): void {
    this.setSpeechDelivery(null)
    this.contain('interrupt LipSync', () => this.avatar.interruptLipSync(turnId))
  }

  stopLipSync(turnId: string): void {
    this.setSpeechDelivery(null)
    this.contain('stop LipSync', () => this.avatar.stopLipSync(turnId))
  }

  setSpeechDelivery(emotion: string | null): void {
    this.speechDeliveryEmotion = emotion
    this.contain('set audible speech delivery', () => this.avatar.setSpeechDelivery(emotion))
    this.publishOverlayProjection()
  }

  triggerUserInterruption(): void {
    this.contain('trigger user interruption', () => this.avatar.triggerUserInterruption())
  }

  triggerEarImpulse(trigger: EarImpulse, correlationId?: string): boolean {
    try {
      return this.avatar.triggerEarImpulse(trigger, correlationId)
    } catch (error) {
      this.reportFailure('trigger ear impulse', error)
      return false
    }
  }

  triggerReactionGesture(trigger: ReactionGestureTrigger): void {
    this.contain('trigger reaction gesture', () => this.avatar.triggerReactionGesture(trigger))
  }

  private contain(operation: string, execute: () => unknown): void {
    try {
      execute()
    } catch (error) {
      this.reportFailure(operation, error)
    }
  }

  private publishOverlayProjection(): void {
    const state = this.lastAvatarState
    if (!state) return
    this.contain('publish Overlay projection', () =>
      this.overlay.publishAvatarState({
        ...state,
        embodimentIntent: this.conversationIntent,
        behaviorEmbodimentIntent: this.behaviorIntent,
        browserScreenGazeSessionId: this.browserScreenGazeSessionId,
        browserScreenGazeActive: this.browserScreenGazeActive,
        speechDeliveryEmotion: this.speechDeliveryEmotion,
      }),
    )
  }
}
