import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type ChatMessagePatch,
  ChatMessageUpdateCoalescer,
} from '../../../src/renderer/controller/ChatMessageUpdateCoalescer'
import { ControllerStore } from '../../../src/renderer/controller/ControllerStore'

afterEach(() => vi.useRealTimers())

describe('streaming chat message updates', () => {
  it('coalesces rapid deltas to at most one regular commit per 20 ms', () => {
    vi.useFakeTimers()
    const commits: ChatMessagePatch[] = []
    const updates = new ChatMessageUpdateCoalescer((_id, patch) => commits.push(patch))

    for (let index = 1; index <= 1_000; index += 1) {
      updates.update('assistant-1', { text: `partial-${index}`, streaming: true })
      vi.advanceTimersByTime(2)
    }

    expect(commits.length).toBeLessThanOrEqual(100)
    expect(commits.at(-1)?.text).toBe('partial-1000')
    updates.dispose()
  })

  it('flushes terminal text immediately and reconciles the exact final draft', () => {
    vi.useFakeTimers()
    const commits: ChatMessagePatch[] = []
    const updates = new ChatMessageUpdateCoalescer((_id, patch) => commits.push(patch))
    updates.update('assistant-1', { text: 'незавершённый **текст', streaming: true })
    const grounding = { kind: 'project' } as never
    updates.update(
      'assistant-1',
      { text: 'Финальный **текст**.', grounding, streaming: false },
      true,
    )

    expect(commits).toEqual([{ text: 'Финальный **текст**.', grounding, streaming: false }])
    vi.runAllTimers()
    expect(commits).toHaveLength(1)
  })

  it('retains the latest partial text while interruption clears streaming state', () => {
    vi.useFakeTimers()
    const store = new ControllerStore({ messages: [] } as never)
    store.appendMessage({ id: 'assistant-1', role: 'assistant', text: 'Первый', streaming: true })
    const updates = new ChatMessageUpdateCoalescer((id, patch) => store.updateMessage(id, patch))
    updates.update('assistant-1', { text: 'Первый фрагмент', streaming: true })
    updates.flushAll({ streaming: false })
    store.markLatestAssistantInterrupted()

    expect(store.getState().messages[0]).toMatchObject({
      text: 'Первый фрагмент',
      streaming: false,
      interrupted: true,
    })
  })
})
