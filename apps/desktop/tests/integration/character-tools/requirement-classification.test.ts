import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it } from 'vitest'

import { CharacterToolDispatcher } from '../../../src/main/character-tools/CharacterToolDispatcher'
import { CharacterToolLoop } from '../../../src/main/character-tools/CharacterToolLoop'
import { CharacterToolRegistry } from '../../../src/main/character-tools/CharacterToolRegistry'
import type { ChatMessage } from '../../../src/main/llm'
import { createSemanticMemoryRuntime, MemoryToolBroker } from '../../../src/main/memory'
import type { PersistentGoal } from '../../../src/shared/alive'
import {
  type BrowserComputerUseProvider,
  type BrowserComputerUseSession,
  EMPTY_BROWSER_COMPUTER_USE_DIAGNOSTICS,
} from '../../../src/shared/browser-computer-use'
import type { ShioCapabilitySnapshot } from '../../../src/shared/capabilities'
import type { CharacterToolRequirement } from '../../../src/shared/character-tools'
import { capabilities, registry, textCompletion } from '../../support/character-tools/requirements'

describe('Character Tool Requirement', () => {
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
})
