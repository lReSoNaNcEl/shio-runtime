import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BacklogSelector } from '../../../src/renderer/conversation/admission/BacklogSelector'
import { ConversationAdmissionCoordinator } from '../../../src/renderer/conversation/admission/ConversationAdmissionCoordinator'
import type {
  BufferedUtterance,
  ConversationInput,
} from '../../../src/renderer/speech/continuous-listening/types'
import { UtteranceBacklog } from '../../../src/renderer/speech/continuous-listening/UtteranceBacklog'
import { ConversationInputCoordinator } from '../../../src/renderer/speech/conversation/ConversationInputCoordinator'
import { createDeferred } from '../../support/Deferred'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  expect(vi.getTimerCount()).toBe(0)
  vi.useRealTimers()
})

function item(
  id: string,
  priorityClass: BufferedUtterance['priorityClass'] = 'P3',
  score = 50,
): BufferedUtterance {
  return {
    id,
    text: id,
    createdAt: Date.now(),
    expiresAt: Date.now() + 30_000,
    streamingSessionId: 's1',
    segmentId: id,
    directAddress: ['P0', 'P1', 'P2'].includes(priorityClass),
    question: priorityClass === 'P1',
    correctionHint: priorityClass === 'P0',
    followUpHint: priorityClass === 'P2',
    attentionScore: score,
    capturedWhileShioBusy: true,
    capturedDuringPlayback: false,
    likelySelfEcho: false,
    triggeredBargeIn: false,
    priorityClass,
  }
}
function input(
  id: string,
  source: ConversationInput['source'] = 'continuous_listening',
): ConversationInput {
  return { turnId: id, text: id, source, createdAt: Date.now(), streamingSessionId: 's1' }
}
const completed = (turnId: string) => ({
  status: 'completed' as const,
  turnId,
  playbackCompleted: true,
  cleanupCompleted: true as const,
})
describe('speech backlog selection', () => {
  it('rejects duplicate ids, self echo and weak overflow', () => {
    const queue = new UtteranceBacklog()
    expect(queue.enqueue(item('strong', 'P1'))).toBe(true)
    expect(queue.enqueue(item('strong', 'P1'))).toBe(false)
    expect(queue.enqueue({ ...item('echo'), likelySelfEcho: true })).toBe(false)
    for (let i = 0; i < 15; i += 1) queue.enqueue(item(`weak-${i}`, 'P4'))
    expect(queue.size()).toBeLessThanOrEqual(10)
    expect(queue.has('strong')).toBe(true)
  })

  it.each([
    { rule: 'attention', firstId: 'z', firstScore: 55, gapMs: 1, winner: 'z' },
    { rule: 'recency', firstId: 'a', firstScore: 50, gapMs: 1, winner: 'b' },
    { rule: 'id', firstId: 'z', firstScore: 50, gapMs: 0, winner: 'b' },
  ])('resolves a near-tie locally by $rule', ({ firstId, firstScore, gapMs, winner }) => {
    const queue = new UtteranceBacklog()
    queue.enqueue(item(firstId, 'P3', firstScore))
    vi.advanceTimersByTime(gapMs)
    queue.enqueue(item('b'))
    const selector = new BacklogSelector()
    const result = selector.select(queue)
    expect(result).toEqual({
      selectedIds: [winner],
      text: winner,
      backlogVersion: queue.getVersion(),
    })
    expect(selector.getDiagnostics()).toEqual({
      ambiguousQueues: 1,
      deterministicSelections: 1,
    })
  })

  it('merges nearby follow-ups from the same session and purges expired speech', () => {
    const queue = new UtteranceBacklog()
    queue.enqueue({ ...item('expired', 'P0'), expiresAt: Date.now() + 20 })
    queue.enqueue({ ...item('other', 'P2'), streamingSessionId: 's2' })
    queue.enqueue({ ...item('question', 'P1'), text: 'Как это работает?' })
    vi.advanceTimersByTime(10)
    queue.enqueue({ ...item('follow-up', 'P2'), text: 'И ещё один пример.' })
    vi.advanceTimersByTime(10)
    const result = new BacklogSelector().select(queue)
    expect(result).toMatchObject({
      text: 'Как это работает? И ещё один пример.',
      selectedIds: ['question', 'follow-up'],
    })
    expect(queue.has('expired')).toBe(false)
  })
})

