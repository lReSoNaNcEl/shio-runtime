export interface BackchannelObservation {
  at: number
  voiced: boolean
  /** Shio is speaking: listeners never nod over their own reply. */
  shioSpeaking: boolean
  /** Global Suspend or Privacy Mode. */
  suppressed: boolean
}

const MIN_SPEECH_MS = 1_200
const PAUSE_WINDOW_MS = [250, 600] as const
const COOLDOWN_MS = [2_000, 4_000] as const

/** Pure prosody policy: a short pause after sustained user speech earns one small
 * acknowledgement. Recognized text is never consulted; time and randomness are injected. */
export class UserProsodyBackchannelPolicy {
  private speechStartedAt: number | null = null
  private lastVoicedAt: number | null = null
  private acknowledged = false
  private cooldownUntil = Number.NEGATIVE_INFINITY

  constructor(private readonly random: () => number) {}

  reset(): void {
    this.speechStartedAt = null
    this.lastVoicedAt = null
    this.acknowledged = false
  }

  observe(input: BackchannelObservation): boolean {
    if (input.suppressed || input.shioSpeaking) {
      this.reset()
      return false
    }
    if (input.voiced) {
      if (this.speechStartedAt === null) this.speechStartedAt = input.at
      this.lastVoicedAt = input.at
      this.acknowledged = false
      return false
    }
    if (this.speechStartedAt === null || this.lastVoicedAt === null) return false
    const pause = input.at - this.lastVoicedAt
    if (pause > PAUSE_WINDOW_MS[1]) {
      this.reset()
      return false
    }
    if (
      this.acknowledged ||
      pause < PAUSE_WINDOW_MS[0] ||
      this.lastVoicedAt - this.speechStartedAt < MIN_SPEECH_MS ||
      input.at < this.cooldownUntil
    )
      return false
    this.acknowledged = true
    // A new acknowledgement needs another full stretch of speech.
    this.speechStartedAt = null
    this.cooldownUntil =
      input.at +
      COOLDOWN_MS[0] +
      Math.max(0, Math.min(1, this.random())) * (COOLDOWN_MS[1] - COOLDOWN_MS[0])
    return true
  }
}
