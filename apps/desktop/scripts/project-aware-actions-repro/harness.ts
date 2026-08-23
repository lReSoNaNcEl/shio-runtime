import assert from 'node:assert/strict'

import type { ChatMessage, LLMProvider } from '../../src/main/llm'
import type { MemoryStore } from '../../src/main/memory'
import { Orchestrator } from '../../src/main/orchestrator'
import { projectContextRequirement } from '../../src/main/project-awareness'
import type { SpeechClient } from '../../src/main/speech/speechClient'
import type { DesktopWorkflowActionResult } from '../../src/shared/actions'
import type { ShioCapabilitySnapshot } from '../../src/shared/capabilities'
import type { AppSettings } from '../../src/shared/config'
import type { ProjectContextProvider } from '../../src/shared/plugins'
import type { ProjectContextPacket } from '../../src/shared/project-awareness'

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
    requirement: 'required',
    snapshotSha,
    repository: 'owner/project',
    branch: 'main',
    freshness: 'fresh',
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

interface ScenarioInput {
  userText: string
  replies: readonly string[]
  initialPacket?: ProjectContextPacket
  replacementPacket?: ProjectContextPacket
  actionResult?: DesktopWorkflowActionResult
}

async function runScenario(input: ScenarioInput): Promise<{
  reply: Awaited<ReturnType<Orchestrator['createReply']>>
  calls: readonly (readonly ChatMessage[])[]
  buildCount: number
  executedCommands: readonly string[]
}> {
  let activePacket = input.initialPacket ?? null
  let buildCount = 0
  let replyIndex = 0
  const calls: (readonly ChatMessage[])[] = []
  const executedCommands: string[] = []
  const llm: LLMProvider = {
    chat: async (messages) => {
      calls.push(messages)
      const reply = input.replies[replyIndex]
      replyIndex += 1
      assert(reply, `Missing fake provider reply for call ${replyIndex}`)
      return reply
    },
  }
  const memory: MemoryStore = {
    getHistory: async () => [],
    appendTurn: async () => undefined,
    clear: async () => undefined,
  }
  const provider: ProjectContextProvider = {
    resolveRequirement: ({ userText }) => projectContextRequirement(userText),
    buildContext: async ({ requirement }) => {
      buildCount += 1
      assert.notEqual(requirement, 'none')
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
    buildCount,
    executedCommands,
  }
}

function hasProjectSnapshot(messages: readonly ChatMessage[], snapshotSha: string): boolean {
  return messages.some(
    (message) =>
      typeof message.content === 'string' &&
      message.content.includes('## Project Context') &&
      message.content.includes(`Snapshot commit: ${snapshotSha}`),
  )
}

async function main(): Promise<void> {
  const simpleNode = await runScenario({
    userText: 'Выполни node -v',
    replies: [
      '[calm]<shio-action>{"type":"desktop.workflow","goal":"Read the installed runtime version","shellCommand":"node -v","requestedCapabilities":["shell"],"risk":"normal"}</shio-action>',
      '[calm]У тебя установлена версия 24.19.0. Терминал пережил эту встречу достойно.',
    ],
    actionResult: actionResult(
      'action-1-123e4567-e89b-12d3-a456-426614174000',
      'PowerShell exit code: 0\nstdout:\nv24.19.0',
    ),
  })
  assert.equal(simpleNode.buildCount, 0)
  assert.deepEqual(simpleNode.executedCommands, ['node -v'])
  assert.equal(simpleNode.reply.grounding?.project, undefined)
  assert.equal(simpleNode.reply.grounding?.action?.result.outcome, 'success')
  assert.equal(simpleNode.reply.grounding?.action?.result.reportedOutcomeSha256?.length, 64)
  assert.equal(
    simpleNode.calls.some((messages) => hasProjectSnapshot(messages, 'old-sha')),
    false,
  )

  const requiredVersionPacket = packet('version-snapshot', '"engines": { "node": ">=22" }')
  const requiredVersion = await runScenario({
    userText: 'Какую версию Node требует этот проект?',
    replies: ['[calm]Проект требует Node.js 22 или новее — package.json тут вполне прямолинеен.'],
    initialPacket: requiredVersionPacket,
  })
  assert.equal(requiredVersion.buildCount, 1)
  assert.equal(requiredVersion.reply.grounding?.project?.snapshotCommit, 'version-snapshot')
  assert.equal(requiredVersion.reply.grounding?.action, undefined)
  assert(hasProjectSnapshot(requiredVersion.calls[0] ?? [], 'version-snapshot'))

  const originalActionPacket = packet('typecheck-original', '"typecheck": "tsc --noEmit"')
  const laterActionPacket = packet('typecheck-later', '"typecheck": "changed-after-action"')
  const projectTypecheck = await runScenario({
    userText: 'Запусти typecheck этого проекта',
    replies: [
      '[calm]<shio-action>{"type":"desktop.workflow","goal":"Run the project typecheck selected from project evidence","shellCommand":"npm run typecheck","requestedCapabilities":["shell"],"risk":"normal"}</shio-action>',
      '[happy]Typecheck прошёл без ошибок. Даже TypeScript сегодня решил не капризничать.',
    ],
    initialPacket: originalActionPacket,
    replacementPacket: laterActionPacket,
    actionResult: actionResult(
      'action-2-123e4567-e89b-12d3-a456-426614174000',
      'PowerShell exit code: 0\nstdout:\nTypecheck passed',
    ),
  })
  assert.equal(projectTypecheck.buildCount, 1)
  assert.deepEqual(projectTypecheck.executedCommands, ['npm run typecheck'])
  assert.equal(projectTypecheck.reply.grounding?.project?.snapshotCommit, 'typecheck-original')
  assert.equal(projectTypecheck.reply.grounding?.action?.result.outcome, 'success')
  assert(Object.isFrozen(projectTypecheck.reply.grounding))
  assert(Object.isFrozen(projectTypecheck.reply.grounding?.project))
  assert(Object.isFrozen(projectTypecheck.reply.grounding?.action))
  assert(hasProjectSnapshot(projectTypecheck.calls[0] ?? [], 'typecheck-original'))
  assert(hasProjectSnapshot(projectTypecheck.calls[1] ?? [], 'typecheck-original'))
  assert.equal(hasProjectSnapshot(projectTypecheck.calls[1] ?? [], 'typecheck-later'), false)

  const literalCommand = await runScenario({
    userText: 'Выполни npm run typecheck',
    replies: [
      '[calm]<shio-action>{"type":"desktop.workflow","goal":"Run the literal command requested by the user","shellCommand":"npm run typecheck","requestedCapabilities":["shell"],"risk":"normal"}</shio-action>',
      '[calm]Команда завершилась успешно. На этот раз npm даже не устроил ритуал зависимости.',
    ],
    actionResult: actionResult(
      'action-3-123e4567-e89b-12d3-a456-426614174000',
      'PowerShell exit code: 0\nstdout:\nTypecheck passed',
    ),
  })
  assert.equal(literalCommand.buildCount, 0)
  assert.deepEqual(literalCommand.executedCommands, ['npm run typecheck'])
  assert.equal(literalCommand.reply.grounding?.project, undefined)
  assert.equal(literalCommand.reply.grounding?.action?.result.outcome, 'success')

  console.log('Project-aware Actions focused repro: PASS')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
