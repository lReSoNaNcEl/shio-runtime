import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ConversationThreadRuntime } from '../../../src/main/conversation-threads'
import type { ChatMessage } from '../../../src/main/llm'
import { InMemoryStore } from '../../../src/main/memory/InMemoryStore'
import { Orchestrator } from '../../../src/main/orchestrator'
import type { AppSettings } from '../../../src/shared/config'
import { createTempDirectory } from '../../support/createTempDirectory'

describe('Conversation Thread Runtime', () => {
  it('supplies an interrupted topic on the next explicit turn and retires it after resolution', async () => {
    const directory = await createTempDirectory('shio-thread-turn-')
    const threads = new ConversationThreadRuntime(join(directory.path, 'threads.sqlite'))
    const requests: string[] = []
    const provider = {
      async chat(messages: readonly ChatMessage[]) {
        requests.push(
          messages
            .filter((message) => message.role === 'system')
            .map((message) => message.content)
            .join('\n'),
        )
        const prompt = requests.at(-1) ?? ''
        if (prompt.includes('## Character Tool Requirement Planning')) {
          const user = messages.findLast((message) => message.role === 'user')?.content
          if (user === 'Where were we?') {
            expect(prompt).toContain('The keeper had just opened the door.')
            expect(prompt).toContain('choose direct-answer')
          }
          return JSON.stringify({
            requirement: { type: 'direct-answer' },
            plannedTools: [],
            embodiment: null,
          })
        }
        return '[calm]Okay.'
      },
    }
    const character = new Orchestrator(
      provider,
      new InMemoryStore(),
      () => ({ uiLocale: 'en' }) as AppSettings,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      threads,
      { enforceRequirements: true },
    )
    try {
      const thread = threads.open(
        {
          topic: 'The lighthouse story',
          summary: 'The keeper had just opened the door.',
          status: 'interrupted',
        },
        'turn-before-interruption',
      )
      await character.createReply({ userText: 'Where were we?' })
      expect(requests.at(-1)).toContain('The lighthouse story')
      expect(requests.at(-1)).toContain('The keeper had just opened the door.')
      threads.resolve(thread.id)
      await character.createReply({ userText: 'Hello.' })
      expect(requests.at(-1)).not.toContain('## Relevant Conversation Thread')
      expect(requests.at(-2)).not.toContain('## Relevant Conversation Thread')
      await character.createReply({ userText: 'The user returned', origin: 'autonomous' })
      expect(requests.length).toBeGreaterThanOrEqual(3)
      for (const prompt of requests)
        expect(prompt).not.toMatch(
          /Goal Awareness|goal[._](?:create|list|update)|unfinished intentions/u,
        )
    } finally {
      threads.close()
      await directory.cleanup()
    }
  })

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
