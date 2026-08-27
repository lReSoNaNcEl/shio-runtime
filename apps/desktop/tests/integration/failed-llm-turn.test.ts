import assert from 'node:assert/strict'

import { APIError } from 'openai'
import { describe, it } from 'vitest'

import type { ChatMessage, LLMProvider } from '../../src/main/llm'
import { LlmResponseError } from '../../src/main/llm'
import { runChatCompletionDetailed } from '../../src/main/llm/openai-compatible/request'
import { InMemoryStore } from '../../src/main/memory/InMemoryStore'
import { Orchestrator } from '../../src/main/orchestrator'
import type { NormalizedScreenContextImage } from '../../src/main/screen-context/ImageNormalizer'
import type { ScreenCaptureAdapter } from '../../src/main/screen-context/ScreenCaptureAdapter'
import {
  ScreenContextError,
  ScreenContextService,
} from '../../src/main/screen-context/ScreenContextService'
import { ConversationTurnFailureError } from '../../src/renderer/runtime/CharacterResponsePort'
import {
  ConversationRuntime,
  type ConversationRuntimeDeps,
} from '../../src/renderer/runtime/ConversationRuntime'
import type { AppSettings } from '../../src/shared/config'
import { deriveTurnRecoveryCapabilities } from '../../src/shared/conversation'

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    api: {
      latency: {
        record: async () => ({ ok: true as const }),
      },
    },
  },
})

class FakeProvider implements LLMProvider {
  readonly requests: Array<readonly ChatMessage[]> = []
  private outcomes: Array<string | Error> = []

  enqueue(...outcomes: Array<string | Error>): void {
    this.outcomes.push(...outcomes)
  }

  async chat(messages: readonly ChatMessage[]): Promise<string> {
    this.requests.push([...messages])
    const outcome = this.outcomes.shift()
    if (outcome instanceof Error) throw outcome
    return outcome ?? '[calm]ok'
  }
}

const networkFailure = () =>
  new LlmResponseError({
    provider: 'mistral',
    code: 'NETWORK_ERROR',
    recoverable: true,
    message: 'network',
  })

async function testTransactionalMemory(): Promise<void> {
  const provider = new FakeProvider()
  const memory = new InMemoryStore()
  const orchestrator = new Orchestrator(
    provider,
    memory,
    {} as ConstructorParameters<typeof Orchestrator>[2],
    (() => ({})) as () => AppSettings,
  )

  provider.enqueue(networkFailure(), networkFailure(), networkFailure(), networkFailure())
  const failedOne = await orchestrator.createReply({ userText: 'failed-one' })
  const failedVision = await orchestrator.createReply({
    userText: 'failed-vision',
    screenContext: {
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
      sourceName: 'synthetic',
    },
  })
  assert.match(failedOne.replyText, /не могу связаться с моделью/u)
  assert.match(failedVision.replyText, /не могу связаться с моделью/u)
  assert.equal((await memory.getHistory('default')).length, 4)

  provider.enqueue('[happy]success')
  await orchestrator.createReply({ userText: 'works-without-new-conversation' })
  assert.equal((await memory.getHistory('default')).length, 6)
  const successfulRequest = provider.requests.at(-1) ?? []
  assert.equal(
    successfulRequest.some(
      (message) =>
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.includes('failed'),
    ),
    true,
  )

  provider.enqueue(networkFailure(), networkFailure(), '[warm]next')
  const failedAfterSuccess = await orchestrator.createReply({ userText: 'failed-after-success' })
  assert.match(failedAfterSuccess.replyText, /не могу связаться с моделью/u)
  await orchestrator.createReply({ userText: 'next' })
  assert.equal((await memory.getHistory('default')).length, 10)

  provider.enqueue(
    new LlmResponseError({
      provider: 'mistral',
      code: 'REQUEST_TOO_LARGE',
      recoverable: false,
      message: 'too large',
    }),
  )
  await assert.rejects(orchestrator.createReply({ userText: 'hidden-terminal-failure' }))
  assert.equal((await memory.getHistory('default')).length, 10)

  provider.enqueue('[calm]cancelled')
  const abortController = new AbortController()
  abortController.abort()
  await assert.rejects(
    orchestrator.createReply({ userText: 'cancelled' }, { signal: abortController.signal }),
    (error) => error instanceof Error && error.message === 'CANCELLED',
  )
  assert.equal((await memory.getHistory('default')).length, 10)
}

