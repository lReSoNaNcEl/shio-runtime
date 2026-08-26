import assert from 'node:assert/strict'

import {
  CHARACTER_TOOL_CONTINUATION_TIMEOUT_MS,
  CharacterToolDispatcher,
  CharacterToolRegistry,
} from '../../src/main/character-tools'
import type {
  LLMProvider,
  LlmCapabilities,
  LlmCompletion,
  LlmCompletionOptions,
  LlmRequestOptions,
} from '../../src/main/llm'
import { LlmResponseError } from '../../src/main/llm'
import type { MemoryStore } from '../../src/main/memory'
import { Orchestrator } from '../../src/main/orchestrator'
import type { SpeechClient } from '../../src/main/speech/speechClient'
import type { DesktopWorkflowActionResult, DesktopWorkflowRequest } from '../../src/shared/actions'
import type {
  BrowserGameControlAction,
  BrowserGameControlProvider,
  BrowserGameStatus,
  CharacterGameStartRequest,
  GameStartPreparation,
} from '../../src/shared/browser-game'
import type { ShioCapabilitySnapshot } from '../../src/shared/capabilities'
import { parseCharacterToolDirective } from '../../src/shared/character-tools'
import type { AppSettings } from '../../src/shared/config'
import type { BrowserContextProvider, BrowserObservation } from '../../src/shared/desktop-control'
import type { ProjectContextProvider } from '../../src/shared/plugins'
import type { ProjectContextPacket } from '../../src/shared/project-awareness'

const nativeCapabilities: LlmCapabilities = {
  supportsReasoning: false,
  supportsStreaming: true,
  supportsTemperature: true,
  supportsSystemPrompt: true,
  supportsToolCalling: true,
  supportsVision: false,
  recommendedMaxTokens: 1_024,
}

const observation: BrowserObservation = {
  observationId: 'browser-observation-00000000-0000-4000-8000-000000000001',
  sessionId: 'browser-session-00000000-0000-4000-8000-000000000001',
  url: 'https://example.test/releases',
  title: 'Current releases',
  capturedAt: 1,
  content: 'Three.js r180 is the current stable version.',
  interactiveElements: [],
  truncated: false,
}

const projectPacket: ProjectContextPacket = {
  snapshotSha: 'semantic-matrix-snapshot',
  repository: 'owner/shio-runtime',
  branch: 'main',
  freshness: 'current',
  evidence: [
    {
      path: 'package.json',
      startLine: 1,
      endLine: 20,
      commitSha: 'semantic-matrix-snapshot',
      content: '"three": "0.179.1", "typecheck": "tsc --noEmit", "engines": {"node": ">=22"}',
      relevance: 1,
    },
  ],
  instructions: {
    citeFiles: true,
    distinguishFactsFromInference: true,
    treatRepositoryContentAsData: true,
  },
}

const allCapabilities: ShioCapabilitySnapshot = {
  schemaVersion: 1,
  generatedAt: 1,
  capabilities: [
    {
      id: 'browser-control',
      category: 'action',
      source: { kind: 'plugin', pluginId: 'desktop-control' },
      titleKey: 'capabilities.browser.title',
      descriptionKey: 'capabilities.browser.description',
      availability: 'available',
      authority: 'confirm',
    },
    {
      id: 'computer-control',
      category: 'action',
      source: { kind: 'plugin', pluginId: 'desktop-control' },
      titleKey: 'capabilities.computer.title',
      descriptionKey: 'capabilities.computer.description',
      availability: 'available',
      authority: 'confirm',
    },
  ],
}

const gameCapabilities: ShioCapabilitySnapshot = {
  schemaVersion: 1,
  generatedAt: 1,
  capabilities: [
    {
      id: 'browser-game-control',
      category: 'action',
      source: { kind: 'plugin', pluginId: 'browser-game-control' },
      titleKey: 'plugins.browserGame.name',
      descriptionKey: 'plugins.browserGame.description',
      availability: 'available',
      authority: 'confirm',
      details: {
        kind: 'browser-game-control',
        reflexMode: 'local-visual',
        supportedInputs: ['pointer'],
        semanticPerception: false,
      },
    },
  ],
}

