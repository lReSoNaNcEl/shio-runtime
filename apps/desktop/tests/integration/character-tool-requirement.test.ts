import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it } from 'vitest'

import { CharacterToolDispatcher } from '../../src/main/character-tools/CharacterToolDispatcher'
import { CharacterToolLoop } from '../../src/main/character-tools/CharacterToolLoop'
import { CharacterToolRegistry } from '../../src/main/character-tools/CharacterToolRegistry'
import type { ChatMessage, LLMProvider, LlmCapabilities, LlmCompletion } from '../../src/main/llm'
import { LlmResponseError } from '../../src/main/llm/errors'
import { createSemanticMemoryRuntime, MemoryToolBroker } from '../../src/main/memory'
import type { PersistentGoal } from '../../src/shared/alive'
import {
  type BrowserComputerUseProvider,
  type BrowserComputerUseSession,
  EMPTY_BROWSER_COMPUTER_USE_DIAGNOSTICS,
} from '../../src/shared/browser-computer-use'
import type { BrowserContextProvider, BrowserObservation } from '../../src/shared/browser-control'
import type { ShioCapabilitySnapshot } from '../../src/shared/capabilities'
import type { CharacterToolRequirement } from '../../src/shared/character-tools'
import type { ProjectContextPacket } from '../../src/shared/project-awareness'
import type { WebSearchProvider } from '../../src/shared/web-search'

const capabilities: LlmCapabilities = {
  supportsReasoning: false,
  supportsStreaming: false,
  supportsTemperature: true,
  supportsSystemPrompt: true,
  supportsToolCalling: true,
  supportsVision: false,
  recommendedMaxTokens: 1_024,
}

describe('constrained planning transport', () => {
  it('quotes prior prose and carries attached-image availability without bypassing domain validation', async () => {
    let planningRequests = 0
    const currentRegistry = () => registry(false)
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({ ...capabilities, supportsSchemaOutput: true }),
        chat: async () => '[calm]Красный квадрат.',
        complete: async (messages, options) => {
          if (!options?.responseSchema) return textCompletion('[calm]Красный квадрат.')
          planningRequests += 1
          assert.equal(options.tools, undefined)
          const properties = options.responseSchema.schema.properties as Record<
            string,
            { maxItems?: number }
          >
          assert.equal(properties.plannedTools.maxItems, 0)
          // Availability constrains the plan, never erases an exact unavailable-tool requirement.
          assert(JSON.stringify(options.responseSchema.schema).includes('memory.list'))
          assert.equal(messages.filter((message) => message.role === 'user').length, 1)
          const input = JSON.parse(String(messages[1].content))
          assert.equal(input.screenAttachmentAvailable, true)
          assert.equal(input.currentTurn, 'Что на приложенной картинке?')
          assert.equal(input.priorConversation[0].content, 'Продолжай историю!')
          return textCompletion(
            JSON.stringify({
              requirement: { type: 'direct-answer' },
              plannedTools: [],
              embodiment: null,
              ...(planningRequests === 1 ? { unexpectedAuthority: true } : {}),
            }),
          )
        },
      },
      providerId: 'mistral',
      messages: [
        { role: 'assistant', content: 'Продолжай историю!' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Что на приложенной картинке?' },
            { type: 'image', mimeType: 'image/png', bytes: new Uint8Array([1]) },
          ],
        },
      ],
      registry: currentRegistry,
      createDispatcher: () =>
        ({ registerPlannedTools: () => undefined, dispose: () => undefined }) as never,
      traceId: 'schema-planning',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      failureReply: 'FAILURE',
      limitReply: 'LIMIT',
    })
    assert.equal(planningRequests, 2)
    assert.equal(result.assistantTurnKind, 'character')
    assert.equal(result.replyText, '[calm]Красный квадрат.')
  })
})

function registry(webAvailable: boolean): CharacterToolRegistry {
  return new CharacterToolRegistry({
    projectAvailable: false,
    webAvailable,
    capabilityContext: null,
    browserObservation: null,
    actionsAvailable: false,
  })
}

function webCall(): LlmCompletion {
  return {
    content: '',
    toolCalls: [
      {
        id: 'web-call',
        name: 'web_search',
        argumentsJson: JSON.stringify({ query: 'Fish Audio S2.1 Pro free access end date' }),
      },
    ],
    finishReason: 'tool_calls',
  }
}

function textCompletion(content: string): LlmCompletion {
  return { content, toolCalls: [], finishReason: 'stop' }
}

async function runWebRequirement(options: {
  web: WebSearchProvider
  complete: LLMProvider['complete']
  capabilities?: LlmCapabilities
  requirement?: CharacterToolRequirement
}) {
  const currentRegistry = () => registry(true)
  return new CharacterToolLoop().run({
    llm: {
      capabilities: () => options.capabilities ?? capabilities,
      chat: async () =>
        JSON.stringify(options.requirement ?? { type: 'explicit-tool', tool: 'web.search' }),
      complete: async (messages, requestOptions) => {
        if (requestOptions?.tools?.some((tool) => tool.name === 'character_tool_requirement')) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'requirement-call',
                name: 'character_tool_requirement',
                argumentsJson: JSON.stringify(
                  options.requirement ?? { type: 'explicit-tool', tool: 'web.search' },
                ),
              },
            ],
            finishReason: 'tool_calls',
          }
        }
        return options.complete?.(messages, requestOptions) as Promise<LlmCompletion>
      },
    },
    providerId: 'mistral',
    messages: [
      {
        role: 'user',
        content:
          'Можешь через web.search узнать, до какого числа дают бесплатный доступ Fish Audio S2.1 Pro?',
      },
    ],
    registry: currentRegistry,
    createDispatcher: (signal) =>
      new CharacterToolDispatcher({
        registry: currentRegistry,
        traceId: 'explicit-web-search-regression',
        userGoal: 'Узнать точную дату через web.search',
        signal,
        webSearch: () => options.web,
      }),
    traceId: 'explicit-web-search-regression',
    requestOptions: {},
    nativeToolsRejected: false,
    enforceToolRequirements: true,
    requirementFailureReply: (requirement, reason) =>
      `REQUIREMENT_FAILURE:${reason}:${JSON.stringify(requirement)}`,
    failureReply: 'TOOL_FAILURE',
    limitReply: 'TOOL_LIMIT',
  })
}

