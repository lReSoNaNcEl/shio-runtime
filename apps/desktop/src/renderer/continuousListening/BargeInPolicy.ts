import { bargeInTuning } from './tuning'

export type BargeInResponsePhase = 'generating' | 'synthesizing' | 'playing' | 'cleaning_up'

export interface BargeInObservation {
  now: number
  activeResponseId: string | null
  responsePhase: BargeInResponsePhase | null
  partialText: string
  speechDurationMs: number
  confidence?: number
  capturedDuringPlayback: boolean
  playbackStartedAt: number | null
  responseInterruptionPending: boolean
  likelySelfEcho: boolean
}

export type BargeInIgnoreReason =
  | 'disabled'
  | 'not-speaking'
  | 'too-short'
  | 'grace-period'
  | 'low-confidence'
  | 'self-echo'
  | 'empty-partial'
  | 'interruption-pending'
  | 'already-triggered'
  | 'retrigger-cooldown'

export type BargeInDecision =
  | { type: 'ignore'; reason: BargeInIgnoreReason }
  | { type: 'interrupt'; reason: 'user-speech-detected'; responseId: string }

export interface BargeInPolicyOptions {
  enabled: boolean
  minimumSpeechMs: number
  playbackGraceMs: number
  minimumConfidence: number
  minimumTextLength: number
  retriggerCooldownMs: number
}

export class BargeInPolicy {
  private interruptedResponseId: string | null = null
  private lastTriggeredAt = Number.NEGATIVE_INFINITY

  constructor(
    private readonly options: BargeInPolicyOptions = {
      enabled: bargeInTuning.enabled,
      minimumSpeechMs: bargeInTuning.minimumSpeechMs,
      playbackGraceMs: bargeInTuning.playbackGraceMs,
      minimumConfidence: bargeInTuning.minimumConfidence,
      minimumTextLength: bargeInTuning.minimumTextLength,
      retriggerCooldownMs: bargeInTuning.retriggerCooldownMs,
    },
  ) {}

  evaluate(observation: BargeInObservation): BargeInDecision {
    if (!this.options.enabled) return { type: 'ignore', reason: 'disabled' }
    if (
      !observation.activeResponseId ||
      (observation.responsePhase !== 'synthesizing' && observation.responsePhase !== 'playing')
    ) {
      return { type: 'ignore', reason: 'not-speaking' }
    }
    if (observation.responseInterruptionPending)
      return { type: 'ignore', reason: 'interruption-pending' }
    if (this.interruptedResponseId === observation.activeResponseId)
      return { type: 'ignore', reason: 'already-triggered' }
    if (observation.now - this.lastTriggeredAt < this.options.retriggerCooldownMs)
      return { type: 'ignore', reason: 'retrigger-cooldown' }

    const meaningfulText = observation.partialText.replace(/[^\p{L}\p{N}]/gu, '')
    if (!meaningfulText) return { type: 'ignore', reason: 'empty-partial' }
    if (
      observation.speechDurationMs < this.options.minimumSpeechMs ||
      meaningfulText.length < this.options.minimumTextLength
    ) {
      return { type: 'ignore', reason: 'too-short' }
    }
    if (
      observation.confidence !== undefined &&
      observation.confidence < this.options.minimumConfidence
    ) {
      return { type: 'ignore', reason: 'low-confidence' }
    }
    if (
      observation.capturedDuringPlayback &&
      observation.playbackStartedAt !== null &&
      observation.now - observation.playbackStartedAt < this.options.playbackGraceMs
    ) {
      return { type: 'ignore', reason: 'grace-period' }
    }
    if (observation.likelySelfEcho) return { type: 'ignore', reason: 'self-echo' }

    return {
      type: 'interrupt',
      reason: 'user-speech-detected',
      responseId: observation.activeResponseId,
    }
  }

  markTriggered(responseId: string, now: number): void {
    this.interruptedResponseId = responseId
    this.lastTriggeredAt = now
  }

  settleResponse(responseId: string): void {
    if (this.interruptedResponseId === responseId) this.interruptedResponseId = null
  }

  reset(): void {
    this.interruptedResponseId = null
    this.lastTriggeredAt = Number.NEGATIVE_INFINITY
  }
}
