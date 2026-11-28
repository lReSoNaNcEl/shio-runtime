import { expect, it } from 'vitest'

import {
  CHARACTER_CONTEXT_ALLOCATION,
  CHARACTER_CONTEXT_BUDGET,
  CharacterRequestComposer,
} from '../../src/main/character/prompting/CharacterRequestComposer'
import type { ShioCapabilitySnapshot } from '../../src/shared/capabilities'

it('assigns every context section to one tier within the total budget', () => {
  expect(Object.values(CHARACTER_CONTEXT_ALLOCATION.tiers).flat().sort()).toEqual(
    Object.keys(CHARACTER_CONTEXT_BUDGET.sections).sort(),
  )
  expect(
    Object.values(CHARACTER_CONTEXT_ALLOCATION.minimumCharacters).reduce(
      (total, value) => total + value,
      0,
    ),
  ).toBeLessThanOrEqual(CHARACTER_CONTEXT_BUDGET.totalCharacters)
})

it('reserves bounded space for every present context section', () => {
  const now = 1_000
  const capabilities: ShioCapabilitySnapshot = {
    schemaVersion: 1,
    generatedAt: now,
    capabilities: Array.from({ length: 20 }, (_, index) => ({
      id: `synthetic-${index}`,
      category: 'knowledge',
      source: { kind: 'core' },
      titleKey: 'capabilities.textChat.title',
      descriptionKey: 'capabilities.textChat.description',
      availability: 'available',
      authority: 'read-only',
    })),
  }
  const memories = Array.from(
    { length: 100 },
    (_, index) => `memory-${index}: ${'private continuity '.repeat(40)}`,
  ).join('\n')

  const messages = new CharacterRequestComposer().compose({
    persona: `## Persona\nPERSONA_MARKER\n${'persona '.repeat(2_000)}`,
    responsePolicy: `## Policy\nPOLICY_MARKER\n${'policy '.repeat(1_000)}`,
    mood: {
      valence: 0.1,
      arousal: 0.2,
      confidence: 0.3,
      playfulness: 0.4,
      curiosity: 0.5,
      frustration: 0.6,
      updatedAt: now,
    },
    relationship: {
      familiarity: 0.8,
      warmth: 0.9,
      relevantSharedHistory: Array.from(
        { length: 3 },
        (_, index) => `shared-history-${index}-${'h'.repeat(240)}`,
      ),
    },
    thread: {
      id: 'thread-1',
      topic: 'Interrupted story',
      summary: 'chapter '.repeat(80),
      status: 'interrupted',
      sourceTurnId: 'turn-1',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 60_000,
      salience: 0.8,
    },
    memory: `## Memory Context\nMEMORY_MARKER\n${memories}`,
    sessionSummary: `SESSION_SUMMARY_MARKER ${'earlier turn '.repeat(200)}`,
    capabilities,
    project: `## Project Evidence\nPROJECT_MARKER\n${'project evidence '.repeat(1_000)}`,
    world: {
      capturedAt: now,
      appFocused: true,
      globalUserIdleMs: 0,
      conversationActive: false,
      audioActive: false,
      privacyMode: false,
      lastUserActivityAt: now,
      foregroundApplication: {
        processName: 'fixture.exe',
        windowTitle: `WORLD_MARKER ${'world '.repeat(300)}`,
      },
      systemAdapter: 'available',
      freshness: { rendererMs: 0, systemMs: 0 },
    },
    toolResults: `## Current Tool Results\nTOOL_RESULT_MARKER\n${'verified result '.repeat(1_000)}`,
    locale: 'en',
  })

  const sections = messages.map((message) => String(message.content))
  expect(sections.reduce((total, section) => total + section.length, 0)).toBeLessThanOrEqual(
    CHARACTER_CONTEXT_BUDGET.totalCharacters,
  )

  const expectedSections = [
    ['persona', '## Persona', 'PERSONA_MARKER'],
    ['responsePolicy', '## Policy', 'POLICY_MARKER'],
    ['mood', '## Current Mood'],
    ['relationship', '## Relationship Context'],
    ['threads', '## Relevant Conversation Thread', 'thread-1'],
    ['memory', '## Memory Context', 'MEMORY_MARKER'],
    ['sessionSummary', '## Earlier In This Session', 'SESSION_SUMMARY_MARKER'],
    ['capabilities', '## Current Shio Capabilities', 'Compact request-scoped availability facts'],
    ['project', '## Project Evidence', 'PROJECT_MARKER'],
    ['world', '## Current World Context', 'WORLD_MARKER'],
    ['toolResults', '## Current Tool Results', 'TOOL_RESULT_MARKER'],
  ] as const
  for (const [name, header, marker] of expectedSections) {
    const content = sections.find((section) => section.startsWith(header))
    if (content === undefined) throw new Error(`Missing context section ${name}`)
    if (marker) expect(content).toContain(marker)
    if (content.endsWith('[truncated]')) {
      expect(content.length, name).toBeGreaterThanOrEqual(
        CHARACTER_CONTEXT_ALLOCATION.minimumCharacters[name],
      )
    }
  }

  expect(sections.join('\n')).not.toContain('memory-99')
})
