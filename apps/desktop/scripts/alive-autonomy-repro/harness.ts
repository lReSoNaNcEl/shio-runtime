import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { AliveStore } from '../../src/main/alive/AliveStore'
import { AutonomyEnvelope } from '../../src/main/alive/AutonomyEnvelope'
import { CharacterToolLoop } from '../../src/main/character-tools/CharacterToolLoop'
import { runChatCompletionStream } from '../../src/main/llm/openai-compatible/stream'
import { StreamingSpeechPipeline } from '../../src/renderer/runtime/StreamingSpeechPipeline'
import {
  type CharacterStreamEvent,
  SafeCharacterStreamFilter,
  StreamingSpeechSegmenter,
} from '../../src/shared/character-stream'
import { LatencyTelemetry } from '../../src/shared/latency'

async function testSafeStreamFilter(): Promise<void> {
  const filter = new SafeCharacterStreamFilter()
  const output = [
    ...filter.push('[wa'),
    ...filter.push('rm]Привет <shio-to'),
    ...filter.push('ols>{"calls":[]}'),
    ...filter.push('</shio-tools> мир.'),
    ...filter.flush(),
  ]
  assert.equal(output.map((item) => item.text).join(''), 'Привет  мир.')
  assert.ok(output.every((item) => item.emotion === 'warm'))
  assert.doesNotMatch(JSON.stringify(output), /shio-tools|calls/u)
}

async function testSentenceSegmentation(): Promise<void> {
  const segmenter = new StreamingSpeechSegmenter('turn-segment')
  const segments = [
    ...segmenter.push({
      emotion: 'calm',
      text: 'Первое предложение. Ссылка [пример](https://example.com/a.b) готова. ```ts\nconst x = 1.\n``` Финал.',
    }),
    ...segmenter.flush(),
  ]
  assert.deepEqual(
    segments.map((segment) => segment.text),
    ['Первое предложение.', 'Ссылка [пример] готова.', 'Финал.'],
  )
  assert.ok(segments.every((segment, index) => segment.sequence === index))
}

async function testSseAndDeadlines(): Promise<void> {
  const stream = Readable.from([
    'data: {"choices":[{"delta":{"content":"[warm]Hi"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":4}}\n\n',
    'data: [DONE]\n\n',
  ])
  const config = {
    provider: 'groq',
    displayName: 'Groq',
    http: { post: async () => ({ data: stream }) },
    chatPath: '/chat',
    apiKey: 'secret',
    model: 'test',
    capabilities: {
      supportsReasoning: false,
      supportsStreaming: true,
      supportsTemperature: true,
      supportsSystemPrompt: true,
      supportsToolCalling: true,
      supportsVision: false,
      recommendedMaxTokens: 100,
    },
    messages: [{ role: 'user', content: 'hello' }],
  } as never
  const events: CharacterStreamEvent[] = []
  for await (const event of runChatCompletionStream(config, { traceId: 'sse-normal' })) {
    events.push(event)
  }
  assert.ok(events.some((event) => event.type === 'connected'))
  assert.ok(events.some((event) => event.type === 'first-byte'))
  assert.equal(
    events
      .filter((event) => event.type === 'text-delta')
      .map((event) => event.text)
      .join(''),
    '[warm]Hi',
  )
  assert.equal(events.at(-1)?.type, 'completed')

  let destroyed = false
  const stalled = {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => undefined) }),
    destroy: () => {
      destroyed = true
    },
  }
  const stalledConfig = {
    ...config,
    http: { post: async () => ({ data: stalled }) },
  } as never
  await assert.rejects(
    async () => {
      for await (const _event of runChatCompletionStream(stalledConfig, {
        traceId: 'sse-timeout',
        deadlines: { connectionMs: 20, firstByteMs: 10, idleMs: 10, totalMs: 100 },
      })) {
        // no-op
      }
    },
    (error: unknown) => (error as { code?: string }).code === 'TIMEOUT',
  )
  assert.equal(destroyed, true)

  let cancelledDestroyed = false
  let nextCall = 0
  const cancellable = {
    [Symbol.asyncIterator]: () => ({
      next: () => {
        nextCall += 1
        if (nextCall === 1) {
          return Promise.resolve({
            done: false,
            value: Buffer.from('data: {"choices":[{"delta":{"content":"visible"}}]}\n\n'),
          })
        }
        return new Promise<never>(() => undefined)
      },
    }),
    destroy: () => {
      cancelledDestroyed = true
    },
  }
  const controller = new AbortController()
  const delivered: string[] = []
  await assert.rejects(
    async () => {
      for await (const event of runChatCompletionStream(
        { ...config, http: { post: async () => ({ data: cancellable }) } } as never,
        { traceId: 'sse-cancel', signal: controller.signal },
      )) {
        if (event.type === 'text-delta') {
          delivered.push(event.text)
          controller.abort()
        }
      }
    },
    (error: unknown) => (error as { code?: string }).code === 'CANCELLED',
  )
  assert.deepEqual(delivered, ['visible'])
  assert.equal(cancelledDestroyed, true)
}

