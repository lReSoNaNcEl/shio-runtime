import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import { SpeechApplicationService } from '../../../src/main/app/SpeechApplicationService'
import type { SpeechClientManager } from '../../../src/main/speech/SpeechClientManager'
import type { SpeechStreamConnection } from '../../../src/main/speech/speechClient'
import type { PlaybackSession } from '../../../src/renderer/audio/audioPlayer'
import { MainCharacterResponsePort } from '../../../src/renderer/runtime/CharacterResponsePort'
import {
  ConversationRuntime,
  type ConversationRuntimeDeps,
} from '../../../src/renderer/runtime/ConversationRuntime'
import type { SpeechOutputPort } from '../../../src/renderer/runtime/SpeechOutputPort'
import {
  type CharacterReplyStreamEvent,
  type SafeCharacterTextDelta,
  SpeechTextCommitBuffer,
} from '../../../src/shared/character-stream'
import {
  type SpeechDeliveryIntent,
  type SpeechStreamInput,
  type SpeechStreamOutput,
  type SpeechStreamStart,
  TTS_STREAM_PROTOCOL_VERSION,
} from '../../../src/shared/speech'

const intent: SpeechDeliveryIntent = {
  emotion: 'calm',
  pace: 'slow',
  energy: 'normal',
  volume: 'normal',
}

function start(turnId = 'stream-turn'): SpeechStreamStart {
  return {
    protocolVersion: TTS_STREAM_PROTOCOL_VERSION,
    sessionId: `speech:${turnId}`,
    turnId,
    voiceId: 'animevox_makima',
    language: 'ru',
    delivery: intent,
  }
}

interface FakeStreamState {
  starts: SpeechStreamStart[]
  messages: Array<SpeechStreamInput>
  cancellations: string[]
  emit?: (event: SpeechStreamOutput) => void
}

function fakeManager(state: FakeStreamState): SpeechClientManager {
  return {
    openStream: (input: SpeechStreamStart, onEvent: (event: SpeechStreamOutput) => void) => {
      state.starts.push(input)
      state.emit = onEvent
      return {
        send: (message) => state.messages.push(message),
        cancel: (reason) => state.cancellations.push(reason),
      } satisfies SpeechStreamConnection
    },
  } as unknown as SpeechClientManager
}

function textCommitBufferFiltersUnsafeSyntax(): void {
  const buffer = new SpeechTextCommitBuffer('safe-turn')
  const deltas: SafeCharacterTextDelta[] = [
    {
      emotion: 'warm',
      text: 'Первое достаточно длинное предложение. Код `secret()` и ',
    },
    {
      emotion: 'warm',
      text: '[ссылка](https://example.com/private) готовы. <|hidden-token|> Финал.',
    },
  ]
  const commits = [...deltas.flatMap((delta) => buffer.push(delta)), ...buffer.flush()]
  assert.equal(commits.map((item) => item.sequence).join(','), '0,1,2')
  assert.equal(
    commits.map((item) => item.text).join(' '),
    'Первое достаточно длинное предложение. Код и [ссылка] готовы. Финал.',
  )
  assert.doesNotMatch(JSON.stringify(commits), /secret|example\.com|hidden-token/u)
}

function oneLogicalSessionAcceptsMultipleCommits(): void {
  const state: FakeStreamState = { starts: [], messages: [], cancellations: [] }
  const service = new SpeechApplicationService(() => fakeManager(state))
  const output: SpeechStreamOutput[] = []
  const stream = service.openStream(start(), (event) => output.push(event))
  stream.send({ type: 'text', sequence: 0, text: 'Первое предложение.' })
  stream.send({ type: 'text', sequence: 1, text: 'Второе — продолжается!' })
  stream.send({ type: 'delivery', sequence: 2, delivery: { ...intent, emotion: 'happy' } })
  stream.send({ type: 'text', sequence: 3, text: 'Третье предложение?' })
  stream.send({ type: 'text', sequence: 4, text: 'Четвёртое: уточнение.' })
  stream.send({ type: 'delivery', sequence: 5, delivery: { ...intent, emotion: 'sad' } })
  stream.send({ type: 'text', sequence: 6, text: 'Пятое завершает ответ.' })
  stream.send({ type: 'finish-input' })

  assert.equal(state.starts.length, 1)
  assert.deepEqual(
    state.messages.map((message) =>
      message.type === 'text' || message.type === 'delivery'
        ? `${message.type}:${message.sequence}`
        : message.type,
    ),
    ['text:0', 'text:1', 'delivery:2', 'text:3', 'text:4', 'delivery:5', 'text:6', 'finish-input'],
  )
  state.emit?.({ type: 'complete', sequence: 5, sessionId: 'speech:stream-turn' })
  assert.equal(output.at(-1)?.type, 'complete')
}

