import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AvatarBehaviorResolver } from '../../../src/renderer/avatar/AvatarBehaviorResolver'
import { AvatarController } from '../../../src/renderer/avatar/AvatarController'
import type { CharacterEmbodimentIntent } from '../../../src/shared/character-response'

const intent: CharacterEmbodimentIntent = { intensity: 'normal', gestureHint: 'greeting' }
interface Inspection {
  effectiveEmbodimentIntent(): CharacterEmbodimentIntent | undefined
  lipSync: { getActiveSession(): { turnId: string } | null }
  behaviorResolver: AvatarBehaviorResolver
}

afterEach(() => vi.restoreAllMocks())

describe('Avatar embodiment context validity', () => {
  it('expires a proposal without using its opening accent later', () => {
    let now = 20_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const controller = new AvatarController()
    const inspect = controller as unknown as Inspection
    controller.setEmbodimentIntent(intent, {
      turnId: 'turn-a',
      receivedAt: now,
      eligibility: 'opening',
    })
    expect(inspect.effectiveEmbodimentIntent()).toEqual(intent)
    now += 10_001
    expect(inspect.effectiveEmbodimentIntent()).toBeUndefined()
  })

  it('rejects stale, future-dated and foreign-turn proposals', () => {
    vi.spyOn(Date, 'now').mockReturnValue(20_000)
    const controller = new AvatarController()
    const inspect = controller as unknown as Inspection
    vi.spyOn(inspect.lipSync, 'getActiveSession').mockReturnValue({ turnId: 'turn-a' })
    for (const context of [
      { turnId: 'turn-a', receivedAt: 1, eligibility: 'opening' as const },
      { turnId: 'turn-a', receivedAt: 21_001, eligibility: 'opening' as const },
      { turnId: 'turn-b', receivedAt: 20_000, eligibility: 'opening' as const },
    ]) {
      controller.setEmbodimentIntent(intent, context)
      expect(inspect.effectiveEmbodimentIntent()).toBeUndefined()
    }
  })

  it('keeps a future-only proposal from becoming a new opening gesture', () => {
    const controller = new AvatarController()
    const inspect = controller as unknown as Inspection
    const semantic = vi.spyOn(inspect.behaviorResolver, 'resolveEmbodimentIntent')
    controller.setEmbodimentIntent(intent, {
      turnId: 'turn-a',
      receivedAt: Date.now(),
      eligibility: 'future-only',
    })
    controller.showSpeaking('calm')
    expect(semantic).not.toHaveBeenCalled()
  })
})
