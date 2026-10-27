import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it } from 'vitest'

import {
  AliveFacade,
  AliveStore,
  AttentionArbiter,
  AutonomyEnvelope,
  BehaviorRuntime,
  ExperiencePolicy,
  ExperienceRuntime,
  FastBrainRuntime,
  MoodRuntime,
  ProactiveInitiativeGate,
} from '../../src/main/alive'
import type { LlmRequestOptions } from '../../src/main/llm'
import type {
  AttentionCandidate,
  AutonomySettings,
  ExperienceAppraisal,
  ExperienceEvent,
  MoodState,
  PersistentGoal,
  WorldContextSnapshot,
} from '../../src/shared/alive'

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

const settings: AutonomySettings = {
  mode: 'full',
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
    testExperiencePolicy(store)

    const browserProgress = experience.observe(browserUseEvent('progress', 31))
    const browserProgressBehavior = behavior.decide({ ...browserProgress, settings, world, at: 31 })
    assert.equal(browserProgressBehavior.intent.kind, 'embodiment')
    assert.equal(browserProgressBehavior.embodimentPresence?.screenGazeActive, true)
    const browserCompleted = experience.observe(
      browserUseEvent('completed', 40, {
        kind: 'success',
        summary: 'Browser task completed',
        confidence: 1,
      }),
    )
    const browserCompletedDecision = behavior.decideWithDiagnostics({
      ...browserCompleted,
      settings,
      world,
      at: 40,
    })
    assert(browserCompleted.appraisal.conversationalImpulse)
    assert.equal(browserCompleted.appraisal.embodimentPresence?.screenGazeActive, false)
    assert.notEqual(browserCompletedDecision.conversationCandidate, 'not-applicable')
    const waitingUser = experience.observe(browserUseEvent('blocked', 44))
    const waitingUserBehavior = behavior.decide({ ...waitingUser, settings, world, at: 44 })
    assert(waitingUser.appraisal.conversationalImpulse)
    assert.equal(waitingUserBehavior.embodimentPresence?.screenGazeActive, false)
    const userSpeechWins = experience.observe(browserUseEvent('blocked', 45))
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
    const resumed = experience.observe(browserUseEvent('started', 46))
    const resumedBehavior = behavior.decide({ ...resumed, settings, world, at: 46 })
    assert.equal(resumedBehavior.embodimentPresence?.screenGazeActive, true)
    const paused = experience.observe(browserUseEvent('stopped', 47))
    const pausedBehavior = behavior.decide({ ...paused, settings, world, at: 47 })
    assert.equal(pausedBehavior.embodimentPresence?.screenGazeActive, false)
    const errored = experience.observe(browserUseEvent('failed', 48))
    const erroredBehavior = behavior.decide({
      ...errored,
      settings,
      world,
      at: 48,
      conversationAllowed: false,
    })
    assert.equal(erroredBehavior.embodimentPresence?.screenGazeActive, false)

    testMoodBehaviorModulation()

    let modelCalls = 0
    let failModel = false
    let deferModel = false
    let modelResponse = JSON.stringify({
      disposition: 'admit',
      candidateId: 'speech',
      confidence: 0.8,
      reason: 'direct address',
    })
    let lastModelOptions: LlmRequestOptions | undefined
    const fastBrain = new FastBrainRuntime(
      () =>
        ({
          chat: async (_messages: unknown, options?: LlmRequestOptions) => {
            modelCalls += 1
            lastModelOptions = options
            if (failModel) throw new Error('FAST_BRAIN_DOWN')
            if (deferModel) {
              assert(options?.signal, 'Fast Brain provider call must receive an AbortSignal')
              return new Promise<string>((_resolve, reject) => {
                const rejectAborted = (): void =>
                  reject(options.signal?.reason ?? new DOMException('Cancelled', 'AbortError'))
                if (options.signal?.aborted) rejectAborted()
                else options.signal?.addEventListener('abort', rejectAborted, { once: true })
              })
            }
            return modelResponse
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
    assert(lastModelOptions?.signal)
    assert.equal(lastModelOptions.timeoutMs, settings.fastBrain.timeoutMs)
    assert.equal(lastModelOptions.maxTokens, settings.fastBrain.maxTokens)

    modelResponse = JSON.stringify({
      disposition: 'admit',
      candidateId: 'speech',
      confidence: 0.8,
      reason: 'direct address',
      unexpected: true,
    })
    assert.equal((await arbiter.decide(ambiguous, settings)).source, 'fallback')
    modelResponse =
      '```json\n{"disposition":"admit","candidateId":"speech","confidence":0.8,"reason":"fenced"}\n```'
    assert.equal((await arbiter.decide(ambiguous, settings)).source, 'fallback')

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

    failModel = false
    deferModel = true
    const cancelled = new AbortController()
    const callsBeforeCancel = modelCalls
    const cancelledDecision = arbiter.decide(ambiguous, settings, {
      signal: cancelled.signal,
    })
    await waitUntil(() => modelCalls > callsBeforeCancel)
    const cancelledProviderSignal = lastModelOptions?.signal
    cancelled.abort(new DOMException('Turn cancelled', 'AbortError'))
    await assert.rejects(cancelledDecision, { name: 'AbortError' })
    assert.equal(cancelledProviderSignal?.aborted, true)

    const expiring = ambiguous.map((entry) => ({ ...entry, expiresAt: Date.now() + 20 }))
    const callsBeforeExpiry = modelCalls
    const expiringDecision = arbiter.decide(expiring, settings)
    await waitUntil(() => modelCalls > callsBeforeExpiry)
    await assert.rejects(expiringDecision, { name: 'AbortError' })
    assert.equal(lastModelOptions?.signal?.aborted, true)

    const lifecycleStore = new AliveStore(join(directory, 'alive-lifecycle.sqlite'))
    let lifecycleProviderSignal: AbortSignal | undefined
    const lifecycleRuntime = new AliveFacade(
      lifecycleStore,
      () =>
        ({
          chat: async (_messages: unknown, options?: LlmRequestOptions) => {
            const providerSignal = options?.signal
            assert(providerSignal)
            lifecycleProviderSignal = providerSignal
            return new Promise<string>((_resolve, reject) => {
              const rejectAborted = (): void =>
                reject(providerSignal.reason ?? new DOMException('Disposed', 'AbortError'))
              if (providerSignal.aborted) rejectAborted()
              else providerSignal.addEventListener('abort', rejectAborted, { once: true })
            })
          },
        }) as never,
    )
    lifecycleRuntime.updateSettings(settings)
    const lifecycleDecision = lifecycleRuntime.arbitrateAttention(ambiguous)
    await waitUntil(() => lifecycleProviderSignal !== undefined)
    lifecycleRuntime.dispose()
    await assert.rejects(lifecycleDecision, { name: 'AbortError' })
    assert.equal(lifecycleProviderSignal?.aborted, true)

    for (const source of ['BehaviorRuntime.ts', 'ExperienceRuntime.ts', 'FastBrainRuntime.ts']) {
      const text = readFileSync(
        join(import.meta.dirname, '../..', 'src/main/alive', source),
        'utf8',
      )
      assert.doesNotMatch(text, /ActionRuntime|ConversationRuntime|\.execute\s*\(/u)
    }
    const behaviorSource = readFileSync(
      join(import.meta.dirname, '../..', 'src/main/alive/BehaviorRuntime.ts'),
      'utf8',
    )
    assert.doesNotMatch(behaviorSource, /conversationActive|audioActive/u)
    const facadeSource = readFileSync(
      join(import.meta.dirname, '../..', 'src/main/alive/AliveFacade.ts'),
      'utf8',
    )
    assert.match(facadeSource, /world\.conversationActive\s*\|\|\s*world\.audioActive/u)
    assert.match(facadeSource, /'initiative-gate'/u)
    const schedulerSource = readFileSync(
      join(import.meta.dirname, '../..', 'src/main/alive/ScheduledTaskRuntime.ts'),
      'utf8',
    )
    assert.doesNotMatch(schedulerSource, /AutonomyEnvelope/u)
    console.log('MIND LAYER REPRO PASS: appraisal, mood, attention, behavior ownership')
  } finally {
    store?.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

function browserUseEvent(
  phase: Extract<ExperienceEvent, { type: 'browser-computer-use-event' }>['phase'],
  at: number,
  observation?: Extract<ExperienceEvent, { type: 'browser-computer-use-event' }>['observation'],
): Parameters<ExperienceRuntime['observe']>[0] {
  return {
    type: 'browser-computer-use-event',
    at,
    eventId: `browser-use-event-00000000-0000-4000-8000-${String(at).padStart(12, '0')}`,
    sessionId: 'browser-use-session-00000000-0000-4000-8000-000000000001',
    phase,
    observation,
    ...(phase === 'failed' ? { errorCode: 'FIXTURE_FAILURE' } : {}),
  }
}

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.fail('condition did not become true')
}

function testMoodBehaviorModulation(): void {
  const neutralMood = mood()
  const curiousMood = mood({ curiosity: 1 })
  const playfulMood = mood({ playfulness: 1, curiosity: 1 })
  const frustratedMood = mood({ frustration: 0.9, arousal: 0.8 })

  const worldChange = appraisal('curious-world', {
    salience: 0.32,
    novelty: 0.65,
  })
  assert.equal(
    new BehaviorRuntime().decide({
      appraisal: worldChange,
      mood: neutralMood,
      settings,
      world,
      at: 1_000,
    }).intent.kind,
    'none',
  )
  const curiousReaction = new BehaviorRuntime().decide({
    appraisal: worldChange,
    mood: curiousMood,
    settings,
    world,
    at: 1_000,
  })
  assert.equal(curiousReaction.intent.kind, 'embodiment')
  if (curiousReaction.intent.kind === 'embodiment') {
    assert.equal(curiousReaction.intent.intent.gestureHint, 'think')
  }

  const playfulImpulse = appraisal('playful-comment', {
    salience: 0.55,
    valence: 0.4,
    novelty: 0.45,
    conversationalImpulse: { topic: 'A light moment', priority: 0.6 },
  })
  assert.equal(
    new BehaviorRuntime().decide({
      appraisal: playfulImpulse,
      mood: neutralMood,
      settings,
      world,
      at: 2_000,
    }).intent.kind,
    'none',
  )
  const playfulReaction = new BehaviorRuntime().decide({
    appraisal: playfulImpulse,
    mood: playfulMood,
    settings,
    world,
    at: 2_000,
  })
  assert.equal(playfulReaction.intent.kind, 'conversation-candidate')
  if (playfulReaction.intent.kind === 'conversation-candidate') {
    assert.equal(playfulReaction.intent.priority, 0.63)
  }
  assert.equal(
    new BehaviorRuntime().decide({
      appraisal: playfulImpulse,
      mood: playfulMood,
      settings: { ...settings, globallySuspended: true },
      world,
      at: 2_000,
    }).intent.kind,
    'none',
    'Mood modulation bypassed Global Suspend',
  )

  const celebration = appraisal('frustrated-celebration', {
    salience: 0.8,
    valence: 0.8,
    arousal: 0.6,
    novelty: 0.5,
    embodimentHint: { intensity: 'normal', gestureHint: 'celebrate', gazeHint: 'user' },
  })
  const softened = new BehaviorRuntime().decide({
    appraisal: celebration,
    mood: frustratedMood,
    settings,
    world,
    at: 3_000,
  })
  assert.equal(softened.intent.kind, 'embodiment')
  if (softened.intent.kind === 'embodiment') {
    assert.equal(softened.intent.intent.intensity, 'subtle')
  }

  const failure = appraisal('frustrated-failure', {
    salience: 0.82,
    valence: -0.7,
    arousal: 0.65,
    novelty: 0.6,
    embodimentHint: { intensity: 'normal', gestureHint: 'disagree', gazeHint: 'screen' },
  })
  const sharpened = new BehaviorRuntime().decide({
    appraisal: failure,
    mood: frustratedMood,
    settings,
    world,
    at: 4_000,
  })
  assert.equal(sharpened.intent.kind, 'embodiment')
  if (sharpened.intent.kind === 'embodiment') {
    assert.equal(sharpened.intent.intent.intensity, 'strong')
  }

  const neutralCooldown = new BehaviorRuntime()
  const playfulCooldown = new BehaviorRuntime()
  const first = appraisal('cooldown-first', {
    valence: 0.3,
    conversationalImpulse: { topic: 'First', priority: 0.75 },
  })
  const second = appraisal('cooldown-second', {
    valence: 0.3,
    conversationalImpulse: { topic: 'Second', priority: 0.75 },
  })
  assert.equal(
    neutralCooldown.decide({ appraisal: first, mood: neutralMood, settings, world, at: 10_000 })
      .intent.kind,
    'conversation-candidate',
  )
  assert.equal(
    playfulCooldown.decide({ appraisal: first, mood: playfulMood, settings, world, at: 10_000 })
      .intent.kind,
    'conversation-candidate',
  )
  assert.equal(
    neutralCooldown.decide({
      appraisal: second,
      mood: neutralMood,
      settings,
      world,
      at: 260_000,
    }).intent.kind,
    'none',
  )
  assert.equal(
    playfulCooldown.decide({
      appraisal: second,
      mood: playfulMood,
      settings,
      world,
      at: 260_000,
    }).intent.kind,
    'conversation-candidate',
  )

  let playfulSpeech = 0
  let inhibitedSpeech = 0
  let inhibitedNonverbal = 0
  for (let index = 0; index < 32; index += 1) {
    const mixed = appraisal(`speech-probability-${index}`, {
      salience: 0.8,
      valence: -0.3,
      arousal: 0.5,
      novelty: 0.5,
      embodimentHint: { intensity: 'subtle', gestureHint: 'disagree', gazeHint: 'screen' },
      conversationalImpulse: { topic: 'Bounded reaction', priority: 0.74 },
    })
    if (
      new BehaviorRuntime().decide({
        appraisal: mixed,
        mood: playfulMood,
        settings,
        world,
        at: index,
      }).intent.kind === 'conversation-candidate'
    ) {
      playfulSpeech += 1
    }
    const inhibited = new BehaviorRuntime().decide({
      appraisal: mixed,
      mood: mood({ playfulness: 0, curiosity: 0, frustration: 1, arousal: 0.8 }),
      settings,
      world,
      at: index,
    })
    if (inhibited.intent.kind === 'conversation-candidate') inhibitedSpeech += 1
    if (inhibited.intent.kind === 'embodiment') inhibitedNonverbal += 1
  }
  assert.equal(playfulSpeech, 32)
  assert.ok(inhibitedSpeech > 0)
  assert.ok(inhibitedNonverbal > 0)
  assert.ok(inhibitedSpeech < playfulSpeech)
}

function mood(overrides: Partial<MoodState> = {}): MoodState {
  return {
    valence: 0,
    arousal: 0,
    confidence: 0.55,
    playfulness: 0.5,
    curiosity: 0.55,
    frustration: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function appraisal(
  eventId: string,
  overrides: Partial<ExperienceAppraisal> = {},
): ExperienceAppraisal {
  return {
    eventId,
    salience: 0.5,
    valence: 0,
    arousal: 0,
    novelty: 0.2,
    socialRelevance: 0.4,
    silence: true,
    ...overrides,
  }
}

function testExperiencePolicy(store: AliveStore): void {
  const baselineMood: MoodState = mood()
  const repeatedPolicy = new ExperiencePolicy()
  const firstFailure = repeatedPolicy.appraise(
    { type: 'action-failed', actionId: 'repeat-1', eventId: 'repeat-1', at: 100 },
    { currentMood: baselineMood },
  )
  const secondFailure = repeatedPolicy.appraise(
    { type: 'action-failed', actionId: 'repeat-2', eventId: 'repeat-2', at: 200 },
    { currentMood: baselineMood },
  )
  const thirdFailure = repeatedPolicy.appraise(
    { type: 'action-failed', actionId: 'repeat-3', eventId: 'repeat-3', at: 300 },
    { currentMood: { ...baselineMood, frustration: 0.8, arousal: 0.7 } },
  )
  assert.ok(secondFailure.salience > firstFailure.salience)
  assert.ok(secondFailure.novelty < firstFailure.novelty)
  assert.match(secondFailure.conversationalImpulse?.topic ?? '', /repeated attempts/u)
  assert.equal(thirdFailure.emotionHint, 'angry')

  const sharedGoal = store.createGoal({
    title: 'Shared qualification',
    owner: 'shared',
    measurable: true,
  })
  store.updateGoal({ id: sharedGoal.id, progress: 0.8 })
  const isolatedGoalAppraisal = new ExperiencePolicy().appraise(
    { type: 'goal-completed', goalId: sharedGoal.id, eventId: 'isolated-goal', at: 400 },
    { currentMood: baselineMood },
  )
  const contextualGoalAppraisal = new ExperiencePolicy().appraise(
    { type: 'goal-completed', goalId: sharedGoal.id, eventId: 'contextual-goal', at: 400 },
    {
      currentMood: baselineMood,
      goal: { ...sharedGoal, progress: 0.8 },
      relationship: {
        familiarity: 0.9,
        warmth: 0.85,
        teasingComfort: 0.4,
        recurringMotifs: ['qualification', 'verified follow-through'],
        relevantSharedHistory: [],
      },
    },
  )
  assert.ok(contextualGoalAppraisal.salience > isolatedGoalAppraisal.salience)
  assert.ok(contextualGoalAppraisal.socialRelevance > isolatedGoalAppraisal.socialRelevance)
  assert.ok(contextualGoalAppraisal.novelty < isolatedGoalAppraisal.novelty)

  const userGoal: PersistentGoal = { ...sharedGoal, owner: 'user' }
  const userGoalAppraisal = new ExperiencePolicy().appraise(
    { type: 'goal-completed', goalId: userGoal.id, eventId: 'user-goal', at: 500 },
    { currentMood: baselineMood, goal: userGoal },
  )
  assert.equal(userGoalAppraisal.conversationalImpulse?.topic, "The user's goal was completed")

  const deterministicEvent = {
    type: 'browser-blocked' as const,
    eventId: 'deterministic',
    at: 600,
  }
  assert.deepEqual(
    new ExperiencePolicy().appraise(deterministicEvent, { currentMood: baselineMood }),
    new ExperiencePolicy().appraise(deterministicEvent, { currentMood: baselineMood }),
  )

  const browserPolicy = new ExperiencePolicy()
  const firstBrowserFailure = browserPolicy.appraise(browserUseEvent('failed', 700), {
    currentMood: baselineMood,
  })
  const differentBrowserFailure = browserPolicy.appraise(browserUseEvent('failed', 701), {
    currentMood: baselineMood,
  })
  const repeatedBrowserFailure = browserPolicy.appraise(browserUseEvent('failed', 702), {
    currentMood: baselineMood,
  })
  assert.ok(firstBrowserFailure.novelty >= differentBrowserFailure.novelty)
  assert.ok(repeatedBrowserFailure.novelty <= differentBrowserFailure.novelty)
  assert.equal(differentBrowserFailure.origin, 'browser-computer-use')
  assert.deepEqual(differentBrowserFailure.embodimentPresence, {
    source: 'browser-computer-use',
    sessionId: 'browser-use-session-00000000-0000-4000-8000-000000000001',
    screenGazeActive: false,
  })
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

describe('Mind layer', () => {
  it('preserves Alive appraisal and behavior boundaries', async () => {
    await main()
  })
})
