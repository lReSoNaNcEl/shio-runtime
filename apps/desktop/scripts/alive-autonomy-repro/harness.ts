import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Readable } from 'node:stream'

import { AliveRuntime } from '../../src/main/alive/AliveRuntime'
import { AliveStore } from '../../src/main/alive/AliveStore'
import { AutonomyEnvelope } from '../../src/main/alive/AutonomyEnvelope'
import {
  goalAwarenessPrompt,
  unfinishedGoalSnapshot,
} from '../../src/main/character/prompting/GoalAwarenessPrompt'
import { CharacterToolDispatcher } from '../../src/main/character-tools/CharacterToolDispatcher'
import { CharacterToolLoop } from '../../src/main/character-tools/CharacterToolLoop'
import { CharacterToolRegistry } from '../../src/main/character-tools/CharacterToolRegistry'
import { runChatCompletionStream } from '../../src/main/llm/openai-compatible/stream'
import { createSemanticMemoryRuntime, MemoryToolBroker } from '../../src/main/memory'
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
    assert.deepEqual(store.legacyHabitRecords(), [])
    store.close()

    const reopened = new AliveStore(databasePath)
    assert.equal(reopened.goals()[0]?.id, goal.id)
    assert.equal(reopened.version(), 4)
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
      globalUserIdleMs: 0,
      userIdleMs: 0,
      conversationActive: false,
      audioActive: false,
      privacyMode: false,
      lastUserActivityAt: 1,
      systemAdapter: 'available' as const,
      freshness: { rendererMs: 0, schedulerMs: 0, systemMs: 0 },
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