async function characterResponseWaitsForTerminalStreamEvent(): Promise<void> {
  let streamListener: ((event: CharacterReplyStreamEvent) => void) | undefined
  let subscribed = true
  let replyResolved = false
  const receivedEvents: CharacterReplyStreamEvent[] = []
  ;(globalThis as unknown as { window: unknown }).window = {
    api: {
      llm: {
        onReplyStreamEvent: (listener: (event: CharacterReplyStreamEvent) => void) => {
          streamListener = (event) => {
            if (subscribed) listener(event)
          }
          return () => {
            subscribed = false
          }
        },
        reply: async () => ({
          ok: true,
          replyText:
            '[warm]Первое предложение уже передано. Второе предложение пришло последней дельтой.',
        }),
      },
    },
  }

  const response = new MainCharacterResponsePort()
    .createReply('turn:ipc-order', 'Ответь подробно.', undefined, (event) => {
      receivedEvents.push(event)
    })
    .then((draft) => {
      replyResolved = true
      return draft
    })

  await Promise.resolve()
  await Promise.resolve()
  assert.equal(replyResolved, false)
  assert.equal(subscribed, true)

  streamListener?.({
    type: 'text-delta',
    turnId: 'turn:ipc-order',
    requestId: 'request:turn:ipc-order',
    at: Date.now(),
    llmRound: 0,
    delta: { emotion: 'warm', text: ' Второе предложение пришло последней дельтой.' },
  })
  streamListener?.({
    type: 'completed',
    turnId: 'turn:ipc-order',
    requestId: 'request:turn:ipc-order',
    at: Date.now(),
    llmRound: 0,
  })

  const draft = await response
  assert.equal(draft.speechText.includes('Второе предложение'), true)
  assert.equal(receivedEvents.at(-1)?.type, 'completed')
  assert.equal(subscribed, false)
}

