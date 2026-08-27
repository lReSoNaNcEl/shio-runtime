import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import { verifiedToolOutcomeFallback } from '../../src/main/character/presentation/MemoryResultPresenter'
import { CharacterToolDispatcher } from '../../src/main/character-tools/CharacterToolDispatcher'
import { CharacterToolRegistry } from '../../src/main/character-tools/CharacterToolRegistry'
import { ToolInfluenceContext } from '../../src/main/character-tools/ToolInfluenceContext'
import {
  type BrowserComputerUseControlAction,
  type BrowserComputerUseProvider,
  type BrowserComputerUseSession,
  type BrowserComputerUseStartRequest,
  EMPTY_BROWSER_COMPUTER_USE_DIAGNOSTICS,
} from '../../src/shared/browser-computer-use'
import type { BrowserContextProvider, BrowserObservation } from '../../src/shared/browser-control'
import type { ShioCapabilitySnapshot } from '../../src/shared/capabilities'
import { CHARACTER_TOOL_IDS, parseCharacterToolDirective } from '../../src/shared/character-tools'

const observation: BrowserObservation = {
  observationId: 'browser-observation-00000000-0000-4000-8000-000000000001',
  sessionId: 'browser-session-00000000-0000-4000-8000-000000000001',
  url: 'https://example.test/app',
  title: 'Fixture application',
  capturedAt: 1,
  content: 'Ready',
  interactiveElements: [{ ref: 'e1', role: 'button', name: 'Continue' }],
  truncated: false,
}

const capabilities: ShioCapabilitySnapshot = {
  schemaVersion: 1,
  generatedAt: 1,
  capabilities: [
    {
      id: 'browser-control',
      category: 'action',
      source: { kind: 'plugin', pluginId: 'browser-control' },
      titleKey: 'capabilities.browser.title',
      descriptionKey: 'capabilities.browser.description',
      availability: 'available',
      authority: 'confirm',
    },
    {
      id: 'browser-computer-use',
      category: 'action',
      source: { kind: 'plugin', pluginId: 'browser-control' },
      titleKey: 'plugins.browserControl.name',
      descriptionKey: 'plugins.browserControl.description',
      availability: 'available',
      authority: 'confirm',
      details: {
        kind: 'browser-computer-use',
        semanticControl: 'ready',
        visualControl: 'ready',
        isolatedProfile: true,
      },
    },
  ],
}

const browserContext: BrowserContextProvider = {
  currentObservation: () => observation,
  observe: async () => observation,
}

function session(
  state: BrowserComputerUseSession['state'],
  overrides: Partial<BrowserComputerUseSession> = {},
): BrowserComputerUseSession {
  return {
    id: 'browser-use-session-00000000-0000-4000-8000-000000000001',
    goal: 'Complete the fixture application',
    browserContextId: observation.sessionId,
    pageId: 'browser-page-00000000-0000-4000-8000-000000000001',
    state,
    startedAt: 1,
    expiresAt: 300_001,
    maxSteps: 30,
    maxActions: 100,
    stepCount: 0,
    actionCount: 0,
    authorityScopeId: 'action-1-00000000-0000-4000-8000-000000000001',
    termination: { type: 'goal-completed' },
    mode: 'visual',
    controlMode: 'slow',
    activity: state === 'running' ? 'observing' : 'idle',
    diagnostics: { ...EMPTY_BROWSER_COMPUTER_USE_DIAGNOSTICS },
    ...overrides,
  }
}

