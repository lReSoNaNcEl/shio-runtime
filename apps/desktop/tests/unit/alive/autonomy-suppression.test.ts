import { describe, expect, it } from 'vitest'

import { DEFAULT_AUTONOMY_SETTINGS } from '../../../src/main/alive/AliveStore'
import {
  autonomyBusyStop,
  autonomyPolicyStop,
  insideQuietHours,
} from '../../../src/main/alive/autonomySuppression'
import type { AutonomySettings } from '../../../src/shared/alive'

const at = new Date(2026, 9, 30, 23, 30).getTime()

function settingsMatrix(): AutonomySettings[] {
  const matrix: AutonomySettings[] = []
  for (const globallySuspended of [false, true])
    for (const privacyMode of [false, true])
      for (const mode of ['off', 'suggest', 'full'] as const)
        for (const enabled of [false, true])
          for (const [startHour, endHour] of [
            [22, 7],
            [9, 17],
            [5, 5],
          ] as const)
            matrix.push({
              ...DEFAULT_AUTONOMY_SETTINGS,
              globallySuspended,
              privacyMode,
              mode,
              quietHours: { enabled, startHour, endHour },
            })
  return matrix
}

// The predicates previously duplicated in BehaviorRuntime and AmbientPresencePolicy.
function previousQuietHours(settings: AutonomySettings, now: number): boolean {
  if (!settings.quietHours.enabled) return false
  const hour = new Date(now).getHours()
  const { startHour, endHour } = settings.quietHours
  return startHour === endHour
    ? true
    : startHour < endHour
      ? hour >= startHour && hour < endHour
      : hour >= startHour || hour < endHour
}

describe('shared autonomy suppression', () => {
  it('matches the previous Behavior policy stop for every settings combination', () => {
    for (const settings of settingsMatrix()) {
      const previous =
        settings.globallySuspended ||
        settings.privacyMode ||
        settings.mode === 'off' ||
        previousQuietHours(settings, at)
      expect(autonomyPolicyStop(settings, at, { quietHours: true }) !== null).toBe(previous)
      expect(insideQuietHours(settings, at)).toBe(previousQuietHours(settings, at))
    }
  })

  it('matches the previous Ambient Presence stop, which ignores quiet hours', () => {
    for (const settings of settingsMatrix())
      for (const conversationActive of [false, true])
        for (const audioActive of [false, true])
          for (const browserComputerUseScreenFocusActive of [false, true]) {
            const previous =
              settings.globallySuspended ||
              settings.privacyMode ||
              settings.mode === 'off' ||
              conversationActive ||
              audioActive ||
              browserComputerUseScreenFocusActive
            const stopped =
              autonomyPolicyStop(settings, at, { quietHours: false }) !== null ||
              autonomyBusyStop({
                conversationActive,
                audioActive,
                browserComputerUseScreenFocusActive,
              }) !== null
            expect(stopped).toBe(previous)
          }
  })

  it('reports the established precedence of policy stops', () => {
    const quiet = {
      ...DEFAULT_AUTONOMY_SETTINGS,
      quietHours: { enabled: true, startHour: 22, endHour: 7 },
    }
    expect(
      autonomyPolicyStop({ ...quiet, globallySuspended: true, privacyMode: true }, at, {
        quietHours: true,
      }),
    ).toBe('suspended')
    expect(
      autonomyPolicyStop({ ...quiet, privacyMode: true, mode: 'off' }, at, { quietHours: true }),
    ).toBe('privacy')
    expect(autonomyPolicyStop({ ...quiet, mode: 'off' }, at, { quietHours: true })).toBe('off')
    expect(autonomyPolicyStop(quiet, at, { quietHours: true })).toBe('quiet-hours')
    expect(autonomyPolicyStop(quiet, at, { quietHours: false })).toBeNull()
  })
})
