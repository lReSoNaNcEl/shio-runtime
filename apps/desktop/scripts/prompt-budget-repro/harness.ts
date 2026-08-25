import {
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

console.log('Prompt budget repro passed.')
