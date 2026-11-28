import assert from 'node:assert/strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage, LLMProvider } from '../../src/main/llm'
import { LlmResponseError } from '../../src/main/llm'
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
import type { CharacterReplyStreamEvent } from '../../src/shared/character-stream'
import type { AppSettings } from '../../src/shared/config'
import { deriveTurnRecoveryCapabilities } from '../../src/shared/conversation'
import { createDeferred } from '../support/Deferred'
import { WireHttpError as APIError, runChatCompletionDetailed } from '../support/llm/wireFixture'

beforeEach(() => {
  vi.stubGlobal('window', {
    api: {
      llm: {
        cancelReply: async () => ({ ok: true as const }),
      },
      latency: {
        record: async () => ({ ok: true as const }),
      },
      tts: {
        cancelSynthesis: async () => ({ ok: true as const }),
      },
    },
  })
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
    provider: 'openrouter',
    code: 'NETWORK_ERROR',
    recoverable: true,
    message: 'network',
  })

async function testTransactionalMemory(): Promise<void> {
  const provider = new FakeProvider()
  const memory = new InMemoryStore()
  const orchestrator = new Orchestrator(provider, memory, (() => ({})) as () => AppSettings)

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
      provider: 'openrouter',
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

async function testProviderReasoningContainment(): Promise<void> {
  const provider = new FakeProvider()
  const memory = new InMemoryStore()
  const orchestrator = new Orchestrator(provider, memory, (() => ({})) as () => AppSettings)
  provider.enqueue('\\<think>private plan\\</think>[warm]Привет!')

  const reply = await orchestrator.createReply({ userText: 'Поздоровайся' })
  const history = await memory.getHistory('default')

  assert.equal(reply.replyText, '[warm]Привет!')
  assert.equal(history.at(-1)?.content, 'Привет!')
  assert.doesNotMatch(JSON.stringify({ reply, history }), /private plan|think/u)
}

type ConversationOverrides = Omit<
  Partial<ConversationRuntimeDeps>,
  'presentation' | 'speechOutput' | 'characterResponse'
> &
  Pick<ConversationRuntimeDeps, 'characterResponse'> & {
    setEmbodimentIntent?: ConversationRuntimeDeps['presentation']['setEmbodimentIntent']
    speechOutput?: Partial<ConversationRuntimeDeps['speechOutput']>
  }

function createConversationRuntime({
  setEmbodimentIntent = () => undefined,
  speechOutput,
  ...overrides
}: ConversationOverrides): ConversationRuntime {
  return new ConversationRuntime({
    speechOutput: { stopCurrent: () => undefined, ...speechOutput },
    characterState: { get: () => ({}) },
    conversationState: {
      transition: () => ({}),
      setPresence: () => ({}),
    },
    conversationPresence: { update: (patch: object) => patch },
    presentation: {
      applyCharacterState: () => undefined,
      setEmbodimentIntent,
      interruptLipSync: () => undefined,
      stopLipSync: () => undefined,
      triggerEarImpulse: () => false,
      triggerReactionGesture: () => undefined,
      triggerUserInterruption: () => undefined,
      publishAvatarState: () => undefined,
    },
    events: { publish: () => undefined },
    setStatus: () => undefined,
    pushMessage: () => undefined,
    formatUserError: (message: string) => message,
    markAssistantMessageInterrupted: () => undefined,
    setResponseInterruptionPending: () => undefined,
    recordRuntimeEvent: () => undefined,
    reportSpeechServiceError: () => undefined,
    rememberSpeechMetadata: () => undefined,
    updateSpeechPlaybackProgress: () => undefined,
    isContinuousCaptureAlive: () => false,
    handleLlmSetupRequired: () => undefined,
    ...overrides,
  } as unknown as ConversationRuntimeDeps)
}

const recoveryCodes = ['TIMEOUT', 'CANCELLED', 'NETWORK_ERROR'] as const

async function testConversationAlwaysLeavesThinking(code: (typeof recoveryCodes)[number]) {
  const statuses: string[] = []
  const events: string[] = []
  const runtime = createConversationRuntime({
    characterResponse: {
      createReply: async () => {
        throw new ConversationTurnFailureError({
          domain: 'llm',
          code,
          providerId: 'openrouter',
          attachmentDisposition: 'released',
          retrySameRequest: code !== 'CANCELLED',
          canResubmitWithoutImage: false,
        })
      },
    },
    setStatus: (status: string) => statuses.push(status),
    recordRuntimeEvent: (label: string) => events.push(label),
  })
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

async function testPostGenerationFailureReleasesScreenAttachment(): Promise<void> {
  let embodimentUpdates = 0
  const runtime = createConversationRuntime({
    characterResponse: {
      createReply: async () => ({
        replyText: '[calm]screen answer',
        displayText: 'screen answer',
        speechText: '',
        emotionKey: 'calm',
        segments: [],
      }),
    },
    setEmbodimentIntent: () => {
      embodimentUpdates += 1
      if (embodimentUpdates === 2) throw new Error('post-generation renderer failure')
    },
  })

  const result = await runtime.execute(
    {
      turnId: 'turn-post-generation-failure',
      text: 'analyze the attached screenshot',
      source: 'text_chat',
      screenContextId: 'capture-consumed-by-main',
      createdAt: Date.now(),
      admissionCycleId: 'cycle-post-generation-failure',
    },
    () => undefined,
  )

  assert.equal(result.status, 'failed')
  if (result.status !== 'failed') throw new Error('Expected failed result')
  assert.equal(result.attachmentDisposition, 'released')
}

async function testPostGenerationCancellationReleasesScreenAttachment(): Promise<void> {
  let markSynthesisStarted!: () => void
  const synthesisStarted = new Promise<void>((resolve) => {
    markSynthesisStarted = resolve
  })
  const runtime = createConversationRuntime({
    speechOutput: {
      hasSpeakableContent: () => true,
      openStream: () => ({
        completion: new Promise<never>(() => undefined),
        commit: () => markSynthesisStarted(),
        finish: () => undefined,
        cancel: () => undefined,
      }),
    },
    characterResponse: {
      createReply: async () => ({
        replyText: '[calm]screen answer',
        displayText: 'screen answer',
        speechText: 'screen answer',
        emotionKey: 'calm',
        segments: [
          {
            id: 'segment-1',
            index: 0,
            emotion: 'calm',
            text: 'screen answer',
            boundaryAfter: 'sentence',
            targetMaxGapMs: 0,
          },
        ],
      }),
    },
  })

  const execution = runtime.execute(
    {
      turnId: 'turn-post-generation-cancellation',
      text: 'analyze the attached screenshot',
      source: 'text_chat',
      screenContextId: 'capture-consumed-by-main',
      createdAt: Date.now(),
      admissionCycleId: 'cycle-post-generation-cancellation',
    },
    () => undefined,
  )
  await synthesisStarted
  assert.equal(await runtime.interruptCurrentResponse('manual-stop'), true)
  const result = await execution

  assert.equal(result.status, 'cancelled')
  if (result.status !== 'cancelled') throw new Error('Expected cancelled result')
  assert.equal(result.attachmentDisposition, 'released')
}

async function testSpeechCancellationPreservesFinalStreamedText(): Promise<void> {
  const partialText = 'Короткая потоковая версия. '
  const finalText = `${partialText}Полное продолжение ответа модели.`
  let markFinalShown!: () => void
  const finalShown = new Promise<void>((resolve) => {
    markFinalShown = resolve
  })
  const messageTexts: string[] = []
  const runtime = createConversationRuntime({
    speechOutput: {
      hasSpeakableContent: () => true,
      openStream: () => ({
        completion: new Promise<never>(() => undefined),
        commit: () => undefined,
        finish: () => undefined,
        cancel: () => undefined,
      }),
    },
    characterResponse: {
      createReply: async (
        _turnId: string,
        _text: string,
        _screenContextId?: string,
        onStreamEvent?: (event: CharacterReplyStreamEvent) => void,
      ) => {
        onStreamEvent?.({
          type: 'text-delta',
          turnId: 'turn-preserve-final-text',
          requestId: 'request:turn-preserve-final-text',
          at: Date.now(),
          llmRound: 0,
          delta: { text: partialText, emotion: 'calm' },
        })
        return {
          replyText: `[calm]${finalText}`,
          displayText: finalText,
          speechText: finalText,
          emotionKey: 'calm',
          segments: [
            {
              id: 'segment-1',
              index: 0,
              emotion: 'calm',
              text: finalText,
              boundaryAfter: 'sentence',
              targetMaxGapMs: 0,
            },
          ],
        }
      },
    },
    pushMessage: (_role: string, text: string) => {
      messageTexts.push(text)
      return 'assistant-stream'
    },
    updateMessage: (
      _id: string,
      text: string,
      _grounding: unknown,
      _streaming: boolean | undefined,
      immediate: boolean | undefined,
    ) => {
      messageTexts.push(text)
      if (immediate && text === finalText) markFinalShown()
    },
  })

  const execution = runtime.execute(
    {
      turnId: 'turn-preserve-final-text',
      text: 'Ответь подробно',
      source: 'text_chat',
      createdAt: Date.now(),
      admissionCycleId: 'cycle-preserve-final-text',
    },
    () => undefined,
  )
  await finalShown
  assert.equal(await runtime.interruptCurrentResponse('manual-stop'), true)
  const result = await execution

  assert.equal(result.status, 'cancelled')
  assert.equal(messageTexts.at(-1), finalText)
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
      provider: 'openrouter',
      displayName: 'OpenRouter',
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

describe('failed LLM turn recovery', () => {
  it.each(['generation', 'synthesis'] as const)(
    'settles local interruption before adapter abort during %s',
    async (phase) => {
      const pending = createDeferred<never>()
      const started = createDeferred<void>()
      const cancel = vi.fn(async () => {
        pending.reject(new DOMException('Aborted', 'AbortError'))
        return { ok: true as const }
      })
      const pushMessage = vi.fn()
      const markInterrupted = vi.fn()
      const interruptionPending = vi.fn()
      const runtime = createConversationRuntime({
        characterResponse: {
          createReply: () => {
            started.resolve()
            return pending.promise
          },
        },
        speechOutput: {
          openStream: () => {
            started.resolve()
            return {
              completion: pending.promise,
              commit: () => undefined,
              finish: () => undefined,
              cancel: () => undefined,
            }
          },
        },
        pushMessage,
        markAssistantMessageInterrupted: markInterrupted,
        setResponseInterruptionPending: interruptionPending,
        isContinuousCaptureAlive: () => true,
      })
      window.api.llm.cancelReply = cancel
      window.api.tts.cancelSynthesis = cancel
      const execution = runtime.execute(
        {
          turnId: 'interrupted',
          text: 'happy',
          createdAt: Date.now(),
          admissionCycleId: 'cycle',
          source: phase === 'generation' ? 'continuous_listening' : 'debug',
        },
        () => undefined,
      )
      await started.promise
      expect(runtime.getActiveResponseSnapshot().phase).toBe(
        phase === 'generation' ? 'generating' : 'synthesizing',
      )
      expect(await runtime.interruptCurrentResponse('voice-barge-in')).toBe(true)
      expect(await execution).toMatchObject({ status: 'cancelled' })
      expect(cancel).toHaveBeenCalledTimes(2)
      expect(pushMessage).not.toHaveBeenCalled()
      expect(markInterrupted).toHaveBeenCalledOnce()
      expect(interruptionPending.mock.calls).toEqual([[true], [false]])
    },
  )

  it('uses the stopped exchange in planning and reply without committing it to history', async () => {
    const provider = new FakeProvider()
    provider.enqueue(
      JSON.stringify({
        requirement: { type: 'direct-answer' },
        plannedTools: [],
        embodiment: null,
      }),
      '[calm]Внутри показался компас.',
    )
    const memory = new InMemoryStore()
    const orchestrator = new Orchestrator(
      provider,
      memory,
      () => ({ uiLocale: 'ru' }) as AppSettings,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { enforceRequirements: true },
    )
    const result = await orchestrator.createReply({
      userText: 'Продолжи.',
      interruptedTurn: {
        userText: 'Расскажи про Ариадну.',
        visibleReply: 'Ариадна открыла коробку.',
      },
    })
    assert.match(result.replyText, /компас/u)
    assert.equal(provider.requests.length, 2)
    for (const request of provider.requests) {
      const system = request
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n')
      assert.match(system, /Расскажи про Ариадну/u)
      assert.match(system, /Ариадна открыла коробку/u)
    }
    const history = await memory.getHistory('default')
    assert.equal(history.length, 2)
    assert.equal(history[0]?.content, 'Продолжи.')
    assert.doesNotMatch(JSON.stringify(history), /Ариадн/u)
  })

  it(
    'keeps turn history consistent across provider failures and cancellation',
    testTransactionalMemory,
  )
  it('keeps provider reasoning out of replies and history', testProviderReasoningContainment)
  it.each(recoveryCodes)('leaves thinking after %s', testConversationAlwaysLeavesThinking)
  it(
    'releases the screen attachment after a renderer failure',
    testPostGenerationFailureReleasesScreenAttachment,
  )
  it(
    'releases the screen attachment after speech cancellation',
    testPostGenerationCancellationReleasesScreenAttachment,
  )
  it(
    'preserves final streamed text when speech is cancelled',
    testSpeechCancellationPreservesFinalStreamedText,
  )
  it('releases the screen context lease', testScreenContextLease)
  it('classifies HTTP 413 for turn recovery', testHttp413Classification)
})
