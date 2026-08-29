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
export type SpeechPlaybackOptions = AudioPlayOptions

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
      voiceId: 'animevox_makima',
      language: 'ru',
      delivery: intent,
    })
    let expectedAudioSequence = 0
    let inputSequence = 0
    let deliveryKey = JSON.stringify(intent)
    let playback: PcmStreamPlayback | null = null
    let terminal = false
    let ready = false
    const pendingInputs: SpeechStreamInput[] = []
    let settle!: (completion: PlaybackCompletion) => void
    let reject!: (error: unknown) => void
    const completion = new Promise<PlaybackCompletion>((resolve, rejectPromise) => {
      settle = resolve
      reject = rejectPromise
    })
    let audioChain = Promise.resolve()

    const fail = (error: unknown): void => {
      if (terminal) return
      terminal = true
      playback?.cancel('stream-failed')
      port.close()
      reject(error)
    }
    const send = (input: SpeechStreamInput): void => {
      if (terminal) return
      if (!ready) {
        pendingInputs.push(input)
        return
      }
      port.postMessage(input)
    }
    const onMessage = (output: SpeechStreamOutput): void => {
      if (terminal) return
      if (output.type === 'ready') {
        if (
          output.protocolVersion !== TTS_STREAM_PROTOCOL_VERSION ||
          output.sampleFormat !== 'float32-le'
        ) {
          fail(new Error('Unsupported TTS stream format'))
          return
        }
        ready = true
        for (const input of pendingInputs.splice(0)) port.postMessage(input)
        void this.player
          .startPcmStream(output.sampleRate, options)
          .then((value) => {
            playback = value
          })
          .catch(fail)
        return
      }
      if (output.type === 'audio') {
        if (output.sequence !== expectedAudioSequence) {
          fail(
            new Error(
              `Out-of-order TTS audio: expected=${expectedAudioSequence} actual=${output.sequence}`,
            ),
          )
          return
        }
        expectedAudioSequence += 1
        audioChain = audioChain
          .then(async () => {
            while (!playback && !terminal) await new Promise((resolve) => setTimeout(resolve, 0))
            if (!playback || terminal) return
            await playback.append(output.pcm)
            port.postMessage({ type: 'audio-ack', sequence: output.sequence })
          })
          .catch(fail)
        return
      }
      if (output.type === 'complete') {
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
        fail(new Error(`Speech stream cancelled sessionId=${output.sessionId}`))
        return
      }
      fail(new Error(`${output.code}: ${output.message}`))
    }
    port.start(onMessage, () => fail(new Error('Invalid speech MessagePort payload')))

    return {
      completion,
      commit: (commit) => {
        if (terminal) return
        const nextDelivery = deliveryIntent(commit.emotion)
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
        send({ type: 'finish-input' })
      },
      cancel: (reason) => {
        if (terminal) return
        terminal = true
        this.player.stopCurrent(turnId, 'conversation-interrupted')
        port.postMessage({ type: 'cancel', reason })
        port.close()
        reject(new Error(`Speech stream cancelled turnId=${turnId}`))
      },
    }
  }

  stopCurrent(turnId: string, reason: 'conversation-interrupted'): void {
    this.player.stopCurrent(turnId, reason)
  }
}

export function deliveryIntent(emotion: string): SpeechDeliveryIntent {
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
  }
}
