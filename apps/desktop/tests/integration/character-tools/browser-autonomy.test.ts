import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import { CharacterToolDispatcher } from '../../../src/main/character-tools/CharacterToolDispatcher'
import { CharacterToolLoop } from '../../../src/main/character-tools/CharacterToolLoop'
import { CharacterToolRegistry } from '../../../src/main/character-tools/CharacterToolRegistry'
import type { LLMProvider } from '../../../src/main/llm'
import {
  type BrowserComputerUseProvider,
  type BrowserComputerUseSession,
  EMPTY_BROWSER_COMPUTER_USE_DIAGNOSTICS,
} from '../../../src/shared/browser-computer-use'
import type {
  BrowserContextProvider,
  BrowserObservation,
} from '../../../src/shared/browser-control'
import type { ShioCapabilitySnapshot } from '../../../src/shared/capabilities'
import type { CharacterToolRequirement } from '../../../src/shared/character-tools'
import { capabilities, textCompletion } from '../../support/character-tools/requirements'

describe('Character Tool Requirement', () => {
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
})
