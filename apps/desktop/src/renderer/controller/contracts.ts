import type { CharacterState } from '../../shared/runtime/characterState'
import type { RuntimeEvent } from '../../shared/runtime/events'
import type { MicrophoneGateState } from '../audio/microphoneGateTypes'
import type { AnimationPlaybackStatus } from '../avatar/AvatarAnimationController'
import type { AnimationCooldownState } from '../avatar/AvatarAnimationCooldownManager'
import type { AvatarAnimationQueueDebugState } from '../avatar/AvatarAnimationQueue'
import type { AvatarBehaviorEngineDecision } from '../avatar/AvatarBehaviorEngine'
import type { AvatarBehaviorCandidate } from '../avatar/AvatarBehaviorResolver'
import type { AvatarBehaviorTransitionLogEntry } from '../avatar/AvatarController'
import type { IdleOrchestratorDebugState } from '../avatar/AvatarIdleOrchestrator'
import type { AvatarPlaybackRequestDebugState } from '../avatar/AvatarPlaybackRequestLog'
import type { SpeakingGestureSchedulerDebugState } from '../avatar/AvatarSpeakingGestureScheduler'
import type { AvatarMode, AvatarRuntime } from '../runtime/AvatarRuntime'
import type { RuntimeHealth } from '../runtime/RuntimeStateInvariantValidator'
import type { SpeechStateTimelineEntry } from '../runtime/SpeechRuntime'
import type { SpeechCapabilitiesState } from '../runtime/speechCapabilities'
import type { ContinuousListeningSettings } from '../speech/continuous-listening/types'
import type { FacialDebugState } from '../three/AvatarExpressionMixer'
import type { OverlayViewMode } from '../three/avatarTuning'
import type { EarBehaviorDebugState } from '../three/EarBehaviorRuntime'
import type { HeadMotionDebugState } from '../three/HeadMotionRuntime'
import type { MouthWeights } from '../three/LipSync'
import type { LookAtDebugState } from '../three/LookAtRuntime'
import type { VrmBodyActionDebugState } from '../three/VrmModel'

export type AppStatus =
  | 'idle'
  | 'listening'
  | 'recognizing'
  | 'thinking'
  | 'synthesizing'
  | 'speaking'

export const STATUS_LABELS: Record<AppStatus, string> = {
  idle: 'Ожидание',
  listening: 'Слушаю...',
  recognizing: 'Распознаю...',
  thinking: 'Думаю...',
  synthesizing: 'Генерирую голос...',
  speaking: 'Говорю...',
}

export interface ChatMsg {
  id: string
  role: 'user' | 'assistant' | 'error' | 'meta'
  text: string
  interrupted?: boolean
}

export type HealthState = 'checking' | 'ok' | 'warn' | 'err'

export interface ControllerState {
  status: AppStatus
  responseInterruptionPending: boolean
  messages: ChatMsg[]
  health: { state: HealthState; text: string }
  /** Read-only projection of Speech API capability availability (ASR/TTS/streaming). */
  speechCapabilities: SpeechCapabilitiesState
  llmHealth: { state: 'unknown' | 'checking' | 'ok' | 'error'; detail: string }
  vrmLoaded: boolean
  faceTrackingEnabled: boolean
  passiveCompanionEnabled: boolean
  continuousListeningEnabled: boolean
  continuousListeningMode: ContinuousListeningSettings['mode']
  continuousListeningState: 'off' | 'starting' | 'on' | 'error'
  continuousListeningError: string
  overlayState: 'off' | 'opening' | 'on' | 'closing' | 'error'
  overlayCameraMode: OverlayViewMode
  overlayError: string
  speechProgress: number
  overlayAnimationHudEnabled: boolean
  overlayAnimationFile: string
  microphoneGate: MicrophoneGateState
}

export interface RuntimeTimelineEvent {
  id: string
  at: number
  label: string
  detail?: string
}

export interface RuntimeDebugSnapshot {
  appStatus: AppStatus
  characterState: CharacterState
  eventHistory: readonly RuntimeEvent[]
  avatarMode: AvatarMode
  emotionKey: string
  vrmEmotion: string
  currentBodyAnimation: string
  currentBodyAnimationFile: string
  currentBodyAnimationLoop: boolean
  currentBodyAnimationStatus: AnimationPlaybackStatus
  bodyActions: VrmBodyActionDebugState
  animationAssetCache: ReturnType<AvatarRuntime['getDebugState']>['animationAssetCache']
  previousBodyAnimation: string
  activeTransitionPolicy: string
  activeBlendDuration: number
  animationQueue: AvatarAnimationQueueDebugState
  speakingGestureScheduler: SpeakingGestureSchedulerDebugState
  behaviorEngine: AvatarBehaviorEngineDecision | null
  currentBehaviorId: string
  currentBehaviorCandidates: AvatarBehaviorCandidate[]
  behaviorSelectionReason: string
  activeAnimationCooldowns: AnimationCooldownState[]
  selectedBehaviorAnimation: string
  currentGesture: string
  idleOrchestrator: IdleOrchestratorDebugState
  lipsyncWeights: MouthWeights
  facial: FacialDebugState
  lookAt: LookAtDebugState
  headMotion: HeadMotionDebugState
  earBehavior: EarBehaviorDebugState
  performance: ReturnType<AvatarRuntime['getDebugState']>['performance']
  playbackRequests: AvatarPlaybackRequestDebugState
  speechTimeline: SpeechStateTimelineEntry[]
  behaviorTimeline: AvatarBehaviorTransitionLogEntry[]
  ttsLatencyMs: string
  ttsCache: string
  overlayState: string
  controllers: Record<string, string>
  timeline: RuntimeTimelineEvent[]
  runtimeHealth: RuntimeHealth | null
}
