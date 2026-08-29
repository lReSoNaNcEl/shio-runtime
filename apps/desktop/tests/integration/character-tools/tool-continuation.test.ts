import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import { CharacterToolDispatcher } from '../../../src/main/character-tools/CharacterToolDispatcher'
import { CharacterToolLoop } from '../../../src/main/character-tools/CharacterToolLoop'
import { CharacterToolRegistry } from '../../../src/main/character-tools/CharacterToolRegistry'
import type { ShioCapabilitySnapshot } from '../../../src/shared/capabilities'
import type { CharacterToolRequirement } from '../../../src/shared/character-tools'
import type { WebSearchProvider } from '../../../src/shared/web-search'
import {
  capabilities,
  registry,
  textCompletion,
  webCall,
} from '../../support/character-tools/requirements'

describe('Character Tool Requirement', () => {
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

  it('contains textual provider tool syntax and reissues a natural direct answer', async () => {
    let streamRound = 0
    const visibleText: string[] = []
    const result = await new CharacterToolLoop().run({
      llm: {
        capabilities: () => ({
          ...capabilities,
          supportsStreaming: true,
          supportsToolCalling: false,
        }),
        chat: async () =>
          JSON.stringify({ type: 'direct-answer' } satisfies CharacterToolRequirement),
        stream: async function* () {
          streamRound += 1
          yield { type: 'connected' as const, at: 1 }
          if (streamRound === 1) {
            yield { type: 'text-delta' as const, at: 2, text: '[calm]Сейчас посмотрю. \\<tool' }
            yield {
              type: 'text-delta' as const,
              at: 3,
              text: '\\_call> {"name":"Action:capabilities.list","arguments":{}} \\</tool\\_call>',
            }
          } else {
            yield {
              type: 'text-delta' as const,
              at: 4,
              text: '[calm]Доступны память, цели и веб-поиск.',
            }
          }
          yield { type: 'completed' as const, at: 5, finishReason: 'stop' as const }
        },
      },
      providerId: 'mistral',
      messages: [{ role: 'user', content: 'Перечисли доступные возможности.' }],
      registry: () => registry(true),
      createDispatcher: () => ({ dispose: () => undefined }) as never,
      traceId: 'contained-provider-tool-syntax',
      requestOptions: {},
      nativeToolsRejected: false,
      enforceToolRequirements: true,
      failureReply: 'TOOL_FAILURE',
      limitReply: 'TOOL_LIMIT',
      onStreamEvent: (event) => {
        if (event.type === 'text-delta') visibleText.push(event.delta.text)
      },
    })

    assert.equal(streamRound, 2)
    assert.equal(result.replyText, '[calm]Доступны память, цели и веб-поиск.')
    assert.doesNotMatch(visibleText.join(''), /tool|Action|capabilities/u)
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
