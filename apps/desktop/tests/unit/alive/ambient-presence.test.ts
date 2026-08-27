import { describe, expect, it } from 'vitest'

import { DEFAULT_AUTONOMY_SETTINGS } from '../../../src/main/alive/AliveStore'
import { AmbientPresencePolicy } from '../../../src/main/alive/AmbientPresencePolicy'
import type { MoodState, WorldContextSnapshot } from '../../../src/shared/alive'

const mood: MoodState = {
  valence: 0.2,
  arousal: 0.4,
  confidence: 0.6,
  playfulness: 0.3,
  curiosity: 0.7,
  frustration: 0,
  updatedAt: 1_000,
}

function world(overrides: Partial<WorldContextSnapshot> = {}): WorldContextSnapshot {
  return {
    capturedAt: 1_000,
    appFocused: true,
    globalUserIdleMs: 0,
    userIdleMs: 0,
    conversationActive: false,
    audioActive: false,
    privacyMode: false,
    lastUserActivityAt: 1_000,
    foregroundApplication: { processName: 'webstorm.exe', displayName: 'WebStorm' },
    systemAdapter: 'available',
    freshness: {
      rendererMs: 0,
      schedulerMs: null,
      systemMs: 0,
      systemSources: {
        globalIdleMs: 0,
        foregroundApplicationMs: 0,
        runningApplicationsMs: null,
        systemLoadMs: null,
      },
    },
    ...overrides,
  }
}

describe('Ambient Presence policy', () => {
  it('projects a bounded screen-gaze response to foreground changes', () => {
    const policy = new AmbientPresencePolicy()
    const foreground = policy.decide({
      previous: world(),
      current: world({
        capturedAt: 2_000,
        foregroundApplication: { processName: 'chrome.exe', displayName: 'Chrome' },
      }),
      settings: DEFAULT_AUTONOMY_SETTINGS,
      mood,
      browserComputerUseScreenFocusActive: false,
      at: 2_000,
    })
    expect(foreground?.attention).toBe('foreground-change')
    expect(foreground?.embodiment?.gazeHint).toBe('screen')

    const cooldown = policy.decide({
      previous: world({ globalUserIdleMs: 6 * 60_000 }),
      current: world({ globalUserIdleMs: 0 }),
      settings: DEFAULT_AUTONOMY_SETTINGS,
      mood,
      browserComputerUseScreenFocusActive: false,
      at: 3_000,
    })
    expect(cooldown).toBeNull()
  })

  it('yields to conversation, Browser Computer Use gaze, and Privacy Mode', () => {
    const policy = new AmbientPresencePolicy()
    expect(
      policy.decide({
        previous: world(),
        current: world({
          conversationActive: true,
          foregroundApplication: { processName: 'chrome.exe' },
        }),
        settings: DEFAULT_AUTONOMY_SETTINGS,
        mood,
        browserComputerUseScreenFocusActive: false,
        at: 40_000,
      }),
    ).toBeNull()
    expect(
      policy.decide({
        previous: world(),
        current: world({ foregroundApplication: { processName: 'chrome.exe' } }),
        settings: DEFAULT_AUTONOMY_SETTINGS,
        mood,
        browserComputerUseScreenFocusActive: true,
        at: 80_000,
      }),
    ).toBeNull()
    expect(
      policy.decide({
        previous: world(),
        current: world({ foregroundApplication: { processName: 'chrome.exe' } }),
        settings: { ...DEFAULT_AUTONOMY_SETTINGS, privacyMode: true },
        mood,
        browserComputerUseScreenFocusActive: false,
        at: 120_000,
      }),
    ).toBeNull()
  })
})
