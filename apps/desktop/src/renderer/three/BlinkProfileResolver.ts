/**
 * BlinkProfileResolver — the single, pure composition point for the effective
 * blink profile.
 *
 * Root cause of the original order-dependent behaviour: {@link AvatarFacialRuntime}
 * pushed two *independent* blink profiles into the BlinkController — one from
 * `setProceduralMode()` (mode profile) and one from `applyEmotion()` (emotion
 * profile) — so the last writer won. `speaking -> happy` and `happy -> speaking`
 * therefore produced different blink tuning.
 *
 * This resolver removes last-write-wins: the emotion supplies the BASE timing /
 * duration / depth, and the procedural mode supplies explicit multiplicative
 * modifiers (interval / duration / weight). The same `(mode, emotion)` pair
 * always yields the same effective profile, independent of call order.
 *
 * It never mutates the source tuning objects; it returns a fresh, normalized
 * {@link EffectiveBlinkProfile}.
 */

import { facialTuning } from './avatarTuning'
import { getFacialProfile } from './FacialProfile'
import type { VrmProceduralMode } from './VrmModel'

export interface EffectiveBlinkProfile {
  /** Emotion base profile id the timing was derived from. */
  profileId: string
  intervalMinMs: number
  intervalMaxMs: number
  closingMs: number
  closedMs: number
  openingMs: number
  /** Lower bound of the randomized blink depth (kept so blinks are not uniform). */
  minWeight: number
  /** Upper bound of the randomized blink depth. */
  maxWeight: number
  /** Hard ceiling the eyelid weight can never exceed. */
  blinkMax: number
  doubleBlinkChance: number
  cooldownMs: number
  sequenceGapMinMs: number
  sequenceGapMaxMs: number
  secondBlinkDurationScale: number
  secondBlinkWeightScale: number
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))
const positive = (value: number, fallback = 1): number =>
  Number.isFinite(value) && value > 0 ? value : fallback

/**
 * Compose the effective blink profile from an emotion base and a procedural
 * mode modifier. Pure: same inputs -> identical output, no side effects.
 */
export function resolveEffectiveBlinkProfile(
  proceduralMode: VrmProceduralMode,
  emotion: string,
): EffectiveBlinkProfile {
  const base = getFacialProfile(emotion).blinkProfile
  const modeKey = facialTuning.blink.profileByMode[proceduralMode]
  const modifier = facialTuning.blink.modeModifiers[modeKey]
  const sequence = facialTuning.blink.sequence

  const intervalScale = positive(modifier.intervalScale)
  const durationScale = positive(modifier.durationScale)
  const weightScale = positive(modifier.weightScale)

  const ceiling = clamp01(base.blinkMax ?? facialTuning.blink.blinkMax)

  // Base emotion timing (FacialProfile stores intervals in seconds, duration in ms).
  const intervalMinMs = Math.max(200, (base.intervalMin ?? 3.4) * 1000 * intervalScale)
  const intervalMaxMs = Math.max(intervalMinMs, (base.intervalMax ?? 5.2) * 1000 * intervalScale)

  const totalMs = Math.max(120, (base.durationMs ?? 410) * durationScale)
  // Same phase split the controller has always used (close / hold / open).
  const closingMs = totalMs * 0.2
  const closedMs = totalMs * 0.28
  const openingMs = totalMs * 0.52

  const maxWeight = clamp01(Math.min(ceiling, (base.weightMax ?? 0.64) * weightScale))
  const minWeight = clamp01(Math.min((base.weightMin ?? 0.42) * weightScale, maxWeight))

  return {
    profileId: base.profileId,
    intervalMinMs,
    intervalMaxMs,
    closingMs,
    closedMs,
    openingMs,
    minWeight,
    maxWeight,
    blinkMax: ceiling,
    doubleBlinkChance: clamp01(base.doubleBlinkChance ?? 0.04),
    cooldownMs: Math.max(0, base.cooldownMs ?? 680),
    sequenceGapMinMs: Math.max(0, sequence.gapMinMs),
    sequenceGapMaxMs: Math.max(sequence.gapMinMs, sequence.gapMaxMs),
    secondBlinkDurationScale: positive(sequence.secondBlinkDurationScale),
    secondBlinkWeightScale: positive(sequence.secondBlinkWeightScale),
  }
}