async function testConversationAlwaysLeavesThinking(): Promise<void> {
  for (const code of ['TIMEOUT', 'CANCELLED', 'NETWORK_ERROR'] as const) {
    const statuses: string[] = []
    const events: string[] = []
    const runtime = new ConversationRuntime({
      speechOutput: { stopCurrent: () => undefined },
      characterResponse: {
        createReply: async () => {
          throw new ConversationTurnFailureError({
            domain: 'llm',
            code,
            providerId: 'mistral',
            attachmentDisposition: 'released',
            retrySameRequest: code !== 'CANCELLED',
            canResubmitWithoutImage: false,
          })
        },
      },
      characterState: { get: () => ({}) },
      conversationState: {
        transition: () => ({}),
        setPresence: () => ({}),
      },
      conversationPresence: { update: (patch: object) => patch },
      presentation: {
        applyCharacterState: () => undefined,
        setEmbodimentIntent: () => undefined,
        interruptLipSync: () => undefined,
        stopLipSync: () => undefined,
        triggerEarImpulse: () => false,
        triggerReactionGesture: () => undefined,
        triggerUserInterruption: () => undefined,
        publishAvatarState: () => undefined,
      },
      events: { publish: () => undefined },
      setStatus: (status: string) => statuses.push(status),
      pushMessage: () => undefined,
      formatUserError: (message: string) => message,
      markAssistantMessageInterrupted: () => undefined,
      setResponseInterruptionPending: () => undefined,
      recordRuntimeEvent: (label: string) => events.push(label),
      reportSpeechServiceError: () => undefined,
      rememberSpeechMetadata: () => undefined,
      updateSpeechPlaybackProgress: () => undefined,
      isContinuousCaptureAlive: () => false,
      handleLlmSetupRequired: () => undefined,
    } as unknown as ConversationRuntimeDeps)
    const result = await runtime.execute(
      {
        turnId: `turn-${code.toLowerCase()}`,
        text: 'safe diagnostic query',
        source: 'text_chat',
        createdAt: Date.now(),
        admissionCycleId: `cycle-${code.toLowerCase()}`,
      },
      () => undefined,
    )
    assert.equal(result.status, 'failed')
    assert.equal(statuses.includes('thinking'), true)
    assert.equal(statuses.at(-1), 'idle')
    assert.equal(events.includes('Conversation Terminal'), true)
  }
}

async function testScreenContextLease(): Promise<void> {
  const normalized: NormalizedScreenContextImage = {
    bytes: new Uint8Array([7, 8, 9]),
    mimeType: 'image/png',
    previewDataUrl: 'data:image/png;base64,BwgJ',
    width: 1,
    height: 1,
  }
  const normalizer = {
    normalizeImport: async () => normalized,
  } as unknown as ConstructorParameters<typeof ScreenContextService>[1]
  const service = new ScreenContextService({} as ScreenCaptureAdapter, normalizer)
  const rendererId = 10
  const descriptor = await service.importImage(rendererId, {
    operationId: crypto.randomUUID(),
    bytes: new ArrayBuffer(3),
    mimeType: 'image/png',
    sourceKind: 'file',
    sourceName: 'synthetic.png',
  })

  service.acquireForTurn(rendererId, descriptor.captureId, 'turn-1')
  assert.throws(
    () => service.acquireForTurn(rendererId, descriptor.captureId, 'turn-2'),
    (error) => error instanceof ScreenContextError && error.code === 'CAPTURE_NOT_OWNED',
  )
  service.rollbackTurn(rendererId, descriptor.captureId, 'turn-1')
  service.acquireForTurn(rendererId, descriptor.captureId, 'turn-2')
  service.completeTurn(rendererId, descriptor.captureId, 'turn-2')
  assert.equal(service.release(rendererId, descriptor.captureId), false)

  const inFlight = await service.importImage(rendererId, {
    operationId: crypto.randomUUID(),
    bytes: new ArrayBuffer(3),
    mimeType: 'image/png',
    sourceKind: 'file',
    sourceName: 'new-conversation.png',
  })
  service.acquireForTurn(rendererId, inFlight.captureId, 'turn-new-conversation')
  assert.equal(service.release(rendererId, inFlight.captureId), true)
  assert.equal(service.rollbackTurn(rendererId, inFlight.captureId, 'turn-new-conversation'), false)
  service.dispose()
}

async function testHttp413Classification(): Promise<void> {
  const error = APIError.generate(
    413,
    { error: { sensitive: 'must-not-cross-boundary' } },
    'large',
    new Headers(),
  )
  const client = {
    chat: { completions: { create: async () => Promise.reject(error) } },
  }
  await assert.rejects(
    runChatCompletionDetailed({
      provider: 'mistral',
      displayName: 'Mistral',
      client: client as never,
      model: 'test',
      capabilities: {
        supportsVision: true,
        supportsReasoning: false,
        supportsStreaming: false,
        supportsSystemPrompt: true,
        supportsTemperature: true,
        supportsToolCalling: false,
        recommendedMaxTokens: 10,
      },
      messages: [{ role: 'user', content: 'test' }],
    }),
    (caught) =>
      caught instanceof LlmResponseError &&
      caught.code === 'REQUEST_TOO_LARGE' &&
      caught.recoverable === false &&
      !caught.message.includes('sensitive'),
  )
  assert.deepEqual(
    deriveTurnRecoveryCapabilities({
      code: 'REQUEST_TOO_LARGE',
      transportRecoverable: false,
      hadImage: true,
      attachmentDisposition: 'released',
    }),
    {
      retrySameRequest: false,
      canResubmitWithoutImage: true,
    },
  )
}

async function run(): Promise<void> {
  await testTransactionalMemory()
  await testConversationAlwaysLeavesThinking()
  await testScreenContextLease()
  await testHttp413Classification()
  console.log('Failed LLM turn recovery repro passed')
}

describe('failed LLM turn recovery', () => {
  it('releases transactional state and screen leases', async () => {
    await run()
  })
})
