import { describe, expect, it } from 'vitest'

import { DEFAULT_AUTONOMY_SETTINGS, DEFAULT_MOOD_STATE } from '../../../src/main/alive/AliveStore'
import { BehaviorRuntime } from '../../../src/main/alive/BehaviorRuntime'
import {
  IDLE_ACTIVITIES,
  IDLE_MIN_INTERVAL_MS,
  type IdleActivityInput,
  IdleActivityPolicy,
  idleRateFactor,
  seededRandom,
} from '../../../src/main/alive/IdleActivityPolicy'
import type { MoodState } from '../../../src/shared/alive'

const start = new Date(2026, 9, 30, 12, 0).getTime()
const TICK_MS = 5_000

function input(at: number, overrides: Partial<IdleActivityInput> = {}): IdleActivityInput {
  return {
    at,
    settings: DEFAULT_AUTONOMY_SETTINGS,
    mood: DEFAULT_MOOD_STATE,
    conversationActive: false,
    audioActive: false,
    browserComputerUseScreenFocusActive: false,
    ...overrides,
  }
}

function simulate(seed: number, minutes: number, mood: MoodState = DEFAULT_MOOD_STATE) {
  const policy = new IdleActivityPolicy(seededRandom(seed))
  const events: Array<{ at: number; id: string }> = []
  for (let at = start; at <= start + minutes * 60_000; at += TICK_MS) {
    const selected = policy.decide(input(at, { mood }))
    if (selected) events.push({ at, id: selected.activity.id })
  }
  return events
}

describe('idle activity policy', () => {
  it('produces the same schedule for the same seed and a different one otherwise', () => {
    expect(simulate(7, 10)).toEqual(simulate(7, 10))
    expect(simulate(7, 10)).not.toEqual(simulate(8, 10))
  })

  it('keeps a neutral idle visibly occupied within the minimum interval and maximum gap', () => {
    const events = simulate(3, 20)
    expect(events.length).toBeGreaterThan(30)
    const gaps = events.slice(1).map((event, index) => event.at - events[index].at)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(IDLE_MIN_INTERVAL_MS)
    // Ticks arrive every 5 s, so the bounded 25 s gap may be observed one tick late.
    expect(Math.max(...gaps, events[0].at - start)).toBeLessThanOrEqual(30_000)
  })

  it('never repeats the same activity twice in a row', () => {
    const events = simulate(11, 30)
    for (let index = 1; index < events.length; index++)
      expect(events[index].id).not.toBe(events[index - 1].id)
  })

  it('makes low arousal calmer and high arousal livelier within bounds', () => {
    const calm = { ...DEFAULT_MOOD_STATE, arousal: -1, curiosity: 0.2, playfulness: 0.2 }
    const lively = { ...DEFAULT_MOOD_STATE, arousal: 1, curiosity: 1, playfulness: 1 }
    expect(idleRateFactor(calm)).toBeLessThan(idleRateFactor(DEFAULT_MOOD_STATE))
    expect(idleRateFactor(lively)).toBeGreaterThan(idleRateFactor(DEFAULT_MOOD_STATE))
    expect(idleRateFactor(calm)).toBeGreaterThanOrEqual(0.5)
    expect(idleRateFactor(lively)).toBeLessThanOrEqual(1.5)
    expect(idleRateFactor({ ...DEFAULT_MOOD_STATE, arousal: Number.NaN })).toBe(
      idleRateFactor(DEFAULT_MOOD_STATE),
    )
    const counts = (mood: MoodState) =>
      [1, 2, 3, 4, 5].reduce((sum, seed) => sum + simulate(seed, 30, mood).length, 0)
    expect(counts(calm)).toBeLessThan(counts(lively))
  })

  it.each([
    ['suspended', { settings: { ...DEFAULT_AUTONOMY_SETTINGS, globallySuspended: true } }],
    ['privacy', { settings: { ...DEFAULT_AUTONOMY_SETTINGS, privacyMode: true } }],
    ['off', { settings: { ...DEFAULT_AUTONOMY_SETTINGS, mode: 'off' as const } }],
    [
      'quiet hours',
      {
        settings: {
          ...DEFAULT_AUTONOMY_SETTINGS,
          quietHours: { enabled: true, startHour: 11, endHour: 13 },
        },
      },
    ],
    ['conversation', { conversationActive: true }],
    ['audio', { audioActive: true }],
    ['browser screen focus', { browserComputerUseScreenFocusActive: true }],
  ])('stays silent and resets its quiet period while %s', (_name, overrides) => {
    const policy = new IdleActivityPolicy(seededRandom(5))
    for (let at = start; at <= start + 5 * 60_000; at += TICK_MS)
      expect(policy.decide(input(at, overrides))).toBeNull()
    // After the stop ends, the quiet period starts again: nothing on the first tick.
    expect(policy.decide(input(start + 5 * 60_000 + TICK_MS))).toBeNull()
  })

  it('waits for long quiet before a stretch and honours each cooldown', () => {
    const events = simulate(13, 30)
    const stretches = events.filter((event) => event.id === 'stretch-small')
    for (const stretch of stretches) expect(stretch.at - start).toBeGreaterThanOrEqual(90_000)
    for (const activity of IDLE_ACTIVITIES) {
      const times = events.filter((event) => event.id === activity.id).map((event) => event.at)
      for (let index = 1; index < times.length; index++)
        expect(times[index] - times[index - 1]).toBeGreaterThanOrEqual(activity.cooldownMs)
    }
  })

  it('delays the next activity after another owner shows presence and resets idempotently', () => {
    const policy = new IdleActivityPolicy(seededRandom(2))
    policy.decide(input(start))
    policy.notePresence(start + 7_000)
    expect(policy.decide(input(start + 10_000))).toBeNull()
    policy.reset()
    policy.reset()
    expect(policy.decide(input(start + 60_000))).toBeNull()
  })

  it('emits only bounded embodiment commands tagged with their activity', () => {
    const behavior = new BehaviorRuntime(seededRandom(9))
    const commands = []
    for (let at = start; at <= start + 5 * 60_000; at += TICK_MS) {
      const command = behavior.observeIdle(input(at))
      if (command) commands.push(command)
    }
    expect(commands.length).toBeGreaterThan(5)
    for (const command of commands) {
      expect(command.intent.kind).toBe('embodiment')
      expect(command.idleActivityId).toBeDefined()
      expect(IDLE_ACTIVITIES.map((activity) => activity.id)).toContain(command.idleActivityId)
      if (command.holdMs !== undefined) expect(command.holdMs).toBeLessThanOrEqual(10_000)
    }
  })
})
