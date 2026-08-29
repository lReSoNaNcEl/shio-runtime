import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import { CharacterToolDispatcher } from '../../../src/main/character-tools/CharacterToolDispatcher'
import { CharacterToolLoop } from '../../../src/main/character-tools/CharacterToolLoop'
import { CharacterToolRegistry } from '../../../src/main/character-tools/CharacterToolRegistry'
import type { CharacterToolRequirement } from '../../../src/shared/character-tools'
import type { ProjectContextPacket } from '../../../src/shared/project-awareness'
import type { WebSearchProvider } from '../../../src/shared/web-search'
import {
  capabilities,
  registry,
  runWebRequirement,
  textCompletion,
  webCall,
} from '../../support/character-tools/requirements'

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
})
