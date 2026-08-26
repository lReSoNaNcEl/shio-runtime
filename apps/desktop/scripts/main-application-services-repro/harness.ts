import assert from 'node:assert/strict'

import { MainConversationTurnService } from '../../src/main/app/MainConversationTurnService'
import { SpeechApplicationService } from '../../src/main/app/SpeechApplicationService'
import type { LlmGateway } from '../../src/main/llm'
import type { CharacterReplyInput, Orchestrator } from '../../src/main/orchestrator'
import type { ScreenContextService } from '../../src/main/screen-context'
import type { SpeechClientManager } from '../../src/main/speech/SpeechClientManager'
import { SpeechServiceError } from '../../src/main/speech/speechErrors'

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
  assert.equal(cancelledSignal?.aborted, true)
}

async function speechServiceLifecycle(): Promise<void> {
  let synthesisSignal: AbortSignal | null = null
  const orchestrator = {
    synthesizeReply: async (_text: string, _emotion: string, signal: AbortSignal) => {
      synthesisSignal = signal
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () =>
            reject(
              new SpeechServiceError({
                code: 'CANCELLED',
                operation: 'synthesis',
                recoverable: false,
                technicalMessage: 'cancelled in repro',
              }),
            ),
          { once: true },
        )
      })
    },
  } as unknown as Orchestrator
  const speech = {
    getEndpoint: () => 'http://127.0.0.1:8000',
    health: async () => ({ status: 'ok' }),
    transcribe: async () => ({ text: 'распознано' }),
    warmupVoice: async () => ({ ok: true }),
  } as unknown as SpeechClientManager
  const service = new SpeechApplicationService(
    () => speech,
    () => orchestrator,
  )

  assert.equal(service.getEndpoint(), 'http://127.0.0.1:8000')
  assert.deepEqual(await service.recognize(new ArrayBuffer(48)), { text: 'распознано' })
  const synthesis = service.synthesize('speech-cancel', 'Текст', 'calm')
  await service.cancelSynthesis('speech-cancel')
  await assert.rejects(synthesis, (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'CANCELLED')
    return true
  })
  assert.equal(synthesisSignal?.aborted, true)
}

async function main(): Promise<void> {
  await conversationTurnLifecycle()
  await speechServiceLifecycle()
  console.log('Main application services repro: PASS')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
