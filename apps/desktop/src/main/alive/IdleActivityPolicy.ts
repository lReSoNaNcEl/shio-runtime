import type { AutonomySettings, MoodState } from '../../shared/alive'
import type { CharacterEmbodimentIntent } from '../../shared/character-response'
import { autonomyBusyStop, autonomyPolicyStop } from './autonomySuppression'

type MoodDimension = 'valence' | 'arousal' | 'playfulness' | 'curiosity'

/** One self-directed idle activity. Data only: adding an activity is a new record. */
export interface IdleActivityDefinition {
  id: string
  /** Presentation capability; the renderer skips a gesture its catalog cannot play. */
  requires: 'gaze' | 'gesture'
  /** Mean rate at a neutral Mood, activities per minute. */
  ratePerMinute: number
  /** Bounded Mood weights around the default Mood (positive = more frequent). */
  mood: Partial<Record<MoodDimension, number>>
  /** Required quiet time since the last conversation before the activity is eligible. */
  minQuietMs: number
  cooldownMs: number
  /** Transient presentation hold; absent for a self-terminating gesture. */
  holdMs?: number
  intent: CharacterEmbodimentIntent
}

export const IDLE_ACTIVITIES: readonly IdleActivityDefinition[] = Object.freeze([
  {
    id: 'look-around',
    requires: 'gaze',
    ratePerMinute: 1.8,
    mood: { arousal: 0.3, curiosity: 0.5 },
    minQuietMs: 0,
    cooldownMs: 15_000,
    holdMs: 2_500,
    intent: { intensity: 'subtle', gazeHint: 'away' },
  },
  {
    id: 'look-at-screen',
    requires: 'gaze',
    ratePerMinute: 1.4,
    mood: { curiosity: 0.6 },
    minQuietMs: 0,
    cooldownMs: 15_000,
    holdMs: 3_500,
    intent: { intensity: 'subtle', gazeHint: 'screen' },
  },
  {
    id: 'glance-at-user',
    requires: 'gaze',
    ratePerMinute: 1.2,
    mood: { valence: 0.4, playfulness: 0.4 },
    minQuietMs: 0,
    cooldownMs: 20_000,
    holdMs: 2_000,
    intent: { intensity: 'subtle', gazeHint: 'user' },
  },
  {
    id: 'curious-lean',
    requires: 'gesture',
    ratePerMinute: 0.35,
    mood: { curiosity: 1, arousal: 0.3 },
    minQuietMs: 20_000,
    cooldownMs: 90_000,
    holdMs: 3_000,
    intent: { intensity: 'subtle', gestureHint: 'curious', gazeHint: 'screen' },
  },
  {
    id: 'stretch-small',
    requires: 'gesture',
    ratePerMinute: 0.3,
    mood: { arousal: -0.6 },
    minQuietMs: 90_000,
    cooldownMs: 180_000,
    intent: { intensity: 'subtle', gestureHint: 'stretch' },
  },
] satisfies IdleActivityDefinition[])

const MOOD_CENTERS: Record<MoodDimension, number> = {
  valence: 0,
  arousal: 0,
  playfulness: 0.5,
  curiosity: 0.55,
}
/** Hard bounds: never more often than every 8 s, never quieter than the max gap. */
export const IDLE_MIN_INTERVAL_MS = 8_000
const MAX_QUIET_GAP_MS = 25_000
const MAX_QUIET_GAP_LIMITS = [20_000, 45_000] as const

export interface IdleActivityInput {
  at: number
  settings: AutonomySettings
  mood: MoodState
  conversationActive: boolean
  audioActive: boolean
  browserComputerUseScreenFocusActive: boolean
}

export interface IdleActivitySelection {
  activity: IdleActivityDefinition
  intent: CharacterEmbodimentIntent
  holdMs?: number
}

const bounded = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback)

/** Mood scales the overall idle rate within 0.5..1.5; low arousal means fewer activities. */
export function idleRateFactor(mood: MoodState): number {
  return bounded(
    1 +
      0.35 * finite(mood.arousal, 0) +
      0.4 * (finite(mood.curiosity, 0.55) - 0.55) +
      0.3 * (finite(mood.playfulness, 0.5) - 0.5),
    0.5,
    1.5,
  )
}

