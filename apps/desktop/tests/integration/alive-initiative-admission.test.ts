import assert from 'node:assert/strict'

import { it, vi } from 'vitest'

import type { ControllerState } from '../../src/renderer/controller/contracts'
import { AliveExperienceRuntime } from '../../src/renderer/runtime/AliveExperienceRuntime'
import type { ConversationPresentationPort } from '../../src/renderer/runtime/ConversationPresentationPort'
import type { AliveSnapshot, BehaviorCommand } from '../../src/shared/alive'

it('passes only Main-admitted initiatives to conversation and leaves previews as suggestions', async () => {
  let behavior!: (command: BehaviorCommand) => void
  const spoken: string[] = []
  const suggestions: string[] = []
  const host = new EventTarget()
  vi.stubGlobal('window', {
    addEventListener: host.addEventListener.bind(host),
    removeEventListener: host.removeEventListener.bind(host),
    setInterval,
    clearInterval,
    api: {
      alive: {
        onChanged: () => () => undefined,
        onBehavior: (listener: typeof behavior) => {
          behavior = listener
          return () => undefined
        },
        snapshot: async () => ({}) as AliveSnapshot,
        updateWorld: async () => undefined,
      },
    },
  })
  vi.stubGlobal('document', { hasFocus: () => true })
  const runtime = new AliveExperienceRuntime({
    getControllerState: () => ({ status: 'idle' }) as ControllerState,
    updateSnapshot: () => undefined,
    pushInitiative: (topic) => suggestions.push(topic),
    runAdmittedInitiative: async (topic) => {
      spoken.push(topic)
    },
    presentation: {} as ConversationPresentationPort,
    recordEvent: () => undefined,
  })
  try {
    runtime.start()
    const candidate: BehaviorCommand = {
      id: 'candidate',
      at: Date.now(),
      intent: { kind: 'conversation-candidate', topic: 'Take a break', priority: 0.8 },
    }
    behavior(candidate)
    behavior({ ...candidate, initiativeDisposition: 'preview' })
    assert.deepEqual(spoken, [])
    assert.equal(suggestions.length, 2)
    behavior({ ...candidate, initiativeDisposition: 'admit' })
    await Promise.resolve()
    assert.deepEqual(spoken, ['Take a break'])
    assert.equal(suggestions.length, 2)
  } finally {
    runtime.dispose()
  }
})

it('executes a Main-selected idle activity as a held glance and one gesture, and tears down', () => {
  vi.useFakeTimers()
  let behavior!: (command: BehaviorCommand) => void
  const intents: Array<string | undefined> = []
  const gestures: string[] = []
  const host = new EventTarget()
  vi.stubGlobal('window', {
    addEventListener: host.addEventListener.bind(host),
    removeEventListener: host.removeEventListener.bind(host),
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    api: {
      alive: {
        onChanged: () => () => undefined,
        onBehavior: (listener: typeof behavior) => {
          behavior = listener
          return () => undefined
        },
        snapshot: async () => ({}) as AliveSnapshot,
        updateWorld: async () => undefined,
      },
    },
  })
  vi.stubGlobal('document', { hasFocus: () => true })
  const presentation: Pick<
    ConversationPresentationPort,
    'setBehaviorEmbodimentIntent' | 'playIdleActivityGesture'
  > = {
    setBehaviorEmbodimentIntent: (intent) => {
      intents.push(intent?.gazeHint)
    },
    playIdleActivityGesture: (intent) => {
      gestures.push(intent.gestureHint ?? '')
    },
  }
  const runtime = new AliveExperienceRuntime({
    getControllerState: () => ({ status: 'idle' }) as ControllerState,
    updateSnapshot: () => undefined,
    pushInitiative: () => undefined,
    runAdmittedInitiative: async () => undefined,
    presentation: presentation as ConversationPresentationPort,
    recordEvent: () => undefined,
  })
  try {
    runtime.start()
    behavior({
      id: 'idle-1',
      at: Date.now(),
      idleActivityId: 'curious-lean',
      holdMs: 3_000,
      intent: {
        kind: 'embodiment',
        intent: { intensity: 'subtle', gestureHint: 'curious', gazeHint: 'screen' },
      },
    })
    assert.deepEqual(intents, ['screen'])
    assert.deepEqual(gestures, ['curious'])
    vi.advanceTimersByTime(2_999)
    assert.deepEqual(intents, ['screen'])
    vi.advanceTimersByTime(1)
    assert.deepEqual(intents, ['screen', undefined])
    runtime.setWatchSession('watch-1', true)
    behavior({
      id: 'late-glance',
      at: Date.now(),
      watchReaction: { sessionId: 'watch-1', expiresAt: Date.now() + 120 },
      holdMs: 850,
      intent: { kind: 'embodiment', intent: { intensity: 'subtle', gazeHint: 'screen' } },
    })
    assert.equal(intents.at(-1), 'screen')
    vi.advanceTimersByTime(120)
    assert.equal(intents.at(-1), undefined)
    behavior({
      id: 'idle-2',
      at: Date.now(),
      idleActivityId: 'look-around',
      holdMs: 60_000,
      intent: { kind: 'embodiment', intent: { intensity: 'subtle', gazeHint: 'away' } },
    })
    runtime.dispose()
    runtime.dispose()
    vi.advanceTimersByTime(60_000)
    assert.deepEqual(intents, ['screen', undefined, 'screen', undefined, 'away'])
  } finally {
    runtime.dispose()
    vi.useRealTimers()
  }
})