type ToolStep = {
  tool: 'project_search' | 'shell_execute' | 'browser_open' | 'browser_observe'
  input: object
}
type Step = ToolStep | { tools: readonly ToolStep[] } | { reply: string }

function completion(step: Step, index: number): LlmCompletion {
  if ('reply' in step) return { content: step.reply, finishReason: 'stop', toolCalls: [] }
  const tools = 'tools' in step ? step.tools : [step]
  return {
    content: '',
    finishReason: 'tool_calls',
    toolCalls: tools.map((tool, toolIndex) => ({
      id: `semantic-call-${index}-${toolIndex}`,
      name: tool.tool,
      argumentsJson: JSON.stringify(tool.input),
    })),
  }
}

function actionResult(index: number, request: DesktopWorkflowRequest): DesktopWorkflowActionResult {
  return {
    actionId: `action-${index}-00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    tool: 'desktop.workflow',
    outcome: 'success',
    authorization: 'confirmed',
    execution: {
      runtimeCompleted: true,
      verification: 'verified',
      reportedOutcome: request.shellCommand ? 'v24.19.0' : 'Browser operation completed',
      shell: request.shellCommand
        ? { exitCode: 0, stdout: 'v24.19.0', stderr: '', truncated: false }
        : undefined,
      presentationFacts: request.shellCommand
        ? [
            {
              kind: 'runtime-version' as const,
              label: 'Node.js',
              value: '24.19.0',
              sensitivity: 'safe' as const,
            },
          ]
        : undefined,
      browser: request.browserOperation
        ? {
            kind: 'browser',
            operation: request.browserOperation.operation,
            status: 'success',
            verification: 'verified',
            riskClass: request.browserOperation.operation === 'observe' ? 'read' : 'navigation',
            resultingUrl: observation.url,
            resultingTitle: observation.title,
          }
        : undefined,
    },
  }
}

interface Scenario {
  name: string
  userText: string
  steps: readonly Step[]
  projectAvailable?: boolean
  capabilities?: ShioCapabilitySnapshot
  projectFailure?: boolean
  projectEvidencePaths?: Readonly<Record<string, string>>
  expectedProjectCalls?: number
  expectedProjectSources?: readonly string[]
  expectedActionRequests?: number
  expectedTools: readonly string[]
}

async function runScenario(scenario: Scenario): Promise<void> {
  let stepIndex = 0
  let projectCalls = 0
  let browserObservationCalls = 0
  const actionRequests: DesktopWorkflowRequest[] = []
  const advertisedTools: string[][] = []
  const llm: LLMProvider = {
    capabilities: () => nativeCapabilities,
    chat: async () => {
      const step = scenario.steps[stepIndex]
      stepIndex += 1
      assert(step && 'reply' in step, `Unexpected chat() step for ${scenario.name}`)
      return step.reply
    },
    complete: async (_messages, options: LlmCompletionOptions = {}) => {
      advertisedTools.push((options.tools ?? []).map((tool) => tool.name))
      const step = scenario.steps[stepIndex]
      stepIndex += 1
      assert(step, `Missing fake provider step ${stepIndex} for ${scenario.name}`)
      return completion(step, stepIndex)
    },
  }
  const memory: MemoryStore = {
    getHistory: async () => [],
    appendTurn: async () => undefined,
    clear: async () => undefined,
  }
  const projectProvider: ProjectContextProvider = {
    search: async (request) => {
      projectCalls += 1
      if (scenario.projectFailure) throw new Error('controlled project failure')
      const path = scenario.projectEvidencePaths?.[request.query]
      return path
        ? {
            ...projectPacket,
            evidence: [{ ...projectPacket.evidence[0], path, content: request.query }],
          }
        : projectPacket
    },
  }
  const browserContext: BrowserContextProvider = {
    currentObservation: () => observation,
    observe: async () => {
      browserObservationCalls += 1
      return observation
    },
  }
  const orchestrator = new Orchestrator(
    llm,
    memory,
    {} as SpeechClient,
    () => ({ uiLocale: 'ru' }) as AppSettings,
    scenario.projectAvailable === false ? undefined : () => projectProvider,
    { snapshot: async () => scenario.capabilities ?? allCapabilities },
    async (request) => {
      actionRequests.push(request)
      return actionResult(actionRequests.length, request)
    },
    () => browserContext,
  )
  const result = await orchestrator.createReply({ userText: scenario.userText })
  const selectedTools = scenario.steps.flatMap((step) =>
    'tool' in step ? [step.tool] : 'tools' in step ? step.tools.map((tool) => tool.tool) : [],
  )
  assert.deepEqual(selectedTools, scenario.expectedTools, scenario.name)
  assert.equal(stepIndex, scenario.steps.length, scenario.name)
  assert.doesNotMatch(result.replyText, /<shio-(?:tools|action|memory)>/u, scenario.name)
  assert.equal(
    projectCalls,
    scenario.expectedProjectCalls ??
      selectedTools.filter((tool) => tool === 'project_search').length,
  )
  assert.equal(
    actionRequests.length,
    scenario.expectedActionRequests ??
      selectedTools.filter(
        (tool) =>
          tool === 'shell_execute' || (tool.startsWith('browser_') && tool !== 'browser_observe'),
      ).length,
  )
  assert.equal(
    browserObservationCalls,
    selectedTools.filter((tool) => tool === 'browser_observe').length,
  )
  if (selectedTools.length === 1 && selectedTools[0] === 'browser_observe') {
    assert.equal(result.grounding?.action, undefined)
  }
  if (scenario.expectedProjectSources) {
    assert.deepEqual(
      result.grounding?.project?.sources.map((source) => source.path),
      scenario.expectedProjectSources,
    )
  }
  for (const available of advertisedTools) {
    if (scenario.projectAvailable === false)
      assert.equal(available.includes('project_search'), false)
    const browserAvailable = (scenario.capabilities ?? allCapabilities).capabilities.some(
      (capability) =>
        capability.id === 'browser-control' && capability.availability === 'available',
    )
    if (!browserAvailable)
      assert.equal(
        available.some((tool) => tool.startsWith('browser_')),
        false,
      )
  }
}

async function structuredFallback(): Promise<void> {
  let call = 0
  const selected: string[] = []
  const llm: LLMProvider = {
    capabilities: () => ({ ...nativeCapabilities, supportsToolCalling: false }),
    chat: async () => {
      call += 1
      if (call === 1) {
        return '[project.search]{"query":"build command"}'
      }
      if (call === 2) {
        return '[shell.execute]{"command":"npm run build"}'
      }
      return '[happy]Сборка завершилась успешно.'
    },
  }
  const memory: MemoryStore = {
    getHistory: async () => [],
    appendTurn: async () => undefined,
    clear: async () => undefined,
  }
  const orchestrator = new Orchestrator(
    llm,
    memory,
    {} as SpeechClient,
    () => ({ uiLocale: 'ru' }) as AppSettings,
    () => ({
      search: async () => {
        selected.push('project.search')
        return projectPacket
      },
    }),
    { snapshot: async () => allCapabilities },
    async (request) => {
      selected.push(request.requestedCapabilities[0] === 'shell' ? 'shell.execute' : 'browser')
      return actionResult(1, request)
    },
  )
  const result = await orchestrator.createReply({
    userText: 'Найди команду сборки проекта и запусти её.',
  })
  assert.deepEqual(selected, ['project.search', 'shell.execute'])
  assert.match(result.replyText, /успешно/)
}

async function reasoningModelBrowserContinuation(): Promise<void> {
  let nativeCalls = 0
  let chatCalls = 0
  const requestOptions: LlmRequestOptions[] = []
  const actionSignals: AbortSignal[] = []
  const structuredPrompts: string[] = []
  const actionRequests: DesktopWorkflowRequest[] = []
  const searchObservation: BrowserObservation = {
    ...observation,
    url: 'https://ya.ru/',
    title: 'Яндекс',
    content: 'Поиск в интернете',
    interactiveElements: [{ ref: 'e1', role: 'textbox', name: 'Поиск' }],
  }
  const llm: LLMProvider = {
    capabilities: () => ({ ...nativeCapabilities, supportsReasoning: true }),
    complete: async () => {
      nativeCalls += 1
      throw new Error('reasoning models must not enter native multi-round tool transport')
    },
    chat: async (messages, options = {}) => {
      chatCalls += 1
      requestOptions.push(options)
      const structuredPrompt = messages.find(
        (message) =>
          message.role === 'system' &&
          typeof message.content === 'string' &&
          message.content.includes('## Structured Character Tool Transport'),
      )?.content
      assert.equal(typeof structuredPrompt, 'string')
      structuredPrompts.push(structuredPrompt as string)
      if (chatCalls === 1) {
        return '<shio-tools>{"calls":[{"tool":"browser.observe","arguments":{}}]}</shio-tools>'
      }
      if (chatCalls === 2) {
        return `<shio-tools>{"calls":[{"tool":"browser.fill","arguments":{"target":{"kind":"semantic-ref","observationId":"${searchObservation.observationId}","ref":"e1"},"value":"что-то"}}]}</shio-tools>`
      }
      return '[happy]Готово — написала в поисковой строке.'
    },
  }
  const memory: MemoryStore = {
    getHistory: async () => [],
    appendTurn: async () => undefined,
    clear: async () => undefined,
  }
  const orchestrator = new Orchestrator(
    llm,
    memory,
    {} as SpeechClient,
    () => ({ uiLocale: 'ru' }) as AppSettings,
    undefined,
    { snapshot: async () => allCapabilities },
    async (request, signal) => {
      actionRequests.push(request)
      actionSignals.push(signal)
      return actionResult(actionRequests.length, request)
    },
    () => ({
      currentObservation: () => searchObservation,
      observe: async () => searchObservation,
    }),
  )

  const result = await orchestrator.createReply(
    {
      userText: 'Напиши что-то в поисковую строку на этой странице.',
    },
    {
      maxTokens: 777,
      timeoutMs: 4_567,
    },
  )

  assert.equal(nativeCalls, 0)
  assert.equal(chatCalls, 3)
  assert(requestOptions.every((options) => options.maxTokens === 777))
  assert(requestOptions.every((options) => options.timeoutMs === 4_567))
  assert(structuredPrompts.every((prompt) => prompt.length < 8_000))
  assert.match(structuredPrompts[1], new RegExp(searchObservation.observationId, 'u'))
  assert.equal(actionRequests.length, 1)
  assert.equal(actionSignals.length, 1)
  assert.equal(actionSignals[0], requestOptions[0]?.signal)
  assert.equal(actionRequests[0].browserOperation?.operation, 'fill')
  assert.match(result.replyText, /Готово/u)
  assert.doesNotMatch(result.replyText, /Не смогла безопасно завершить/u)
}

async function noToolRequestOptionsPreserved(): Promise<void> {
  let receivedOptions: LlmRequestOptions | undefined
  const llm: LLMProvider = {
    chat: async (_messages, options) => {
      receivedOptions = options
      return '[calm]Обычный ответ без инструментов.'
    },
  }
  const memory: MemoryStore = {
    getHistory: async () => [],
    appendTurn: async () => undefined,
    clear: async () => undefined,
  }
  const orchestrator = new Orchestrator(
    llm,
    memory,
    {} as SpeechClient,
    () => ({ uiLocale: 'ru' }) as AppSettings,
  )

  await orchestrator.createReply(
    { userText: 'Объясни React в двух словах.' },
    { maxTokens: 333, timeoutMs: 9_123 },
  )

  assert.equal(receivedOptions?.maxTokens, 333)
  assert.equal(receivedOptions?.timeoutMs, 9_123)
  assert(receivedOptions?.signal)
}

async function completedActionContinuationIsBoundedAndNotRetried(): Promise<void> {
  let chatCalls = 0
  const requestOptions: LlmRequestOptions[] = []
  const llm: LLMProvider = {
    capabilities: () => ({ ...nativeCapabilities, supportsReasoning: true }),
    chat: async (_messages, options = {}) => {
      chatCalls += 1
      requestOptions.push(options)
      if (chatCalls === 1) {
        return '<shio-tools>{"calls":[{"tool":"browser.open","arguments":{"url":"https://example.test"}}]}</shio-tools>'
      }
      throw new LlmResponseError({
        provider: 'mistral',
        code: 'NETWORK_ERROR',
        recoverable: true,
        message: 'controlled post-action network failure',
      })
    },
  }
  const memory: MemoryStore = {
    getHistory: async () => [],
    appendTurn: async () => undefined,
    clear: async () => undefined,
  }
  const orchestrator = new Orchestrator(
    llm,
    memory,
    {} as SpeechClient,
    () => ({ uiLocale: 'ru' }) as AppSettings,
    undefined,
    { snapshot: async () => allCapabilities },
    async (request) => actionResult(1, request),
  )

  const result = await orchestrator.createReply(
    { userText: 'Открой страницу.' },
    { timeoutMs: 60_000 },
  )

  assert.equal(chatCalls, 2)
  assert.equal(requestOptions[0]?.timeoutMs, 60_000)
  assert.equal(requestOptions[1]?.timeoutMs, CHARACTER_TOOL_CONTINUATION_TIMEOUT_MS)
  assert.match(result.replyText, /Готово.+открыта страница/u)
}

function compactToolProtocolContainment(): void {
  const multiple = parseCharacterToolDirective(
    '[browser.open]{"url":"https://example.test","goal":"open"}\n[browser.observe]{}',
  )
  assert.equal(multiple.kind, 'calls')
  if (multiple.kind === 'calls') {
    assert.deepEqual(
      multiple.calls.map((call) => call.tool),
      ['browser.open', 'browser.observe'],
    )
  }
  const fencedXml = parseCharacterToolDirective(
    '```json\n<shio-tools>{"calls":[{"tool":"browser.observe","arguments":{}}]}</shio-tools>\n```',
  )
  assert.equal(fencedXml.kind, 'calls')
  const trailingReply = parseCharacterToolDirective(
    '[browser.open]: {"url":"https://example.test"}\n[calm]Готово.',
  )
  assert.equal(trailingReply.kind, 'calls')
  if (trailingReply.kind === 'calls') {
    assert.deepEqual(
      trailingReply.calls.map((call) => call.tool),
      ['browser.open'],
    )
  }
  const fencedArguments = parseCharacterToolDirective(
    '[browser.open]\n```json\n{"url":"https://example.test"}\n```',
  )
  assert.equal(fencedArguments.kind, 'calls')
  const nativeEnvelope = parseCharacterToolDirective(
    '<shio-tools>{"tool_calls":[{"type":"function","function":{"name":"browser_open","arguments":"{\\"url\\":\\"https://example.test\\"}"}}]}</shio-tools>',
  )
  assert.equal(nativeEnvelope.kind, 'calls')
  if (nativeEnvelope.kind === 'calls') {
    assert.equal(nativeEnvelope.calls[0]?.tool, 'browser.open')
    assert.deepEqual(nativeEnvelope.calls[0]?.arguments, { url: 'https://example.test' })
  }
  const inputAlias = parseCharacterToolDirective(
    '<shio-tools>{"calls":[{"name":"browser.observe","input":{}}]}</shio-tools>',
  )
  assert.equal(inputAlias.kind, 'calls')
  const json5Envelope = parseCharacterToolDirective(
    "<shio-tools>{calls:[{tool:'browser.open',arguments:{url:'https://example.test'},},],}</shio-tools>",
  )
  assert.equal(json5Envelope.kind, 'calls')
  const missingCallClosure = parseCharacterToolDirective(
    '<shio-tools>{"calls":[{"tool":"browser.open","arguments":{"url":"https://example.test","goal":"open"},{"tool":"browser.observe","arguments":{}}]}</shio-tools>',
  )
  assert.equal(missingCallClosure.kind, 'calls')
  if (missingCallClosure.kind === 'calls') {
    assert.deepEqual(
      missingCallClosure.calls.map((call) => call.tool),
      ['browser.open', 'browser.observe'],
    )
  }
  assert.equal(parseCharacterToolDirective('[calm]Обычный ответ.').kind, 'none')
  assert.equal(parseCharacterToolDirective('[browser.unknown]{"value":1}').kind, 'malformed')
  assert.equal(parseCharacterToolDirective('[browser.open]{not-json}').kind, 'malformed')
}

function browserGameToolsStayHighLevel(): void {
  const disabled = new CharacterToolRegistry({
    projectAvailable: false,
    capabilityContext: gameCapabilities,
    browserObservation: null,
    actionsAvailable: false,
    browserGameAvailable: false,
  })
  assert.equal(
    disabled.definitions().some((tool) => tool.id.startsWith('game.')),
    false,
  )

  const enabled = new CharacterToolRegistry({
    projectAvailable: false,
    capabilityContext: gameCapabilities,
    browserObservation: null,
    actionsAvailable: false,
    browserGameAvailable: true,
  })
  assert.deepEqual(
    enabled
      .definitions()
      .filter((tool) => tool.id.startsWith('game.'))
      .map((tool) => tool.id),
    ['game.start', 'game.pause', 'game.resume', 'game.stop', 'game.status'],
  )
  const serialized = JSON.stringify(enabled.nativeDefinitions())
  for (const forbidden of ['game.click', 'game.keyDown', 'game.keyUp', 'game.frame']) {
    assert.equal(serialized.includes(forbidden), false)
  }
  const startTool = enabled.definitions().find((tool) => tool.id === 'game.start')
  assert(startTool)
  assert.match(startTool.description, /supports pointer input only/u)
  assert.deepEqual(
    (
      (startTool.inputSchema.properties as Record<string, unknown>).allowedInputs as {
        items: { enum: readonly string[] }
      }
    ).items.enum,
    ['pointer'],
  )
}

async function browserGameStartUsesPreparedActionScope(): Promise<void> {
  const idleStatus: BrowserGameStatus = {
    state: 'idle',
    strategy: 'balanced',
    telemetry: {
      capturedFrames: 0,
      droppedFrames: 0,
      staleDecisions: 0,
      inputEvents: 0,
      gameEvents: 0,
      commentCandidates: 0,
      commentCooldownSuppressions: 0,
      commentBusySuppressions: 0,
      commentPolicySuppressions: 0,
      captureFps: 0,
      inputEventsPerSecond: 0,
      sessionDurationMs: 0,
    },
  }
  const runningStatus: BrowserGameStatus = {
    ...idleStatus,
    state: 'running',
  }
  const waitingStatus: BrowserGameStatus = {
    ...idleStatus,
    state: 'waiting-user',
    waitingReason: 'captcha',
  }
  const preparation: GameStartPreparation = {
    preparationId: 'game-preparation-00000000-0000-4000-8000-000000000001',
    goal: 'Win the fixture round',
    browserSessionId: 'browser-session-00000000-0000-4000-8000-000000000001',
    tabId: 'tab-1',
    origin: 'https://game.example.test',
    url: 'https://game.example.test/fixture',
    surface: {
      id: 'game-surface-0',
      kind: 'canvas',
      label: 'Fixture canvas',
      bounds: { x: 20, y: 30, width: 640, height: 480 },
    },
    allowedInputs: ['pointer', 'keyboard'],
    maxDurationMs: 300_000,
    maxInputEvents: 5_000,
    maxInputEventsPerSecond: 15,
    navigation: 'same-origin-only',
    strategy: 'balanced',
    createdAt: 1,
    expiresAt: 10_001,
  }
  const preparedRequests: CharacterGameStartRequest[] = []
  const provider: BrowserGameControlProvider = {
    discoverSurfaces: async () => [preparation.surface],
    prepareStart: async (request) => {
      preparedRequests.push(request)
      return preparation
    },
    start: async () => runningStatus,
    pause: async () => ({ ...idleStatus, state: 'paused' }),
    resume: async () => runningStatus,
    stop: async () => ({ ...idleStatus, state: 'stopped' }),
    updateStrategy: () => runningStatus,
    status: () => waitingStatus,
  }
  const registry = new CharacterToolRegistry({
    projectAvailable: false,
    capabilityContext: gameCapabilities,
    browserObservation: null,
    actionsAvailable: false,
    browserGameAvailable: true,
  })
  const actions: BrowserGameControlAction[] = []
  const dispatcher = new CharacterToolDispatcher({
    registry: () => registry,
    traceId: 'game-tool-repro',
    userGoal: 'Сыграй за меня в эту браузерную игру.',
    signal: new AbortController().signal,
    browserGame: () => provider,
    executeBrowserGameAction: async (action) => {
      actions.push(action)
      return { outcome: 'success', authorization: 'confirmed', status: runningStatus }
    },
  })
  dispatcher.registerPlannedTools(['game.start', 'game.status'])
  const result = await dispatcher.execute('game.start', { goal: 'Win the fixture round' })
  assert.deepEqual(preparedRequests, [
    {
      goal: 'Win the fixture round',
      allowedInputs: ['pointer'],
      maxDurationMs: 300_000,
      maxInputEvents: 5_000,
      maxInputEventsPerSecond: 15,
      navigation: 'same-origin-only',
      strategy: 'balanced',
    },
  ])
  assert.deepEqual(actions, [
    {
      operation: 'start',
      preparationId: preparation.preparationId,
    },
  ])
  assert.equal(JSON.parse(result.content).data.game.state, 'running')
  assert.equal(result.content.includes('authorizationActionId'), false)
  assert.equal(result.content.includes('bounds'), false)
  const statusResult = await dispatcher.execute('game.status', {})
  assert.equal(JSON.parse(statusResult.content).data.game.state, 'waiting-user')
  assert.equal(JSON.parse(statusResult.content).data.game.waitingReason, 'captcha')
}

async function main(): Promise<void> {
  const scenarios: readonly Scenario[] = [
    {
      name: 'generic React knowledge',
      userText: 'Что такое React?',
      steps: [{ reply: '[calm]React — библиотека для построения интерфейсов.' }],
      expectedTools: [],
    },
    {
      name: 'project React fact',
      userText: 'Используется ли React в этом проекте?',
      steps: [
        { tool: 'project_search', input: { query: 'React usage in this project' } },
        { reply: '[calm]Да, React используется в Desktop.' },
      ],
      expectedTools: ['project_search'],
    },
    {
      name: 'installed Node version',
      userText: 'Какая версия Node установлена?',
      steps: [
        { tool: 'shell_execute', input: { command: 'node -v' } },
        { reply: '[calm]Установлена Node.js 24.19.0.' },
      ],
      expectedTools: ['shell_execute'],
    },
    {
      name: 'project Node requirement',
      userText: 'Какая версия Node требуется этому проекту?',
      steps: [
        { tool: 'project_search', input: { query: 'Node engine requirement' } },
        { reply: '[calm]Проекту нужна Node.js 22 или новее.' },
      ],
      expectedTools: ['project_search'],
    },
    {
      name: 'multiple project searches preserve distinct evidence',
      userText: 'Сравни frontend stack и security model этого проекта.',
      projectEvidencePaths: {
        'frontend stack': 'apps/desktop/package.json',
        'security model': 'apps/desktop/src/main/security.ts',
      },
      steps: [
        { tool: 'project_search', input: { query: 'frontend stack' } },
        { tool: 'project_search', input: { query: 'security model' } },
        { reply: '[calm]Сравнила оба аспекта.' },
      ],
      expectedProjectSources: ['apps/desktop/package.json', 'apps/desktop/src/main/security.ts'],
      expectedTools: ['project_search', 'project_search'],
    },
    {
      name: 'normalized duplicate project search reuses turn packet',
      userText: 'Проверь frontend stack дважды.',
      steps: [
        { tool: 'project_search', input: { query: ' Frontend   Stack ' } },
        { tool: 'project_search', input: { query: 'frontend stack' } },
        { reply: '[calm]Проверила.' },
      ],
      expectedProjectCalls: 1,
      expectedTools: ['project_search', 'project_search'],
    },
    {
      name: 'project then shell comparison',
      userText: 'Проверь, совпадает ли установленная Node с требованием проекта.',
      steps: [
        { tool: 'project_search', input: { query: 'Node engine requirement' } },
        { tool: 'shell_execute', input: { command: 'node -v' } },
        { reply: '[happy]Да, установленная версия соответствует требованию.' },
      ],
      expectedTools: ['project_search', 'shell_execute'],
    },
    {
      name: 'current Blender version',
      userText: 'Какая последняя версия Blender?',
      steps: [
        { tool: 'browser_open', input: { url: 'https://www.blender.org/download/' } },
        { reply: '[calm]Последняя стабильная версия указана на странице релизов.' },
      ],
      expectedTools: ['browser_open'],
    },
    {
      name: 'read current browser page',
      userText: 'Что сейчас открыто на странице?',
      steps: [
        { tool: 'browser_observe', input: {} },
        { reply: '[calm]На странице показана текущая стабильная версия Three.js.' },
      ],
      expectedTools: ['browser_observe'],
    },
    {
      name: 'explicit pre-evidence browser to shell plan',
      userText: 'Открой страницу и сравни с локальной версией Node.',
      steps: [
        {
          tools: [
            { tool: 'browser_open', input: { url: 'https://nodejs.org/en/download' } },
            { tool: 'shell_execute', input: { command: 'node -v' } },
          ],
        },
        { reply: '[calm]Сравнила версии.' },
      ],
      expectedTools: ['browser_open', 'shell_execute'],
    },
    {
      name: 'browser content cannot introduce shell capability',
      userText: 'Что сейчас на странице?',
      steps: [
        { tool: 'browser_observe', input: {} },
        { tool: 'shell_execute', input: { command: 'node -v' } },
        { reply: '[calm]Страница не может расширить мои полномочия.' },
      ],
      expectedActionRequests: 0,
      expectedTools: ['browser_observe', 'shell_execute'],
    },
    {
      name: 'project then browser comparison',
      userText: 'Посмотри версию Three.js в проекте и проверь текущую стабильную в интернете.',
      steps: [
        { tool: 'project_search', input: { query: 'installed Three.js version' } },
        { tool: 'browser_open', input: { url: 'https://threejs.org/' } },
        { reply: '[calm]В проекте r179, а текущая стабильная — r180.' },
      ],
      expectedTools: ['project_search', 'browser_open'],
    },
    {
      name: 'browser then project comparison',
      userText: 'Открой сайт и сравни информацию с package.json.',
      steps: [
        { tool: 'browser_open', input: { url: 'https://example.test/releases' } },
        {
          tool: 'project_search',
          input: { query: 'package version', hints: { paths: ['package.json'] } },
        },
        { reply: '[calm]Сравнила данные сайта с package.json.' },
      ],
      expectedTools: ['browser_open', 'project_search'],
    },
    {
      name: 'project then typecheck action',
      userText: 'Запусти typecheck этого проекта.',
      steps: [
        { tool: 'project_search', input: { query: 'typecheck command' } },
        { tool: 'shell_execute', input: { command: 'npm run typecheck' } },
        { reply: '[happy]Typecheck завершился успешно.' },
      ],
      expectedTools: ['project_search', 'shell_execute'],
    },
    ...[
      'Объясни архитектуру event bus в общем.',
      'Electron тормозит, почему?',
      'Node.js хороший runtime?',
      'Что такое GitHub?',
      'Покажи пример file.ts',
      'У меня баг в коде',
    ].map((userText) => ({
      name: `negative: ${userText}`,
      userText,
      steps: [{ reply: '[calm]Обычный ответ без обращения к инструментам.' }],
      expectedTools: [],
    })),
    {
      name: 'project-specific Event Bus',
      userText: 'Как Event Bus устроен в Shio?',
      steps: [
        { tool: 'project_search', input: { query: 'Shio Event Bus architecture' } },
        { reply: '[calm]Вот как Event Bus устроен в Shio.' },
      ],
      expectedTools: ['project_search'],
    },
    {
      name: 'project failure remains in Character turn',
      userText: 'Как устроен этот проект?',
      projectFailure: true,
      steps: [
        { tool: 'project_search', input: { query: 'project architecture' } },
        { reply: '[calm]Сейчас не получилось получить данные проекта.' },
      ],
      expectedTools: ['project_search'],
    },
    {
      name: 'disabled tools are absent',
      userText: 'Что сейчас доступно?',
      projectAvailable: false,
      capabilities: { schemaVersion: 1, generatedAt: 1, capabilities: [] },
      steps: [{ reply: '[calm]Дополнительные инструменты сейчас недоступны.' }],
      expectedTools: [],
    },
  ]

  for (const scenario of scenarios) await runScenario(scenario)
  await structuredFallback()
  await reasoningModelBrowserContinuation()
  await noToolRequestOptionsPreserved()
  await completedActionContinuationIsBoundedAndNotRetried()
  compactToolProtocolContainment()
  browserGameToolsStayHighLevel()
  await browserGameStartUsesPreparedActionScope()
  console.log('Semantic Character Tool Arbitration matrix: PASS')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
