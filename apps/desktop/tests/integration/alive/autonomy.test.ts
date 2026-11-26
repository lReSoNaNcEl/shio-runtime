import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, it, vi } from 'vitest'

import { AliveRuntime } from '../../../src/main/alive/AliveRuntime'
import { AliveStore } from '../../../src/main/alive/AliveStore'
import { AutonomyEnvelope } from '../../../src/main/alive/AutonomyEnvelope'
import {
  CharacterToolLoop,
  type CharacterToolLoopStreamEvent,
} from '../../../src/main/character-tools/CharacterToolLoop'
import {
  type CharacterStreamEvent,
  SafeCharacterStreamFilter,
  SpeechTextCommitBuffer,
} from '../../../src/shared/character-stream'
import { LatencyTelemetry } from '../../../src/shared/latency'
import { runChatCompletionStream } from '../../support/llm/wireFixture'

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
  const commits = new SpeechTextCommitBuffer('turn-segment')
  const segments = [
    ...commits.push({
      emotion: 'calm',
      text: 'Первое предложение. Ссылка [пример](https://example.com/a.b) готова. ```ts\nconst x = 1.\n``` Финал.',
    }),
    ...commits.flush(),
  ]
  assert.deepEqual(
    segments.map((segment) => segment.text),
    ['Первое предложение.', 'Ссылка [пример] готова.', 'Финал.'],
  )
  assert.ok(segments.every((segment, index) => segment.sequence === index))
}

