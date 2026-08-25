import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createSemanticMemoryRuntime } from '../../src/main/memory'

function main(): void {
  const directory = mkdtempSync(join(tmpdir(), 'shio-memory-2-'))
  try {
    const runtime = createSemanticMemoryRuntime(join(directory, 'hybrid.sqlite'), {
      embeddings: {
        embed: (text) => {
          const value = text.toLocaleLowerCase()
          if (value.includes('feline') || value.includes('кот')) return [1, 0]
          if (value.includes('tea') || value.includes('чай')) return [0, 1]
          return [0.5, 0.5]
        },
      },
    })
    runtime.createManual({ kind: 'fact', text: 'У пользователя живёт кот Марс.' })
    runtime.createManual({ kind: 'preference', text: 'Пользователь любит зелёный чай.' })
    assert.match(
      runtime.searchForUi({ query: 'feline companion', limit: 1 }).items[0]?.text ?? '',
      /кот Марс/u,
    )
    assert.equal(runtime.status().retrievalMode, 'hybrid')

    runtime.observeCompletedFact({
      eventId: 'event-1',
      kind: 'task-completed',
      entityId: 't1',
      at: 10,
    })
    runtime.observeCompletedFact({
      eventId: 'event-1',
      kind: 'task-completed',
      entityId: 't1',
      at: 10,
    })
    runtime.observeCompletedFact({
      eventId: 'event-2',
      kind: 'task-completed',
      entityId: 't2',
      at: 20,
    })
    assert.equal(runtime.habitSuggestions().length, 0)
    runtime.observeCompletedFact({
      eventId: 'event-3',
      kind: 'task-completed',
      entityId: 't3',
      at: 30,
    })
    const habit = runtime.habitSuggestions()[0]
    assert.ok(habit)
    assert.equal(habit.evidenceCount, 3)
    runtime.decideHabit(habit.id, 'approved')
    assert.equal(runtime.relevantHabitMotifs(100, 3).length, 1)
    assert.equal(runtime.relevantHabitMotifs(101, 3).length, 0, 'Habit cooldown was not respected')
    assert.equal(runtime.relevantHabitMotifs(100 + 6 * 60 * 60_000, 3).length, 1)

    runtime.createManual({ kind: 'relationship', text: 'Мы вместе выбирали имя для проекта.' })
    runtime.createManual({ kind: 'relationship', text: 'Пользователь ценит спокойный тон.' })
    const relationship = runtime.relationshipContext()
    assert.ok(relationship.familiarity >= 0 && relationship.familiarity <= 1)
    assert.ok(relationship.warmth >= 0 && relationship.warmth <= 1)
    assert.ok(relationship.relevantSharedHistory.length <= 4)
    assert.ok(relationship.recurringMotifs.length <= 4)
    runtime.close()

    const fallback = createSemanticMemoryRuntime(join(directory, 'fallback.sqlite'), {
      embeddings: {
        embed: () => {
          throw new Error('EMBEDDINGS_UNAVAILABLE')
        },
      },
    })
    fallback.createManual({ kind: 'fact', text: 'Lexical fallback marker.' })
    assert.equal(fallback.searchForUi({ query: 'lexical marker' }).items.length, 1)
    fallback.close()

    const aliveStore = readFileSync(join(process.cwd(), 'src/main/alive/AliveStore.ts'), 'utf8')
    const experience = readFileSync(
      join(process.cwd(), 'src/main/alive/ExperienceRuntime.ts'),
      'utf8',
    )
    assert.doesNotMatch(aliveStore, /memory_habits|observeHabit\s*\(/u)
    assert.doesNotMatch(experience, /SemanticMemory|MemoryStore|\.insertMany\s*\(/u)
    console.log('MEMORY 2 REPRO PASS: hybrid fallback, procedural habits, relationship bounds')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

main()
