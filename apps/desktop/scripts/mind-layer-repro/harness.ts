import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  AliveStore,
  AttentionArbiter,
  AutonomyEnvelope,
  BehaviorRuntime,
  ExperienceRuntime,
  FastBrainRuntime,
  MoodRuntime,
  ProactiveInitiativeGate,
} from '../../src/main/alive'
import type { AttentionCandidate, WorldContextSnapshot } from '../../src/shared/alive'
import type { GameSemanticEvent, GameSemanticEventType } from '../../src/shared/browser-game'

const world: WorldContextSnapshot = {
  capturedAt: 1,
  appFocused: true,
  globalUserIdleMs: 0,
  userIdleMs: 0,
  conversationActive: false,
  audioActive: false,
  privacyMode: false,
  lastUserActivityAt: 1,
  systemAdapter: 'available',
  freshness: { rendererMs: 0, schedulerMs: 0, systemMs: 0 },
}

const settings = {
  mode: 'full' as const,
  globallySuspended: false,
  privacyMode: false,
  quietHours: { enabled: false, startHour: 22, endHour: 8 },
  cooldownMs: 60_000,
  maxDailyInitiatives: 6,
  fastBrain: { enabled: true, timeoutMs: 1_000, maxTokens: 64 },
}

async function main(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'shio-mind-layer-'))
  let store: AliveStore | undefined
  try {
    store = new AliveStore(join(directory, 'alive.sqlite'))
    const persistMood = store.saveMood.bind(store)
    let moodWriteCount = 0
    store.saveMood = (mood) => {
      moodWriteCount += 1
      persistMood(mood)
    }
    const facts: string[] = []
    const behavior = new BehaviorRuntime()
    const experience = new ExperienceRuntime(store, new MoodRuntime(store), (fact) =>
      facts.push(fact.eventId),
    )
    const success = experience.observe({
      type: 'action-verified',
      actionId: 'a1',
      eventId: 'success',
      novelty: 0.1,
      at: 10,
    })
    const failure = experience.observe({
      type: 'action-failed',
      actionId: 'a2',
      eventId: 'failure',
      at: 20,
    })
    const successBehavior = behavior.decide({ ...success, settings, world, at: 10 })
    const failureBehavior = behavior.decide({ ...failure, settings, world, at: 20 })
    assert.equal(success.appraisal.silence, true)
    assert.equal(successBehavior.intent.kind, 'none')
    assert.equal(moodWriteCount, 2, 'each new Experience should persist Mood exactly once')
    assert.ok(failure.appraisal.salience > success.appraisal.salience)
    assert.ok(failure.appraisal.valence < success.appraisal.valence)
    assert.equal(failureBehavior.intent.kind, 'conversation-candidate')
    assert.ok(Object.values(failure.mood).every((value) => typeof value === 'number'))
    experience.observe({
      type: 'task-completed',
      taskId: crypto.randomUUID(),
      eventId: 'completed-once',
      at: 30,
    })
    assert.deepEqual(facts, ['success', 'completed-once'])
    assert.equal(moodWriteCount, 3, 'each new Experience should add one Mood write')
    const persistedBeforeSnapshot = store.mood()
    const decayed = experience.moodSnapshot(30 + 4 * 60 * 60_000)
    assert.ok(Math.abs(decayed.valence) < Math.abs(failure.mood.valence))
    assert.equal(moodWriteCount, 3, 'reading a projected Mood snapshot must not persist it')
    assert.deepEqual(store.mood(), persistedBeforeSnapshot)

    const lifeLost = experience.observe(gameEvent('life-lost', 31, 'ambient'))
    const lifeLostBehavior = behavior.decide({ ...lifeLost, settings, world, at: 31 })
    assert.equal(lifeLostBehavior.intent.kind, 'embodiment')
    assert.equal(lifeLostBehavior.embodimentPresence?.screenGazeActive, true)
    const levelCompleted = experience.observe(gameEvent('level-completed', 40, 'important'))
    const levelCompletedBehavior = behavior.decide({
      ...levelCompleted,
      settings,
      world,
      at: 40,
    })
    assert.equal(levelCompletedBehavior.intent.kind, 'conversation-candidate')
    const checkpointSuppressed = experience.observe(gameEvent('checkpoint', 41, 'normal'))
    const checkpointBehavior = behavior.decide({
      ...checkpointSuppressed,
      settings,
      world,
      at: 41,
    })
    assert.notEqual(checkpointBehavior.intent.kind, 'conversation-candidate')
    const newRecord = experience.observe(gameEvent('new-record', 42, 'important'))
    const newRecordBehavior = behavior.decide({ ...newRecord, settings, world, at: 42 })
    assert.equal(newRecordBehavior.intent.kind, 'conversation-candidate')
    const thirdCommentSuppressed = experience.observe(gameEvent('level-completed', 43, 'important'))
    const thirdCommentBehavior = behavior.decide({
      ...thirdCommentSuppressed,
      settings,
      world,
      at: 43,
    })
    assert.notEqual(thirdCommentBehavior.intent.kind, 'conversation-candidate')
    const waitingUser = experience.observe(gameEvent('waiting-user', 44, 'blocking'))
    const waitingUserBehavior = behavior.decide({ ...waitingUser, settings, world, at: 44 })
    assert.equal(waitingUserBehavior.intent.kind, 'conversation-candidate')
    assert.equal(waitingUserBehavior.embodimentPresence?.screenGazeActive, false)
    const userSpeechWins = experience.observe(gameEvent('waiting-user', 45, 'blocking'))
    const userSpeechBehavior = behavior.decide({
      ...userSpeechWins,
      settings,
      world: { ...world, conversationActive: true, audioActive: true },
      at: 45,
      conversationAllowed: false,
    })
    assert.notEqual(userSpeechBehavior.intent.kind, 'conversation-candidate')
    assert.equal(
      userSpeechBehavior.embodimentPresence?.screenGazeActive,
      false,
      'session gaze release must survive conversation suppression',
    )
    const resumed = experience.observe(gameEvent('game-resumed', 46, 'ambient'))
    const resumedBehavior = behavior.decide({ ...resumed, settings, world, at: 46 })
    assert.equal(resumedBehavior.embodimentPresence?.screenGazeActive, true)
    const paused = experience.observe(gameEvent('game-paused', 47, 'ambient'))
    const pausedBehavior = behavior.decide({ ...paused, settings, world, at: 47 })
    assert.equal(pausedBehavior.embodimentPresence?.screenGazeActive, false)
    const errored = experience.observe(gameEvent('game-error', 48, 'blocking'))
    const erroredBehavior = behavior.decide({
      ...errored,
      settings,
      world,
      at: 48,
      conversationAllowed: false,
    })
    assert.equal(erroredBehavior.embodimentPresence?.screenGazeActive, false)

    let modelCalls = 0
    let failModel = false
    const fastBrain = new FastBrainRuntime(
      () =>
        ({
          chat: async () => {
            modelCalls += 1
            if (failModel) throw new Error('FAST_BRAIN_DOWN')
            return JSON.stringify({
              disposition: 'admit',
              candidateId: 'speech',
              confidence: 0.8,
              reason: 'direct address',
            })
          },
        }) as never,
    )
    const arbiter = new AttentionArbiter(fastBrain)
    const candidates: AttentionCandidate[] = [
      candidate('speech', 'speech', 0.95, 0.8, 1),
      candidate('reminder', 'scheduler', 0.58, 0.45, 0.5),
      candidate('world', 'world', 0.2, 0.1, 0.1),
    ]
    const clear = await arbiter.decide(candidates, settings)
    assert.equal(clear.candidateId, 'speech')
    assert.equal(clear.source, 'deterministic')
    assert.equal(modelCalls, 0, 'Fast Brain ran despite a deterministic clear winner')

    const ambiguous = [
      candidate('speech', 'speech', 0.7, 0.4, 0.7),
      candidate('reminder', 'scheduler', 0.72, 0.42, 0.65),
    ]
    assert.equal((await arbiter.decide(ambiguous, settings)).source, 'model')
    assert.equal(modelCalls, 1)
    failModel = true
    const fallback = await arbiter.decide(ambiguous, settings)
    assert.equal(fallback.source, 'fallback')
    assert.ok(fallback.candidateId)

    const gateSettings = {
      ...settings,
      fastBrain: { ...settings.fastBrain, enabled: false },
    }
    let currentSettings = gateSettings
    let currentWorld = world
    let gateNow = Date.now()
    const gate = new ProactiveInitiativeGate({
      store,
      envelope: new AutonomyEnvelope(),
      attention: arbiter,
      settings: () => currentSettings,
      world: () => currentWorld,
      now: () => gateNow,
    })
    const firstAt = gateNow
    const firstCandidate = candidate('experience:first', 'experience', 0.9, 0.85, 0.8, firstAt)
    let deliveries = 0
    currentWorld = { ...world, audioActive: true }
    const audioBusy = await gate.submit(
      {
        origin: 'experience',
        entityId: 'first',
        candidates: [firstCandidate],
      },
      () => {
        deliveries += 1
        return true
      },
    )
    assert.equal(audioBusy.outcome, 'defer')
    assert.equal(audioBusy.outcome === 'defer' ? audioBusy.reason : '', 'busy')
    assert.equal(deliveries, 0, 'audio-active initiative reached Behavior delivery')

    currentWorld = world
    currentSettings = { ...gateSettings, cooldownMs: 60_000 }
    gateNow = firstAt + 1
    const simultaneous = await Promise.all([
      gate.submit(
        {
          origin: 'experience',
          entityId: 'first',
          candidates: [firstCandidate],
        },
        () => {
          deliveries += 1
          return true
        },
      ),
      gate.submit(
        {
          origin: 'goal',
          entityId: 'second',
          candidates: [candidate('goal:second', 'goal', 0.9, 0.85, 0.8, firstAt + 2)],
        },
        () => {
          deliveries += 1
          return true
        },
      ),
    ])
    assert.equal(simultaneous[0].outcome, 'admit')
    assert.equal(simultaneous[1].outcome, 'defer')
    assert.equal(deliveries, 1, 'serialized gate admitted more than one initiative in cooldown')
    assert.equal(store.dailyInitiativeCount(firstAt + 2), 1)

    currentSettings = { ...gateSettings, mode: 'confirm', cooldownMs: 0 }
    const previewAt = firstAt + 3
    gateNow = previewAt
    const preview = await gate.submit(
      {
        origin: 'scheduler',
        entityId: 'preview',
        candidates: [candidate('scheduler:preview', 'scheduler', 0.9, 0.85, 0.8, previewAt)],
      },
      (approval) => {
        assert.equal(approval.outcome, 'preview')
        deliveries += 1
        return true
      },
    )
    assert.equal(preview.outcome, 'preview')
    assert.equal(store.dailyInitiativeCount(previewAt), 2)

    currentSettings = { ...gateSettings, cooldownMs: 0 }
    gateNow = previewAt + 1_000
    const stale = await gate.submit(
      {
        origin: 'behavior',
        entityId: 'stale',
        candidates: [
          {
            ...candidate('behavior:stale', 'behavior', 0.9, 0.85, 0.8, previewAt),
            expiresAt: gateNow - 1,
          },
        ],
      },
      () => {
        deliveries += 1
        return true
      },
    )
    assert.equal(stale.outcome, 'ignore')
    assert.equal(deliveries, 2, 'expired initiative reached Behavior delivery')
    gate.dispose()
    const afterDispose = await gate.submit(
      {
        origin: 'world',
        entityId: 'disposed',
        candidates: [candidate('world:disposed', 'world', 0.9, 0.85, 0.8, gateNow)],
      },
      () => {
        deliveries += 1
        return true
      },
    )
    assert.equal(afterDispose.outcome, 'ignore')
    assert.equal(deliveries, 2, 'disposed gate delivered an initiative')

    for (const source of ['BehaviorRuntime.ts', 'ExperienceRuntime.ts', 'FastBrainRuntime.ts']) {
      const text = readFileSync(join(process.cwd(), 'src/main/alive', source), 'utf8')
      assert.doesNotMatch(text, /ActionRuntime|ConversationRuntime|\.execute\s*\(/u)
    }
    const behaviorSource = readFileSync(
      join(process.cwd(), 'src/main/alive/BehaviorRuntime.ts'),
      'utf8',
    )
    assert.doesNotMatch(behaviorSource, /conversationActive|audioActive/u)
    const facadeSource = readFileSync(join(process.cwd(), 'src/main/alive/AliveFacade.ts'), 'utf8')
    assert.match(facadeSource, /world\.conversationActive\s*\|\|\s*world\.audioActive/u)
    assert.match(facadeSource, /'initiative-gate'/u)
    const schedulerSource = readFileSync(
      join(process.cwd(), 'src/main/alive/ScheduledTaskRuntime.ts'),
      'utf8',
    )
    assert.doesNotMatch(schedulerSource, /AutonomyEnvelope/u)
    console.log('MIND LAYER REPRO PASS: appraisal, mood, attention, behavior ownership')
  } finally {
    store?.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

function gameEvent(
  type: GameSemanticEventType,
  at: number,
  importance: GameSemanticEvent['importance'],
): Parameters<ExperienceRuntime['observe']>[0] {
  const event: GameSemanticEvent = {
    eventId: `game-event-00000000-0000-4000-8000-${String(at).padStart(12, '0')}`,
    sessionId: 'game-session-00000000-0000-4000-8000-000000000001',
    type,
    at,
    importance,
  }
  return { type: 'game-event', at, eventId: event.eventId, gameEvent: event }
}

function candidate(
  id: string,
  source: AttentionCandidate['source'],
  salience: number,
  urgency: number,
  socialRelevance: number,
  createdAt = 1,
): AttentionCandidate {
  return {
    id,
    source,
    summary: id,
    salience,
    novelty: 0.4,
    urgency,
    socialRelevance,
    interruptibility: 'normal',
    createdAt,
  }
}

void main()
