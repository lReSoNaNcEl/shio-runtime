/** Prosody-only user speech activity. It sees microphone levels and ASR VAD
 * boundaries, never audio content or recognized text. */
export type UserSpeechActivityEvent =
  | { type: 'onset'; at: number }
  | { type: 'sample'; at: number; voiced: boolean }
  | { type: 'end'; at: number }

export interface UserSpeechActivitySource {
  subscribe(listener: (event: UserSpeechActivityEvent) => void): () => void
}

const VOICED_MINIMUM = 0.012
const NOISE_MULTIPLIER = 3
const NOISE_FLOOR_LIMITS = [0.001, 0.05] as const
/** Silence longer than this starts a new utterance with its own onset. */
export const UTTERANCE_GAP_MS = 700

/** Voice activity from bounded RMS levels with an adaptive noise floor. */
export class UserSpeechActivityMonitor implements UserSpeechActivitySource {
  private readonly listeners = new Set<(event: UserSpeechActivityEvent) => void>()
  private noiseFloor = 0.004
  private active = false
  private lastVoicedAt: number | null = null
  private lastOnsetAt: number | null = null

  subscribe(listener: (event: UserSpeechActivityEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  begin(): void {
    this.active = true
    this.lastVoicedAt = null
    this.lastOnsetAt = null
  }

  end(at: number): void {
    if (!this.active) return
    this.active = false
    this.lastVoicedAt = null
    this.emit({ type: 'end', at })
  }

  observeLevel(rms: number, at: number): void {
    if (!this.active || !Number.isFinite(rms) || !Number.isFinite(at)) return
    const level = Math.max(0, rms)
    const voiced = level > Math.max(VOICED_MINIMUM, this.noiseFloor * NOISE_MULTIPLIER)
    if (!voiced)
      this.noiseFloor = Math.max(
        NOISE_FLOOR_LIMITS[0],
        Math.min(NOISE_FLOOR_LIMITS[1], this.noiseFloor * 0.95 + level * 0.05),
      )
    if (voiced) {
      this.onset(at)
      this.lastVoicedAt = at
    }
    this.emit({ type: 'sample', at, voiced })
  }

  /** An ASR VAD speech start (continuous listening) is an onset of its own. */
  observeExternalOnset(at: number): void {
    if (Number.isFinite(at)) this.onset(at)
  }

  private onset(at: number): void {
    const continuing = this.lastVoicedAt !== null && at - this.lastVoicedAt <= UTTERANCE_GAP_MS
    const recent = this.lastOnsetAt !== null && at - this.lastOnsetAt <= UTTERANCE_GAP_MS
    if (continuing || recent) return
    this.lastOnsetAt = at
    this.emit({ type: 'onset', at })
  }

  private emit(event: UserSpeechActivityEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
