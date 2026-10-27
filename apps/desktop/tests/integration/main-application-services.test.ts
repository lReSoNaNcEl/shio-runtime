import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import { MainConversationTurnService } from '../../src/main/app/MainConversationTurnService'
import { SpeechApplicationService } from '../../src/main/app/SpeechApplicationService'
import type { LlmGateway } from '../../src/main/llm'
import type { CharacterReplyInput, Orchestrator } from '../../src/main/orchestrator'
import type { ScreenContextService } from '../../src/main/screen-context'
import type { SpeechClientManager } from '../../src/main/speech/SpeechClientManager'
import type { SpeechStreamConnection } from '../../src/main/speech/speechClient'
import type {
  SpeechStreamInput,
  SpeechStreamOutput,
  SpeechStreamStart,
} from '../../src/shared/speech'

function configuredLlmSettings() {
  return {
    activeProvider: 'groq',
    providers: { groq: { model: 'openai/gpt-oss-120b', credential: { configured: true } } },
  } as never
}

async function conversationTurnLifecycle(): Promise<void> {
  const receivedInputs: CharacterReplyInput[] = []
  const successfulOrchestrator = {
    createReply: async (input: CharacterReplyInput) => {
      receivedInputs.push(input)
      return {
        replyText: '[calm]Готово.',
        emotionKey: 'calm',
      }
    },
  } as unknown as Orchestrator
  const service = new MainConversationTurnService(
    () => successfulOrchestrator,
    () => ({ getActiveCapabilities: () => ({ supportsVision: true }) }) as LlmGateway,
    {} as ScreenContextService,
    configuredLlmSettings,
  )
  assert.deepEqual(await service.createReply(1, { turnId: 'turn-success', userText: 'Привет' }), {
    ok: true,
    replyText: '[calm]Готово.',
    emotionKey: 'calm',
    embodimentIntent: undefined,
    grounding: undefined,
  })
  assert.equal(receivedInputs[0]?.origin, 'user')
  await service.createReply(1, {
    turnId: 'turn-autonomous',
    userText: 'Checkpoint reached: 3',
    origin: 'autonomous',
  })
  assert.equal(receivedInputs[1]?.origin, 'autonomous')

  const missingModel = new MainConversationTurnService(
    () => successfulOrchestrator,
    () => ({ getActiveCapabilities: () => ({ supportsVision: true }) }) as LlmGateway,
    {} as ScreenContextService,
    () =>
      ({
        activeProvider: 'groq',
        providers: { groq: { model: '', credential: { configured: true } } },
      }) as never,
  )
  assert.deepEqual(
    await missingModel.createReply(1, { turnId: 'turn-model-missing', userText: 'Привет' }),
    { ok: false, errorCode: 'LLM_MODEL_MISSING' },
  )

  let cancelledSignal: AbortSignal | null = null
  const cancellableOrchestrator = {
    createReply: async (_input: unknown, options: { signal: AbortSignal }) => {
      cancelledSignal = options.signal
      return new Promise<never>((_resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => reject({ code: 'CANCELLED', recoverable: true }),
          { once: true },
        )
      })
    },
  } as unknown as Orchestrator
  const cancellable = new MainConversationTurnService(
    () => cancellableOrchestrator,
    () => ({ getActiveCapabilities: () => ({ supportsVision: true }) }) as LlmGateway,
    {} as ScreenContextService,
    configuredLlmSettings,
  )
  const reply = cancellable.createReply(1, { turnId: 'turn-cancel', userText: 'Стоп' })
  await cancellable.cancelReply('turn-cancel')
  const cancelled = await reply
  assert.equal(cancelled.ok, false)
  assert.equal(cancelled.failure?.code, 'CANCELLED')
  assert.equal((cancelledSignal as AbortSignal | null)?.aborted, true)
}

async function speechServiceLifecycle(): Promise<void> {
  const streamMessages: Array<SpeechStreamInput> = []
  const cancellations: string[] = []
  let streamOutput: ((event: SpeechStreamOutput) => void) | undefined
  const speech = {
    getEndpoint: () => 'http://127.0.0.1:8000',
    health: async () => ({ status: 'ok' }),
    transcribe: async () => ({ text: 'распознано' }),
    warmupVoice: async () => ({ ok: true }),
    openStream: (_input: SpeechStreamStart, onEvent: (event: SpeechStreamOutput) => void) => {
      streamOutput = onEvent
      return {
        send: (message) => streamMessages.push(message),
        cancel: async (reason) => {
          cancellations.push(reason)
        },
      } satisfies SpeechStreamConnection
    },
  } as unknown as SpeechClientManager
  const service = new SpeechApplicationService(() => speech)

  assert.equal(service.getEndpoint(), 'http://127.0.0.1:8000')
  assert.deepEqual(await service.recognize(new ArrayBuffer(48)), { text: 'распознано' })
  const stream = service.openStream(
    {
      protocolVersion: 2,
      sessionId: 'speech:speech-cancel',
      turnId: 'speech-cancel',
      voiceId: 'animevox_makima',
      language: 'ru',
      delivery: { emotion: 'calm', pace: 'slow', energy: 'normal', volume: 'normal' },
    },
    () => undefined,
  )
  stream.send({
    type: 'text',
    sequence: 0,
    text: 'Текст для потоковой речи.',
  })
  assert.equal(streamMessages.length, 1)
  await service.cancelSynthesis('speech-cancel')
  assert.deepEqual(cancellations, ['Conversation interrupted'])
  streamOutput?.({ type: 'error', code: 'cancelled', message: 'cancelled in test' })
}

async function main(): Promise<void> {
  await conversationTurnLifecycle()
  await speechServiceLifecycle()
  console.log('Main application services repro: PASS')
}

describe('main application services', () => {
  it('owns conversation and speech application lifecycles', async () => {
    await main()
  })
})
