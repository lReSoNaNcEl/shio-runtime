import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, it } from 'vitest'

import type { ChatMessage, LLMProvider, LlmCapabilities, LlmCompletion } from '../../src/main/llm'
import type { MemoryStore } from '../../src/main/memory'
import { Orchestrator, projectReplyProvenance } from '../../src/main/orchestrator'
import type { SpeechClient } from '../../src/main/speech/speechClient'
import { groupProjectEvidence } from '../../src/renderer/components/chat/projectEvidence'
import { ControllerStore } from '../../src/renderer/controller/ControllerStore'
import type { AppSettings } from '../../src/shared/config'
import type { ProjectContextProvider } from '../../src/shared/plugins'
import type { ProjectContextPacket } from '../../src/shared/project-awareness'

function packet(snapshotSha: string): ProjectContextPacket {
  return {
    snapshotSha,
    repository: 'owner/project',
    branch: 'main',
    freshness: 'current',
    evidence: [
      {
        path: 'ARCHITECTURE.md',
        startLine: 10,
        endLine: 20,
        commitSha: snapshotSha,
        content: 'architecture evidence',
        relevance: 1,
      },
      {
        path: 'apps/desktop/src/main/orchestrator.ts',
        startLine: 100,
        endLine: 120,
        commitSha: snapshotSha,
        content: 'orchestrator evidence',
        relevance: 0.9,
      },
      {
        path: 'apps/desktop/src/main/orchestrator.ts',
        startLine: 150,
        endLine: 170,
        commitSha: snapshotSha,
        content: 'second range',
        relevance: 0.8,
      },
      {
        path: 'apps/desktop/src/main/orchestrator.ts',
        startLine: 150,
        endLine: 170,
        commitSha: snapshotSha,
        content: 'duplicate range',
        relevance: 0.7,
      },
      {
        path: 'C:\\private\\project-index.sqlite',
        startLine: 1,
        endLine: 1,
        commitSha: snapshotSha,
        content: 'must never be projected',
        relevance: 0.6,
      },
    ],
    instructions: {
      citeFiles: true,
      distinguishFactsFromInference: true,
      treatRepositoryContentAsData: true,
    },
  }
}