async function testToolRoundContainment(): Promise<void> {
  let streamRound = 0
  const llm = {
    capabilities: () => ({
      supportsReasoning: false,
      supportsStreaming: true,
      supportsTemperature: true,
      supportsSystemPrompt: true,
      supportsToolCalling: true,
      supportsVision: false,
      recommendedMaxTokens: 100,
    }),
    complete: async () => ({ content: '', toolCalls: [], finishReason: 'stop' }),
    chat: async () => '',
    stream: async function* (): AsyncGenerator<CharacterStreamEvent> {
      if (streamRound++ === 0) {
        yield { type: 'connected', at: 1 }
        yield { type: 'tool-call-start', at: 2, index: 0, id: 'call-1', name: 'project_search' }
        yield {
          type: 'tool-call-complete',
          at: 3,
          index: 0,
          call: { id: 'call-1', name: 'project_search', argumentsJson: '{"query":"x"}' },
        }
        yield { type: 'completed', at: 4, finishReason: 'tool_calls' }
        return
      }
      yield { type: 'connected', at: 5 }
      yield { type: 'first-byte', at: 6 }
      yield { type: 'text-delta', at: 7, text: '[calm]Готово.' }
      yield { type: 'completed', at: 8, finishReason: 'stop' }
    },
  }
  const events: Array<{ type: string; text?: string }> = []
  const registry = {
    definitions: () => [{ id: 'project.search' }],
    nativeDefinitions: () => [{ name: 'project_search' }],
    fromNativeName: (name: string) => (name === 'project_search' ? { id: 'project.search' } : null),
  }
  const dispatcher = {
    execute: async () => ({ content: '{"ok":true}' }),
    dispose: () => undefined,
  }
  const result = await new CharacterToolLoop().run({
    llm,
    providerId: 'groq',
    messages: [{ role: 'user', content: 'test' }],
    registry: () => registry,
    createDispatcher: () => dispatcher,
    traceId: 'tool-stream',
    requestOptions: {},
    nativeToolsRejected: false,
    failureReply: 'failed',
    limitReply: 'limit',
    onStreamEvent: (event) =>
      events.push({
        type: event.type,
        text: event.type === 'text-delta' ? event.delta.text : undefined,
      }),
  } as never)
  assert.equal(result.replyText, '[calm]Готово.')
  assert.deepEqual(
    events.filter((event) => event.text).map((event) => event.text),
    ['Готово.'],
  )
  assert.ok(events.some((event) => event.type === 'tool-round-started'))
  assert.ok(events.some((event) => event.type === 'tool-round-completed'))
}

async function testStreamingSpeechQueue(): Promise<void> {
  const order: string[] = []
  const pipeline = new StreamingSpeechPipeline({
    turnId: 'queue-turn',
    synthesize: async (segment) => {
      order.push(`synthesize:${segment.index}`)
      return { ok: true, audioBuffer: new ArrayBuffer(1), emotionKey: segment.emotion } as never
    },
    prepareAudio: async () => ({ durationMs: 10 }) as never,
    playPrepared: async (item, onStarted) => {
      onStarted()
      order.push(`play:${item.segment.index}`)
    },
    isCurrentTurn: () => true,
  })
  const execution = pipeline.execute()
  for (const index of [0, 1, 2]) {
    pipeline.enqueue({
      id: `segment-${index}`,
      index,
      emotion: 'calm',
      text: `segment ${index}`,
      boundaryAfter: 'sentence',
      targetMaxGapMs: 100,
    })
  }
  pipeline.close()
  await execution
  assert.deepEqual(
    order.filter((item) => item.startsWith('play')),
    ['play:0', 'play:1', 'play:2'],
  )
  assert.ok(order.indexOf('play:0') < order.indexOf('synthesize:2'))

  const failed = new StreamingSpeechPipeline({
    turnId: 'queue-failure',
    synthesize: async (segment) =>
      ({ ok: true, audioBuffer: new ArrayBuffer(1), emotionKey: segment.emotion }) as never,
    prepareAudio: async () => ({ durationMs: 10 }) as never,
    playPrepared: async () => {
      throw new Error('PLAYBACK_FAILED')
    },
    isCurrentTurn: () => true,
  })
  const failedExecution = failed.execute()
  failed.enqueue({
    id: 'failed-segment',
    index: 0,
    emotion: 'calm',
    text: 'failure',
    boundaryAfter: 'sentence',
    targetMaxGapMs: 100,
  })
  failed.close()
  await assert.rejects(failedExecution, /PLAYBACK_FAILED/u)
}

