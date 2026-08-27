import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createSemanticMemoryRuntime } from '../../../src/main/memory'
import { createTempDirectory } from '../../support'

describe('Memory retrieval', () => {
  it('combines semantic and lexical evidence when embeddings are available', async () => {
    const directory = await createTempDirectory('shio-memory-retrieval-')
    const runtime = createSemanticMemoryRuntime(join(directory.path, 'hybrid.sqlite'), {
      embeddings: {
        embed: (text) => {
          const value = text.toLocaleLowerCase()
          if (value.includes('feline') || value.includes('кот')) return [1, 0]
          if (value.includes('tea') || value.includes('чай')) return [0, 1]
          return [0.5, 0.5]
        },
      },
    })
    try {
      runtime.createManual({ kind: 'fact', text: 'У пользователя живёт кот Марс.' })
      runtime.createManual({ kind: 'preference', text: 'Пользователь любит зелёный чай.' })
      expect(runtime.searchForUi({ query: 'feline companion', limit: 1 }).items[0]?.text).toMatch(
        /кот Марс/u,
      )
      expect(runtime.status().retrievalMode).toBe('hybrid')
    } finally {
      runtime.close()
      await directory.cleanup()
    }
  })

  it('retains lexical retrieval when embeddings are unavailable', async () => {
    const directory = await createTempDirectory('shio-memory-fallback-')
    const runtime = createSemanticMemoryRuntime(join(directory.path, 'fallback.sqlite'), {
      embeddings: {
        embed: () => {
          throw new Error('EMBEDDINGS_UNAVAILABLE')
        },
      },
    })
    try {
      runtime.createManual({ kind: 'fact', text: 'Lexical fallback marker.' })
      expect(runtime.searchForUi({ query: 'lexical marker' }).items).toHaveLength(1)
    } finally {
      runtime.close()
      await directory.cleanup()
    }
  })
})

describe('Procedural Memory habits', () => {
  it('deduplicates evidence, requires approval, and enforces reuse cooldown', async () => {
    const directory = await createTempDirectory('shio-memory-habits-')
    const runtime = createSemanticMemoryRuntime(join(directory.path, 'habits.sqlite'))
    try {
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
      expect(runtime.habitSuggestions()).toHaveLength(0)

      runtime.observeCompletedFact({
        eventId: 'event-3',
        kind: 'task-completed',
        entityId: 't3',
        at: 30,
      })
      const habit = runtime.habitSuggestions()[0]
      expect(habit?.evidenceCount).toBe(3)
      if (!habit) throw new Error('Expected a pending habit suggestion')
      runtime.decideHabit(habit.id, 'approved')
      expect(runtime.relevantHabitMotifs(100, 3)).toHaveLength(1)
      expect(runtime.relevantHabitMotifs(101, 3)).toHaveLength(0)
      expect(runtime.relevantHabitMotifs(100 + 6 * 60 * 60_000, 3)).toHaveLength(1)
    } finally {
      runtime.close()
      await directory.cleanup()
    }
  })
})

describe('Relationship Memory projection', () => {
  it('keeps numeric and textual projections bounded', async () => {
    const directory = await createTempDirectory('shio-memory-relationship-')
    const runtime = createSemanticMemoryRuntime(join(directory.path, 'relationship.sqlite'))
    try {
      runtime.createManual({ kind: 'relationship', text: 'Мы вместе выбирали имя для проекта.' })
      runtime.createManual({ kind: 'relationship', text: 'Пользователь ценит спокойный тон.' })
      const relationship = runtime.relationshipContext()
      expect(relationship.familiarity).toBeGreaterThanOrEqual(0)
      expect(relationship.familiarity).toBeLessThanOrEqual(1)
      expect(relationship.warmth).toBeGreaterThanOrEqual(0)
      expect(relationship.warmth).toBeLessThanOrEqual(1)
      expect(relationship.relevantSharedHistory.length).toBeLessThanOrEqual(4)
      expect(relationship.recurringMotifs.length).toBeLessThanOrEqual(4)
    } finally {
      runtime.close()
      await directory.cleanup()
    }
  })
})
