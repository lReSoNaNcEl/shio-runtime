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
