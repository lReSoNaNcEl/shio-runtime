import type { SpeechTextCommit } from '../../shared/character-stream'
import {
  SPEECH_EMOTIONS,
  type SpeechDeliveryIntent,
  type SpeechStreamInput,
  type SpeechStreamOutput,
  TTS_STREAM_PROTOCOL_VERSION,
} from '../../shared/speech'
import type {
  AudioPlayer,
  AudioPlayOptions,
  PcmStreamPlayback,
  PlaybackCompletion,
  PlaybackSession,
} from '../audio/audioPlayer'
import type { SpeechRuntime } from './SpeechRuntime'

export type SpeechPlaybackSession = PlaybackSession
export type SpeechPlaybackOptions = AudioPlayOptions & {
  onDelivery?: (emotion: string) => void
  onFirstPcm?: () => void
}

class SpeechStreamCancelledError extends Error {
  constructor(turnId: string) {
    super(`Speech stream cancelled turnId=${turnId}`)
    this.name = 'SpeechStreamCancelledError'
  }
}

export interface SpeechOutputStream {
  readonly completion: Promise<PlaybackCompletion>
  commit(commit: SpeechTextCommit): void
  finish(): void
  cancel(reason: 'conversation-interrupted' | 'stream-failed'): void
}

export interface SpeechOutputPort {
  hasSpeakableContent(text: string): boolean
  openStream(
    turnId: string,
    intent: SpeechDeliveryIntent,
    options: SpeechPlaybackOptions,
  ): SpeechOutputStream
  stopCurrent(turnId: string, reason: 'conversation-interrupted'): void
}

/** Speech-output composition; AudioPlayer remains the sole playback owner. */
export class RuntimeSpeechOutputPort implements SpeechOutputPort {
  constructor(
    private readonly speech: SpeechRuntime,
    private readonly player: AudioPlayer,
    private readonly getLanguage: () => 'ru' | 'en' = () => 'ru',
  ) {}

  hasSpeakableContent(text: string): boolean {
    return this.speech.hasSpeakableContent(text)
  }

