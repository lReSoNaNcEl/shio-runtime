import type { CharacterEmbodimentIntent } from '../../shared/character-response'
import type { CharacterState } from '../../shared/runtime'
import type { ReactionGestureTrigger } from '../avatar/AvatarController'
import type { EarImpulse } from '../avatar/embodiment/secondary-motion/EarBehaviorRuntime'
import type { LipSyncStartRequest } from '../avatar/embodiment/speech/LipSync'
import type { AvatarRuntime } from './AvatarRuntime'
import type { OverlayRuntime, SyncedAvatarState } from './OverlayRuntime'

export type ConversationAvatarProjection = SyncedAvatarState

export interface ConversationPresentationPort {
  applyCharacterState(
    state: CharacterState,
    options?: { lipSyncStart?: LipSyncStartRequest; stopLipSyncTurnId?: string },
  ): void
  publishAvatarState(state: SyncedAvatarState, intent?: CharacterEmbodimentIntent): void
  setEmbodimentIntent(intent: CharacterEmbodimentIntent | undefined): void
  interruptLipSync(turnId: string): void
  stopLipSync(turnId: string): void
  triggerUserInterruption(): void
  triggerEarImpulse(trigger: EarImpulse, correlationId?: string): boolean
  triggerReactionGesture(trigger: ReactionGestureTrigger): void
}

/** Presentation adapter. Failures are contained and cannot fail a conversation turn. */
export class AvatarConversationPresentationPort implements ConversationPresentationPort {
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
    this.contain('publish Overlay projection', () =>
      this.overlay.publishAvatarState({ ...state, embodimentIntent: intent }),
    )
  }

  setEmbodimentIntent(intent: CharacterEmbodimentIntent | undefined): void {
    this.contain('set embodiment intent', () => this.avatar.setEmbodimentIntent(intent))
  }

  interruptLipSync(turnId: string): void {
    this.contain('interrupt LipSync', () => this.avatar.interruptLipSync(turnId))
  }

  stopLipSync(turnId: string): void {
    this.contain('stop LipSync', () => this.avatar.stopLipSync(turnId))
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
}