describe('conversation admission', () => {
  it('admits explicit chat and releases a failed execution', async () => {
    const failure = {
      status: 'failed' as const,
      turnId: 'chat',
      phase: 'generation' as const,
      error: 'NETWORK_ERROR',
    }
    const coordinator = new ConversationAdmissionCoordinator(
      async () => failure,
      new UtteranceBacklog(),
      new BacklogSelector(),
    )
    expect(await coordinator.admitExplicit(input('chat', 'text_chat'))).toEqual(failure)
    await Promise.resolve()
    expect(coordinator.isBusy()).toBe(false)
    expect(coordinator.getActiveExecution()).toBeUndefined()
  })

  it.each([
    { source: 'text_chat', watchVoice: false },
    { source: 'push_to_talk', watchVoice: false },
    { source: 'continuous_listening', watchVoice: true },
  ] as const)(
    'gives explicit $source priority over queued mic speech',
    async ({ source, watchVoice }) => {
      const release = createDeferred<void>()
      const starts: string[] = []
      const coordinator = new ConversationAdmissionCoordinator(
        async (turn) => {
          starts.push(turn.text)
          if (turn.source === 'autonomous_initiative') await release.promise
          return completed(turn.turnId)
        },
        new UtteranceBacklog(),
        new BacklogSelector(),
      )
      coordinator.setContinuousEnabled(true)
      const running = coordinator.admitWithResult(input('active', 'autonomous_initiative'))
      expect(await coordinator.admitWithResult(input('busy', 'autonomous_initiative'))).toEqual({
        outcome: 'ignored_busy',
      })
      expect(await coordinator.admit(input('question'), item('question', 'P1'))).toBe(
        'queued_backlog',
      )
      const user = coordinator.admitExplicit({ ...input('user', source), watchVoice })
      release.resolve()
      expect((await running).completion?.status).toBe('completed')
      expect((await user).status).toBe('completed')
      expect(starts).toEqual(['active', 'user', 'question'])
    },
  )

  it.each(['kept', 'disabled', 'reset'])(
    'drains at most one correction with the listening session %s',
    async (mode) => {
      const queue = new UtteranceBacklog()
      const release = createDeferred<void>()
      const starts: string[] = []
      let active = 0
      const coordinator = new ConversationAdmissionCoordinator(
        async (turn) => {
          expect(active).toBe(0)
          active += 1
          starts.push(turn.text)
          if (turn.text === 'initial') await release.promise
          active -= 1
          return completed(turn.turnId)
        },
        queue,
        new BacklogSelector(),
      )
      coordinator.setContinuousEnabled(true)
      const running = coordinator.admit(input('initial'))
      await coordinator.admit(input('background'), item('background'))
      await coordinator.admit(input('question'), item('question', 'P1', 80))
      await coordinator.admit(input('correction'), item('correction', 'P0', 90))
      if (mode === 'disabled') coordinator.setContinuousEnabled(false)
      if (mode === 'reset') coordinator.resetStreamingSession()
      release.resolve()
      await running
      expect(starts).toEqual(mode === 'kept' ? ['initial', 'correction'] : ['initial'])
      expect(queue.snapshot().map((entry) => entry.id)).toEqual(mode === 'kept' ? ['question'] : [])
    },
  )

  it('starts and stops capture directly', async () => {
    const setContinuousListening = vi.fn(async () => undefined)
    const coordinator = new ConversationInputCoordinator({
      speechInputRuntime: { setContinuousListening },
      getControllerState: () => ({
        continuousListening: {
          desired: true,
          transport: 'starting',
          activity: 'idle',
          microphoneCaptured: false,
        },
      }),
      patchControllerState: vi.fn(),
    } as never)
    try {
      const settings = {
        enabled: true,
        replyCooldownMs: 1,
        followUpWindowMs: 1,
        curiosityChance: 0,
      }
      await coordinator.applyContinuousSettings(settings, false)
      await coordinator.applyContinuousSettings({ ...settings, enabled: false }, false)
      expect(setContinuousListening).toHaveBeenNthCalledWith(
        1,
        true,
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
      )
      expect(setContinuousListening).toHaveBeenNthCalledWith(2, false)
    } finally {
      coordinator.dispose()
    }
  })
})
