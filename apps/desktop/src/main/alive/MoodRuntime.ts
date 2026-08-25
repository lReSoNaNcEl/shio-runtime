import type { ExperienceAppraisal, MoodState } from '../../shared/alive'
import type { AliveStore } from './AliveStore'
import { DEFAULT_MOOD_STATE } from './AliveStore'

const MOOD_DECAY_MS = 30 * 60_000

export class MoodRuntime {
  constructor(private readonly store: AliveStore) {}

  snapshot(now = Date.now()): MoodState {
    return this.decay(this.store.mood(), now)
  }

  apply(appraisal: ExperienceAppraisal, at = Date.now()): MoodState {
    const current = this.snapshot(at)
    const next = Object.freeze({
      valence: boundedMood(current.valence + appraisal.valence * 0.22),
      arousal: boundedMood(current.arousal + appraisal.arousal * 0.2),
      confidence: boundedUnit(current.confidence + appraisal.valence * 0.08),
      playfulness: boundedUnit(
        current.playfulness + Math.max(0, appraisal.valence) * appraisal.socialRelevance * 0.08,
      ),
      curiosity: boundedUnit(current.curiosity + appraisal.novelty * 0.1),
      frustration: boundedUnit(
        current.frustration + Math.max(0, -appraisal.valence) * appraisal.salience * 0.18,
      ),
      updatedAt: at,
    })
    this.store.saveMood(next)
    return next
  }

  private decay(state: MoodState, now: number): MoodState {
    if (state.updatedAt <= 0 || now <= state.updatedAt) return state
    const retention = Math.exp(-(now - state.updatedAt) / MOOD_DECAY_MS)
    const decayed = Object.freeze({
      valence: boundedMood(state.valence * retention),
      arousal: boundedMood(state.arousal * retention),
      confidence: approach(DEFAULT_MOOD_STATE.confidence, state.confidence, retention),
      playfulness: approach(DEFAULT_MOOD_STATE.playfulness, state.playfulness, retention),
      curiosity: approach(DEFAULT_MOOD_STATE.curiosity, state.curiosity, retention),
      frustration: boundedUnit(state.frustration * retention),
      updatedAt: now,
    })
    this.store.saveMood(decayed)
    return decayed
  }
}

function boundedMood(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

function boundedUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function approach(baseline: number, value: number, retention: number): number {
  return boundedUnit(baseline + (value - baseline) * retention)
}
