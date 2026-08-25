import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  AliveStore,
  AttentionArbiter,
  BehaviorRuntime,
  ExperienceRuntime,
  FastBrainRuntime,
  MoodRuntime,
} from '../../src/main/alive'
import type { AttentionCandidate, WorldContextSnapshot } from '../../src/shared/alive'

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
    const experience = new ExperienceRuntime(
      store,
      new BehaviorRuntime(),
      new MoodRuntime(store),
      (fact) => facts.push(fact.eventId),
    )
    const success = experience.observe(
      { type: 'action-verified', actionId: 'a1', eventId: 'success', novelty: 0.1, at: 10 },
      settings,
      world,
    )
    assert.equal(success.appraisal.silence, true)
    assert.equal(success.behavior.intent.kind, 'none')
    assert.equal(moodWriteCount, 1, 'a new Experience should persist Mood exactly once')
    const failure = experience.observe(
      { type: 'action-failed', actionId: 'a2', eventId: 'failure', at: 20 },
      settings,
      world,
    )
    assert.ok(failure.appraisal.salience > success.appraisal.salience)
    assert.ok(failure.appraisal.valence < success.appraisal.valence)
    assert.equal(failure.behavior.intent.kind, 'conversation-candidate')
    assert.ok(Object.values(failure.mood).every((value) => typeof value === 'number'))
    assert.equal(moodWriteCount, 2, 'decay projection must not add a second Experience write')
    experience.observe(
      { type: 'task-completed', taskId: crypto.randomUUID(), eventId: 'completed-once', at: 30 },
      settings,
      world,
    )
    assert.deepEqual(facts, ['success', 'completed-once'])
    assert.equal(moodWriteCount, 3, 'each new Experience should add one Mood write')
    const persistedBeforeSnapshot = store.mood()
    const decayed = experience.moodSnapshot(30 + 4 * 60 * 60_000)
    assert.ok(Math.abs(decayed.valence) < Math.abs(failure.mood.valence))
    assert.equal(moodWriteCount, 3, 'reading a projected Mood snapshot must not persist it')
    assert.deepEqual(store.mood(), persistedBeforeSnapshot)

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

    for (const source of ['BehaviorRuntime.ts', 'ExperienceRuntime.ts', 'FastBrainRuntime.ts']) {
      const text = readFileSync(join(process.cwd(), 'src/main/alive', source), 'utf8')
      assert.doesNotMatch(text, /ActionRuntime|ConversationRuntime|\.execute\s*\(/u)
    }
    console.log('MIND LAYER REPRO PASS: appraisal, mood, attention, behavior ownership')
  } finally {
    store?.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

function candidate(
  id: string,
  source: AttentionCandidate['source'],
  salience: number,
  urgency: number,
  socialRelevance: number,
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
    createdAt: 1,
  }
}

void main()
