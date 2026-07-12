import assert from 'node:assert/strict'
import { AudioPlayer } from '../../src/renderer/audio/audioPlayer'
import { BacklogSelector } from '../../src/renderer/continuousListening/BacklogSelector'
import { ConversationAdmissionCoordinator } from '../../src/renderer/continuousListening/ConversationAdmissionCoordinator'
import { AttentionEngine } from '../../src/renderer/continuousListening/AttentionEngine'
import { RuleGate } from '../../src/renderer/continuousListening/RuleGate'
import { UtteranceBacklog } from '../../src/renderer/continuousListening/UtteranceBacklog'
import { UtteranceChunkBuilder } from '../../src/renderer/continuousListening/UtteranceChunkBuilder'
import type { BufferedUtterance, ConversationInput } from '../../src/renderer/continuousListening/types'

let now = Date.now()
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const deferred = <T = void>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>((done) => { resolve = done }), resolve }
}
const input = (id: string, source: ConversationInput['source'] = 'continuous_listening'): ConversationInput => ({
  turnId: id, text: id, source, createdAt: now, streamingSessionId: source === 'continuous_listening' ? 's1' : undefined
})
const completed = (turnId: string) => ({
  status: 'completed' as const, turnId, playbackCompleted: true as const, cleanupCompleted: true as const
})
const item = (id: string, priorityClass: BufferedUtterance['priorityClass'], score = 50): BufferedUtterance => ({
  id,
  text: id,
  createdAt: now++,
  expiresAt: now + 30_000,
  streamingSessionId: 's1',
  segmentId: id,
  directAddress: priorityClass === 'P0' || priorityClass === 'P1' || priorityClass === 'P2',
  question: priorityClass === 'P1',
  correctionHint: priorityClass === 'P0',
  followUpHint: priorityClass === 'P2',
  attentionScore: score,
  attentionMode: 'streamer',
  capturedWhileShioBusy: true,
  capturedDuringPlayback: false,
  likelySelfEcho: false,
  priorityClass
})
const disabledLlm = { enabled: false, providerId: '', model: '', timeoutMs: 2_000, minimumConfidence: 0.72 }
const enabledLlm = { enabled: true, providerId: 'groq', model: 'cheap', timeoutMs: 2_000, minimumConfidence: 0.72 }