async function testPersistentGoalTool(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'shio-goal-tool-'))
  try {
    const store = new AliveStore(join(directory, 'alive.sqlite'))
    const active = store.createGoal({ title: 'Найти фотки с котиками в браузере' })
    store.createGoal({ title: 'Paused goal' })
    const paused = store.goals().find((goal) => goal.title === 'Paused goal')
    assert.ok(paused)
    store.updateGoal({ id: paused.id, status: 'paused' })
    const runtime = new AliveRuntime(store, () => {
      throw new Error('Fast Brain is not used by this repro')
    })
    const awareness = goalAwarenessPrompt(runtime.snapshot().goals)
    assert.match(awareness, /Найти фотки с котиками в браузере/u)
    assert.doesNotMatch(awareness, /Paused goal/u)
    assert.match(awareness, /Other unfinished intentions: 1/u)
    assert.match(awareness, /Goal Awareness Context/u)
    assert.doesNotMatch(awareness, /progressPercent/u)
    const memoryRuntime = createSemanticMemoryRuntime(join(directory, 'memory.sqlite'))
    memoryRuntime.setEnabled(true)
    const memoryBroker = new MemoryToolBroker(memoryRuntime)

    const registry = new CharacterToolRegistry({
      projectAvailable: false,
      goalsAvailable: true,
      goalCreatesAvailable: true,
      goalUpdatesAvailable: true,
      capabilityContext: null,
      browserObservation: null,
      memory: memoryBroker,
      actionsAvailable: false,
    })
    assert.ok(registry.get('goal.create'))
    assert.ok(registry.get('goal.list'))
    assert.ok(registry.get('goal.update'))

    const dispatcher = new CharacterToolDispatcher({
      registry: () => registry,
      traceId: 'goal-tool-repro',
      userGoal: 'Какие у тебя сейчас цели?',
      signal: new AbortController().signal,
      semanticMemory: memoryBroker,
      persistentGoals: () => runtime.snapshot().goals,
      goalAwareness: unfinishedGoalSnapshot(runtime.snapshot().goals),
      createPersistentGoal: (input) => runtime.createGoalFromCharacter(input),
      revisePersistentGoal: (input) => runtime.reviseGoalFromCharacter(input),
    })
    const rejected = await dispatcher.execute('goal.update', {
      id: 'unknown-goal',
      status: 'paused',
    })
    assert.match(rejected.content, /GOAL_NOT_IN_TURN_CONTEXT/u)
    const userReported = await dispatcher.execute('goal.update', {
      id: active.id,
      status: 'waiting_user',
      lastNote: 'Пользователь выберет подходящий запрос',
      progressPercent: 25,
    })
    assert.equal(userReported.verifiedOutcome?.kind, 'goal.update')
    const revised = runtime.snapshot().goals.find((goal) => goal.id === active.id)
    assert.equal(revised?.progress, 0.25)
    assert.equal(revised?.measurable, true)
    assert.equal(revised?.status, 'waiting_user')
    const result = await dispatcher.execute('goal.list', { status: 'waiting_user' })
    const payload = JSON.parse(result.content) as {
      ok: boolean
      data: { source: string; count: number; goals: Array<{ id: string; title: string }> }
    }
    assert.equal(payload.ok, true)
    assert.equal(payload.data.source, 'persistent-goal-store')
    assert.equal(payload.data.count, 1)
    assert.equal(payload.data.goals[0]?.id, active.id)
    assert.equal(payload.data.goals[0]?.title, 'Найти фотки с котиками в браузере')
    assert.doesNotMatch(result.content, /Paused goal/u)
    const rejectedMemory = await dispatcher.execute('memory.store', {
      memories: [{ kind: 'fact', text: 'Goal is complete' }],
    })
    assert.match(rejectedMemory.content, /GOAL_DATA_CANNOT_AUTHORIZE_MEMORY_MUTATION/u)
    assert.equal(memoryRuntime.status().recordCount, 0)
    const createdResult = await dispatcher.execute('goal.create', {
      title: 'Вместе подготовить релиз',
      description: 'Хотим выпустить спокойную и понятную версию',
      nextStep: 'Обсудить критерии готовности',
      owner: 'shared',
    })
    assert.equal(createdResult.verifiedOutcome?.kind, 'goal.create')
    assert.ok(runtime.snapshot().goals.some((goal) => goal.title === 'Вместе подготовить релиз'))
    dispatcher.dispose()

    const actionRegistry = new CharacterToolRegistry({
      projectAvailable: false,
      goalsAvailable: true,
      goalUpdatesAvailable: true,
      capabilityContext: {
        schemaVersion: 1,
        generatedAt: 0,
        capabilities: [
          {
            id: 'browser-control',
            category: 'action',
            source: { kind: 'plugin', pluginId: 'desktop-control' },
            titleKey: 'capabilities.browser.title',
            descriptionKey: 'capabilities.browser.description',
            availability: 'available',
          },
        ],
      },
      browserObservation: null,
      actionsAvailable: true,
    })
    const actionDispatcher = new CharacterToolDispatcher({
      registry: () => actionRegistry,
      traceId: 'goal-action-tool-repro',
      userGoal: 'Начни выполнять цель сейчас',
      signal: new AbortController().signal,
      persistentGoals: () => runtime.snapshot().goals,
      goalAwareness: unfinishedGoalSnapshot(runtime.snapshot().goals),
      revisePersistentGoal: (input) => runtime.reviseGoalFromCharacter(input),
      executeDesktopWorkflow: async () => ({
        actionId: 'action-1-00000000-0000-4000-8000-000000000000',
        tool: 'desktop.workflow',
        outcome: 'success',
        authorization: 'full',
        execution: { runtimeCompleted: true, verification: 'verified' },
      }),
    })
    const action = await actionDispatcher.execute('browser.open', {
      url: 'https://www.bing.com/images/search?q=cats',
      goal: 'Найти фотки с котиками в браузере',
    })
    assert.match(action.content, /"ok":true/u)
    const updated = await actionDispatcher.execute('goal.update', {
      id: active.id,
      status: 'completed',
      lastNote: 'Проверенный поиск завершён',
    })
    assert.equal(updated.verifiedOutcome?.kind, 'goal.update')
    assert.match(updated.content, /"status":"completed"/u)
    assert.equal(runtime.snapshot().goals.find((goal) => goal.id === active.id)?.progress, 1)
    assert.equal(
      runtime.snapshot().goals.find((goal) => goal.id === active.id)?.status,
      'completed',
    )
    actionDispatcher.dispose()

    const unverifiedGoal = runtime
      .createGoal({ title: 'Goal with unverified work' })
      .goals.find((goal) => goal.title === 'Goal with unverified work')
    assert.ok(unverifiedGoal)
    const unverifiedDispatcher = new CharacterToolDispatcher({
      registry: () => actionRegistry,
      traceId: 'goal-unverified-action-repro',
      userGoal: 'Выполни цель',
      signal: new AbortController().signal,
      persistentGoals: () => runtime.snapshot().goals,
      goalAwareness: unfinishedGoalSnapshot(runtime.snapshot().goals),
      revisePersistentGoal: (input) => runtime.reviseGoalFromCharacter(input),
      executeDesktopWorkflow: async () => ({
        actionId: 'action-2-00000000-0000-4000-8000-000000000000',
        tool: 'desktop.workflow',
        outcome: 'success',
        authorization: 'full',
        execution: { runtimeCompleted: true, verification: 'unverified' },
      }),
    })
    await unverifiedDispatcher.execute('browser.open', {
      url: 'https://example.com',
      goal: unverifiedGoal.title,
    })
    const unverifiedUpdate = await unverifiedDispatcher.execute('goal.update', {
      id: unverifiedGoal.id,
      status: 'completed',
    })
    assert.match(unverifiedUpdate.content, /GOAL_UPDATE_REQUIRES_VERIFIED_ACTION/u)
    assert.equal(
      runtime.snapshot().goals.find((goal) => goal.id === unverifiedGoal.id)?.status,
      'active',
    )
    unverifiedDispatcher.dispose()
    memoryRuntime.close()
    runtime.dispose()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function testGoalSchemaMigration(): void {
  const directory = mkdtempSync(join(tmpdir(), 'shio-goal-migration-'))
  const databasePath = join(directory, 'alive.sqlite')
  try {
    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      CREATE TABLE alive_goals (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
        status TEXT NOT NULL, progress REAL NOT NULL, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO alive_goals VALUES ('legacy-goal', 'Старая цель', '', 'active', 0, 1, 1);
      PRAGMA user_version = 1;
    `)
    legacy.close()
    const migrated = new AliveStore(databasePath)
    const goal = migrated.goals()[0]
    assert.equal(migrated.version(), 4)
    assert.equal(goal?.owner, 'shared')
    assert.equal(goal?.nextStep, '')
    assert.equal(goal?.lastNote, '')
    assert.equal(goal?.measurable, false)
    migrated.close()
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

function testTasksLayoutUsesValidTokens(): void {
  const stylesheet = readFileSync(join(__dirname, '../src/renderer/styles/tasks.css'), 'utf8')
  const view = readFileSync(
    join(__dirname, '../src/renderer/components/views/TasksView.tsx'),
    'utf8',
  )
  assert.doesNotMatch(stylesheet, /--s2-(?:space|corner-radius)-/u)
  assert.match(stylesheet, /\.tasks-form-surface/u)
  assert.match(stylesheet, /\.tasks-create-actions/u)
  assert.match(stylesheet, /\.tasks-conversation-first/u)
  assert.match(view, /<Disclosure/u)
  assert.match(view, /goal\.measurable &&/u)
}

async function main(): Promise<void> {
  await testSafeStreamFilter()
  await testSentenceSegmentation()
  await testSseAndDeadlines()
  await testToolRoundContainment()
  await testStreamingSpeechQueue()
  await testPersistenceAndEnvelope()
  testGoalSchemaMigration()
  await testPersistentGoalTool()
  await testLatencyAggregation()
  testTasksLayoutUsesValidTokens()
  console.log('Alive & Autonomous repro passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
