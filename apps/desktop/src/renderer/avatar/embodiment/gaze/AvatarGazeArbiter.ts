import type {
  CharacterEmbodimentIntent,
  EmbodimentGazeHint,
} from '../../../../shared/character-response'
import type { AvatarMode } from '../../AvatarStateMachine'

/** Resolves transient gaze producers without creating a second Character State. */
export class AvatarGazeArbiter {
  private conversationHint: EmbodimentGazeHint | undefined
  private behaviorHint: EmbodimentGazeHint | undefined
  private gameSessionId: string | null = null

  setConversationIntent(intent: CharacterEmbodimentIntent | undefined): void {
    this.conversationHint = intent?.gazeHint
  }

  setBehaviorIntent(intent: CharacterEmbodimentIntent | undefined): void {
    this.behaviorHint = intent?.gazeHint
  }

  setGameScreenGaze(sessionId: string, active: boolean): void {
    if (active) {
      this.gameSessionId = sessionId
      return
    }
    if (this.gameSessionId === sessionId) this.gameSessionId = null
  }

  resolve(mode: AvatarMode): EmbodimentGazeHint | undefined {
    if (mode === 'listening') return undefined
    return (
      this.conversationHint ??
      this.behaviorHint ??
      (this.gameSessionId ? ('screen' as const) : undefined)
    )
  }

  gameScreenGazeActive(): boolean {
    return this.gameSessionId !== null
  }
}
