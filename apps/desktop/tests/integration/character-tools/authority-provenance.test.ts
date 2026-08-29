import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import { CharacterToolDispatcher } from '../../../src/main/character-tools/CharacterToolDispatcher'
import { CharacterToolLoop } from '../../../src/main/character-tools/CharacterToolLoop'
import type { ChatMessage, LLMProvider } from '../../../src/main/llm'
import type { CharacterToolRequirement } from '../../../src/shared/character-tools'
import { capabilities, registry } from '../../support/character-tools/requirements'

describe('Character Tool Requirement', () => {
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
})
