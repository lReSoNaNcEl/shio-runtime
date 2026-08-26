import type {
  AmbientPresenceIntent,
  AutonomySettings,
  MoodState,
  WorldContextSnapshot,
} from '../../shared/alive'

const PRESENCE_COOLDOWN_MS = 30_000
const RETURNED_IDLE_THRESHOLD_MS = 2 * 60_000
const RELAXED_IDLE_THRESHOLD_MS = 5 * 60_000
const ACTIVE_IDLE_THRESHOLD_MS = 15_000
const SYSTEM_LOAD_DELTA = 0.35

export interface AmbientPresenceInput {
  previous: WorldContextSnapshot
  current: WorldContextSnapshot
  settings: AutonomySettings
  mood: MoodState
  browserComputerUseScreenFocusActive: boolean
  at: number
}

/** Deterministic, mostly-silent semantic presence policy. It never calls an LLM or Avatar APIs. */
export class AmbientPresencePolicy {
  private lastSelectedAt: number | null = null

  decide(input: AmbientPresenceInput): AmbientPresenceIntent | null {
    const { current, previous, settings, at } = input
    if (
      settings.globallySuspended ||
      settings.privacyMode ||
      settings.mode === 'off' ||
      current.conversationActive ||
      current.audioActive ||
      input.browserComputerUseScreenFocusActive ||
      (this.lastSelectedAt !== null && at - this.lastSelectedAt < PRESENCE_COOLDOWN_MS)
    ) {
      return null
    }

    const intent =
      returnedToUser(previous, current, input.mood) ??
      relaxedAfterIdle(previous, current, input.mood) ??
      foregroundChanged(previous, current, input.mood) ??
      mediaChanged(previous, current, input.mood) ??
      systemLoadChanged(previous, current, input.mood)
    if (!intent) return null
    this.lastSelectedAt = at
    return Object.freeze(intent)
  }
}

function returnedToUser(
  previous: WorldContextSnapshot,
  current: WorldContextSnapshot,
  mood: MoodState,
): AmbientPresenceIntent | null {
  if (
    previous.globalUserIdleMs < RETURNED_IDLE_THRESHOLD_MS ||
    current.globalUserIdleMs > ACTIVE_IDLE_THRESHOLD_MS
  ) {
    return null
  }
  return {
    attention: 'user',
    energy: mood.arousal > 0.45 ? 'engaged' : 'normal',
    curiosity: boundedUnit(0.35 + mood.curiosity * 0.25),
    embodiment: { intensity: 'subtle', gazeHint: 'user' },
  }
}

function relaxedAfterIdle(
  previous: WorldContextSnapshot,
  current: WorldContextSnapshot,
  mood: MoodState,
): AmbientPresenceIntent | null {
  if (
    previous.globalUserIdleMs >= RELAXED_IDLE_THRESHOLD_MS ||
    current.globalUserIdleMs < RELAXED_IDLE_THRESHOLD_MS
  ) {
    return null
  }
  return {
    attention: 'relaxed',
    energy: 'low',
    curiosity: boundedUnit(mood.curiosity * 0.25),
    embodiment: { intensity: 'subtle', gazeHint: 'away' },
  }
}

function foregroundChanged(
  previous: WorldContextSnapshot,
  current: WorldContextSnapshot,
  mood: MoodState,
): AmbientPresenceIntent | null {
  const before = previous.foregroundApplication?.processName
  const after = current.foregroundApplication?.processName
  if (!before || !after || before === after) return null
  return {
    attention: 'foreground-change',
    energy: mood.arousal > 0.55 ? 'engaged' : 'normal',
    curiosity: boundedUnit(0.4 + mood.curiosity * 0.4),
    embodiment: { intensity: 'subtle', gazeHint: 'screen' },
  }
}

function mediaChanged(
  previous: WorldContextSnapshot,
  current: WorldContextSnapshot,
  mood: MoodState,
): AmbientPresenceIntent | null {
  if (previous.media?.playing === current.media?.playing) return null
  return {
    attention: current.media?.playing ? 'screen' : 'relaxed',
    energy: current.media?.playing ? 'normal' : 'low',
    curiosity: boundedUnit(0.25 + mood.curiosity * 0.35),
    embodiment: {
      intensity: 'subtle',
      gazeHint: current.media?.playing ? 'screen' : 'away',
    },
  }
}

function systemLoadChanged(
  previous: WorldContextSnapshot,
  current: WorldContextSnapshot,
  mood: MoodState,
): AmbientPresenceIntent | null {
  const before = highestLoad(previous)
  const after = highestLoad(current)
  if (before === null || after === null || after - before < SYSTEM_LOAD_DELTA) return null
  return {
    attention: 'screen',
    energy: 'engaged',
    curiosity: boundedUnit(0.45 + mood.curiosity * 0.35),
    embodiment: { intensity: 'subtle', gestureHint: 'think', gazeHint: 'screen' },
  }
}

function highestLoad(world: WorldContextSnapshot): number | null {
  const values = [world.system?.cpuLoad, world.system?.gpuLoad, world.system?.memoryLoad].filter(
    (value): value is number => value !== undefined,
  )
  return values.length > 0 ? Math.max(...values) : null
}

function boundedUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
}
