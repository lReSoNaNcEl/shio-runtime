import type { BlinkDebugState } from './BlinkController'
import type { FacialProfile, MouthWeights, VisemeName } from './FacialProfile'
import type { MouthClosureDebug } from './MouthClosureController'
import type { SpeakingEyeDebug } from './SpeakingEyeController'

export type ExpressionSource = 'autoBlink' | 'lipSync' | 'emotion' | 'lookAt' | 'speakingEye'

export type SourceLifecycleStatus = 'inactive' | 'active' | 'decaying' | 'reset'

export interface FacialExpressionEntry {
  expression: string
  value: number
  source: ExpressionSource
}

export interface FacialSourceLifecycleDebug {
  source: ExpressionSource
  active: boolean
  lastUpdateMs: number | null
  raw: Record<string, number>
  final: Record<string, number>
  status: SourceLifecycleStatus
  maxObservedValue: number
  stuckWarning: string | null
}

export interface MouthTuningDebug {
  attached: boolean
  envelope: number
  openness: number
  raw: MouthWeights
  afterSilenceThreshold: MouthWeights
  afterAttackRelease: MouthWeights
  afterMouthClosedBias: MouthWeights
  afterClamp: MouthWeights
  filtered: MouthWeights
  clamped: MouthWeights
  final: MouthWeights
  speechEnergy: number
  playbackItemId: string
  analyserAttached: boolean
  lipSyncActive: boolean
  currentRawRms: number
  currentNormalizedEnergy: number
  currentMouthOpenness: number
  antiStallActive: boolean
  activeVisemes: VisemeName[]
  visemeBlend: MouthWeights
  releaseStage: string
  mouthClosedBias: number
  signalWarning: string | null
  attackPerSecond: number
  releasePerSecond: number
  silentReleasePerSecond: number
  detachedReleasePerSecond: number
  silenceThreshold: number
  clamps: MouthWeights
  stats: {
    playbackSeq: number
    frameCount: number
    averageOpenness: number
    peakOpenness: number
    percentHighOpen: number
    percentClosed: number
    longestOpenMs: number
    releaseAfterDetachMs: number | null
    saturatedSignal: boolean
    nonZeroEnergyFrames: number
    audibleDeadMouthMs: number
    audibleDeadMouthFrames: number
    antiStallActivationCount: number
  }
}

export type BlinkTuningDebug = BlinkDebugState

export interface FacialDebugState {
  currentProfile: string
  expressionBlend: Record<string, number>
  supportedExpressions: string[]
  supportedVisemes: VisemeName[]
  unsupportedExpressionRequests: string[]
  releaseCurve: string
  eyeProfile: FacialProfile['eyeProfile']
  mouthProfile: FacialProfile['mouthProfile']
  activeSources: ExpressionSource[]
  entries: FacialExpressionEntry[]
  blink: number
  mouth: MouthWeights
  emotion: Record<string, number>
  finalValues: Record<string, number>
  sourceLifecycle: FacialSourceLifecycleDebug[]
  stuckWarnings: string[]
  mouthTuning: MouthTuningDebug
  blinkTuning: BlinkTuningDebug
  blinkExpressions: string[]
  speakingEye: SpeakingEyeDebug & {
    leftExpression: string
    rightExpression: string
    finalLeft: number
    finalRight: number
  }
  mouthClosure: Pick<
    MouthClosureDebug,
    | 'enabled'
    | 'active'
    | 'strength'
    | 'sinceLastClosureMs'
    | 'nextClosureInMs'
    | 'boundary'
    | 'graceRemainingMs'
  > & { rawMouthMax: number; finalMouthMax: number }
}