  openStream(
    turnId: string,
    intent: SpeechDeliveryIntent,
    options: SpeechPlaybackOptions,
  ): SpeechOutputStream {
    const port = window.api.tts.openStream({
      protocolVersion: TTS_STREAM_PROTOCOL_VERSION,
      sessionId: `speech:${turnId}`,
      turnId,
      language: this.getLanguage(),
      delivery: intent,
    })
    let expectedAudioSequence = 0
    let inputSequence = 0
    let deliveryKey = JSON.stringify(intent)
    let playback: PcmStreamPlayback | null = null
    let terminal = false
    let ready = false
    let inputFinished = false
    let providerCompleted = false
    let sourceOffset = 0
    let playbackReady: Promise<PcmStreamPlayback> | null = null
    const pendingInputs: SpeechStreamInput[] = []
    let settle!: (completion: PlaybackCompletion) => void
    let reject!: (error: unknown) => void
    const completion = new Promise<PlaybackCompletion>((resolve, rejectPromise) => {
      settle = resolve
      reject = rejectPromise
    })
    // Streaming starts before generation ends, so its completion may reject before
    // Conversation Runtime reaches its await. Keep the original rejection for that
    // consumer while observing terminal failures from the moment the stream opens.
    void completion.catch((error: unknown) => {
      if (!(error instanceof SpeechStreamCancelledError))
        console.error('[SpeechOutput] stream failed', error)
    })
    let audioChain = Promise.resolve()
    let lastTextSequence: number | undefined

    const fail = (error: unknown): void => {
      if (terminal) return
      terminal = true
      this.player.stopCurrent(turnId, 'conversation-interrupted')
      playback?.cancel('stream-failed')
      port.close()
      reject(error)
    }
    const send = (input: SpeechStreamInput): void => {
      if (terminal) return
      if (!ready) {
        if (pendingInputs.length >= 128) {
          fail(new Error('Speech input queue overflow'))
          return
        }
        pendingInputs.push(input)
        return
      }
      port.postMessage(input)
    }
    const onMessage = (output: SpeechStreamOutput): void => {
      if (terminal) return
      if (output.type === 'ready') {
        if (ready) {
          fail(new Error('Duplicate TTS readiness event'))
          return
        }
        if (
          output.protocolVersion !== TTS_STREAM_PROTOCOL_VERSION ||
          output.sessionId !== `speech:${turnId}` ||
          output.sampleFormat !== 'float32-le'
        ) {
          fail(new Error('Unsupported TTS stream format'))
          return
        }
        ready = true
        for (const input of pendingInputs.splice(0)) port.postMessage(input)
        playbackReady = this.player.startPcmStream(output.sampleRate, options).then((value) => {
          if (terminal) {
            value.cancel('stream-failed')
            throw new Error('Playback ownership cancelled')
          }
          playback = value
          return value
        })
        void playbackReady.catch(fail)
        return
      }
      if (output.type === 'audio') {
        if (
          !ready ||
          providerCompleted ||
          output.sequence !== expectedAudioSequence ||
          output.sessionId !== `speech:${turnId}` ||
          output.turnId !== turnId ||
          output.sampleOffset !== sourceOffset ||
          output.samples * 4 !== output.pcm.byteLength
        ) {
          fail(
            new Error(
              `Out-of-order TTS audio: expected=${expectedAudioSequence} actual=${output.sequence}`,
            ),
          )
          return
        }
        expectedAudioSequence += 1
        if (expectedAudioSequence === 1) options.onFirstPcm?.()
        sourceOffset += output.samples
        audioChain = audioChain
          .then(async () => {
            await playbackReady
            if (!playback || terminal) return
            const newCue = output.emotion !== undefined && output.textSequence !== lastTextSequence
            lastTextSequence = output.textSequence
            await playback.append(
              output.pcm,
              newCue ? () => options.onDelivery?.(output.emotion ?? 'neutral') : undefined,
            )
            port.postMessage({ type: 'audio-ack', sequence: output.sequence })
          })
          .catch(fail)
        return
      }
      if (output.type === 'complete') {
        if (
          !ready ||
          providerCompleted ||
          output.sessionId !== `speech:${turnId}` ||
          output.sequence !== expectedAudioSequence
        ) {
          fail(new Error('Invalid speech completion'))
          return
        }
        providerCompleted = true
        audioChain = audioChain
          .then(async () => {
            if (!playback) throw new Error('TTS stream completed before playback became ready')
            const result = await playback.finish()
            terminal = true
            port.close()
            settle(result)
          })
          .catch(fail)
        return
      }
      if (output.type === 'cancelled') {
        fail(new SpeechStreamCancelledError(turnId))
        return
      }
      fail(new Error(`${output.code}: ${output.message}`))
    }
    port.start(onMessage, () => fail(new Error('Invalid speech MessagePort payload')))

    return {
      completion,
      commit: (commit) => {
        if (terminal || inputFinished) return
        const nextDelivery = deliveryIntent(commit.emotion, commit.voiceStyle)
        const nextDeliveryKey = JSON.stringify(nextDelivery)
        if (nextDeliveryKey !== deliveryKey) {
          send({
            type: 'delivery',
            sequence: inputSequence,
            delivery: nextDelivery,
          })
          inputSequence += 1
          deliveryKey = nextDeliveryKey
        }
        send({
          type: 'text',
          sequence: inputSequence,
          text: commit.text,
        })
        inputSequence += 1
      },
      finish: () => {
        if (inputFinished) return
        inputFinished = true
        send({ type: 'finish-input' })
      },
      cancel: (reason) => {
        if (terminal) return
        terminal = true
        this.player.stopCurrent(turnId, 'conversation-interrupted')
        port.postMessage({ type: 'cancel', reason })
        port.close()
        reject(new SpeechStreamCancelledError(turnId))
      },
    }
  }

  stopCurrent(turnId: string, reason: 'conversation-interrupted'): void {
    this.player.stopCurrent(turnId, reason)
  }
}

export function deliveryIntent(emotion: string, style?: string): SpeechDeliveryIntent {
  const normalizedEmotion = SPEECH_EMOTIONS.find((candidate) => candidate === emotion) ?? 'neutral'
  return {
    emotion: normalizedEmotion,
    pace: normalizedEmotion === 'calm' || normalizedEmotion === 'sad' ? 'slow' : 'normal',
    energy:
      normalizedEmotion === 'happy' ||
      normalizedEmotion === 'angry' ||
      normalizedEmotion === 'surprised'
        ? 'high'
        : 'normal',
    volume: normalizedEmotion === 'whisper' ? 'soft' : 'normal',
    ...(style ? { style } : {}),
  }
}