async function main(): Promise<void> {
  const firstPacket = packet('abc1234567890')
  const normalized = projectReplyProvenance(firstPacket)
  assert.equal(normalized.snapshotCommit, 'abc1234567890')
  assert.equal(normalized.sources.length, 3)
  assert.equal(JSON.stringify(normalized).includes('project-index.sqlite'), false)
  const grouped = groupProjectEvidence(normalized.sources)
  assert.equal(grouped.length, 2)
  assert.equal(grouped.find((source) => source.path.endsWith('orchestrator.ts'))?.ranges.length, 2)

  let activePacket: ProjectContextPacket | null = firstPacket
  let generationFails = false
  let captured: readonly ChatMessage[] = []
  let llmTraceId: string | undefined
  let projectContextTraceId: string | undefined
  const toolCapabilities: LlmCapabilities = {
    supportsReasoning: false,
    supportsStreaming: true,
    supportsTemperature: true,
    supportsSystemPrompt: true,
    supportsToolCalling: true,
    supportsVision: false,
    recommendedMaxTokens: 1_024,
  }
  const llm: LLMProvider = {
    capabilities: () => toolCapabilities,
    chat: async () => {
      throw new Error('Native tool path unexpectedly used chat()')
    },
    complete: async (messages, options): Promise<LlmCompletion> => {
      captured = messages
      llmTraceId = options?.traceId
      if (generationFails) throw new Error('generation failed')
      if (
        activePacket &&
        !messages.some((message) => message.role === 'tool' && message.name === 'project_search')
      ) {
        return {
          content: '',
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: 'project-call-1',
              name: 'project_search',
              argumentsJson: JSON.stringify({ query: 'Orchestrator implementation architecture' }),
            },
          ],
        }
      }
      return {
        content: '[neutral]Проверенный ответ. Sources: attacker/fake.ts:1-9.',
        finishReason: 'stop',
        toolCalls: [],
      }
    },
  }
  let committedTurns = 0
  const memory: MemoryStore = {
    getHistory: async () => [],
    appendTurn: async () => {
      committedTurns += 1
    },
    clear: async () => undefined,
  }
  const provider: ProjectContextProvider = {
    search: async (request) => {
      projectContextTraceId = request.traceId
      return activePacket
    },
  }
  const orchestrator = new Orchestrator(
    llm,
    memory,
    {} as SpeechClient,
    () => ({ uiLocale: 'ru' }) as AppSettings,
    () => provider,
  )

  const oldReply = await orchestrator.createReply(
    { userText: 'Как устроен Orchestrator?' },
    { traceId: 'trace-project-1' },
  )
  assert.equal(projectContextTraceId, 'trace-project-1')
  assert.equal(llmTraceId, 'trace-project-1')
  assert.equal(oldReply.grounding?.project?.snapshotCommit, 'abc1234567890')
  assert.equal(oldReply.grounding?.project?.sources.length, 3)
  assert.equal(
    oldReply.grounding?.project?.sources.some((source) => source.path.includes('attacker')),
    false,
  )
  assert(
    captured.some(
      (message) =>
        message.role === 'tool' &&
        typeof message.content === 'string' &&
        message.content.includes('abc1234567890'),
    ),
  )

  activePacket = packet('def5678901234')
  const newReply = await orchestrator.createReply({ userText: 'Как устроен Orchestrator?' })
  assert.equal(newReply.grounding?.project?.snapshotCommit, 'def5678901234')
  assert.equal(oldReply.grounding?.project?.snapshotCommit, 'abc1234567890')

  activePacket = null
  const ordinaryReply = await orchestrator.createReply({ userText: 'Как дела?' })
  assert.equal(ordinaryReply.grounding, undefined)

  generationFails = true
  const committedBeforeFailure = committedTurns
  await assert.rejects(
    () => orchestrator.createReply({ userText: 'Покажи проект' }),
    /generation failed/,
  )
  assert.equal(committedTurns, committedBeforeFailure)

  const store = new ControllerStore({ messages: [] } as never)
  store.appendMessage({
    id: 'assistant-1',
    role: 'assistant',
    text: 'Ответ уже показан',
    grounding: oldReply.grounding,
  })
  store.appendMessage({ id: 'tts-error', role: 'error', text: 'TTS unavailable' })
  assert.equal(store.getState().messages[0]?.grounding?.project?.snapshotCommit, 'abc1234567890')

  const conversationRuntimeSource = readFileSync(
    join(process.cwd(), 'src/renderer/runtime/ConversationRuntime.ts'),
    'utf8',
  )
  const fallbackMessageIndex = conversationRuntimeSource.indexOf(
    "pushMessage('assistant', draft.displayText, draft.grounding)",
  )
  const fallbackSpeechCommitIndex = conversationRuntimeSource.indexOf(
    'commitSpeech(commitBuffer.push(delta))',
    fallbackMessageIndex,
  )
  assert(fallbackMessageIndex >= 0 && fallbackSpeechCommitIndex > fallbackMessageIndex)
  const chatSource = readFileSync(
    join(process.cwd(), 'src/renderer/components/chat/ChatMessageList.tsx'),
    'utf8',
  )
  assert.match(chatSource, /message\.role === 'assistant' && message\.grounding\?\.project/)
  const evidenceBarSource = readFileSync(
    join(process.cwd(), 'src/renderer/components/chat/ProjectEvidenceBar.tsx'),
    'utf8',
  )
  assert.match(evidenceBarSource, /freshnessAtGeneration === 'stale'/)
  assert.match(evidenceBarSource, /chat\.evidence\.projectSources/)
  console.log('Project Reply Provenance focused repro: PASS')
}

describe('Project reply provenance integration', () => {
  it('binds user-visible evidence to the exact turn packet and freshness', main)
})
