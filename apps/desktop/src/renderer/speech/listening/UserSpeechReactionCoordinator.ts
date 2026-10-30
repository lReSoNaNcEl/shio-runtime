import { UserProsodyBackchannelPolicy } from './UserProsodyBackchannelPolicy'
import type { UserSpeechActivitySource } from './UserSpeechActivity'

/** Narrow presentation sink for listening reactions. */
export interface UserSpeechReactionSink {
  reactToUserSpeechOnset?(): void
  acknowledgeUserSpeech?(): void
}

export interface UserSpeechReactionDeps {
  shioSpeaking: () => boolean
  /** Global Suspend or Privacy Mode silence every listening reaction. */
  suppressed: () => boolean
  random?: () => number
}

/** Routes prosody-only user speech activity to the Avatar reactions it earns. */
export class UserSpeechReactionCoordinator {
  private readonly policy: UserProsodyBackchannelPolicy
  private unsubscribe: (() => void) | null

  constructor(
    source: UserSpeechActivitySource,
    private readonly sink: UserSpeechReactionSink,
    private readonly deps: UserSpeechReactionDeps,
  ) {
    this.policy = new UserProsodyBackchannelPolicy(deps.random ?? Math.random)
    this.unsubscribe = source.subscribe((event) => {
      if (event.type === 'end') {
        this.policy.reset()
        return
      }
      const suppressed = this.deps.suppressed()
      const shioSpeaking = this.deps.shioSpeaking()
      if (event.type === 'onset') {
        if (!suppressed && !shioSpeaking) this.sink.reactToUserSpeechOnset?.()
        return
      }
      if (this.policy.observe({ at: event.at, voiced: event.voiced, shioSpeaking, suppressed }))
        this.sink.acknowledgeUserSpeech?.()
    })
  }

  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.policy.reset()
  }
}
