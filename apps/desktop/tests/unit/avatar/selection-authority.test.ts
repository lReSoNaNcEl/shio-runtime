import { describe, expect, it } from 'vitest'

import { AvatarBehaviorResolver } from '../../../src/renderer/avatar/AvatarBehaviorResolver'
import type { AvatarStateEffect } from '../../../src/renderer/avatar/AvatarStateMachine'
import { resolveAvatarMotionAuthority } from '../../../src/renderer/avatar/embodiment/motion/AvatarMotionLayer'

const effect: AvatarStateEffect = {
  mode: 'speaking',
  proceduralMode: 'speaking',
  emotionKey: 'happy',
  behaviorId: 'happy',
  loop: true,
}

describe('selected profile composition authority', () => {
  it.each(['behavior:neutral', 'behavior:happy'])(
    'keeps %s presence at full continuous-presence authority',
    (tag) => {
      const selected = new AvatarBehaviorResolver().resolveAnimationTags(
        effect,
        [tag],
        'happy',
        'speaking',
      )
      expect(selected?.animationId).toMatch(/^presence_/u)
      expect(selected?.motionLayer).toBe('base')
      if (!selected) throw new Error('Missing presence selection')
      expect(
        resolveAvatarMotionAuthority({
          bodyLayer: selected.motionLayer,
          directedGaze: false,
          screenGaze: false,
        }).proceduralUpperBodyWeight,
      ).toBe(1)
    },
  )

  it('uses base authority when a semantic gesture falls back to presence on cooldown', () => {
    const resolver = new AvatarBehaviorResolver()
    const intent = { intensity: 'normal', gestureHint: 'greeting' } as const
    const first = resolver.resolveEmbodimentIntent(effect, intent, 'speaking')
    expect(first?.animationId).toBe('greet_wave_soft')
    expect(first?.motionLayer).toBe('gesture')
    resolver.recordStarted('greet_wave_soft')
    const fallback = resolver.resolveEmbodimentIntent(effect, intent, 'reaction')
    expect(fallback?.animationId).toMatch(/^presence_/u)
    expect(fallback?.motionLayer).toBe('base')
  })

  it('preserves the canonical presence kind even for a semantic think proposal', () => {
    const selected = new AvatarBehaviorResolver().resolveEmbodimentIntent(
      effect,
      { intensity: 'normal', gestureHint: 'think' },
      'speaking',
    )
    expect(selected?.animationId).toBe('presence_thinking')
    expect(selected?.motionLayer).toBe('base')
  })

  it('maps an actual semantic act to its gesture and does not infer disagreement from anger', () => {
    const resolver = new AvatarBehaviorResolver()
    expect(
      resolver.resolveEmbodimentIntent(
        effect,
        { intensity: 'normal', gestureHint: 'explain' },
        'speaking',
      ),
    ).toMatchObject({ animationId: 'explain_one_palm', motionLayer: 'gesture' })
    expect(
      resolver.resolveEmbodimentIntent(
        effect,
        { intensity: 'normal', gestureHint: 'greeting' },
        'reaction',
      ),
    ).toMatchObject({ animationId: 'greet_wave_soft', motionLayer: 'reaction' })
    expect(
      resolver.resolveAnimationTags(effect, ['behavior:angry'], 'angry', 'reaction'),
    ).toBeNull()
  })
})