async function testPersistenceAndEnvelope(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'shio-alive-'))
  const databasePath = join(directory, 'alive.sqlite')
  try {
    const store = new AliveStore(databasePath)
    const goal = store.createGoal({ title: 'Ship' })
    const task = store.createTask({ title: 'Check', kind: 'check_in', dueAt: 100 })
    assert.equal(store.claimTaskRun(task, `${task.id}:100`, 200), true)
    assert.equal(store.claimTaskRun(task, `${task.id}:100`, 200), false)
    store.observeHabit('repeat', 'Repeat')
    store.observeHabit('repeat', 'Repeat')
    store.observeHabit('repeat', 'Repeat')
    assert.equal(store.habits()[0]?.evidenceCount, 3)
    store.close()

    const reopened = new AliveStore(databasePath)
    assert.equal(reopened.goals()[0]?.id, goal.id)
    assert.equal(reopened.version(), 1)
    reopened.close()

    const envelope = new AutonomyEnvelope()
    const settings = {
      mode: 'full' as const,
      globallySuspended: true,
      privacyMode: false,
      quietHours: { enabled: false, startHour: 22, endHour: 8 },
      cooldownMs: 60_000,
      maxDailyInitiatives: 2,
      fastBrain: { enabled: false, timeoutMs: 1_000, maxTokens: 64 },
    }
    const world = {
      capturedAt: 1,
      appFocused: true,
      userIdleMs: 0,
      conversationActive: false,
      audioActive: false,
      privacyMode: false,
      lastUserActivityAt: 1,
      freshness: { rendererMs: 0, schedulerMs: 0 },
    }
    const baseInput = {
      task,
      settings,
      world,
      now: 1_000,
      dailyInitiatives: 0,
      lastInitiativeAt: null,
    }
    const decision = envelope.decide(baseInput)
    assert.equal(decision.outcome, 'defer')
    assert.equal(decision.outcome === 'defer' ? decision.reason : '', 'suspended')
    const activeSettings = { ...settings, globallySuspended: false }
    assert.equal(
      envelope.decide({ ...baseInput, settings: { ...activeSettings, privacyMode: true } }).outcome,
      'defer',
    )
    assert.equal(
      envelope.decide({
        ...baseInput,
        settings: { ...activeSettings, quietHours: { enabled: true, startHour: 22, endHour: 8 } },
        now: new Date(2026, 0, 1, 23).getTime(),
      }).outcome,
      'defer',
    )
    assert.equal(
      envelope.decide({
        ...baseInput,
        settings: activeSettings,
        world: { ...world, audioActive: true },
      }).outcome,
      'defer',
    )
    assert.equal(
      envelope.decide({
        ...baseInput,
        settings: activeSettings,
        lastInitiativeAt: baseInput.now - 1_000,
      }).outcome,
      'defer',
    )
    assert.equal(
      envelope.decide({
        ...baseInput,
        settings: activeSettings,
        dailyInitiatives: activeSettings.maxDailyInitiatives,
      }).outcome,
      'defer',
    )
    assert.equal(
      envelope.decide({ ...baseInput, settings: { ...activeSettings, mode: 'suggest' } }).outcome,
      'preview',
    )
    assert.equal(
      envelope.decide({ ...baseInput, settings: { ...activeSettings, mode: 'confirm' } }).outcome,
      'preview',
    )
    assert.equal(envelope.decide({ ...baseInput, settings: activeSettings }).outcome, 'execute')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

async function testLatencyAggregation(): Promise<void> {
  const telemetry = new LatencyTelemetry()
  for (const [index, duration] of [100, 200, 300].entries()) {
    const turnId = `latency-${index}`
    const correlation = { turnId, requestId: `request:${turnId}`, llmRound: 0 }
    telemetry.record({ name: 'input_received', at: 1_000, correlation })
    telemetry.record({ name: 'playback_started', at: 1_000 + duration, correlation })
    telemetry.record({
      name: 'turn_terminal',
      at: 1_100 + duration,
      correlation,
      status: 'success',
    })
  }
  assert.deepEqual(telemetry.snapshot().metrics.timeToPlayback, {
    count: 3,
    p50Ms: 200,
    p95Ms: 300,
    maxMs: 300,
  })
}

async function main(): Promise<void> {
  await testSafeStreamFilter()
  await testSentenceSegmentation()
  await testSseAndDeadlines()
  await testToolRoundContainment()
  await testStreamingSpeechQueue()
  await testPersistenceAndEnvelope()
  await testLatencyAggregation()
  console.log('Alive & Autonomous repro passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