async function testSseAndDeadlines(): Promise<void> {
  const stream = {
    controller: new AbortController(),
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: '[warm]Hi' }, finish_reason: null }] }
      yield {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { total_tokens: 4 },
      }
    },
  }
  const config = {
    provider: 'groq',
    displayName: 'Groq',
    client: { chat: { completions: { create: async () => stream } } },
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
  }
  const events: CharacterStreamEvent[] = []
  for await (const event of runChatCompletionStream(config as never, { traceId: 'sse-normal' })) {
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

  const stalledController = new AbortController()
  const stalled = {
    controller: stalledController,
    [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => undefined) }),
  }
  const stalledConfig = {
    ...config,
    client: { chat: { completions: { create: async () => stalled } } },
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
  assert.equal(stalledController.signal.aborted, true)

  const cancellableController = new AbortController()
  let nextCall = 0
  const cancellable = {
    controller: cancellableController,
    [Symbol.asyncIterator]: () => ({
      next: () => {
        nextCall += 1
        if (nextCall === 1) {
          return Promise.resolve({
            done: false,
            value: { choices: [{ delta: { content: 'visible' }, finish_reason: null }] },
          })
        }
        return new Promise<never>(() => undefined)
      },
    }),
  }
  const controller = new AbortController()
  const delivered: string[] = []
  await assert.rejects(
    async () => {
      for await (const event of runChatCompletionStream(
        {
          ...config,
          client: { chat: { completions: { create: async () => cancellable } } },
        } as never,
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
  assert.equal(cancellableController.signal.aborted, true)
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
    onStreamEvent: (event: CharacterToolLoopStreamEvent) =>
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
  const commits = new SpeechTextCommitBuffer('queue-turn')
  const output = [
    ...commits.push({ emotion: 'calm', text: 'Первый стабильный фрагмент речи. ' }),
    ...commits.push({ emotion: 'warm', text: 'Второй стабильный фрагмент речи. ' }),
    ...commits.push({ emotion: 'warm', text: 'Третий стабильный фрагмент речи.' }),
    ...commits.flush(),
  ]
  assert.deepEqual(
    output.map((item) => `${item.sequence}:${item.emotion}`),
    ['0:calm', '1:warm', '2:warm'],
  )
  assert.ok(output.every((item) => item.turnId === 'queue-turn'))

  const cancelled = new SpeechTextCommitBuffer('cancelled-turn')
  cancelled.push({ emotion: 'calm', text: 'Незавершённый фрагмент' })
  cancelled.cancel()
  assert.deepEqual(cancelled.flush(), [])
}

async function testPersistenceAndEnvelope(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'shio-alive-'))
  const databasePath = join(directory, 'alive.sqlite')
  try {
    const store = new AliveStore(databasePath)
    store.saveSettings({ ...store.settings(), privacyMode: true })
    store.close()

    const legacy = new DatabaseSync(databasePath)
    legacy.prepare("UPDATE alive_settings SET value = ? WHERE key = 'autonomy'").run(
      JSON.stringify({
        mode: 'confirm',
        globallySuspended: true,
        privacyMode: true,
        quietHours: { enabled: true, startHour: 22, endHour: 8 },
        cooldownMs: 900_000,
        maxDailyInitiatives: 0,
      }),
    )
    legacy.close()

    const reopened = new AliveStore(databasePath)
    assert.equal(reopened.version(), 7)
    const expected = { mode: 'confirm', globallySuspended: true, privacyMode: true }
    assert.deepEqual(reopened.settings(), expected)
    reopened.close()

    const persisted = new DatabaseSync(databasePath)
    try {
      const row = persisted.prepare("SELECT value FROM alive_settings WHERE key = 'autonomy'").get()
      assert.deepEqual(JSON.parse(String(row?.value)), expected)
    } finally {
      persisted.close()
    }

    const envelope = new AutonomyEnvelope()
    const settings = {
      mode: 'full' as const,
      globallySuspended: true,
      privacyMode: false,
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
      freshness: { rendererMs: 0, systemMs: 0 },
    }
    const baseInput = {
      settings,
      world,
      now: 1_000,
    }
    const decision = envelope.decide(baseInput)
    assert.equal(decision.outcome, 'defer')
    assert.equal(decision.outcome === 'defer' ? decision.reason : '', 'suspended')
    const activeSettings = { ...settings, globallySuspended: false }
    assert.equal(
      envelope.decide({ ...baseInput, settings: { ...activeSettings, privacyMode: true } }).outcome,
      'defer',
    )
    const viewing = {
      ...baseInput,
      confirmedWatchSession: true,
      settings: { ...activeSettings, privacyMode: true },
      now: 61_000,
    }
    assert.equal(envelope.decide(viewing).outcome, 'execute')
    assert.equal(
      envelope.decide({ ...viewing, settings: { ...viewing.settings, globallySuspended: true } })
        .outcome,
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

function testGoalSchemaMigration(version: number): void {
  const directory = mkdtempSync(join(tmpdir(), 'shio-goal-migration-'))
  const databasePath = join(directory, 'alive.sqlite')
  try {
    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      CREATE TABLE alive_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE alive_audit (id INTEGER PRIMARY KEY, at INTEGER, category TEXT, event TEXT, entity_id TEXT, outcome TEXT, detail TEXT);
      CREATE TABLE alive_tasks (id TEXT PRIMARY KEY, title TEXT, next_run_at INTEGER, status TEXT);
      INSERT INTO alive_tasks VALUES ('due','Legacy reminder',0,'scheduled');
      CREATE TABLE alive_goals (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
        status TEXT NOT NULL, progress REAL NOT NULL, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO alive_goals VALUES ('legacy-goal', 'Старая цель', '', 'active', 0, 1, 1);
      INSERT INTO alive_settings VALUES ('autonomy', '{"privacyMode":true,"fastBrain":{"enabled":true}}');
      INSERT INTO alive_settings VALUES ('mood', '{"curiosity":0.7}');
      INSERT INTO alive_audit (id, at, category, event, outcome)
        VALUES (1, 100, 'behavior', 'initiative', 'selected');
      CREATE TABLE alive_task_runs (task_id TEXT REFERENCES alive_tasks(id) ON DELETE CASCADE);
      CREATE TABLE alive_goal_executions (goal_id TEXT REFERENCES alive_goals(id) ON DELETE CASCADE);
      CREATE TABLE alive_goal_watches (goal_id TEXT REFERENCES alive_goals(id) ON DELETE CASCADE);
      CREATE TABLE alive_autonomy_scopes (goal_id TEXT REFERENCES alive_goals(id) ON DELETE CASCADE);
      INSERT INTO alive_task_runs VALUES ('due');
      INSERT INTO alive_goal_executions VALUES ('legacy-goal');
      INSERT INTO alive_goal_watches VALUES ('legacy-goal');
      INSERT INTO alive_autonomy_scopes VALUES ('legacy-goal');
      PRAGMA user_version = ${version};
    `)
    legacy.close()
    const migrated = new AliveStore(databasePath)
    const runtime = new AliveRuntime(migrated)
    const events: unknown[] = []
    runtime.onBehavior((event) => events.push(event))
    runtime.start()
    try {
      const auditReads = vi.spyOn(migrated, 'recentAudit')
      const snapshot = runtime.snapshot()
      assert.equal(snapshot.health.operational, true)
      assert.equal(snapshot.settings.privacyMode, true)
      assert.equal('fastBrain' in snapshot.settings, false)
      assert.equal(migrated.mood().curiosity, 0.7)
      assert.equal('audit' in snapshot, false)
      assert.equal(auditReads.mock.calls.length, 0)
      assert.equal(runtime.recentAudit()[0]?.event, 'initiative')
      assert.equal(auditReads.mock.calls.length, 1)
      assert.doesNotMatch(JSON.stringify(snapshot), /Legacy reminder|Старая цель/u)
      assert.deepEqual(events, [])
    } finally {
      runtime.dispose()
    }
    const archived = new DatabaseSync(databasePath)
    try {
      assert.deepEqual(
        archived
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
          .all()
          .map((row) => row.name),
        ['alive_audit', 'alive_settings'],
      )
      assert.equal(archived.prepare('PRAGMA user_version').get()?.user_version, 7)
    } finally {
      archived.close()
    }
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

describe('Alive and Autonomy integration', () => {
  it('filters streamed protocol data before presentation', testSafeStreamFilter)
  it('segments streaming speech in deterministic order', testSentenceSegmentation)
  it('enforces SSE and provider deadlines', testSseAndDeadlines)
  it('contains tool-first rounds before user-visible output', testToolRoundContainment)
  it('bounds and orders the streaming speech queue', testStreamingSpeechQueue)
  it('persists autonomy settings and enforces the envelope', testPersistenceAndEnvelope)
  it.each([1, 5, 6])('removes retired tables on upgrade from v%s', testGoalSchemaMigration)
  it('drops the retired habit table from a current Alive database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'shio-alive-legacy-habits-'))
    const databasePath = join(directory, 'alive.sqlite')
    try {
      const initial = new AliveStore(databasePath)
      const settings = initial.settings()
      initial.close()

      const legacy = new DatabaseSync(databasePath)
      try {
        legacy.exec('CREATE TABLE alive_habits (habit_key TEXT PRIMARY KEY)')
      } finally {
        legacy.close()
      }

      const reopened = new AliveStore(databasePath)
      try {
        assert.deepEqual(reopened.settings(), settings)
      } finally {
        reopened.close()
      }

      const cleaned = new DatabaseSync(databasePath, { readOnly: true })
      try {
        assert.equal(
          cleaned.prepare("SELECT name FROM sqlite_master WHERE name = 'alive_habits'").get(),
          undefined,
        )
      } finally {
        cleaned.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('aggregates bounded latency percentiles', testLatencyAggregation)
})
