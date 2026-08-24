import assert from 'node:assert/strict'

import type {
  ChatMessage,
  LLMProvider,
  LlmCapabilities,
  LlmCompletion,
  LlmCompletionOptions,
} from '../../src/main/llm'
import type { MemoryStore } from '../../src/main/memory'
import { Orchestrator } from '../../src/main/orchestrator'
import type { SpeechClient } from '../../src/main/speech/speechClient'
import type { DesktopWorkflowActionResult } from '../../src/shared/actions'
import type { ShioCapabilitySnapshot } from '../../src/shared/capabilities'
import type { AppSettings } from '../../src/shared/config'
import type { ProjectContextProvider } from '../../src/shared/plugins'
import type { ProjectContextPacket } from '../../src/shared/project-awareness'

const toolCapabilities: LlmCapabilities = {
  supportsReasoning: false,
  supportsStreaming: true,
  supportsTemperature: true,
  supportsSystemPrompt: true,
  supportsToolCalling: true,
  supportsVision: false,
  recommendedMaxTokens: 1_024,
}

const actionCapabilities: ShioCapabilitySnapshot = {
  schemaVersion: 1,
  generatedAt: 1,
  capabilities: [
    {
      id: 'computer-control',
      category: 'action',
      source: { kind: 'plugin', pluginId: 'desktop-control' },
      titleKey: 'capabilities.computer.title',
      descriptionKey: 'capabilities.computer.description',
      availability: 'available',
      authority: 'full',
    },
  ],
}

function packet(snapshotSha: string, content: string): ProjectContextPacket {
  return {
    snapshotSha,
    repository: 'owner/project',
    branch: 'main',
    freshness: 'current',
    evidence: [
      {
        path: 'package.json',
        startLine: 1,
        endLine: 20,
        commitSha: snapshotSha,
        content,
        relevance: 1,
      },
    ],
    instructions: {
      citeFiles: true,
      distinguishFactsFromInference: true,
      treatRepositoryContentAsData: true,
    },
  }
}

function actionResult(actionId: string, reportedOutcome: string): DesktopWorkflowActionResult {
  return {
    actionId,
    tool: 'desktop.workflow',
    outcome: 'success',
    authorization: 'full',
    execution: {
      runtimeCompleted: true,
      reportedOutcome,
      verification: 'verified',
    },
  }
}

type ProviderStep =
  | { tool: 'project_search' | 'shell_execute'; input: Record<string, unknown> }
  | { reply: string }

function completion(step: ProviderStep, index: number): LlmCompletion {
  if ('reply' in step) return { content: step.reply, finishReason: 'stop', toolCalls: [] }
  return {
    content: '',
    finishReason: 'tool_calls',
    toolCalls: [
      {
        id: `tool-call-${index}`,
        name: step.tool,
        argumentsJson: JSON.stringify(step.input),
      },
    ],
  }
}

interface ScenarioInput {
  userText: string
  steps: readonly ProviderStep[]
  initialPacket?: ProjectContextPacket
  replacementPacket?: ProjectContextPacket
  actionResult?: DesktopWorkflowActionResult
}

async function runScenario(input: ScenarioInput): Promise<{
  reply: Awaited<ReturnType<Orchestrator['createReply']>>
  calls: readonly (readonly ChatMessage[])[]
  searchCount: number
  executedCommands: readonly string[]
}> {
  let activePacket = input.initialPacket ?? null
  let searchCount = 0
  let stepIndex = 0
  const calls: (readonly ChatMessage[])[] = []
  const executedCommands: string[] = []
  const llm: LLMProvider = {
    capabilities: () => toolCapabilities,
    chat: async () => {
      throw new Error('Native tool path unexpectedly used chat()')
    },
    complete: async (messages, options: LlmCompletionOptions = {}) => {
      calls.push(messages)
      assert.equal(options.toolChoice === 'none' || options.toolChoice === 'auto', true)
      assert.equal(
        options.tools?.some((tool) => tool.name === 'project_search'),
        true,
      )
      assert.equal(
        options.tools?.some((tool) => tool.name === 'shell_execute'),
        true,
      )
      const step = input.steps[stepIndex]
      stepIndex += 1
      assert(step, `Missing fake provider step ${stepIndex}`)
      return completion(step, stepIndex)
    },
  }
  const memory: MemoryStore = {
    getHistory: async () => [],
    appendTurn: async () => undefined,
    clear: async () => undefined,
  }
  const provider: ProjectContextProvider = {
    search: async ({ query }) => {
      searchCount += 1
      assert(query.trim().length > 0)
      return activePacket
    },
  }
  const orchestrator = new Orchestrator(
    llm,
    memory,
    {} as SpeechClient,
    () => ({ uiLocale: 'ru' }) as AppSettings,
    () => provider,
    { snapshot: async () => actionCapabilities },
    async (request) => {
      assert(input.actionResult, 'Unexpected desktop workflow execution')
      executedCommands.push(request.shellCommand ?? '')
      activePacket = input.replacementPacket ?? activePacket
      return input.actionResult
    },
  )

  return {
    reply: await orchestrator.createReply({ userText: input.userText }),
    calls,
    searchCount,
    executedCommands,
  }
}

