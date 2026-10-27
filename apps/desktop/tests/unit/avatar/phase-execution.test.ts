import { describe, expect, it } from 'vitest'

import { MotionPhaseExecution } from '../../../src/renderer/avatar/MotionPhaseExecution'
import { getMotionProfile, MOTION_CATALOG_REVISION } from '../../../src/shared/motion'

function execution(id = 'agree_soft'): MotionPhaseExecution {
  const profile = getMotionProfile(id)
  if (!profile) throw new Error('Missing fixture profile')
  return new MotionPhaseExecution('execution-1', profile)
}
function advance(value: MotionPhaseExecution, milliseconds: number, target = true): void {
  for (let remaining = milliseconds; remaining > 0; remaining -= 50)
    value.advance(Math.min(50, remaining) / 1000, target)
}

describe('phased motion execution lifecycle', () => {
  it('forecasts only the next generated phase without advancing execution or outcomes', () => {
    const value = execution()
    expect(value.forecastPlan('anchor')).toBeNull()
    value.ready = true
    expect(value.forecastPlan('anchor')).toMatchObject({
      phaseId: 'stroke',
      planRevision: 1,
      clockDomain: 'local',
    })
    expect(value.phase).toBe('prepare')
    expect(value.revision).toBe(0)
    expect(value.elapsedMs).toBe(0)
    expect(value.outcome).toBeNull()
    value.setClock('pcm')
    const forecast = value.forecastPlan('anchor')
    advance(value, value.budget.minMs)
    expect(value.plan('anchor')).toEqual(forecast)
    expect(value.forecastPlan('anchor')).toBeNull()
  })

  it('can recover an interruptible unready phase without claiming it completed', () => {
    const value = execution()
    value.requestRecovery()
    expect(value.advance(0, false)).toBe(true)
    expect(value.phase).toBe('recover')
    expect(value.outcome).toBeNull()
    value.ready = true
    advance(value, value.budget.minMs)
    expect(value.outcome).toBe('superseded')
  })

  it('recovers a failed protected stroke without replaying it or claiming completion', () => {
    const value = execution()
    value.ready = true
    advance(value, value.budget.minMs)
    expect(value.phase).toBe('stroke')
    value.requestFailureRecovery()
    expect(value.advance(0, false)).toBe(true)
    expect(value.phase).toBe('recover')
    value.ready = true
    advance(value, value.budget.minMs)
    expect(value.outcome).toBe('failed')
  })

  it('keeps preparation pending until ready and cannot complete from a diagnostic read', () => {
    const value = execution()
    advance(value, 5_000)
    for (let index = 0; index < 10; index += 1) {
      expect(value.plan('anchor')).toMatchObject({
        phaseId: 'prepare',
        catalogRevision: MOTION_CATALOG_REVISION,
      })
      expect(value.progress).toBe(0)
    }
    expect(value.phase).toBe('prepare')
    expect(value.outcome).toBeNull()
    value.ready = true
    advance(value, value.budget.minMs)
    expect(value.phase).toBe('stroke')
    expect(value.ready).toBe(false)
    expect(value.outcome).toBeNull()
  })

  it('requires both timing and exit conditions for every phase, including recovery', () => {
    const value = execution()
    for (const phase of ['prepare', 'stroke', 'hold'] as const) {
      expect(value.phase).toBe(phase)
      value.ready = true
      advance(value, value.budget.minMs, false)
      expect(value.phase).toBe(phase)
      expect(value.outcome).toBeNull()
      value.advance(0, true)
    }
    expect(value.phase).toBe('recover')
    value.ready = true
    advance(value, value.budget.minMs - 50)
    expect(value.outcome).toBeNull()
    value.advance(0.05, false)
    expect(value.outcome).toBeNull()
    value.advance(0, true)
    expect(value.outcome).toBe('completed')
  })

  it('holds speech phase timing while consumption is paused and recovery selects local time', () => {
    const value = execution()
    expect(value.setClock('playback-a')).toBe(true)
    value.ready = true
    value.advance(0.05, true)
    const elapsed = value.elapsedMs
    for (let index = 0; index < 100; index += 1) value.advance(0, true)
    expect(value.elapsedMs).toBe(elapsed)
    expect(value.plan('anchor')).toMatchObject({ clockDomain: 'speech', playbackId: 'playback-a' })
    value.requestRecovery()
    advance(value, value.budget.minMs)
    expect(value.phase).toBe('recover')
    expect(value.plan('anchor')).toMatchObject({ clockDomain: 'local', playbackId: null })
    value.ready = true
    advance(value, value.budget.minMs)
    expect(value.outcome).toBe('superseded')
  })

  it('recovers an expired target before reporting timeout and never claims completion', () => {
    const value = execution()
    value.ready = true
    advance(value, value.budget.maxMs, false)
    expect(value.phase).toBe('recover')
    expect(value.outcome).toBeNull()
    expect(value.hasTimedOut).toBe(true)
    value.ready = true
    advance(value, value.budget.minMs, true)
    expect(value.outcome).toBe('timed-out')
  })

  it('interrupts a held presence immediately while retaining protection of a stroke', () => {
    const presence = execution('presence_poised')
    for (let i = 0; i < 2; i++) {
      presence.ready = true
      advance(presence, presence.budget.minMs)
    }
    presence.ready = true
    presence.requestRecovery()
    expect(presence.elapsedMs).toBe(0)
    expect(presence.advance(0, false)).toBe(true)
    expect(presence.phase).toBe('recover')
    const gesture = execution()
    gesture.ready = true
    advance(gesture, gesture.budget.minMs)
    gesture.ready = true
    gesture.requestRecovery()
    gesture.advance(0, true)
    expect(gesture.phase).toBe('stroke')
  })

  it('keeps standing presence held until a recovery request', () => {
    const value = execution('presence_poised')
    for (let index = 0; index < 2; index += 1) {
      value.ready = true
      advance(value, value.budget.minMs)
    }
    expect(value.phase).toBe('hold')
    value.ready = true
    advance(value, value.budget.maxMs + 1_000)
    expect(value.phase).toBe('hold')
    expect(value.outcome).toBeNull()
    value.requestRecovery()
    value.advance(0, true)
    expect(value.phase).toBe('recover')
  })
})
