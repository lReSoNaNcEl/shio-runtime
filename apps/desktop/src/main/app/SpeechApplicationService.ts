import type { Orchestrator } from '../orchestrator'
import type { SpeechClientManager } from '../speech/SpeechClientManager'
import { DEFAULT_TTS_VOICE_ID } from '../speech/speechClient'
import { SpeechServiceError } from '../speech/speechErrors'

const synthesisCancelled = (turnId: string): SpeechServiceError =>
  new SpeechServiceError({
    code: 'CANCELLED',
    operation: 'synthesis',
    recoverable: false,
    technicalMessage: `Conversation interrupted turnId=${turnId}`,
  })

export class SpeechApplicationService {
  private activeSynthesisTurnId: string | null = null
  private readonly cancelledTurns = new Set<string>()
  private readonly abortControllers = new Map<string, AbortController>()
  private readonly settlements = new Map<string, Promise<void>>()

  constructor(
    private readonly speech: () => SpeechClientManager,
    private readonly orchestrator: () => Orchestrator,
  ) {}

  health(signal?: AbortSignal): ReturnType<SpeechClientManager['health']> {
    return this.speech().health(signal)
  }

  getEndpoint(): string {
    return this.speech().getEndpoint()
  }

  warmup(language: 'ru' | 'en') {
    return this.speech().warmupVoice({
      engine: 'f5',
      voiceId: DEFAULT_TTS_VOICE_ID,
      language,
    })
  }

  async recognize(wavBuffer: ArrayBuffer, signal?: AbortSignal): Promise<{ text: string }> {
    const result = await this.speech().transcribe(wavBuffer, signal)
    return { text: result.text }
  }

  async synthesize(turnId: string, replyText: string, emotionKey: string) {
    if (this.cancelledTurns.has(turnId)) {
      this.cancelledTurns.delete(turnId)
      throw synthesisCancelled(turnId)
    }
    if (this.activeSynthesisTurnId) {
      throw new Error(
        `TTS synthesis overlap: activeTurnId=${this.activeSynthesisTurnId} requestedTurnId=${turnId}`,
      )
    }
    this.activeSynthesisTurnId = turnId
    const abortController = new AbortController()
    this.abortControllers.set(turnId, abortController)
    let settle!: () => void
    this.settlements.set(
      turnId,
      new Promise<void>((resolve) => {
        settle = resolve
      }),
    )
    try {
      const result = await this.orchestrator().synthesizeReply(
        replyText,
        emotionKey,
        abortController.signal,
      )
      if (this.cancelledTurns.has(turnId)) throw synthesisCancelled(turnId)
      return result
    } finally {
      this.abortControllers.delete(turnId)
      this.settlements.delete(turnId)
      this.cancelledTurns.delete(turnId)
      if (this.activeSynthesisTurnId === turnId) this.activeSynthesisTurnId = null
      settle()
    }
  }

  async cancelSynthesis(turnId: string): Promise<void> {
    this.cancelledTurns.add(turnId)
    this.abortControllers.get(turnId)?.abort(new Error('Conversation interrupted'))
    await this.settlements.get(turnId)
  }

  async dispose(): Promise<void> {
    const activeTurnId = this.activeSynthesisTurnId
    if (activeTurnId) await this.cancelSynthesis(activeTurnId)
    this.cancelledTurns.clear()
  }
}
