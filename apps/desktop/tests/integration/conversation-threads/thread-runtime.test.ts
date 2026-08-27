import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ConversationThreadRuntime } from '../../../src/main/conversation-threads'
import { createTempDirectory } from '../../support'

describe('Conversation Thread Runtime', () => {
  it('projects only unresolved, relevant, ephemeral threads', async () => {
    const directory = await createTempDirectory('shio-conversation-threads-')
    const runtime = new ConversationThreadRuntime(
      join(directory.path, 'conversation', 'threads.sqlite'),
    )
    try {
      const first = runtime.open(
        {
          topic: 'Browser computer use',
          summary: 'The substantive implementation discussion was interrupted.',
          status: 'interrupted',
          salience: 0.8,
        },
        'turn-substantive',
        1_000,
      )
      runtime.open(
        {
          topic: 'Waiting for fixture data',
          summary: 'The user will provide a fixture before the discussion continues.',
          status: 'waiting-user',
          salience: 0.7,
        },
        'turn-waiting',
        2_000,
      )
      const awareness = runtime.awareness(3_000)
      expect(awareness).toHaveLength(1)
      expect(awareness[0]?.status).toBe('waiting-user')
      expect(awareness[0]).not.toHaveProperty('memoryId')
      expect(awareness[0]).not.toHaveProperty('goalId')

      expect(runtime.resolve(first.id, 4_000).status).toBe('resolved')
      expect(runtime.awareness(4_000).some((thread) => thread.id === first.id)).toBe(false)

      const expiring = runtime.open(
        { topic: 'Short-lived branch', summary: 'A temporary conversational branch.' },
        'turn-expiring',
        5_000,
      )
      expect(
        runtime.awareness(expiring.expiresAt + 1).some((item) => item.id === expiring.id),
      ).toBe(false)
    } finally {
      runtime.close()
      await directory.cleanup()
    }
  })
})
