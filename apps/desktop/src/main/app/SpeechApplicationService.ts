import type { SpeechStreamInput, SpeechStreamOutput, SpeechStreamStart } from '../../shared/speech'
import { hasSpeakableContent } from '../../shared/speech'
import type { SpeechClientManager } from '../speech/SpeechClientManager'
import { DEFAULT_TTS_VOICE_ID, type SpeechStreamConnection } from '../speech/speechClient'
import { normalizeSpeechText } from '../speech/text-normalization'

export interface ApplicationSpeechStream {
  send(message: SpeechStreamInput): void
  cancel(reason: string): void
}

export class SpeechApplicationService {
  private readonly activeByTurn = new Map<string, SpeechStreamConnection>()

  constructor(private readonly speech: () => SpeechClientManager) {}

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
      if (event.type === 'complete' || event.type === 'cancelled' || event.type === 'error') {
        if (this.activeByTurn.get(input.turnId) === connection)
          this.activeByTurn.delete(input.turnId)
      }
      onEvent(event)
    })
    this.activeByTurn.set(input.turnId, connection)
    let backendSequence = 0
    return {
      send: (message) => {
        if (message.type === 'text') {
          const normalized = normalizeSpeechText({ text: message.text, language: input.language })
          if (!hasSpeakableContent(normalized.text)) return
          const characters = Array.from(normalized.text)
          while (characters.length) {
            connection.send({
              ...message,
              sequence: backendSequence,
              text: characters.splice(0, 220).join(''),
            })
            backendSequence += 1
          }
          return
        }
        if (message.type === 'delivery') {
          connection.send({ ...message, sequence: backendSequence })
          backendSequence += 1
          return
        }
        connection.send(message)
      },
      cancel: (reason) => {
        void connection.cancel(reason).catch(() => {
          onEvent({ type: 'error', code: 'cancel_failed', message: 'Fish cancellation failed' })
        })
      },
    }
  }

  async cancelSynthesis(turnId: string): Promise<void> {
    const connection = this.activeByTurn.get(turnId)
    if (!connection) return
    await connection.cancel('Conversation interrupted')
    if (this.activeByTurn.get(turnId) === connection) this.activeByTurn.delete(turnId)
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.activeByTurn.keys()].map((turnId) => this.cancelSynthesis(turnId)))
  }
}