function hasProjectSnapshot(messages: readonly ChatMessage[], snapshotSha: string): boolean {
  return messages.some(
    (message) =>
      message.role === 'tool' &&
      typeof message.content === 'string' &&
      message.content.includes(snapshotSha),
  )
}

async function main(): Promise<void> {
  const simpleNode = await runScenario({
    userText: 'Какая версия Node установлена?',
    steps: [
      { tool: 'shell_execute', input: { command: 'node -v' } },
      { reply: '[calm]У тебя установлена версия 24.19.0.' },
    ],
    actionResult: actionResult(
      'action-1-123e4567-e89b-12d3-a456-426614174000',
      'PowerShell exit code: 0\nstdout:\nv24.19.0',
    ),
  })
  assert.equal(simpleNode.searchCount, 0)
  assert.deepEqual(simpleNode.executedCommands, ['node -v'])
  assert.equal(simpleNode.reply.grounding?.project, undefined)
  assert.equal(simpleNode.reply.grounding?.action?.result.outcome, 'success')

  const requiredVersionPacket = packet('version-snapshot', '"engines": { "node": ">=22" }')
  const requiredVersion = await runScenario({
    userText: 'Какая версия Node требуется этому проекту?',
    steps: [
      {
        tool: 'project_search',
        input: { query: 'Node runtime requirement', hints: { paths: ['package.json'] } },
      },
      { reply: '[calm]Проект требует Node.js 22 или новее.' },
    ],
    initialPacket: requiredVersionPacket,
  })
  assert.equal(requiredVersion.searchCount, 1)
  assert.equal(requiredVersion.reply.grounding?.project?.snapshotCommit, 'version-snapshot')
  assert.equal(requiredVersion.reply.grounding?.action, undefined)

  const originalActionPacket = packet('typecheck-original', '"typecheck": "tsc --noEmit"')
  const laterActionPacket = packet('typecheck-later', '"typecheck": "changed-after-action"')
  const projectTypecheck = await runScenario({
    userText: 'Найди команду typecheck этого проекта и запусти её.',
    steps: [
      {
        tool: 'project_search',
        input: { query: 'project typecheck command', hints: { paths: ['package.json'] } },
      },
      { tool: 'shell_execute', input: { command: 'npm run typecheck' } },
      { reply: '[happy]Typecheck прошёл без ошибок.' },
    ],
    initialPacket: originalActionPacket,
    replacementPacket: laterActionPacket,
    actionResult: actionResult(
      'action-2-123e4567-e89b-12d3-a456-426614174000',
      'PowerShell exit code: 0\nstdout:\nTypecheck passed',
    ),
  })
  assert.equal(projectTypecheck.searchCount, 1)
  assert.deepEqual(projectTypecheck.executedCommands, ['npm run typecheck'])
  assert.equal(projectTypecheck.reply.grounding?.project?.snapshotCommit, 'typecheck-original')
  assert.equal(projectTypecheck.reply.grounding?.action?.result.outcome, 'success')
  assert(Object.isFrozen(projectTypecheck.reply.grounding))
  assert(hasProjectSnapshot(projectTypecheck.calls[1] ?? [], 'typecheck-original'))
  assert(hasProjectSnapshot(projectTypecheck.calls[2] ?? [], 'typecheck-original'))
  assert.equal(hasProjectSnapshot(projectTypecheck.calls[2] ?? [], 'typecheck-later'), false)

  const literalCommand = await runScenario({
    userText: 'Выполни npm run typecheck',
    steps: [
      { tool: 'shell_execute', input: { command: 'npm run typecheck' } },
      { reply: '[calm]Команда завершилась успешно.' },
    ],
    actionResult: actionResult(
      'action-3-123e4567-e89b-12d3-a456-426614174000',
      'PowerShell exit code: 0\nstdout:\nTypecheck passed',
    ),
  })
  assert.equal(literalCommand.searchCount, 0)
  assert.deepEqual(literalCommand.executedCommands, ['npm run typecheck'])
  assert.equal(literalCommand.reply.grounding?.project, undefined)

  console.log('Semantic Project-aware Actions focused repro: PASS')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
