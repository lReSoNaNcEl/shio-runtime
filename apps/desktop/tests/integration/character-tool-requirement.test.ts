import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import { CharacterToolDispatcher } from '../../src/main/character-tools/CharacterToolDispatcher'
import { CharacterToolLoop } from '../../src/main/character-tools/CharacterToolLoop'
import { CharacterToolRegistry } from '../../src/main/character-tools/CharacterToolRegistry'
import type { ChatMessage, LLMProvider, LlmCapabilities, LlmCompletion } from '../../src/main/llm'
import type { DesktopWorkflowActionResult } from '../../src/shared/actions'
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
})