describe('Character Tool Requirement', () => {
  it('uses structured planning for one missing native call without disabling future native tools', async () => {
    const currentRegistry = () => registry(false)
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => capabilities,
        complete: async (messages) => {
          assert(
            messages.some((message) =>
              String(message.content).includes('calling character_tool_requirement exactly once'),
            ),
          )
          throw new LlmResponseError({
            provider: 'mistral',
            code: 'INCOMPLETE_TOOL_CALL',
            message: 'Required call missing',
          })
        },
        chat: async (messages) =>
          String(messages[0].content).includes('Character Tool Requirement Planning')
            ? JSON.stringify({
                requirement: { type: 'direct-answer' },
                plannedTools: [],
                embodiment: null,
              })
            : '[calm]Продолжение истории.',
      },
      providerId: 'mistral',
      messages: [{ role: 'user', content: 'Продолжи нашу вымышленную историю.' }],
      registry: currentRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: currentRegistry,
          traceId: 'missing-native-call',
          userGoal: 'Продолжить историю',
          signal,
        }),
      traceId: 'missing-native-call',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      requirementFailureReply: () => 'REQUIREMENT_FAILURE',
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })
    assert.equal(result.nativeToolsRejected, false)
    assert.equal(result.replyText, '[calm]Продолжение истории.')
  })

  it('calls memory.list without an invented kind and returns stored records', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'shio-memory-list-requirement-'))
    const runtime = createSemanticMemoryRuntime(join(directory, 'memory.sqlite'))
    try {
      runtime.setEnabled(true)
      runtime.createManual({
        kind: 'preference',
        text: 'Пользователь предпочитает тёмную тему.',
      })
      const broker = new MemoryToolBroker(runtime)
      const currentRegistry = () =>
        new CharacterToolRegistry({
          projectAvailable: false,
          capabilityContext: null,
          browserObservation: null,
          memory: broker,
          actionsAvailable: false,
        })
      let replyCalls = 0
      let planningPrompt = ''
      const result = await new CharacterToolLoop().run({
        llm: {
          capabilities: () => ({ ...capabilities, supportsToolCalling: false }),
          complete: async () => {
            throw new Error(
              'Native completion is not expected for this structured-provider fixture',
            )
          },
          chat: async (messages) => {
            const prompt = messages.map((message) => String(message.content)).join('\n')
            if (prompt.includes('Character Tool Requirement Planning')) {
              planningPrompt = prompt
              return JSON.stringify({
                requirement: { type: 'explicit-tool', tool: 'memory.list' },
                plannedTools: ['memory.list'],
              })
            }
            replyCalls += 1
            if (replyCalls === 1) {
              assert.match(prompt, /"id":"memory\.list"/u)
              return '<shio-tools>{"calls":[{"tool":"memory.list","arguments":{"limit":20}}]}</shio-tools>'
            }
            assert.match(prompt, /Пользователь предпочитает тёмную тему/u)
            return '[warm]Я помню, что ты предпочитаешь тёмную тему.'
          },
        },
        providerId: 'mistral',
        messages: [
          {
            role: 'user',
            content:
              'Вызови memory.list с аргументами {"limit":20} и перечисли, что ты помнишь обо мне.',
          },
        ],
        registry: currentRegistry,
        createDispatcher: (signal) =>
          new CharacterToolDispatcher({
            registry: currentRegistry,
            traceId: 'memory-list-requirement',
            userGoal: 'Перечислить записи долговременной памяти',
            signal,
            semanticMemory: broker,
          }),
        traceId: 'memory-list-requirement',
        requestOptions: {},
        nativeToolsRejected: false,
        enforceToolRequirements: true,
        failureReply: 'TOOL_FAILURE',
        limitReply: 'TOOL_LIMIT',
      })

      assert.match(planningPrompt, /Use explicit-tool memory\.list/u)
      assert.equal(replyCalls, 2)
      assert.equal(result.calls, 1)
      assert.deepEqual(result.toolEvidence.requirement, {
        type: 'explicit-tool',
        tool: 'memory.list',
      })
      assert.deepEqual(result.toolEvidence.executedTools, ['memory.list'])
      assert.equal(result.toolEvidence.memory.succeeded, true)
      assert.match(result.replyText, /тёмную тему/u)
    } finally {
      runtime.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('maps an explicit Goal Store listing to goal.list and returns active next steps', async () => {
    const goals: readonly PersistentGoal[] = [
      {
        id: 'goal-active-00000000-0000-4000-8000-000000000001',
        title: 'Подготовить релиз',
        description: 'Завершить квалификацию релиза.',
        nextStep: 'Запустить deterministic regression suite.',
        lastNote: '',
        owner: 'shared',
        status: 'active',
        progress: 0.5,
        measurable: true,
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: 'goal-paused-00000000-0000-4000-8000-000000000002',
        title: 'Отложенная цель',
        description: '',
        nextStep: 'Дождаться решения.',
        lastNote: '',
        owner: 'user',
        status: 'paused',
        progress: 0,
        measurable: false,
        createdAt: 1,
        updatedAt: 2,
      },
    ]
    const currentRegistry = () =>
      new CharacterToolRegistry({
        projectAvailable: false,
        goalsAvailable: true,
        capabilityContext: null,
        browserObservation: null,
        actionsAvailable: false,
      })
    let replyCalls = 0
    let planningPrompt = ''
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({ ...capabilities, supportsToolCalling: false }),
        complete: async () => {
          throw new Error('Native completion is not expected for this structured-provider fixture')
        },
        chat: async (messages) => {
          const prompt = messages.map((message) => String(message.content)).join('\n')
          if (prompt.includes('Character Tool Requirement Planning')) {
            planningPrompt = prompt
            return JSON.stringify({
              requirement: { type: 'explicit-tool', tool: 'goal.list' },
              plannedTools: ['goal.list'],
            })
          }
          replyCalls += 1
          if (replyCalls === 1) {
            assert.match(prompt, /"id":"goal\.list"/u)
            return '<shio-tools>{"calls":[{"tool":"goal.list","arguments":{"status":"active","limit":20}}]}</shio-tools>'
          }
          assert.match(prompt, /Подготовить релиз/u)
          assert.match(prompt, /Запустить deterministic regression suite/u)
          assert.doesNotMatch(prompt, /Отложенная цель/u)
          return '[calm]Активная цель: «Подготовить релиз». Следующий шаг — запустить regression suite.'
        },
      },
      providerId: 'mistral',
      messages: [
        {
          role: 'user',
          content:
            'Вызови goal.list с аргументами {"status":"active","limit":20} и покажи активные цели.',
        },
      ],
      registry: currentRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: currentRegistry,
          traceId: 'active-goal-list-requirement',
          userGoal: 'Показать активные цели из Goal Store',
          signal,
          persistentGoals: () => goals,
        }),
      traceId: 'active-goal-list-requirement',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })

    assert.match(planningPrompt, /Use explicit-tool goal\.list/u)
    assert.equal(replyCalls, 2)
    assert.equal(result.calls, 1)
    assert.deepEqual(result.toolEvidence.requirement, {
      type: 'explicit-tool',
      tool: 'goal.list',
    })
    assert.deepEqual(result.toolEvidence.executedTools, ['goal.list'])
    assert.match(result.replyText, /Подготовить релиз/u)
  })

  it('treats attached Screen Context as direct visual evidence without browser tools', async () => {
    const browserCapabilities: ShioCapabilitySnapshot = {
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
      ],
    }
    const currentRegistry = () =>
      new CharacterToolRegistry({
        projectAvailable: false,
        capabilityContext: browserCapabilities,
        browserObservation: null,
        actionsAvailable: true,
      })
    let planningPrompt = ''
    let responseReceivedImage = false
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({ ...capabilities, supportsToolCalling: false, supportsVision: true }),
        complete: async () => {
          throw new Error('Native completion is not expected for this structured-provider fixture')
        },
        chat: async (messages) => {
          const prompt = messages.map((message) => String(message.content)).join('\n')
          if (prompt.includes('Character Tool Requirement Planning')) {
            planningPrompt = prompt
            return JSON.stringify({ requirement: { type: 'direct-answer' }, plannedTools: [] })
          }
          responseReceivedImage = messages.some(
            (message) =>
              message.role === 'user' &&
              Array.isArray(message.content) &&
              message.content.some((part) => part.type === 'image'),
          )
          return '[calm]На приложенном снимке виден интерфейс приложения.'
        },
      },
      providerId: 'mistral',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Проанализируй приложенный снимок экрана.' },
            { type: 'image', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
          ],
        },
      ],
      registry: currentRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: currentRegistry,
          traceId: 'attached-screen-context-requirement',
          userGoal: 'Проанализировать приложенный снимок экрана',
          signal,
        }),
      traceId: 'attached-screen-context-requirement',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })

    assert.match(planningPrompt, /Screen Context image attached[^\n]*yes/u)
    assert.match(planningPrompt, /Return direct-answer with no browser tools/u)
    assert.match(planningPrompt, /browser\.observe cannot inspect Screen Context/u)
    assert.equal(responseReceivedImage, true)
    assert.equal(result.calls, 0)
    assert.deepEqual(result.toolEvidence.requirement, { type: 'direct-answer' })
    assert.deepEqual(result.toolEvidence.executedTools, [])
  })

  it('uses the supplied World Context for a current system status question', async () => {
    const currentRegistry = () => registry(false)
    let planningPrompt = ''
    let responsePrompt = ''
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({ ...capabilities, supportsToolCalling: false }),
        complete: async () => {
          throw new Error('Native completion is not expected for this structured-provider fixture')
        },
        chat: async (messages) => {
          const prompt = messages.map((message) => String(message.content)).join('\n')
          if (prompt.includes('Character Tool Requirement Planning')) {
            planningPrompt = prompt
            return JSON.stringify({
              requirement: { type: 'direct-answer' },
              plannedTools: [],
            })
          }
          responsePrompt = prompt
          return '[calm]Сейчас на переднем плане Visual Studio Code; высокой нагрузки не видно.'
        },
      },
      providerId: 'mistral',
      messages: [
        {
          role: 'system',
          content: [
            '## Current World Context',
            'Present-state, request-scoped observations only.',
            JSON.stringify({
              foregroundApplication: { processName: 'Code.exe', displayName: 'Visual Studio Code' },
              runningApplications: [{ processName: 'Code.exe', displayName: 'Visual Studio Code' }],
              systemLoad: { cpuPercent: 8, memoryPercent: 42 },
            }),
          ].join('\n\n'),
        },
        {
          role: 'user',
          content: 'Что ты умеешь?',
        },
        {
          role: 'assistant',
          content: 'Могу подсказать, что делает твоя система на данный момент.',
        },
        {
          role: 'user',
          content: 'Что делает моя система на данный момент?',
        },
      ],
      registry: currentRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: currentRegistry,
          traceId: 'world-context-system-status',
          userGoal: 'Что делает моя система на данный момент?',
          signal,
        }),
      traceId: 'world-context-system-status',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })

    assert.match(planningPrompt, /Current World Context projection included[^\n]*yes/u)
    assert.match(planningPrompt, /return direct-answer/u)
    assert.match(planningPrompt, /browser\.useStatus only/u)
    assert.match(planningPrompt, /installed version of a command-line utility/u)
    assert.match(planningPrompt, /What npx version is installed on my computer/u)
    assert.match(planningPrompt, /do not make it browser-state/u)
    assert.match(responsePrompt, /Visual Studio Code/u)
    assert.match(result.replyText, /Visual Studio Code/u)
    assert.equal(result.calls, 0)
    assert.deepEqual(result.toolEvidence.requirement, { type: 'direct-answer' })
    assert.deepEqual(result.toolEvidence.executedTools, [])
  })

  it.each([
    'Управляй этой динамической страницей непрерывно, реагируй на изменения и остановись только когда я попрошу.',
    'Запусти browser.use для непрерывного управления до явной остановки.',
    'Открой любой сайт с играми, выбери любую игру и поиграй в неё 3–5 минут на своё усмотрение.',
  ])(
    'requires browser.use and returns after the background session starts: %s',
    async (request) => {
      const browserCapabilities: ShioCapabilitySnapshot = {
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
      const activeSession: BrowserComputerUseSession = {
        id: 'browser-use-session-00000000-0000-4000-8000-000000000003',
        goal: request,
        browserContextId: 'browser-session-1',
        pageId: 'browser-page-1',
        state: 'running',
        startedAt: 1,
        expiresAt: 1_800_001,
        maxSteps: 30,
        maxActions: 100,
        stepCount: 0,
        actionCount: 0,
        authorityScopeId: 'action-1',
        termination: { type: 'until-stopped' },
        continuousBudget: {
          maximumDurationMs: 1_800_000,
          maxSlowDecisionsPerMinute: 120,
          maxReactiveInputEventsPerSecond: 30,
          maxReactiveInputEventsTotal: 216_000,
          maxPointerHoldMs: 5_000,
          maxKeyHoldMs: 5_000,
          maxFrameRate: 30,
        },
        mode: 'visual',
        controlMode: 'slow',
        activity: 'observing',
        diagnostics: { ...EMPTY_BROWSER_COMPUTER_USE_DIAGNOSTICS },
      }
      const computerUse: BrowserComputerUseProvider = {
        browserContext: { currentObservation: () => null, observe: async () => null },
        status: () => ({
          enabled: true,
          browser: 'Google Chrome',
          isolatedProfile: true,
          semanticControl: 'ready',
          visualControl: 'ready',
          visualModel: 'fixture-vision',
          currentSession: activeSession,
        }),
        start: async () => activeSession,
        pause: async () => activeSession,
        resume: async () => activeSession,
        stop: async () => activeSession,
      }
      const currentRegistry = () =>
        new CharacterToolRegistry({
          projectAvailable: false,
          capabilityContext: browserCapabilities,
          browserObservation: null,
          actionsAvailable: true,
          browserComputerUseAvailable: true,
        })
      let responseRound = 0
      let actionCount = 0
      const result = await new CharacterToolLoop().run({
        llm: {
          capabilities: () => capabilities,
          chat: async () =>
            JSON.stringify({
              type: 'explicit-tool',
              tool: 'browser.use',
            } satisfies CharacterToolRequirement),
          complete: async () => {
            responseRound += 1
            if (responseRound === 1) return textCompletion('[calm]Начинаю управлять страницей.')
            if (responseRound === 2) {
              return {
                content: '',
                toolCalls: [
                  {
                    id: 'browser-use-call',
                    name: 'browser_use',
                    argumentsJson: JSON.stringify({
                      goal: request,
                      termination: { type: 'until-stopped' },
                    }),
                  },
                ],
                finishReason: 'tool_calls',
              }
            }
            return textCompletion('[calm]Управление браузером запущено и продолжится в фоне.')
          },
        },
        providerId: 'mistral',
        messages: [{ role: 'user', content: request }],
        registry: currentRegistry,
        createDispatcher: (signal) =>
          new CharacterToolDispatcher({
            registry: currentRegistry,
            traceId: 'continuous-browser-tool-requirement',
            userGoal: request,
            signal,
            browserComputerUse: () => computerUse,
            executeBrowserComputerUseAction: async () => {
              actionCount += 1
              return { outcome: 'success', authorization: 'confirmed', session: activeSession }
            },
          }),
        traceId: 'continuous-browser-tool-requirement',
        requestOptions: {},
        nativeToolsRejected: false,
        enforceToolRequirements: true,
        failureReply: 'TOOL_FAILURE',
        limitReply: 'TOOL_LIMIT',
      })

      assert.equal(actionCount, 1)
      assert.equal(responseRound, 3)
      assert.match(result.replyText, /продолжится в фоне/u)
      assert.deepEqual(result.toolEvidence, {
        requirement: { type: 'explicit-tool', tool: 'browser.use' },
        executedTools: ['browser.use'],
        failedTools: [],
        web: { used: false, succeeded: false },
        project: { used: false, succeeded: false },
        browser: { used: true, succeeded: true },
        memory: { used: false, succeeded: false },
      })
    },
  )

  it('uses fresh browser.useStatus state without rewriting previous turn evidence', async () => {
    const browserCapabilities: ShioCapabilitySnapshot = {
      schemaVersion: 1,
      generatedAt: 2,
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
    const currentSession: BrowserComputerUseSession = {
      id: 'browser-use-session-00000000-0000-4000-8000-000000000004',
      goal: 'Keep controlling the page',
      browserContextId: 'browser-session-1',
      pageId: 'browser-page-1',
      state: 'paused',
      startedAt: 1,
      expiresAt: 1_800_001,
      maxSteps: 30,
      maxActions: 100,
      stepCount: 40,
      actionCount: 18,
      authorityScopeId: 'action-1',
      termination: { type: 'until-stopped' },
      continuousBudget: {
        maximumDurationMs: 1_800_000,
        maxSlowDecisionsPerMinute: 120,
        maxReactiveInputEventsPerSecond: 30,
        maxReactiveInputEventsTotal: 216_000,
        maxPointerHoldMs: 5_000,
        maxKeyHoldMs: 5_000,
        maxFrameRate: 30,
      },
      mode: 'visual',
      controlMode: 'slow',
      activity: 'idle',
      diagnostics: { ...EMPTY_BROWSER_COMPUTER_USE_DIAGNOSTICS },
    }
    const provider: BrowserComputerUseProvider = {
      browserContext: { currentObservation: () => null, observe: async () => null },
      status: () => ({
        enabled: true,
        browser: 'Google Chrome',
        isolatedProfile: true,
        semanticControl: 'ready',
        visualControl: 'ready',
        visualModel: 'fixture-vision',
        currentSession,
      }),
      start: async () => currentSession,
      pause: async () => currentSession,
      resume: async () => currentSession,
      stop: async () => currentSession,
    }
    const currentRegistry = () =>
      new CharacterToolRegistry({
        projectAvailable: false,
        capabilityContext: browserCapabilities,
        browserObservation: null,
        actionsAvailable: true,
        browserComputerUseAvailable: true,
      })
    const prior = {
      requirement: { type: 'explicit-tool', tool: 'browser.use' } as const,
      executedTools: ['browser.use'] as const,
      failedTools: [] as const,
      web: { used: false, succeeded: false },
      project: { used: false, succeeded: false },
      browser: { used: true, succeeded: true },
      memory: { used: false, succeeded: false },
    }
    const priorBytes = JSON.stringify(prior)
    let responseRound = 0
    let statusPrompt = ''
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => capabilities,
        chat: async () =>
          JSON.stringify({
            type: 'explicit-tool',
            tool: 'browser.useStatus',
          } satisfies CharacterToolRequirement),
        complete: async (messages, requestOptions) => {
          if (requestOptions?.tools?.some((tool) => tool.name === 'character_tool_requirement')) {
            return {
              content: '',
              toolCalls: [
                {
                  id: 'status-requirement-call',
                  name: 'character_tool_requirement',
                  argumentsJson: JSON.stringify({
                    type: 'explicit-tool',
                    tool: 'browser.useStatus',
                  }),
                },
              ],
              finishReason: 'tool_calls',
            }
          }
          responseRound += 1
          if (responseRound === 1) {
            return {
              content: '',
              toolCalls: [
                {
                  id: 'browser-status-call',
                  name: 'browser_use_status',
                  argumentsJson: '{}',
                },
              ],
              finishReason: 'tool_calls',
            }
          }
          statusPrompt = messages.map((message) => String(message.content)).join('\n')
          return textCompletion('[calm]Сессия сейчас на паузе.')
        },
      },
      providerId: 'mistral',
      messages: [
        { role: 'user', content: 'Играй, пока я не остановлю.' },
        { role: 'assistant', content: 'Управление запущено.', toolEvidence: prior },
        { role: 'user', content: 'Ты всё ещё играешь?' },
      ],
      registry: currentRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: currentRegistry,
          traceId: 'fresh-browser-status',
          userGoal: 'Ты всё ещё играешь?',
          signal,
          browserComputerUse: () => provider,
        }),
      traceId: 'fresh-browser-status',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })

    assert.match(result.replyText, /на паузе/u)
    assert.match(statusPrompt, /"state":"paused"/u)
    assert.deepEqual(result.toolEvidence.executedTools, ['browser.useStatus'])
    assert.equal(JSON.stringify(prior), priorBytes)
  })

  it.each([false, true])(
    'requires the native web.search call with reasoning capability=%s and replay disabled',
    async (supportsReasoning) => {
      let searchCount = 0
      let responseRound = 0
      const web: WebSearchProvider = {
        status: () => ({
          availability: 'available',
          diagnostics: {
            parserSignature: 'fixture/v1',
            parserState: 'valid-results',
            consecutiveFailureCount: 0,
          },
        }),
        search: async () => {
          searchCount += 1
          return {
            results: [
              {
                title: 'Fish Audio announcement',
                url: 'https://example.test/fish-audio',
                snippet: 'The offer ends on 31 August 2026.',
                publishedAt: '2026-08-20T00:00:00.000Z',
              },
            ],
            truncated: false,
            provider: 'fixture',
          }
        },
      }
      const result = await runWebRequirement({
        web,
        capabilities: { ...capabilities, supportsReasoning, requiresReasoningReplay: false },
        complete: async (messages) => {
          responseRound += 1
          if (responseRound === 1) {
            return textCompletion('[calm]По памяти бесплатный доступ действует до 24 июля 2026.')
          }
          if (responseRound === 2) return webCall()
          const toolIndex = messages.findIndex((message) => message.role === 'tool')
          assert(toolIndex >= 0)
          assert.equal(messages.at(-1)?.role, 'tool')
          assert.equal(
            messages.slice(toolIndex + 1).some((message) => message.role === 'system'),
            false,
          )
          assert.match(String(messages.at(-1)?.content), /"requirementStatus":"succeeded"/u)
          return textCompletion(
            '[calm]По найденному источнику предложение действует до 31 августа.',
          )
        },
      })

      assert.equal(searchCount, 1)
      assert.equal(responseRound, 3)
      assert.equal(result.calls, 1)
      assert.equal(result.replyText.includes('24 июля'), false)
      assert.equal(result.toolEvidence.requirement.type, 'explicit-tool')
      assert.deepEqual(result.toolEvidence.executedTools, ['web.search'])
      assert.deepEqual(result.toolEvidence.failedTools, [])
      assert.deepEqual(result.toolEvidence.web, {
        used: true,
        succeeded: true,
        resultCount: 1,
        freshestSourceAt: Date.parse('2026-08-20T00:00:00.000Z'),
      })
    },
  )

  it('allows an honest terminal response after required web.search fails without retrying', async () => {
    let searchCount = 0
    let responseRound = 0
    const web: WebSearchProvider = {
      status: () => ({
        availability: 'degraded',
        reason: 'network-failure',
        diagnostics: {
          parserSignature: 'fixture/v1',
          parserState: 'not-observed',
          consecutiveFailureCount: 1,
        },
      }),
      search: async () => {
        searchCount += 1
        throw new Error('network unavailable')
      },
    }
    const result = await runWebRequirement({
      web,
      complete: async () => {
        responseRound += 1
        return responseRound === 1
          ? webCall()
          : textCompletion('[calm]Не смогла выполнить web.search, поэтому точную дату не назову.')
      },
    })

    assert.equal(searchCount, 1)
    assert.equal(responseRound, 2)
    assert.deepEqual(result.toolEvidence.executedTools, ['web.search'])
    assert.deepEqual(result.toolEvidence.failedTools, ['web.search'])
    assert.deepEqual(result.toolEvidence.web, { used: true, succeeded: false })
  })

  it('reports an explicitly requested unavailable tool instead of answering from memory', async () => {
    let replyCallCount = 0
    const emptyRegistry = () => registry(false)
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({ ...capabilities, supportsToolCalling: false }),
        complete: async () => {
          replyCallCount += 1
          return textCompletion('[calm]По памяти дата такая-то.')
        },
        chat: async () =>
          JSON.stringify({
            type: 'explicit-tool',
            tool: 'web.search',
          } satisfies CharacterToolRequirement),
      },
      providerId: 'mistral',
      messages: [{ role: 'user', content: 'Проверь это через web.search.' }],
      registry: emptyRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: emptyRegistry,
          traceId: 'unavailable-web-search',
          userGoal: 'Проверь это через web.search.',
          signal,
        }),
      traceId: 'unavailable-web-search',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      requirementFailureReply: (requirement, reason) =>
        `REQUIREMENT_FAILURE:${reason}:${JSON.stringify(requirement)}`,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })

    assert.equal(replyCallCount, 0)
    assert.match(result.replyText, /^REQUIREMENT_FAILURE:unavailable:/u)
    assert.deepEqual(result.toolEvidence.executedTools, [])
    assert.deepEqual(result.toolEvidence.web, { used: false, succeeded: false })
    assert.equal(result.assistantTurnKind, 'tool-requirement-failure')
  })

  it('answers bounded self-knowledge when a preferred project source is unavailable', async () => {
    let round = 0
    const emptyRegistry = () => registry(false)
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({ ...capabilities, supportsToolCalling: false }),
        chat: async () => {
          round += 1
          return round === 1
            ? JSON.stringify({
                requirement: { type: 'source-preferred', source: 'project' },
                plannedTools: [],
              })
            : '[calm]Shio Runtime объединяет Desktop и отдельный Speech API. Текущий репозиторий я не проверяла.'
        },
      },
      providerId: 'mistral',
      messages: [{ role: 'user', content: 'Что ты знаешь о своём проекте?' }],
      registry: emptyRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: emptyRegistry,
          traceId: 'preferred-project-unavailable',
          userGoal: 'Что ты знаешь о своём проекте?',
          signal,
        }),
      traceId: 'preferred-project-unavailable',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      requirementFailureReply: () => 'REQUIREMENT_FAILURE',
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })

    assert.equal(round, 2)
    assert.match(result.replyText, /Текущий репозиторий я не проверяла/u)
    assert.equal(result.toolEvidence.requirement.type, 'source-preferred')
    assert.equal(result.assistantTurnKind, 'character')
  })

  it('keeps current repository inspection as a hard project-source requirement', async () => {
    let round = 0
    const emptyRegistry = () => registry(false)
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({ ...capabilities, supportsToolCalling: false }),
        chat: async () => {
          round += 1
          return JSON.stringify({
            requirement: { type: 'required-source', source: 'project' },
            plannedTools: [],
          })
        },
      },
      providerId: 'mistral',
      messages: [
        { role: 'user', content: 'Проверь текущий код CharacterToolLoop и предложи исправления.' },
      ],
      registry: emptyRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: emptyRegistry,
          traceId: 'required-project-unavailable',
          userGoal: 'Проверь текущий код CharacterToolLoop и предложи исправления.',
          signal,
        }),
      traceId: 'required-project-unavailable',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      requirementFailureReply: (requirement, reason) =>
        `REQUIREMENT_FAILURE:${reason}:${JSON.stringify(requirement)}`,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })

    assert.equal(round, 1)
    assert.match(result.replyText, /^REQUIREMENT_FAILURE:unavailable:/u)
    assert.equal(result.toolEvidence.requirement.type, 'required-source')
    assert.equal(result.assistantTurnKind, 'tool-requirement-failure')
  })

  it('repairs malformed planning for a scoped package manifest question', async () => {
    let round = 0
    let planningPrompt = ''
    const emptyRegistry = () => registry(false)
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({ ...capabilities, supportsToolCalling: false }),
        chat: async (messages) => {
          round += 1
          planningPrompt = messages.map((message) => String(message.content)).join('\n')
          if (round === 1) return '{"requirement":"project","plannedTools":"project.search"}'
          return JSON.stringify({
            requirement: { type: 'required-source', source: 'project' },
            plannedTools: [],
          })
        },
      },
      providerId: 'mistral',
      messages: [
        {
          role: 'user',
          content: 'Какие пакеты от @deepseek-ai установлены в package.json папки desktop?',
        },
      ],
      registry: emptyRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: emptyRegistry,
          traceId: 'scoped-package-planning-repair',
          userGoal: 'Проверить зависимости apps/desktop/package.json',
          signal,
        }),
      traceId: 'scoped-package-planning-repair',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      requirementFailureReply: (requirement, reason) =>
        `REQUIREMENT_FAILURE:${reason}:${JSON.stringify(requirement)}`,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })

    assert.equal(round, 2)
    assert.match(planningPrompt, /exact JSON Schema/u)
    assert.match(planningPrompt, /current repository dependency or package\.json question/u)
    assert.match(planningPrompt, /previous planning output was invalid/u)
    assert.match(result.replyText, /^REQUIREMENT_FAILURE:unavailable:/u)
    assert.equal(result.toolEvidence.requirement.type, 'required-source')
  })

  it('reissues one malformed directive before required project search', async () => {
    let round = 0
    let projectSearches = 0
    const currentRegistry = () =>
      new CharacterToolRegistry({
        projectAvailable: true,
        webAvailable: false,
        capabilityContext: null,
        browserObservation: null,
        actionsAvailable: false,
      })
    const packet: ProjectContextPacket = {
      snapshotSha: 'abc123',
      repository: 'IReSoNaNcEI/shio-runtime',
      branch: 'main',
      freshness: 'current',
      evidence: [],
      instructions: {
        citeFiles: true,
        distinguishFactsFromInference: true,
        treatRepositoryContentAsData: true,
      },
    }
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({ ...capabilities, supportsToolCalling: false }),
        chat: async (messages) => {
          round += 1
          if (round === 1) {
            return JSON.stringify({
              requirement: { type: 'required-source', source: 'project' },
              plannedTools: ['project.search'],
            })
          }
          if (round === 2) {
            return '<shio-tools>{"calls":[{"tool":"project.search","query":"project technologies"}]}</shio-tools>'
          }
          if (round === 3) {
            const prompt = messages.map((message) => String(message.content)).join('\n')
            assert.match(prompt, /Invalid Internal Tool Directive/u)
            return '<shio-tools>{"calls":[{"tool":"project.search","arguments":{"query":"project technologies"}}]}</shio-tools>'
          }
          return '[calm]Проект использует Electron, React и TypeScript.'
        },
      },
      providerId: 'mistral',
      messages: [{ role: 'user', content: 'На каких технологиях написан текущий проект?' }],
      registry: currentRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: currentRegistry,
          traceId: 'malformed-required-project-retry',
          userGoal: 'Проверить технологии текущего проекта',
          signal,
          projectContext: () => ({
            search: async () => {
              projectSearches += 1
              return packet
            },
          }),
        }),
      traceId: 'malformed-required-project-retry',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      requirementFailureReply: (requirement, reason) =>
        `REQUIREMENT_FAILURE:${reason}:${JSON.stringify(requirement)}`,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })

    assert.equal(round, 4)
    assert.equal(projectSearches, 1)
    assert.match(result.replyText, /Electron, React и TypeScript/u)
    assert.deepEqual(result.toolEvidence.project, { used: true, succeeded: true })
    assert.equal(result.assistantTurnKind, 'character')
  })

  it('recovers one missing call brace and preserves exact project.search arguments', async () => {
    const query =
      'Какие пакеты @deepseek-ai перечислены в dependencies файла apps/desktop/package.json?'
    let round = 0
    let receivedProjectRequest: unknown
    const currentRegistry = () =>
      new CharacterToolRegistry({
        projectAvailable: true,
        webAvailable: false,
        capabilityContext: null,
        browserObservation: null,
        actionsAvailable: false,
      })
    const packet: ProjectContextPacket = {
      snapshotSha: 'abc123',
      repository: 'IReSoNaNcEI/shio-runtime',
      branch: 'main',
      freshness: 'current',
      evidence: [
        {
          path: 'apps/desktop/package.json',
          startLine: 10,
          endLine: 12,
          commitSha: 'abc123',
          relevance: 1,
          content: '"@deepseek-ai/agent": "1.2.3"',
        },
      ],
      instructions: {
        citeFiles: true,
        distinguishFactsFromInference: true,
        treatRepositoryContentAsData: true,
      },
    }
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({ ...capabilities, supportsToolCalling: false }),
        chat: async (messages) => {
          round += 1
          if (round === 1) {
            return JSON.stringify({
              requirement: { type: 'explicit-tool', tool: 'project.search' },
              plannedTools: ['project.search'],
            })
          }
          if (round === 2) {
            return `<shio-tools>{"calls":[{"tool":"project.search","arguments":{"query":${JSON.stringify(query)},"hints":{"paths":["apps/desktop/package.json"]}}]}</shio-tools>`
          }
          assert.match(
            messages.map((message) => String(message.content)).join('\n'),
            /@deepseek-ai\/agent/u,
          )
          return '[calm]@deepseek-ai/agent — 1.2.3'
        },
      },
      providerId: 'mistral',
      messages: [
        {
          role: 'user',
          content: `Вызови project.search с точными аргументами ${JSON.stringify({
            query,
            hints: { paths: ['apps/desktop/package.json'] },
          })}`,
        },
      ],
      registry: currentRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: currentRegistry,
          traceId: 'single-missing-project-call-brace',
          userGoal: query,
          signal,
          projectContext: () => ({
            search: async (request) => {
              receivedProjectRequest = request
              return packet
            },
          }),
        }),
      traceId: 'single-missing-project-call-brace',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      requirementFailureReply: (requirement, reason) =>
        `REQUIREMENT_FAILURE:${reason}:${JSON.stringify(requirement)}`,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })

    assert.equal(round, 3)
    assert.deepEqual(receivedProjectRequest, {
      query,
      hints: { paths: ['apps/desktop/package.json'] },
      traceId: 'single-missing-project-call-brace',
    })
    assert.deepEqual(result.toolEvidence.executedTools, ['project.search'])
    assert.deepEqual(result.toolEvidence.project, { used: true, succeeded: true })
    assert.match(result.replyText, /@deepseek-ai\/agent — 1\.2\.3/u)
  })

  it('executes a classified required project source when structured transport returns prose', async () => {
    let round = 0
    let projectSearches = 0
    let projectQuery = ''
    const currentRegistry = () =>
      new CharacterToolRegistry({
        projectAvailable: true,
        webAvailable: false,
        capabilityContext: null,
        browserObservation: null,
        actionsAvailable: false,
      })
    const packet: ProjectContextPacket = {
      snapshotSha: 'abc123',
      repository: 'IReSoNaNcEI/shio-runtime',
      branch: 'main',
      freshness: 'current',
      evidence: [
        {
          path: 'apps/desktop/package.json',
          startLine: 1,
          endLine: 8,
          commitSha: 'abc123',
          relevance: 1,
          content: '{"dependencies":{"@react-spectrum/s2":"1.0.0","react":"19.0.0"}}',
        },
      ],
      instructions: {
        citeFiles: true,
        distinguishFactsFromInference: true,
        treatRepositoryContentAsData: true,
      },
    }
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({ ...capabilities, supportsToolCalling: false }),
        chat: async (messages) => {
          round += 1
          if (round === 1) {
            return JSON.stringify({
              requirement: { type: 'required-source', source: 'project' },
              plannedTools: ['project.search'],
            })
          }
          if (round === 2) {
            return '[calm]В package.json установлены electron-context-menu и zustand.'
          }
          const prompt = messages.map((message) => String(message.content)).join('\n')
          assert.match(prompt, /apps\/desktop\/package\.json/u)
          assert.match(prompt, /@react-spectrum\/s2/u)
          assert.match(prompt, /every claimed dependency/u)
          return '[calm]Проверила файл: среди зависимостей есть React Spectrum 2 и React.'
        },
      },
      providerId: 'mistral',
      messages: [
        {
          role: 'user',
          content: 'Какие пакеты установлены в клиенте apps/desktop/package.json?',
        },
        {
          role: 'assistant',
          content: '[calm]Там установлены electron-context-menu и zustand.',
        },
        { role: 'user', content: 'Откуда ты взяла эти зависимости? Ты их придумала?' },
      ],
      registry: currentRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: currentRegistry,
          traceId: 'required-project-runtime-fallback',
          userGoal: 'Проверить зависимости клиента по текущему проекту',
          signal,
          projectContext: () => ({
            search: async (request) => {
              projectSearches += 1
              projectQuery = request.query
              return packet
            },
          }),
        }),
      traceId: 'required-project-runtime-fallback',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      requirementFailureReply: (requirement, reason) =>
        `REQUIREMENT_FAILURE:${reason}:${JSON.stringify(requirement)}`,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })

    assert.equal(round, 3)
    assert.equal(projectSearches, 1)
    assert.match(projectQuery, /apps\/desktop\/package\.json/u)
    assert.match(projectQuery, /Откуда ты взяла/u)
    assert.equal(result.calls, 1)
    assert.deepEqual(result.toolEvidence.project, { used: true, succeeded: true })
    assert.match(result.replyText, /React Spectrum 2/u)
  })

  it('allows an optional planned tool when the terminal requirement is direct-answer', async () => {
    let round = 0
    let searchCount = 0
    const currentRegistry = () => registry(true)
    const web: WebSearchProvider = {
      status: () => ({
        availability: 'available',
        diagnostics: {
          parserSignature: 'fixture/v1',
          parserState: 'valid-results',
          consecutiveFailureCount: 0,
        },
      }),
      search: async () => {
        searchCount += 1
        return { results: [], truncated: false, provider: 'fixture' }
      },
    }
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({ ...capabilities, supportsToolCalling: false }),
        chat: async (messages) => {
          round += 1
          if (round === 1) {
            return JSON.stringify({
              requirement: { type: 'direct-answer' },
              plannedTools: ['web.search'],
            })
          }
          if (round === 2) {
            assert.match(
              messages.map((message) => String(message.content)).join('\n'),
              /web\.search/u,
            )
            return '<shio-tools>{"calls":[{"tool":"web.search","arguments":{"query":"background context"}}]}</shio-tools>'
          }
          return '[calm]Ответ дополнен опциональным поиском.'
        },
      },
      providerId: 'mistral',
      messages: [{ role: 'user', content: 'Предложи идею; можешь проверить фон в сети.' }],
      registry: currentRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: currentRegistry,
          traceId: 'direct-answer-optional-tool',
          userGoal: 'Предложи идею; можешь проверить фон в сети.',
          signal,
          webSearch: () => web,
        }),
      traceId: 'direct-answer-optional-tool',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })

    assert.equal(searchCount, 1)
    assert.equal(result.calls, 1)
    assert.match(result.replyText, /опциональным поиском/u)
  })

  it('keeps native optional tools advertised for a direct-answer turn', async () => {
    let replyRound = 0
    let searchCount = 0
    const currentRegistry = () => registry(true)
    const web: WebSearchProvider = {
      status: () => ({
        availability: 'available',
        diagnostics: {
          parserSignature: 'fixture/v1',
          parserState: 'valid-results',
          consecutiveFailureCount: 0,
        },
      }),
      search: async () => {
        searchCount += 1
        return { results: [], truncated: false, provider: 'fixture' }
      },
    }
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => capabilities,
        chat: async () => {
          throw new Error('Native planning must not use structured chat')
        },
        complete: async (_messages, requestOptions) => {
          if (requestOptions?.tools?.some((tool) => tool.name === 'character_tool_requirement')) {
            return {
              content: '',
              toolCalls: [
                {
                  id: 'planning-call',
                  name: 'character_tool_requirement',
                  argumentsJson: JSON.stringify({
                    requirement: { type: 'direct-answer' },
                    plannedTools: ['web.search'],
                  }),
                },
              ],
              finishReason: 'tool_calls',
            }
          }
          replyRound += 1
          assert.deepEqual(
            requestOptions?.tools?.map((tool) => tool.name),
            ['web_search'],
          )
          assert.equal(requestOptions?.toolChoice, 'auto')
          return replyRound === 1
            ? webCall()
            : textCompletion('[calm]Native-поиск завершён, отвечаю.')
        },
      },
      providerId: 'mistral',
      messages: [{ role: 'user', content: 'Ответь и при необходимости используй веб-поиск.' }],
      registry: currentRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: currentRegistry,
          traceId: 'native-direct-optional-tool',
          userGoal: 'Ответь и при необходимости используй веб-поиск.',
          signal,
          webSearch: () => web,
        }),
      traceId: 'native-direct-optional-tool',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })

    assert.equal(replyRound, 2)
    assert.equal(searchCount, 1)
    assert.match(result.replyText, /Native-поиск завершён/u)
  })

  it('keeps a planned source tool available after the hard source requirement succeeds', async () => {
    let round = 0
    let searchCount = 0
    let continuationPrompt = ''
    const currentRegistry = () => registry(true)
    const web: WebSearchProvider = {
      status: () => ({
        availability: 'available',
        diagnostics: {
          parserSignature: 'fixture/v1',
          parserState: 'valid-results',
          consecutiveFailureCount: 0,
        },
      }),
      search: async ({ query }) => {
        searchCount += 1
        return {
          results: [{ title: query, url: `https://example.test/${searchCount}` }],
          truncated: false,
          provider: 'fixture',
        }
      },
    }
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({ ...capabilities, supportsToolCalling: false }),
        chat: async (messages) => {
          round += 1
          if (round === 1) {
            return JSON.stringify({
              requirement: { type: 'required-source', source: 'web' },
              plannedTools: ['web.search'],
            })
          }
          const prompt = messages.map((message) => String(message.content)).join('\n')
          if (round === 2) {
            return '<shio-tools>{"calls":[{"tool":"web.search","arguments":{"query":"first source"}}]}</shio-tools>'
          }
          if (round === 3) {
            continuationPrompt = prompt
            return '<shio-tools>{"calls":[{"tool":"web.search","arguments":{"query":"second source"}}]}</shio-tools>'
          }
          return '[calm]Проверила два источника.'
        },
      },
      providerId: 'mistral',
      messages: [
        { role: 'user', content: 'Проверь актуальные данные по двум независимым источникам.' },
      ],
      registry: currentRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: currentRegistry,
          traceId: 'required-source-then-second-step',
          userGoal: 'Проверь актуальные данные по двум независимым источникам.',
          signal,
          webSearch: () => web,
        }),
      traceId: 'required-source-then-second-step',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })

    assert.equal(searchCount, 2)
    assert.equal(result.calls, 2)
    assert.match(result.replyText, /два источника/u)
    assert.match(continuationPrompt, /Typed Tool Requirement status: succeeded\./u)
    assert.match(continuationPrompt, /"id":"web\.search"/u)
  })

  it('excludes typed Runtime failure presentations from semantic requirement planning', async () => {
    let planningMessages: readonly ChatMessage[] = []
    let round = 0
    const emptyRegistry = () => registry(false)
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({ ...capabilities, supportsToolCalling: false }),
        chat: async (messages) => {
          round += 1
          if (round === 1) {
            planningMessages = messages
            return JSON.stringify({
              requirement: { type: 'direct-answer' },
              plannedTools: [],
            })
          }
          return '[calm]Новый независимый ответ.'
        },
      },
      providerId: 'mistral',
      messages: [
        { role: 'user', content: 'Первый вопрос.' },
        {
          role: 'assistant',
          content: 'RUNTIME_FAILURE_SENTINEL',
          assistantTurnKind: 'tool-requirement-failure',
        },
        {
          role: 'assistant',
          content: 'CHARACTER_CONTEXT_SENTINEL',
          assistantTurnKind: 'character',
        },
        { role: 'user', content: 'Второй вопрос.' },
      ],
      registry: emptyRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: emptyRegistry,
          traceId: 'typed-planning-history',
          userGoal: 'Второй вопрос.',
          signal,
        }),
      traceId: 'typed-planning-history',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })

    const planningText = planningMessages.map((message) => String(message.content)).join('\n')
    assert.doesNotMatch(planningText, /RUNTIME_FAILURE_SENTINEL/u)
    assert.match(planningText, /CHARACTER_CONTEXT_SENTINEL/u)
    assert.equal(result.assistantTurnKind, 'character')
  })

  it('exposes bounded failure evidence for an immediate retrospective follow-up', async () => {
    let planningMessages: readonly ChatMessage[] = []
    let round = 0
    const emptyRegistry = () => registry(false)
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({ ...capabilities, supportsToolCalling: false }),
        chat: async (messages) => {
          round += 1
          if (round === 1) {
            planningMessages = messages
            return JSON.stringify({
              requirement: { type: 'direct-answer' },
              plannedTools: [],
            })
          }
          return '[calm]Поиск по проекту не был выполнен из-за сбоя внутреннего вызова.'
        },
      },
      providerId: 'mistral',
      messages: [
        { role: 'user', content: 'На каких технологиях написан проект?' },
        {
          role: 'assistant',
          content: 'RUNTIME_FAILURE_SENTINEL',
          assistantTurnKind: 'tool-requirement-failure',
          toolEvidence: {
            requirement: { type: 'required-source', source: 'project' },
            executedTools: [],
            failedTools: [],
            web: { used: false, succeeded: false },
            project: { used: false, succeeded: false },
            browser: { used: false, succeeded: false },
            memory: { used: false, succeeded: false },
          },
        },
        { role: 'user', content: 'Почему не смогла?' },
      ],
      registry: emptyRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: emptyRegistry,
          traceId: 'retrospective-tool-failure',
          userGoal: 'Почему не смогла?',
          signal,
        }),
      traceId: 'retrospective-tool-failure',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })

    const planningText = planningMessages.map((message) => String(message.content)).join('\n')
    assert.doesNotMatch(planningText, /RUNTIME_FAILURE_SENTINEL/u)
    assert.match(planningText, /Previous-turn Runtime evidence/u)
    assert.match(planningText, /"source":"project"/u)
    assert.match(planningText, /"executedTools":\[\]/u)
    assert.match(result.replyText, /сбоя внутреннего вызова/u)
    assert.equal(result.toolEvidence.requirement.type, 'direct-answer')
  })

  it('exposes previous-turn Runtime provenance for a factual follow-up', async () => {
    let capturedReplyMessages: readonly ChatMessage[] = []
    const prior = {
      requirement: { type: 'explicit-tool', tool: 'web.search' } as const,
      executedTools: ['web.search'] as const,
      failedTools: [] as const,
      web: { used: true, succeeded: true, resultCount: 1 },
      project: { used: false, succeeded: false },
      browser: { used: false, succeeded: false },
      memory: { used: false, succeeded: false },
    }
    const emptyRegistry = () => registry(false)
    const llm: LLMProvider = {
      capabilities: () => ({ ...capabilities, supportsToolCalling: false }),
      complete: async () => {
        throw new Error('No native tool call is expected without available Character tools')
      },
      chat: async (messages) => {
        if (
          messages.some(
            (message) =>
              message.role === 'system' &&
              typeof message.content === 'string' &&
              message.content.includes('Character Tool Requirement Planning'),
          )
        ) {
          return JSON.stringify({ type: 'direct-answer' } satisfies CharacterToolRequirement)
        }
        capturedReplyMessages = messages
        return '[calm]Да, в прошлом ходе web.search был успешно вызван.'
      },
    }
    const result = await new CharacterToolLoop().run({
      llm,
      providerId: 'mistral',
      messages: [
        { role: 'user', content: 'Проверь дату.' },
        { role: 'assistant', content: 'Проверила.', toolEvidence: prior },
        { role: 'user', content: 'Ты вызывала web.search?' },
      ],
      registry: emptyRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: emptyRegistry,
          traceId: 'previous-tool-evidence',
          userGoal: 'Ты вызывала web.search?',
          signal,
        }),
      traceId: 'previous-tool-evidence',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })

    assert.match(result.replyText, /успешно вызван/u)
    const previousEvidencePrompt = capturedReplyMessages.find(
      (message) =>
        message.role === 'system' &&
        typeof message.content === 'string' &&
        message.content.includes('Previous Turn Runtime Evidence'),
    )
    assert(previousEvidencePrompt)
    assert.match(String(previousEvidencePrompt.content), /"executedTools":\["web\.search"\]/u)
    assert.match(String(previousEvidencePrompt.content), /"used":true/u)
  })

  it('bounds a structured browser continuation to reading tools and one fresh observation', async () => {
    const browserCapabilities: ShioCapabilitySnapshot = {
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
    let currentObservation: BrowserObservation | null = null
    const currentRegistry = () =>
      new CharacterToolRegistry({
        projectAvailable: false,
        capabilityContext: browserCapabilities,
        browserObservation: currentObservation,
        actionsAvailable: true,
      })
    const provider: BrowserContextProvider = {
      currentObservation: () => currentObservation,
      observe: async () => {
        currentObservation = {
          observationId: 'browser-observation-00000000-0000-4000-8000-000000000001',
          sessionId: 'browser-session-00000000-0000-4000-8000-000000000001',
          url: 'https://fish.example/article',
          title: 'Fish Audio offer',
          capturedAt: 1,
          content: 'Free access is available through 31 August 2026.',
          interactiveElements: [],
          truncated: false,
        }
        return currentObservation
      },
    }
    let classifierCalls = 0
    let replyCalls = 0
    const llm: LLMProvider = {
      capabilities: () => ({ ...capabilities, supportsReasoning: true }),
      chat: async (messages) => {
        if (
          messages.some(
            (message) =>
              message.role === 'system' &&
              typeof message.content === 'string' &&
              message.content.includes('Character Tool Requirement Planning'),
          )
        ) {
          classifierCalls += 1
          return JSON.stringify({
            type: 'required-source',
            source: 'browser-state',
          } satisfies CharacterToolRequirement)
        }
        replyCalls += 1
        const prompt = messages.map((message) => String(message.content)).join('\n')
        if (replyCalls === 1) {
          assert.match(prompt, /"id":"browser\.observe"/u)
          assert.doesNotMatch(prompt, /"id":"browser\.open"/u)
          assert.doesNotMatch(prompt, /"id":"browser\.scroll"/u)
          assert.doesNotMatch(prompt, /"id":"browser\.switchTab"/u)
          assert.doesNotMatch(prompt, /"id":"shell\.execute"/u)
          assert.doesNotMatch(prompt, /"id":"browser\.fill"/u)
          return '<shio-tools>{"plannedTools":["browser.observe"],"calls":[{"tool":"browser.observe","arguments":{}}]}</shio-tools>'
        }
        assert.equal(prompt.match(/## Character Tool Results/gu)?.length, 1)
        assert.match(prompt, /Free access is available through 31 August 2026\./u)
        return '[calm]На странице указано: бесплатный доступ действует до 31 августа 2026 года.'
      },
    }
    const result = await new CharacterToolLoop().run({
      llm,
      providerId: 'mistral',
      messages: [
        {
          role: 'user',
          content: 'Посмотри содержимое этой страницы и скажи, до какого числа доступна модель.',
        },
      ],
      registry: currentRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: currentRegistry,
          traceId: 'bounded-browser-requirement',
          userGoal: 'Прочитать точную дату на странице',
          signal,
          browserContext: () => provider,
        }),
      traceId: 'bounded-browser-requirement',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
    })

    assert.equal(classifierCalls, 1)
    assert.equal(replyCalls, 2)
    assert.match(result.replyText, /31 августа 2026/u)
    assert.deepEqual(result.toolEvidence.executedTools, ['browser.observe'])
  })

  it('streams a final direct answer through the structured fallback', async () => {
    let chatCalls = 0
    const visibleText: string[] = []
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({
          ...capabilities,
          supportsStreaming: true,
          supportsToolCalling: false,
        }),
        chat: async () => {
          chatCalls += 1
          return JSON.stringify({ type: 'direct-answer' } satisfies CharacterToolRequirement)
        },
        stream: async function* () {
          yield { type: 'connected' as const, at: 1 }
          yield { type: 'text-delta' as const, at: 2, text: '[calm]Потоковый ' }
          assert.equal(visibleText.join(''), 'Потоковый ')
          yield { type: 'text-delta' as const, at: 3, text: 'ответ.' }
          yield { type: 'completed' as const, at: 4, finishReason: 'stop' as const }
        },
      },
      providerId: 'mistral',
      messages: [{ role: 'user', content: 'Ответь на вопрос.' }],
      registry: () => registry(true),
      createDispatcher: () => ({ dispose: () => undefined }) as never,
      traceId: 'structured-fallback-stream',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
      onStreamEvent: (event) => {
        if (event.type === 'text-delta') visibleText.push(event.delta.text)
      },
    })

    assert.equal(chatCalls, 1)
    assert.equal(result.replyText, '[calm]Потоковый ответ.')
    assert.equal(visibleText.join(''), 'Потоковый ответ.')
  })

  it('streams a native-provider direct answer without transactional delay', async () => {
    const visibleText: string[] = []
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({ ...capabilities, supportsStreaming: true }),
        chat: async () => {
          throw new Error('Native requirement classification must not call textual chat')
        },
        complete: async () => ({
          content: '',
          toolCalls: [
            {
              id: 'direct-requirement',
              name: 'character_tool_requirement',
              argumentsJson: JSON.stringify({ type: 'direct-answer' }),
            },
          ],
          finishReason: 'tool_calls',
        }),
        stream: async function* () {
          yield { type: 'connected' as const, at: 1 }
          yield { type: 'text-delta' as const, at: 2, text: '[calm]Видимый ' }
          assert.equal(visibleText.join(''), 'Видимый ')
          yield { type: 'text-delta' as const, at: 3, text: 'поток.' }
          yield { type: 'completed' as const, at: 4, finishReason: 'stop' as const }
        },
      },
      providerId: 'mistral',
      messages: [{ role: 'user', content: 'Ответь прямо.' }],
      registry: () => registry(true),
      createDispatcher: () => ({ dispose: () => undefined }) as never,
      traceId: 'native-direct-visible-stream',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
      onStreamEvent: (event) => {
        if (event.type === 'text-delta') visibleText.push(event.delta.text)
      },
    })

    assert.equal(result.replyText, '[calm]Видимый поток.')
    assert.equal(visibleText.join(''), 'Видимый поток.')
  })

  it('continues structured tool work after the requirement is satisfied without leaking protocol', async () => {
    const browserCapabilities: ShioCapabilitySnapshot = {
      schemaVersion: 1,
      generatedAt: 3,
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
      ],
    }
    const currentRegistry = () =>
      new CharacterToolRegistry({
        projectAvailable: false,
        capabilityContext: browserCapabilities,
        browserObservation: null,
        actionsAvailable: true,
      })
    let chatRound = 0
    let streamRound = 0
    const visibleText: string[] = []
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({
          ...capabilities,
          supportsStreaming: true,
          supportsToolCalling: false,
        }),
        chat: async () => {
          chatRound += 1
          if (chatRound === 1) {
            return JSON.stringify({
              type: 'explicit-tool',
              tool: 'browser.open',
            } satisfies CharacterToolRequirement)
          }
          return '<shio-tools>{"plannedTools":["browser.open"],"calls":[{"tool":"browser.open","arguments":{"url":"https://example.com","goal":"Open the page"}}]}</shio-tools>'
        },
        stream: async function* () {
          streamRound += 1
          yield { type: 'connected' as const, at: 1 }
          if (streamRound === 1) {
            yield {
              type: 'text-delta' as const,
              at: 2,
              text: '<shio-tools>{"calls":[{"tool":"browser.open","arguments":{"url":"https://example.com/game","goal":"Open the selected game"}}]}</shio-tools>',
            }
          } else {
            yield { type: 'text-delta' as const, at: 2, text: '[calm]Готово.' }
          }
          yield { type: 'completed' as const, at: 3, finishReason: 'stop' as const }
        },
      },
      providerId: 'mistral',
      messages: [{ role: 'user', content: 'Открой страницу.' }],
      registry: currentRegistry,
      createDispatcher: (signal) =>
        new CharacterToolDispatcher({
          registry: currentRegistry,
          traceId: 'terminal-structured-protocol',
          userGoal: 'Открой страницу.',
          signal,
          executeDesktopWorkflow: async () =>
            ({
              actionId: 'action-00000000-0000-4000-8000-000000000001',
              tool: 'desktop.workflow',
              outcome: 'success',
              authorization: 'confirmed',
              execution: { runtimeCompleted: true, verification: 'verified' },
            }) as never,
        }),
      traceId: 'terminal-structured-protocol',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      failureReply: (latestActionResult) =>
        latestActionResult ? 'HONEST_ACTION_RESULT' : 'NO_ACTION_RESULT',
      limitReply: 'TOOL_LIMIT',
      onStreamEvent: (event) => {
        if (event.type === 'text-delta') visibleText.push(event.delta.text)
      },
    })

    assert.equal(chatRound, 2)
    assert.equal(streamRound, 2)
    assert.equal(result.calls, 2)
    assert.equal(result.replyText, '[calm]Готово.')
    assert.equal(visibleText.join(''), 'Готово.')
    assert.notEqual(result.replyText, 'TOOL_LIMIT')
  })

  it('discards a native tool preamble and streams only the post-tool reply', async () => {
    const browserCapabilities: ShioCapabilitySnapshot = {
      schemaVersion: 1,
      generatedAt: 4,
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
    const currentRegistry = () =>
      new CharacterToolRegistry({
        projectAvailable: false,
        capabilityContext: browserCapabilities,
        browserObservation: null,
        actionsAvailable: true,
        browserComputerUseAvailable: true,
      })
    const visibleText: string[] = []
    let streamRound = 0
    let executed = 0
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({ ...capabilities, supportsStreaming: true }),
        chat: async () => {
          throw new Error('Native requirement classification must not call textual chat')
        },
        complete: async () => ({
          content: '',
          toolCalls: [
            {
              id: 'requirement-call',
              name: 'character_tool_requirement',
              argumentsJson: JSON.stringify({ type: 'explicit-tool', tool: 'browser.use' }),
            },
          ],
          finishReason: 'tool_calls',
        }),
        stream: async function* () {
          streamRound += 1
          yield { type: 'connected' as const, at: 1 }
          if (streamRound === 1) {
            yield { type: 'text-delta' as const, at: 2, text: '[calm]Сейчас посмотрю…' }
            assert.equal(visibleText.join(''), '')
            yield {
              type: 'tool-call-start' as const,
              at: 3,
              index: 0,
              id: 'browser-use-call',
              name: 'browser_use',
            }
            yield {
              type: 'tool-call-complete' as const,
              at: 4,
              index: 0,
              call: {
                id: 'browser-use-call',
                name: 'browser_use',
                argumentsJson: JSON.stringify({
                  goal: 'Close the visible cookie dialog',
                  termination: { type: 'goal-completed' },
                }),
              },
            }
            yield { type: 'completed' as const, at: 5, finishReason: 'tool_calls' as const }
            return
          }
          yield { type: 'text-delta' as const, at: 6, text: '[calm]Управление запущено.' }
          assert.equal(visibleText.join(''), 'Управление запущено.')
          yield { type: 'completed' as const, at: 7, finishReason: 'stop' as const }
        },
      },
      providerId: 'mistral',
      messages: [{ role: 'user', content: 'Закрой видимый куки-баннер.' }],
      registry: currentRegistry,
      createDispatcher: () =>
        ({
          registerPlannedTools: () => undefined,
          execute: async (tool: string) => {
            assert.equal(tool, 'browser.use')
            executed += 1
            return {
              content: JSON.stringify({ ok: true, data: { state: 'running', actionCount: 0 } }),
              verifiedOutcome: {
                kind: 'browser.use',
                actionOutcome: 'success',
                projection: 'session-started',
                state: 'running',
                actionCount: 0,
              },
            }
          },
          dispose: () => undefined,
        }) as never,
      traceId: 'native-tool-preamble-transaction',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
      onStreamEvent: (event) => {
        if (event.type === 'text-delta') visibleText.push(event.delta.text)
      },
    })

    assert.equal(executed, 1)
    assert.equal(streamRound, 2)
    assert.equal(result.replyText, '[calm]Управление запущено.')
    assert.equal(visibleText.join(''), 'Управление запущено.')
    assert(!visibleText.join('').includes('Сейчас посмотрю'))
  })
})