async function main(): Promise<void> {
  // Stable session + segment identity filters replayed ASR finals before attention.
  const builder = new UtteranceChunkBuilder({ now: () => now })
  const first = builder.pushFinal('Шио, ты тут?', 0.9, {
    streamingSessionId: 'session', segmentId: 'segment', capturedDuringPlayback: false
  })
  assert.equal(first?.id, 'session:segment')
  assert.equal(builder.pushFinal('Шио, ты тут?', 0.9, {
    streamingSessionId: 'session', segmentId: 'segment', capturedDuringPlayback: false
  }), null)

  const engine = new AttentionEngine()
  const gate = new RuleGate()
  const attention = engine.evaluate(first!, {
    mode: 'passive', isSpeaking: true, cooldownActive: false,
    recentConversation: false, followUpWindow: false, curiosityChance: 0
  })
  assert.equal(attention.shouldAttend, true)
  assert.equal(gate.decide(first!, attention, {
    isSpeaking: true, conversationBusy: true, cooldownActive: false, alreadyHandled: false
  }).type, 'backlog')

  // Bounded backlog rejects ids, self-echo and lower-priority overflow.
  const bounded = new UtteranceBacklog()
  assert.equal(bounded.enqueue(item('same', 'P1')), true)
  assert.equal(bounded.enqueue(item('same', 'P1')), false)
  assert.equal(bounded.enqueue({ ...item('echo', 'P3'), likelySelfEcho: true }), false)
  for (let index = 0; index < 15; index += 1) bounded.enqueue(item(`weak-${index}`, 'P4'))
  assert.ok(bounded.size() <= 10)
  assert.equal(bounded.has('same'), true)

  // Normal chat never invokes semantic arbitration, even when configured.
  {
    let arbitrationCalls = 0
    const backlog = new UtteranceBacklog()
    const selector = new BacklogSelector(async () => {
      arbitrationCalls += 1
      throw new Error('must not run')
    })
    const starts: string[] = []
    const coordinator = new ConversationAdmissionCoordinator(async (value) => {
      starts.push(value.source)
      return completed(value.turnId)
    }, backlog, selector)
    coordinator.configureSelector(enabledLlm)
    coordinator.setContinuousEnabled(false)
    await coordinator.admit(input('chat', 'text_chat'))
    assert.deepEqual(starts, ['text_chat'])
    assert.equal(arbitrationCalls, 0)
  }

  // Three delayed busy phrases produce at most one successor; P0 wins.
  {
    const release = deferred<void>()
    const starts: string[] = []
    let active = 0
    let maxActive = 0
    const backlog = new UtteranceBacklog()
    const selector = new BacklogSelector()
    const coordinator = new ConversationAdmissionCoordinator(async (value) => {
      starts.push(value.text)
      active += 1
      maxActive = Math.max(maxActive, active)
      if (value.text === 'initial') await release.promise
      active -= 1
      return completed(value.turnId)
    }, backlog, selector)
    coordinator.configureSelector(disabledLlm)
    coordinator.setContinuousEnabled(true)
    const running = coordinator.admit(input('initial'))
    await flush()
    await coordinator.admit(input('background'), item('background', 'P3'))
    await coordinator.admit(input('question'), item('question', 'P1', 80))
    await coordinator.admit(input('correction'), item('correction', 'P0', 90))
    release.resolve()
    await running
    assert.deepEqual(starts, ['initial', 'correction'])
    assert.equal(maxActive, 1)
  }

  // A late LLM result cannot consume against a changed backlog version.
  {
    const result = deferred<{
      action: 'select'; selectedIds: string[]; text: string; reason: string; confidence: number; backlogVersion: number
    }>()
    const backlog = new UtteranceBacklog()
    backlog.enqueue(item('a', 'P3', 50))
    backlog.enqueue(item('b', 'P3', 50))
    const version = backlog.getVersion()
    const selector = new BacklogSelector(() => result.promise)
    const pending = selector.select(backlog, { continuousEnabled: true, llm: enabledLlm })
    backlog.enqueue(item('c', 'P2', 90))
    result.resolve({ action: 'select', selectedIds: ['a'], text: 'a', reason: 'late', confidence: 1, backlogVersion: version })
    const selection = await pending
    assert.notEqual(selection.reason, 'late')
    assert.equal(selection.backlogVersion, backlog.getVersion())
  }

  // Model error deterministically falls back without deadlock.
  {
    const backlog = new UtteranceBacklog()
    backlog.enqueue(item('x', 'P3', 50))
    backlog.enqueue(item('y', 'P3', 55))
    const selector = new BacklogSelector(async () => { throw new Error('429') })
    const selection = await selector.select(backlog, { continuousEnabled: true, llm: enabledLlm })
    assert.equal(selection.text, 'y')
    assert.equal(selection.reason, 'llm_error_fallback')
  }

  // Timeout and synchronous throws release the arbitration slot.
  {
    const backlog = new UtteranceBacklog()
    backlog.enqueue(item('timeout-a', 'P3', 50))
    backlog.enqueue(item('timeout-b', 'P3', 50))
    let calls = 0
    const selector = new BacklogSelector(() => {
      calls += 1
      if (calls === 1) return new Promise(() => undefined)
      return Promise.resolve({
        action: 'select', selectedIds: ['timeout-a'], text: 'selected', reason: 'second_arbitration',
        confidence: 1, backlogVersion: backlog.getVersion()
      })
    })
    const shortTimeout = { ...enabledLlm, timeoutMs: 5 }
    assert.equal((await selector.select(backlog, { continuousEnabled: true, llm: shortTimeout })).reason, 'llm_error_fallback')
    assert.equal((await selector.select(backlog, { continuousEnabled: true, llm: shortTimeout })).reason, 'second_arbitration')
    assert.equal(calls, 2)

    const throwingSelector = new BacklogSelector(() => { throw new Error('sync') })
    assert.equal((await throwingSelector.select(backlog, { continuousEnabled: true, llm: enabledLlm })).reason, 'llm_error_fallback')
    assert.equal((await throwingSelector.select(backlog, { continuousEnabled: true, llm: enabledLlm })).reason, 'llm_error_fallback')
  }

  // Invalid action/id combinations deterministically fall back.
  {
    const backlog = new UtteranceBacklog()
    backlog.enqueue(item('valid-a', 'P3', 50))
    backlog.enqueue(item('valid-b', 'P3', 50))
    const invalidResults = [
      { action: 'select' as const, selectedIds: ['missing'], text: 'bad' },
      { action: 'select' as const, selectedIds: ['valid-a', 'valid-b'], text: 'bad' },
      { action: 'merge' as const, selectedIds: ['valid-a'], text: 'bad' },
      { action: 'discard_all' as const, selectedIds: ['valid-a'] }
    ]
    for (const invalid of invalidResults) {
      const selector = new BacklogSelector(async (_items, version) => ({
        ...invalid, reason: 'invalid', confidence: 1, backlogVersion: version
      }))
      assert.equal(
        (await selector.select(backlog, { continuousEnabled: true, llm: enabledLlm })).reason,
        'low_confidence_or_schema_fallback'
      )
    }
  }

  // Disabling streaming clears backlog and prevents a pending successor.
  {
    const release = deferred<void>()
    const starts: string[] = []
    const backlog = new UtteranceBacklog()
    const coordinator = new ConversationAdmissionCoordinator(async (value) => {
      starts.push(value.text)
      await release.promise
      return completed(value.turnId)
    }, backlog, new BacklogSelector())
    coordinator.setContinuousEnabled(true)
    const running = coordinator.admit(input('initial'))
    await flush()
    await coordinator.admit(input('queued'), item('queued', 'P0'))
    coordinator.setContinuousEnabled(false)
    release.resolve()
    await running
    assert.deepEqual(starts, ['initial'])
    assert.equal(backlog.size(), 0)
  }

  // AudioPlayer's promise ends on onended and a second playback is rejected.
  {
    class FakeSource {
      buffer: unknown
      onended: (() => void) | null = null
      connect(): void {}
      disconnect(): void {}
      start(): void {}
      stop(): void {}
    }
    class FakeAudioContext {
      state = 'running'
      currentTime = 0
      source: FakeSource | null = null
      destination = {}
      createAnalyser(): { fftSize: number; connect: () => void } { return { fftSize: 0, connect: () => undefined } }
      createBufferSource(): FakeSource { return (this.source = new FakeSource()) }
      async decodeAudioData(): Promise<{ duration: number }> { return { duration: 1 } }
      async resume(): Promise<void> {}
    }
    const context = new FakeAudioContext()
    ;(globalThis as unknown as { AudioContext: new () => FakeAudioContext }).AudioContext = class {
      constructor() { return context }
    } as unknown as new () => FakeAudioContext
    ;(globalThis as unknown as { window: unknown }).window = { setInterval: () => 1, clearInterval: () => undefined }
    const player = new AudioPlayer()
    const playback = player.play(new ArrayBuffer(8), { turnId: 'turn-a', onReady: () => undefined })
    await flush()
    await assert.rejects(
      player.play(new ArrayBuffer(8), { turnId: 'turn-b', onReady: () => undefined }),
      /activeTurnId=turn-a requestedTurnId=turn-b/
    )
    context.source?.onended?.()
    await playback
    assert.equal(player.isBusy(), false)
  }

  console.log('Continuous listening repro: PASS')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