async function conversationStartsSpeechBeforeGenerationCompletes(): Promise<void> {
  let resolveGeneration!: (value: {
    replyText: string
    displayText: string
    speechText: string
    emotionKey: string
    segments: []
  }) => void
  let generationComplete = false
  let streamCount = 0
  let commitCount = 0
  let playbackStarted = false
  const rememberedSpeech: Array<{ emotionKey?: string; avatarEmotion?: string }> = []
  const conversationTransitions: Array<{ status?: string; avatarEmotion?: string }> = []
  let resolvePlayback!: (value: { playbackId: string; turnId: string }) => void
  const playbackCompletion = new Promise<{ playbackId: string; turnId: string }>((resolve) => {
    resolvePlayback = resolve
  })
  const speechOutput: SpeechOutputPort = {
    hasSpeakableContent: (text) => Boolean(text.trim()),
    openStream: (turnId, _delivery, options) => {
      streamCount += 1
      let ready = false
      return {
        completion: playbackCompletion,
        commit: () => {
          commitCount += 1
          if (ready) return
          ready = true
          const session = {
            playbackId: `${turnId}:playback-1`,
            playbackItemId: `${turnId}:playback-1`,
            turnId,
            analyser: {} as AnalyserNode,
            startedAt: performance.now(),
            normalizationReference: 0.12,
            durationMs: 0,
          } satisfies PlaybackSession
          void options.onReady(session)
          options.onStarted?.()
          playbackStarted = true
        },
        finish: () => resolvePlayback({ playbackId: `${turnId}:playback-1`, turnId }),
        cancel: () => undefined,
      }
    },
    stopCurrent: () => undefined,
  }
  ;(globalThis as unknown as { window: unknown }).window = {
    api: { latency: { record: async () => undefined } },
  }
  const generation = new Promise<{
    replyText: string
    displayText: string
    speechText: string
    emotionKey: string
    segments: []
  }>((resolve) => {
    resolveGeneration = resolve
  }).finally(() => {
    generationComplete = true
  })
  const runtime = new ConversationRuntime({
    speechOutput,
    characterResponse: {
      createReply: (
        _turnId: string,
        _text: string,
        _screenContextId?: string,
        onStreamEvent?: (event: CharacterReplyStreamEvent) => void,
      ) => {
        onStreamEvent?.({
          type: 'text-delta',
          turnId: 'turn:concurrent',
          requestId: 'request:turn:concurrent',
          at: Date.now(),
          llmRound: 0,
          delta: {
            emotion: 'warm',
            text: 'Это достаточно длинное первое предложение. ',
          },
        })
        return generation
      },
    },
    characterState: { get: () => ({}) },
    conversationState: {
      transition: (transition: { status?: string; avatarEmotion?: string }) => {
        conversationTransitions.push(transition)
        return {}
      },
      setPresence: () => ({}),
    },
    conversationPresence: { update: (patch: object) => patch },
    presentation: {
      applyCharacterState: () => undefined,
      publishAvatarState: () => undefined,
      setEmbodimentIntent: () => undefined,
      interruptLipSync: () => undefined,
      stopLipSync: () => undefined,
      triggerUserInterruption: () => undefined,
      triggerEarImpulse: () => false,
      triggerReactionGesture: () => undefined,
    },
    events: { publish: () => undefined },
    setStatus: () => undefined,
    pushMessage: () => 'assistant:streaming',
    updateMessage: () => undefined,
    formatUserError: (message: string) => message,
    markAssistantMessageInterrupted: () => undefined,
    setResponseInterruptionPending: () => undefined,
    recordRuntimeEvent: () => undefined,
    reportSpeechServiceError: () => undefined,
    rememberSpeechMetadata: (speech: { emotionKey?: string; avatarEmotion?: string }) => {
      rememberedSpeech.push({ ...speech })
    },
    updateSpeechPlaybackProgress: () => undefined,
    isContinuousCaptureAlive: () => false,
    handleLlmSetupRequired: () => undefined,
  } as unknown as ConversationRuntimeDeps)

  const execution = runtime.execute(
    {
      turnId: 'turn:concurrent',
      text: 'Расскажи подробнее.',
      source: 'text_chat',
      createdAt: Date.now(),
      admissionCycleId: 'cycle:concurrent',
    },
    () => undefined,
  )
  await Promise.resolve()

  assert.equal(generationComplete, false)
  assert.equal(streamCount, 1)
  assert.ok(commitCount > 0)
  assert.equal(playbackStarted, true)

  resolveGeneration({
    replyText: '[warm]Это достаточно длинное первое предложение.',
    displayText: 'Это достаточно длинное первое предложение.',
    speechText: 'Это достаточно длинное первое предложение.',
    emotionKey: 'warm',
    segments: [],
  })
  const result = await execution
  assert.equal(result.status, 'completed')
  assert.equal(streamCount, 1)
  assert.deepEqual(rememberedSpeech, [{ emotionKey: 'warm' }])
  assert.equal(
    conversationTransitions.find((transition) => transition.status === 'speaking')?.avatarEmotion,
    undefined,
  )
}

function sessionOverlapAndCancellationAreBounded(): void {
  const state: FakeStreamState = { starts: [], messages: [], cancellations: [] }
  const service = new SpeechApplicationService(() => fakeManager(state))
  service.openStream(start('first'), () => undefined)
  assert.throws(() => service.openStream(start('second'), () => undefined), /stream overlap/u)
  void service.cancelSynthesis('first')
  assert.deepEqual(state.cancellations, ['Conversation interrupted'])
  service.openStream(start('second'), () => undefined)
  assert.equal(state.starts.length, 2)
}

describe('streaming TTS integration', () => {
  it('commits stable prose while filtering non-speech syntax', textCommitBufferFiltersUnsafeSyntax)
  it(
    'uses one logical speech session for multiple text commits',
    oneLogicalSessionAcceptsMultipleCommits,
  )
  it(
    'keeps the stream subscription until the terminal event arrives',
    characterResponseWaitsForTerminalStreamEvent,
  )
  it(
    'starts speech playback while Character generation is still incomplete',
    conversationStartsSpeechBeforeGenerationCompletes,
  )
  it(
    'rejects overlapping turns and cancels the active backend stream',
    sessionOverlapAndCancellationAreBounded,
  )
})
