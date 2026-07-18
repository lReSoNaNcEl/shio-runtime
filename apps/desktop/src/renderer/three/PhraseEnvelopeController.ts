import { phraseLipSyncTuning } from './avatarTuning'
import type { PhraseBoundary, SpeechPhraseTimingPlan } from './SpeechPhraseTiming'

export type SpeechPhrasePhase =
  | 'idle'
  | 'onset'
  | 'speaking'
  | 'soft-pause'
  | 'sentence-boundary'
  | 'release'
  | 'interrupted'

export interface PhraseEnvelopeOutput {
  articulationScale: number
  closureStrength: number
  jawScale: number
}

const NEUTRAL_OUTPUT: PhraseEnvelopeOutput = {
  articulationScale: 0,
  closureStrength: 0,
  jawScale: 1,
}

export class PhraseEnvelopeController {
  private plan: SpeechPhraseTimingPlan | null = null
  private phase: SpeechPhrasePhase = 'idle'
  private output: PhraseEnvelopeOutput = { ...NEUTRAL_OUTPUT }
  private elapsedMs = 0
  private previousProgress = 0
  private nextBoundaryIndex = 0
  private boundary: { value: PhraseBoundary; remainingMs: number; durationMs: number } | null = null
  private terminal = false

  start(plan: SpeechPhraseTimingPlan): void {
    this.reset()
    this.plan = {
      boundaries: plan.boundaries.map((boundary) => ({ ...boundary })),
      hasTerminalPunctuation: plan.hasTerminalPunctuation,
    }
    this.phase = 'onset'
    this.output = { ...NEUTRAL_OUTPUT }
  }

  update(delta: number, progress: number, speechEnergy: number): void {
    const deltaMs = Math.max(0, delta) * 1000
    if (!this.plan) return
    if (this.terminal) {
      this.updateTerminal(delta)
      return
    }

    this.elapsedMs += deltaMs
    const normalizedProgress = clamp(progress)
    this.consumeBoundary(normalizedProgress)
    this.previousProgress = Math.max(this.previousProgress, normalizedProgress)

    const onsetProgress = clamp(this.elapsedMs / phraseLipSyncTuning.onsetMs)
    const onsetTarget = smoothStep(onsetProgress)
    const articulationTarget = this.phase === 'onset' ? onsetTarget : 1
    const articulationSpeed =
      articulationTarget > this.output.articulationScale
        ? phraseLipSyncTuning.attackSmoothing
        : phraseLipSyncTuning.releaseSmoothing
    this.output.articulationScale = approach(
      this.output.articulationScale,
      articulationTarget,
      delta,
      articulationSpeed,
    )
    this.output.jawScale = approach(
      this.output.jawScale,
      lerp(phraseLipSyncTuning.jawScale.min, phraseLipSyncTuning.jawScale.max, clamp(speechEnergy)),
      delta,
      phraseLipSyncTuning.jawSmoothing,
    )

    if (this.boundary) {
      this.boundary.remainingMs = Math.max(0, this.boundary.remainingMs - deltaMs)
      const progressThrough = 1 - this.boundary.remainingMs / Math.max(1, this.boundary.durationMs)
      this.output.closureStrength =
        this.boundaryStrength(this.boundary.value.type) * Math.sin(Math.PI * progressThrough)
      this.phase = this.isStrongBoundary(this.boundary.value.type)
        ? 'sentence-boundary'
        : 'soft-pause'
      if (this.boundary.remainingMs <= 0) this.boundary = null
    } else {
      this.output.closureStrength = approach(
        this.output.closureStrength,
        0,
        delta,
        phraseLipSyncTuning.releaseSmoothing,
      )
      this.phase = onsetProgress < 1 ? 'onset' : 'speaking'
    }
  }

  finish(): void {
    if (!this.plan || this.terminal) return
    this.terminal = true
    this.phase = 'release'
    this.boundary = null
  }

  interrupt(): void {
    if (!this.plan) return
    this.terminal = true
    this.phase = 'interrupted'
    this.boundary = null
    this.output.closureStrength = 0
  }

  reset(): void {
    this.plan = null
    this.phase = 'idle'
    this.output = { ...NEUTRAL_OUTPUT }
    this.elapsedMs = 0
    this.previousProgress = 0
    this.nextBoundaryIndex = 0
    this.boundary = null
    this.terminal = false
  }

  getOutput(): PhraseEnvelopeOutput {
    return { ...this.output }
  }

  getPhase(): SpeechPhrasePhase {
    return this.phase
  }

  private updateTerminal(delta: number): void {
    this.output.articulationScale = approach(
      this.output.articulationScale,
      0,
      delta,
      phraseLipSyncTuning.releaseSmoothing,
    )
    this.output.closureStrength = approach(
      this.output.closureStrength,
      0,
      delta,
      phraseLipSyncTuning.releaseSmoothing,
    )
    this.output.jawScale = approach(
      this.output.jawScale,
      1,
      delta,
      phraseLipSyncTuning.jawSmoothing,
    )
    if (
      this.phase === 'release' &&
      this.output.articulationScale <= phraseLipSyncTuning.neutralEpsilon
    ) {
      this.reset()
    }
  }

  private consumeBoundary(progress: number): void {
    if (this.boundary) return
    const boundary = this.plan?.boundaries[this.nextBoundaryIndex]
    if (!boundary || progress < boundary.normalizedPosition) return
    if (boundary.normalizedPosition < this.previousProgress) {
      this.nextBoundaryIndex += 1
      this.consumeBoundary(progress)
      return
    }
    this.nextBoundaryIndex += 1
    const durationMs = this.isStrongBoundary(boundary.type)
      ? phraseLipSyncTuning.sentenceBoundary.durationMs
      : phraseLipSyncTuning.softBoundary.durationMs
    this.boundary = { value: boundary, remainingMs: durationMs, durationMs }
  }

  private boundaryStrength(type: PhraseBoundary['type']): number {
    return this.isStrongBoundary(type)
      ? phraseLipSyncTuning.sentenceBoundary.closureStrength
      : phraseLipSyncTuning.softBoundary.closureStrength
  }

  private isStrongBoundary(type: PhraseBoundary['type']): boolean {
    return type === 'sentence' || type === 'ellipsis'
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function smoothStep(value: number): number {
  return value * value * (3 - 2 * value)
}

function approach(current: number, target: number, delta: number, speed: number): number {
  return lerp(current, target, 1 - Math.exp(-Math.max(0, delta) * speed))
}
