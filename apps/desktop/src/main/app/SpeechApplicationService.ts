import { characterRequestId } from '../../shared/character-stream'
import { latencyTelemetry } from '../diagnostics/latencyTelemetry'
import type { Orchestrator } from '../orchestrator'
import type { SpeechClientManager } from '../speech/SpeechClientManager'
import { DEFAULT_TTS_VOICE_ID } from '../speech/speechClient'
import { SpeechServiceError } from '../speech/speechErrors'

const MAX_SYNTHESIS_WORKERS = 2

const synthesisCancelled = (turnId: string): SpeechServiceError =>
  new SpeechServiceError({
    code: 'CANCELLED',
    operation: 'synthesis',
    recoverable: false,
    technicalMessage: `Conversation interrupted turnId=${turnId}`,
  })

interface ActiveSynthesis {
  abortController: AbortController
  settlement: Promise<void>
}

export class SpeechApplicationService {
  private readonly cancelledTurns = new Set<string>()
  private readonly activeByTurn = new Map<string, Map<number, ActiveSynthesis>>()
  private readonly segmentCounters = new Map<string, number>()

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
    return this.speech().warmupVoice({ engine: 'f5', voiceId: DEFAULT_TTS_VOICE_ID, language })
  }

  async recognize(wavBuffer: ArrayBuffer, signal?: AbortSignal): Promise<{ text: string }> {
    const result = await this.speech().transcribe(wavBuffer, signal)
    return { text: result.text }
  }

  async synthesize(turnId: string, replyText: string, emotionKey: string) {
    if (this.cancelledTurns.has(turnId)) throw synthesisCancelled(turnId)
    const otherActiveTurn = [...this.activeByTurn.keys()].find((active) => active !== turnId)
    if (otherActiveTurn) {
      throw new Error(
        `TTS synthesis overlap: activeTurnId=${otherActiveTurn} requestedTurnId=${turnId}`,
      )
    }
    const active = this.activeByTurn.get(turnId) ?? new Map<number, ActiveSynthesis>()
    if (active.size >= MAX_SYNTHESIS_WORKERS) {
      throw new Error(`TTS worker limit exceeded turnId=${turnId}`)
    }
    this.activeByTurn.set(turnId, active)
    const segmentSequence = this.segmentCounters.get(turnId) ?? 0
    this.segmentCounters.set(turnId, segmentSequence + 1)
    this.evictOldCounters()
    const ttsSegmentId = `${turnId}:tts:${segmentSequence}`
    const workerId = `worker-${segmentSequence % MAX_SYNTHESIS_WORKERS}`
    const correlation = { turnId, requestId: characterRequestId(turnId), llmRound: 0, ttsSegmentId }
    latencyTelemetry.record({
      name: 'tts_segment_requested',
      at: Date.now(),
      correlation,
      status: 'started',
      metadata: { workerId, characters: replyText.length, words: wordCount(replyText) },
    })
    const abortController = new AbortController()
    let settle!: () => void
    const settlement = new Promise<void>((resolve) => {
      settle = resolve
    })
    active.set(segmentSequence, { abortController, settlement })
    latencyTelemetry.record({
      name: 'tts_execution_started',
      at: Date.now(),
      correlation,
      status: 'started',
      metadata: { workerId },
    })
    try {
      const result = await this.orchestrator().synthesizeReply(
        replyText,
        emotionKey,
        abortController.signal,
      )
      if (this.cancelledTurns.has(turnId)) throw synthesisCancelled(turnId)
      const readyAt = Date.now()
      latencyTelemetry.record({
        name: 'tts_execution_completed',
        at: readyAt,
        correlation,
        status: 'success',
        metadata: { workerId },
      })
      latencyTelemetry.record({
        name: 'tts_segment_ready',
        at: readyAt,
        correlation,
        status: 'success',
        metadata: { workerId },
      })
      return result
    } finally {
      active.delete(segmentSequence)
      if (active.size === 0) this.activeByTurn.delete(turnId)
      settle()
    }
  }

  async cancelSynthesis(turnId: string): Promise<void> {
    this.cancelledTurns.add(turnId)
    const active = [...(this.activeByTurn.get(turnId)?.values() ?? [])]
    for (const item of active) item.abortController.abort(new Error('Conversation interrupted'))
    await Promise.allSettled(active.map((item) => item.settlement))
    this.cancelledTurns.delete(turnId)
  }

  async dispose(): Promise<void> {
    await Promise.allSettled(
      [...this.activeByTurn.keys()].map((turnId) => this.cancelSynthesis(turnId)),
    )
    this.cancelledTurns.clear()
    this.segmentCounters.clear()
  }

  private evictOldCounters(): void {
    if (this.segmentCounters.size <= 128) return
    const oldest = this.segmentCounters.keys().next().value
    if (oldest) this.segmentCounters.delete(oldest)
  }
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length
}
