import { describe, expect, it } from 'vitest'

import { AvatarSpeakingGestureScheduler } from '../../../src/renderer/avatar/AvatarSpeakingGestureScheduler'
import type { AvatarStateEffect } from '../../../src/renderer/avatar/AvatarStateMachine'
import { cloneCharacterState, INITIAL_CHARACTER_STATE } from '../../../src/shared/runtime'

const effect: AvatarStateEffect = {
  mode: 'speaking',
  proceduralMode: 'speaking',
  emotionKey: 'happy',
  behaviorId: 'happy',
  loop: true,
}

describe('speaking scheduling attempts', () => {
  it('does not retry a rejected or duplicate long-reply switch every frame', () => {
    const state = cloneCharacterState(INITIAL_CHARACTER_STATE)
    state.conversationPresence.replyLength = 'long'
    const scheduler = new AvatarSpeakingGestureScheduler()
    scheduler.begin(effect, state)
    let attempts = 0
    for (let frame = 0; frame < 1500; frame++) {
      if (scheduler.update(0.02, effect, state)) attempts++
    }
    expect(attempts).toBe(1)
    expect(scheduler.getDebugState().lastScheduledAnimation).toBe('none')
  })

  it('does not consume an emphasis cue without a new consumed PCM sample', () => {
    const scheduler = new AvatarSpeakingGestureScheduler()
    scheduler.begin(effect)
    scheduler.beginSegment('happy')
    expect(scheduler.update(0, effect)).toBeNull()
    expect(scheduler.update(0.02, effect)?.phase).toBe('emphasis')
    scheduler.beginSegment('happy')
    expect(scheduler.update(0.02, effect)).toBeNull()
  })
})
