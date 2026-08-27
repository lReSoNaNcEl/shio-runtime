import { describe, expect, it } from 'vitest'

import { CharacterStateStore } from '../../src/renderer/runtime/CharacterStateStore'
import { PassiveEventBus } from '../../src/renderer/runtime/EventBus'

describe('Character State domain writers', () => {
  it('keeps conversational emotion owned by conversation state', () => {
    const store = new CharacterStateStore(new PassiveEventBus())
    store.conversation.transition({ status: 'thinking', mode: 'thinking', emotion: 'happy' })
    expect(store.get().emotion).toBe('happy')
    expect(store.get().speechState.status).toBe('generating')

    store.speech.transitionInput('listening', 'listening')
    expect(store.get().mode).toBe('listening')
    expect(store.get().speechState.status).toBe('listening')
    expect(store.get().emotion).toBe('happy')
  })

  it('keeps attention and avatar writers domain-limited', () => {
    const store = new CharacterStateStore(new PassiveEventBus())
    store.conversation.transition({ status: 'thinking', mode: 'thinking', emotion: 'happy' })
    store.admission.setAttention({ focus: 'user', confidence: 0.42 })
    expect(store.get().attention).toEqual({ focus: 'user', confidence: 0.42 })
    expect(store.get().emotion).toBe('happy')

    const current = store.get()
    store.avatar.sync({
      avatar: { loaded: true },
      animation: current.animation,
      posture: 'relaxed',
    })
    expect(store.get().avatar.loaded).toBe(true)
    expect(store.get().emotion).toBe('happy')
  })
})
