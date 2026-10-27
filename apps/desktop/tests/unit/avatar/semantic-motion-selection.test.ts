import { afterEach, describe, expect, it, vi } from 'vitest'

import { AvatarBehaviorResolver } from '../../../src/renderer/avatar/AvatarBehaviorResolver'
import type { AvatarStateEffect } from '../../../src/renderer/avatar/AvatarStateMachine'
import type { EmbodimentGestureHint } from '../../../src/shared/character-response'
import { getMotionProfile } from '../../../src/shared/motion'

const speaking: AvatarStateEffect = {
  mode: 'speaking',
  proceduralMode: 'speaking',
  emotionKey: 'neutral',
  behaviorId: 'neutral',
  loop: true,
}

afterEach(() => vi.useRealTimers())

describe('standing semantic motion selection', () => {
  it.each([
    ['greeting', 'greet_wave_soft'],
    ['farewell', 'farewell_wave_soft'],
    ['agree', 'agree_soft'],
    ['disagree', 'disagree_gentle'],
    ['reassure', 'reassure_palm'],
    ['thanks', 'thank_heart_hover'],
    ['concern', 'concern_soft'],
  ] satisfies Array<[EmbodimentGestureHint, string]>)(
    'keeps the %s act distinct from emotion and legacy gesture aliases',
    (gestureHint, profileId) => {
      const resolver = new AvatarBehaviorResolver()
      resolver.setCameraMode('bust')
      const selected = resolver.resolveEmbodimentIntent(
        speaking,
        { intensity: 'subtle', gestureHint },
        'speaking',
      )
      expect(selected?.animationId).toBe(profileId)
      expect(selected?.loop).toBe(false)
      expect(selected?.motionLayer).toBe('gesture')
    },
  )

  it('uses presence when no semantic gesture was proposed', () => {
    const resolver = new AvatarBehaviorResolver()
    expect(
      resolver.resolveEmbodimentIntent(speaking, { intensity: 'subtle' }, 'speaking'),
    ).toBeNull()
    expect(getMotionProfile(resolver.resolve(speaking).animationId)?.kind).toBe('presence')
  })

  it('starts cooldown only after accepted execution and preserves presence while it lasts', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'))
    const resolver = new AvatarBehaviorResolver()
    resolver.setCameraMode('bust')
    const request = () =>
      resolver.resolveEmbodimentIntent(
        speaking,
        { intensity: 'subtle', gestureHint: 'greeting' },
        'speaking',
      )
    expect(request()?.animationId).toBe('greet_wave_soft')
    expect(request()?.animationId).toBe('greet_wave_soft')
    expect(resolver.getActiveCooldowns()).toEqual([])
    resolver.recordStarted('greet_wave_soft')
    const coolingDown = request()
    expect(coolingDown?.animationId).toBe('presence_speaking')
    expect(coolingDown?.candidates[0].excludedByCooldown).toBe(true)
    vi.advanceTimersByTime(60_001)
    expect(request()?.animationId).toBe('greet_wave_soft')
  })
})
