import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import { CharacterToolDispatcher } from '../../src/main/character-tools/CharacterToolDispatcher'
import { CharacterToolLoop } from '../../src/main/character-tools/CharacterToolLoop'
import { CharacterToolRegistry } from '../../src/main/character-tools/CharacterToolRegistry'
import type { ChatMessage, LLMProvider, LlmCapabilities, LlmCompletion } from '../../src/main/llm'
import type { DesktopWorkflowActionResult } from '../../src/shared/actions'
import {
  type BrowserComputerUseProvider,
  type BrowserComputerUseSession,
  EMPTY_BROWSER_COMPUTER_USE_DIAGNOSTICS,
} from '../../src/shared/browser-computer-use'
import type { BrowserContextProvider, BrowserObservation } from '../../src/shared/browser-control'
import type { ShioCapabilitySnapshot } from '../../src/shared/capabilities'
import type { CharacterToolRequirement } from '../../src/shared/character-tools'
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
  requirement?: CharacterToolRequirement
}) {
  const currentRegistry = () => registry(true)
  return new CharacterToolLoop().run({
    llm: {
      capabilities: () => capabilities,
      chat: async () =>
        JSON.stringify(options.requirement ?? { type: 'explicit-tool', tool: 'web.search' }),
      complete: options.complete,
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
        complete: async (messages) => {
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

  it('rejects an unsourced draft and requires the explicitly requested web.search call', async () => {
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
        return textCompletion('[calm]По найденному источнику предложение действует до 31 августа.')
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
  })

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
        capabilities: () => capabilities,
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
      capabilities: () => capabilities,
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
      observe: async () => currentObservation,
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
          assert.match(prompt, /"id":"browser\.open"/u)
          assert.match(prompt, /"id":"browser\.observe"/u)
          assert.match(prompt, /"id":"browser\.scroll"/u)
          assert.doesNotMatch(prompt, /"id":"shell\.execute"/u)
          assert.doesNotMatch(prompt, /"id":"browser\.fill"/u)
          return '<shio-tools>{"plannedTools":["browser.open"],"calls":[{"tool":"browser.open","arguments":{"url":"https://fish.example/article"}}]}</shio-tools>'
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
          executeDesktopWorkflow: async (request) => {
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
            return {
              actionId: 'action-00000000-0000-4000-8000-000000000001',
              tool: 'desktop.workflow',
              outcome: 'success',
              authorization: 'confirmed',
              execution: {
                runtimeCompleted: true,
                verification: 'verified',
                browser: {
                  kind: 'browser',
                  operation: request.browserOperation?.operation ?? 'open',
                  status: 'success',
                  verification: 'verified',
                  riskClass: 'navigation',
                  resultingUrl: currentObservation.url,
                  resultingTitle: currentObservation.title,
                },
              },
            } satisfies DesktopWorkflowActionResult
          },
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
    assert.deepEqual(result.toolEvidence.executedTools, ['browser.open'])
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
          return 'The structured fallback must not use chat for the final answer.'
        },
        stream: async function* () {
          yield { type: 'connected' as const, at: 1 }
          yield { type: 'text-delta' as const, at: 2, text: '[calm]Потоковый ' }
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
      enforceToolRequirements: false,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
      onStreamEvent: (event) => {
        if (event.type === 'text-delta') visibleText.push(event.delta.text)
      },
    })

    assert.equal(chatCalls, 0)
    assert.equal(result.replyText, '[calm]Потоковый ответ.')
    assert.equal(visibleText.join(''), 'Потоковый ответ.')
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
})
