import type {
  CharacterEmbodimentIntent,
  EmbodimentGazeHint,
} from '../../../../shared/character-response'
import type { AvatarMode } from '../../AvatarStateMachine'

/** Resolves transient gaze producers without creating a second Character State. */
export class AvatarGazeArbiter {
  private conversationHint: EmbodimentGazeHint | undefined
  private behaviorHint: EmbodimentGazeHint | undefined
  private browserSessionId: string | null = null

  setConversationIntent(intent: CharacterEmbodimentIntent | undefined): void {
    this.conversationHint = intent?.gazeHint
  }

  setBehaviorIntent(intent: CharacterEmbodimentIntent | undefined): void {
    this.behaviorHint = intent?.gazeHint
  }

  setBrowserScreenGaze(sessionId: string, active: boolean): void {
    if (active) {
      this.browserSessionId = sessionId
      return
    }
    if (this.browserSessionId === sessionId) this.browserSessionId = null
  }

  resolve(mode: AvatarMode): EmbodimentGazeHint | undefined {
    if (mode === 'listening') return undefined
    return (
      this.conversationHint ??
      this.behaviorHint ??
      (this.browserSessionId ? ('screen' as const) : undefined)
    )
  }

  browserScreenGazeActive(): boolean {
    return this.browserSessionId !== null
  }
}