function activityWeight(activity: IdleActivityDefinition, mood: MoodState): number {
  let factor = 1
  for (const [dimension, weight] of Object.entries(activity.mood) as Array<[MoodDimension, number]>)
    factor += weight * (finite(mood[dimension], MOOD_CENTERS[dimension]) - MOOD_CENTERS[dimension])
  return activity.ratePerMinute * bounded(factor, 0.2, 2)
}

/** Deterministic Poisson schedule of self-directed idle activity. Pure: clock and
 * random source are injected, and it never touches Avatar state. Every policy and
 * busy stop resets the quiet period. */
export class IdleActivityPolicy {
  private quietSince: number | null = null
  private nextAt: number | null = null
  private lastAt: number | null = null
  private lastActivityId: string | null = null
  private readonly lastById = new Map<string, number>()

  constructor(
    private readonly random: () => number,
    private readonly activities: readonly IdleActivityDefinition[] = IDLE_ACTIVITIES,
  ) {}

  /** Another owner produced visible presence; the next idle activity waits its interval. */
  notePresence(at: number): void {
    this.lastAt = at
    if (this.nextAt !== null) this.nextAt = Math.max(this.nextAt, at + IDLE_MIN_INTERVAL_MS)
  }

  reset(): void {
    this.quietSince = null
    this.nextAt = null
    this.lastAt = null
    this.lastActivityId = null
    this.lastById.clear()
  }

  decide(input: IdleActivityInput): IdleActivitySelection | null {
    const { at, mood } = input
    if (autonomyPolicyStop(input.settings, at, { quietHours: true }) || autonomyBusyStop(input)) {
      this.quietSince = null
      this.nextAt = null
      return null
    }
    const factor = idleRateFactor(mood)
    if (this.quietSince === null) {
      this.quietSince = at
      this.schedule(at, mood, factor)
      return null
    }
    const maxGap = bounded(MAX_QUIET_GAP_MS / factor, ...MAX_QUIET_GAP_LIMITS)
    const since = this.lastAt ?? this.quietSince
    if (at - since < IDLE_MIN_INTERVAL_MS) return null
    if (this.nextAt !== null && at < this.nextAt && at - since < maxGap) return null
    const activity = this.choose(at, mood)
    if (!activity) {
      this.schedule(at, mood, factor)
      return null
    }
    this.lastAt = at
    this.lastActivityId = activity.id
    this.lastById.set(activity.id, at)
    this.schedule(at, mood, factor)
    return Object.freeze({
      activity,
      intent: Object.freeze({ ...activity.intent }),
      ...(activity.holdMs ? { holdMs: activity.holdMs } : {}),
    })
  }

  private eligible(at: number): IdleActivityDefinition[] {
    const quietFor = this.quietSince === null ? 0 : at - this.quietSince
    return this.activities.filter(
      (activity) =>
        activity.id !== this.lastActivityId &&
        quietFor >= activity.minQuietMs &&
        at - (this.lastById.get(activity.id) ?? Number.NEGATIVE_INFINITY) >= activity.cooldownMs,
    )
  }

  private choose(at: number, mood: MoodState): IdleActivityDefinition | null {
    const candidates = this.eligible(at)
    const weights = candidates.map((activity) => activityWeight(activity, mood))
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    if (total <= 0) return null
    let pick = this.random() * total
    for (const [index, activity] of candidates.entries()) {
      pick -= weights[index]
      if (pick <= 0) return activity
    }
    return candidates.at(-1) ?? null
  }

  private schedule(at: number, mood: MoodState, factor: number): void {
    const ratePerMs =
      (this.activities.reduce((sum, activity) => sum + activityWeight(activity, mood), 0) *
        factor) /
      60_000
    const wait = ratePerMs > 0 ? -Math.log(1 - Math.min(0.999_999, this.random())) / ratePerMs : 0
    this.nextAt = at + Math.max(IDLE_MIN_INTERVAL_MS, wait)
  }
}

/** Small deterministic PRNG (mulberry32) for injected, reproducible idle schedules. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}
