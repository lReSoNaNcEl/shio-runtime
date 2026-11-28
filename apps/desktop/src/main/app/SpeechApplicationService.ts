import type { SpeechStreamInput, SpeechStreamOutput, SpeechStreamStart } from '../../shared/speech'
import { hasSpeakableContent } from '../../shared/speech'
import type { FlashMotionSpeech } from '../motion/FlashMotionSpeech'
import type { SpeechClientManager } from '../speech/SpeechClientManager'
import { DEFAULT_TTS_VOICE_ID, type SpeechStreamConnection } from '../speech/speechClient'
import { normalizeSpeechCommit } from '../speech/text-normalization/normalizeSpeechCommit'

export interface ApplicationSpeechStream {
  send(message: SpeechStreamInput): void
  cancel(reason: string): void
}

export class SpeechApplicationService {
  private readonly activeByTurn = new Map<string, SpeechStreamConnection>()

  constructor(
    private readonly speech: () => SpeechClientManager,
    private readonly motionSpeech?: FlashMotionSpeech,
  ) {}

  health(signal?: AbortSignal): ReturnType<SpeechClientManager['health']> {
    return this.speech().health(signal)
  }

  getEndpoint(): string {
    return this.speech().getEndpoint()
  }

  warmup(language: 'ru' | 'en') {
    return this.speech().warmupVoice({
      engine: 'fish-s2-pro',
      voiceId: DEFAULT_TTS_VOICE_ID,
      language,
    })
  }

  async recognize(wavBuffer: ArrayBuffer, signal?: AbortSignal): Promise<{ text: string }> {
    const result = await this.speech().transcribe(wavBuffer, signal)
    return { text: result.text }
  }

  openStream(
    input: SpeechStreamStart,
    onEvent: (event: SpeechStreamOutput) => void,
  ): ApplicationSpeechStream {
    const existingTurn = [...this.activeByTurn.keys()].find((turnId) => turnId !== input.turnId)
    if (existingTurn) {
      throw new Error(
        `TTS stream overlap: activeTurnId=${existingTurn} requestedTurnId=${input.turnId}`,
      )
    }
    if (this.activeByTurn.has(input.turnId)) {
      throw new Error(`TTS stream already active turnId=${input.turnId}`)
    }
    let connection!: SpeechStreamConnection
    connection = this.speech().openStream(input, (event) => {
      if (event.type === 'audio') this.motionSpeech?.addAudio(event)
      if (event.type === 'complete') this.motionSpeech?.finish(input.turnId)
      if (event.type === 'cancelled' || event.type === 'error')
        this.motionSpeech?.clear(input.turnId)
      if (event.type === 'complete' || event.type === 'cancelled' || event.type === 'error') {
        if (this.activeByTurn.get(input.turnId) === connection)
          this.activeByTurn.delete(input.turnId)
      }
      onEvent(event)
    })
    this.activeByTurn.set(input.turnId, connection)
    this.motionSpeech?.start(input)
    let backendSequence = 0
    let speechLanguage = input.language
    return {
      send: (message) => {
        if (message.type === 'text') {
          const normalized = normalizeSpeechCommit(message.text, speechLanguage)
          if (!hasSpeakableContent(normalized.text)) return
          speechLanguage = normalized.language
          const characters = Array.from(normalized.text)
          while (characters.length) {
            const text = characters.splice(0, 220).join('')
            connection.send({
              ...message,
              sequence: backendSequence,
              text,
            })
            this.motionSpeech?.addText(input.turnId, backendSequence, text)
            backendSequence += 1
          }
          return
        }
        if (message.type === 'delivery') {
          connection.send({ ...message, sequence: backendSequence })
          backendSequence += 1
          return
        }
        if (message.type === 'cancel') this.motionSpeech?.clear(input.turnId)
        connection.send(message)
      },
      cancel: (reason) => {
        this.motionSpeech?.clear(input.turnId)
        void connection.cancel(reason).catch(() => {
          onEvent({ type: 'error', code: 'cancel_failed', message: 'Fish cancellation failed' })
        })
      },
    }
  }

  async cancelSynthesis(turnId: string): Promise<void> {
    this.motionSpeech?.clear(turnId)
    const connection = this.activeByTurn.get(turnId)
    if (!connection) return
    await connection.cancel('Conversation interrupted')
    if (this.activeByTurn.get(turnId) === connection) this.activeByTurn.delete(turnId)
  }

  async dispose(): Promise<void> {
    this.motionSpeech?.clear()
    await Promise.all([...this.activeByTurn.keys()].map((turnId) => this.cancelSynthesis(turnId)))
  }
}
