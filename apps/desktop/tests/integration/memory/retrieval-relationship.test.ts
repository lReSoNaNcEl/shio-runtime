import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

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

describe('Memory storage compatibility', () => {
  it('drops retired habit tables while preserving explicit records', async () => {
    const directory = await createTempDirectory('shio-memory-legacy-habits-')
    const path = join(directory.path, 'memory.sqlite')
    try {
      const initial = createSemanticMemoryRuntime(path)
      let explicitRecord: ReturnType<typeof initial.createManual>
      try {
        explicitRecord = initial.createManual({ kind: 'fact', text: 'My fox is called Quartz.' })
      } finally {
        initial.close()
      }

      const database = new DatabaseSync(path)
      try {
        expect(
          database.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'memory_habit*'").all(),
        ).toEqual([])
        database.exec(`
          CREATE TABLE memory_habits (summary TEXT, status TEXT);
          INSERT INTO memory_habits VALUES ('Legacy habit marker', 'approved');
          CREATE TABLE memory_habit_events (event_id TEXT PRIMARY KEY);
          INSERT INTO memory_habit_events VALUES ('legacy-event');
        `)
      } finally {
        database.close()
      }

      const reopened = createSemanticMemoryRuntime(path)
      try {
        expect(reopened.searchForUi({ query: 'Quartz' }).items).toEqual([explicitRecord])
      } finally {
        reopened.close()
      }
      const cleaned = new DatabaseSync(path, { readOnly: true })
      try {
        expect(
          cleaned.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'memory_habit*'").all(),
        ).toEqual([])
      } finally {
        cleaned.close()
      }
    } finally {
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
    } finally {
      runtime.close()
      await directory.cleanup()
    }
  })
})