async function main(): Promise<void> {
  const parsed = parseCharacterToolDirective(
    '<shio-tools>{"plannedTools":["browser.open","browser.use"],"calls":[{"tool":"browser.open","arguments":{"url":"https://example.test/app"}}]}</shio-tools>',
  )
  assert.equal(parsed.kind, 'calls')
  if (parsed.kind === 'calls') {
    assert.deepEqual(parsed.plannedTools, ['browser.open', 'browser.use'])
  }

  const influence = new ToolInfluenceContext('Complete the fixture application')
  influence.registerPlannedTools(['browser.open', 'browser.use'])
  influence.select('browser.open')
  influence.observeEvidence('browser')
  assert.equal(influence.canInvoke('browser.use'), true)
  assert.equal(influence.canInvoke('shell.execute'), false)

  const injectedPageInfluence = new ToolInfluenceContext('Read the current page')
  injectedPageInfluence.registerPlannedTools(['browser.open'])
  injectedPageInfluence.select('browser.open')
  injectedPageInfluence.observeEvidence('browser')
  assert.equal(injectedPageInfluence.canInvoke('browser.use'), false)
  assert.equal(injectedPageInfluence.canInvoke('shell.execute'), false)

  const disabledRegistry = new CharacterToolRegistry({
    projectAvailable: false,
    capabilityContext: { ...capabilities, capabilities: [] },
    browserObservation: null,
    actionsAvailable: true,
    browserComputerUseAvailable: true,
  })
  assert.equal(disabledRegistry.get('browser.use'), undefined)

  const registry = new CharacterToolRegistry({
    projectAvailable: false,
    capabilityContext: capabilities,
    browserObservation: observation,
    actionsAvailable: true,
    browserComputerUseAvailable: true,
  })
  const genericTools = [
    'browser.use',
    'browser.useStatus',
    'browser.usePause',
    'browser.useResume',
    'browser.useStop',
  ] as const
  for (const id of genericTools) assert(registry.get(id), `${id} is unavailable`)
  assert.equal(
    CHARACTER_TOOL_IDS.some((id) => id.startsWith('game.')),
    false,
  )
  const startSchema = JSON.stringify(registry.get('browser.use')?.inputSchema)
  assert.doesNotMatch(startSchema, /"x"|"y"|coordinate|key-down|mouse-down/u)

  let currentSession: BrowserComputerUseSession | null = null
  const provider: BrowserComputerUseProvider = {
    browserContext,
    status: () => ({
      enabled: true,
      browser: 'Google Chrome',
      isolatedProfile: true,
      semanticControl: 'ready',
      visualControl: 'ready',
      visualModel: 'fixture-vision',
      currentSession,
    }),
    start: async () => {
      throw new Error('Action Runtime must own delegated-session start')
    },
    pause: async () => {
      throw new Error('Action Runtime must own pause')
    },
    resume: async () => {
      throw new Error('Action Runtime must own resume')
    },
    stop: async () => {
      throw new Error('Action Runtime must own stop')
    },
  }
  const actions: Array<BrowserComputerUseStartRequest | BrowserComputerUseControlAction> = []
  const dispatcher = new CharacterToolDispatcher({
    registry: () => registry,
    traceId: 'generic-browser-tools',
    userGoal: 'Complete the fixture application',
    signal: new AbortController().signal,
    browserContext: () => browserContext,
    browserComputerUse: () => provider,
    executeBrowserComputerUseAction: async (action) => {
      actions.push(action)
      const state =
        'operation' in action
          ? action.operation === 'pause'
            ? 'paused'
            : action.operation === 'stop'
              ? 'stopped'
              : 'running'
          : 'running'
      currentSession = session(state)
      return { outcome: 'success', authorization: 'confirmed', session: currentSession }
    },
  })
  dispatcher.registerPlannedTools(genericTools)

  const started = await dispatcher.execute('browser.use', {
    goal: 'Complete the fixture application',
    maxSteps: 30,
    maxActions: 100,
    maxDurationMs: 300_000,
  })
  assert.equal(started.verifiedOutcome?.kind, 'browser.use')
  assert.equal(started.verifiedOutcome?.outcome, 'success')
  assert.match(started.content, /"state":"running"/u)
  assert.deepEqual(actions[0], {
    goal: 'Complete the fixture application',
    maxSteps: 30,
    maxActions: 100,
    maxDurationMs: 300_000,
  })

  const status = await dispatcher.execute('browser.useStatus', {})
  assert.equal(status.verifiedOutcome?.kind, 'browser.useStatus')
  assert.match(status.content, /"state":"running"/u)
  await dispatcher.execute('browser.usePause', {})
  await dispatcher.execute('browser.useResume', {})
  const stopped = await dispatcher.execute('browser.useStop', {})
  assert.equal(stopped.verifiedOutcome?.kind, 'browser.useStop')
  assert.deepEqual(actions.slice(1), [
    { operation: 'pause' },
    { operation: 'resume' },
    { operation: 'stop' },
  ])

  assert.equal(
    verifiedToolOutcomeFallback(started.verifiedOutcome, 'ru'),
    '[calm]Сессия управления браузером запущена.',
  )
  assert.equal(
    verifiedToolOutcomeFallback(
      { kind: 'browser.useStatus', outcome: 'success', state: 'waiting-user' },
      'ru',
    ),
    '[calm]Сессия браузера сохранена и ждёт твоего вмешательства.',
  )
  console.log('Semantic generic browser tools repro: PASS')
}

describe('semantic character tools', () => {
  it('keeps generic browser tool results bounded and semantic', async () => {
    await main()
  })
})
