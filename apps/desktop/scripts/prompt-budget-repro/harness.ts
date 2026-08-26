import {
  CHARACTER_CONTEXT_ALLOCATION,
  CHARACTER_CONTEXT_BUDGET,
  CharacterRequestComposer,
} from '../../src/main/character/prompting/CharacterRequestComposer'
import type { PersistentGoal } from '../../src/shared/alive'
import type { ShioCapabilitySnapshot } from '../../src/shared/capabilities'

function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`FAIL: ${label}`)
  console.log(`PASS: ${label}`)
}

const now = Date.now()
const goals: PersistentGoal[] = Array.from({ length: 20 }, (_, index) => ({
  id: `goal-${index}`,
  title: `Goal ${index} ${'x'.repeat(120)}`,
  description: 'why '.repeat(100),
  nextStep: 'next '.repeat(100),
  lastNote: 'note '.repeat(100),
  owner: 'shared',
  status: 'active',
  progress: 0,
  measurable: false,
  createdAt: now,
  updatedAt: now,
}))
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

check(
  'configured minimum reservations fit inside the total context budget',
  Object.values(CHARACTER_CONTEXT_ALLOCATION.minimumCharacters).reduce(
    (total, value) => total + value,
    0,
  ) <= CHARACTER_CONTEXT_BUDGET.totalCharacters,
)
const tierSections = Object.values(CHARACTER_CONTEXT_ALLOCATION.tiers).flat()
check(
  'every context section belongs to exactly one allocation tier',
  tierSections.length === Object.keys(CHARACTER_CONTEXT_BUDGET.sections).length &&
    new Set(tierSections).size === tierSections.length,
)

const messages = new CharacterRequestComposer().compose({
  persona: `## Persona\n${'stable '.repeat(2_000)}`,
  responsePolicy: `## Policy\n${'bounded '.repeat(1_000)}`,
  goals,
  memory: memories,
  capabilities,
  locale: 'en',
})
const systemText = messages.map((message) => String(message.content)).join('\n')

check(
  'total system context stays within the declared budget',
  systemText.length <= CHARACTER_CONTEXT_BUDGET.totalCharacters,
)
check(
  'only one foreground goal is projected',
  systemText.includes('Goal 0') && !systemText.includes('Goal 1 '),
)
check('remaining goal count is projected', systemText.includes('Other unfinished intentions: 5'))
check('memory dump is bounded', !systemText.includes('memory-99'))
check(
  'capability projection is compact',
  !systemText.includes('Describe capabilities in user language'),
)

const saturatedMessages = new CharacterRequestComposer().compose({
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
    teasingComfort: 0.7,
    recurringMotifs: Array.from(
      { length: 3 },
      (_, index) => `relationship-motif-${index}-${'r'.repeat(180)}`,
    ),
    relevantSharedHistory: Array.from(
      { length: 3 },
      (_, index) => `shared-history-${index}-${'h'.repeat(240)}`,
    ),
  },
  goals,
  memory: `## Memory Context\nMEMORY_MARKER\n${memories}`,
  capabilities,
  project: `## Project Evidence\nPROJECT_MARKER\n${'project evidence '.repeat(1_000)}`,
  world: {
    capturedAt: now,
    appFocused: true,
    globalUserIdleMs: 0,
    userIdleMs: 0,
    conversationActive: false,
    audioActive: false,
    privacyMode: false,
    lastUserActivityAt: now,
    foregroundApplication: {
      processName: 'fixture.exe',
      windowTitle: `WORLD_MARKER ${'world '.repeat(300)}`,
    },
    runningApplications: Array.from({ length: 8 }, (_, index) => ({
      processName: `fixture-${index}.exe`,
      displayName: `Fixture ${index} ${'application '.repeat(40)}`,
    })),
    systemAdapter: 'available',
    freshness: { rendererMs: 0, schedulerMs: 0, systemMs: 0 },
  },
  toolResults: `## Current Tool Results\nTOOL_RESULT_MARKER\n${'verified result '.repeat(1_000)}`,
  locale: 'en',
})
const saturatedText = saturatedMessages.map((message) => String(message.content))
const saturatedCharacters = saturatedText.reduce((total, content) => total + content.length, 0)

check(
  'saturated context keeps every present tier discoverable',
  [
    'PERSONA_MARKER',
    'POLICY_MARKER',
    '## Current Mood',
    '## Relationship Context',
    '## Goal Awareness Context',
    'MEMORY_MARKER',
    '## Current Shio Capabilities',
    'PROJECT_MARKER',
    'WORLD_MARKER',
    'TOOL_RESULT_MARKER',
  ].every((marker) => saturatedText.some((content) => content.includes(marker))),
)
check(
  'saturated system context stays within the declared budget',
  saturatedCharacters <= CHARACTER_CONTEXT_BUDGET.totalCharacters,
)

const sectionHeaders = {
  persona: '## Persona',
  responsePolicy: '## Policy',
  mood: '## Current Mood',
  relationship: '## Relationship Context',
  goals: '## Goal Awareness Context',
  memory: '## Memory Context',
  capabilities: '## Current Shio Capabilities',
  project: '## Project Evidence',
  world: '## Current World Context',
  toolResults: '## Current Tool Results',
} as const
check(
  'every present section receives its minimum reservation before tier expansion',
  Object.entries(sectionHeaders).every(([section, header]) => {
    const content = saturatedText.find((candidate) => candidate.startsWith(header))
    return (
      content !== undefined &&
      (content.length >=
        CHARACTER_CONTEXT_ALLOCATION.minimumCharacters[
          section as keyof typeof CHARACTER_CONTEXT_ALLOCATION.minimumCharacters
        ] ||
        !content.endsWith('[truncated]'))
    )
  }),
)

console.log('Prompt budget repro passed.')
