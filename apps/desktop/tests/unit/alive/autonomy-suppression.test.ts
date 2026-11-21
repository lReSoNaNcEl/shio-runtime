import { describe, expect, it } from 'vitest'

import { DEFAULT_AUTONOMY_SETTINGS } from '../../../src/main/alive/AliveStore'
import { autonomyBusyStop, autonomyPolicyStop } from '../../../src/main/alive/autonomySuppression'

describe('shared autonomy suppression', () => {
  it('evaluates Global Suspend, Privacy Mode and Off in order', () => {
    const off = { ...DEFAULT_AUTONOMY_SETTINGS, mode: 'off' as const }
    expect(autonomyPolicyStop({ ...off, privacyMode: true, globallySuspended: true })).toBe(
      'suspended',
    )
    expect(autonomyPolicyStop({ ...off, privacyMode: true })).toBe('privacy')
    expect(autonomyPolicyStop(off)).toBe('off')
    expect(autonomyPolicyStop(DEFAULT_AUTONOMY_SETTINGS)).toBeNull()
  })

  it('defers presence during conversation, playback or browser screen focus', () => {
    const idle = {
      conversationActive: false,
      audioActive: false,
      browserComputerUseScreenFocusActive: false,
    }
    expect(autonomyBusyStop({ ...idle, conversationActive: true })).toBe('conversation')
    expect(autonomyBusyStop({ ...idle, audioActive: true })).toBe('audio')
    expect(autonomyBusyStop({ ...idle, browserComputerUseScreenFocusActive: true })).toBe(
      'screen-focus',
    )
    expect(autonomyBusyStop(idle)).toBeNull()
  })
})
