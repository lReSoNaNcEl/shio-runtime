import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { AliveRuntime, AliveStore } from '../../../src/main/alive'
import { createSemanticMemoryRuntime } from '../../../src/main/memory'
import { createTempDirectory } from '../../support'

describe('Procedural Memory evidence integration', () => {
  it('observes only deduplicated runtime-confirmed completion', async () => {
    const directory = await createTempDirectory('shio-procedural-evidence-')
    const store = new AliveStore(join(directory.path, 'alive.sqlite'))
    const memoryPath = join(directory.path, 'memory.sqlite')
    const memory = createSemanticMemoryRuntime(memoryPath)
    const runtime = new AliveRuntime(store, () => ({}) as never, {
      proceduralMemory: {
        observeCompletedFact: (fact) => memory.observeCompletedFact(fact),
        habitSuggestions: () => [],
        decideHabit: () => undefined,
      },
    })
    let database: DatabaseSync | undefined
    try {
      runtime.start()
      database = new DatabaseSync(memoryPath)
      const countEvidence = (): number =>
        Number(
          (
            database
              ?.prepare(
                "SELECT evidence_count FROM memory_habits WHERE habit_key = 'verified-action-follow-through'",
              )
              .get() as { evidence_count?: number } | undefined
          )?.evidence_count ?? 0,
        )
      runtime.reportExperience({
        type: 'conversation-completed',
        turnId: 'conversation',
        at: Date.now(),
      })
      expect(countEvidence()).toBe(0)
      runtime.reportExperience({
        type: 'action-verified',
        at: Date.now(),
        actionId: 'action-1',
        eventId: 'verified-action-1',
      })
      expect(countEvidence()).toBe(1)
      runtime.reportExperience({
        type: 'action-verified',
        at: Date.now(),
        actionId: 'action-1',
        eventId: 'verified-action-1',
      })
      expect(countEvidence()).toBe(1)
    } finally {
      database?.close()
      runtime.dispose()
      memory.close()
      await directory.cleanup()
    }
  })
})
