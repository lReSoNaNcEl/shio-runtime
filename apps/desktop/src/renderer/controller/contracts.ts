import type { AliveSnapshot } from '../../shared/alive'
import type { ReplyGrounding } from '../../shared/conversation'
import type { LlmReadiness } from '../../shared/llm'
import type { AvatarRuntimeHealth, CharacterState, RuntimeEvent } from '../../shared/runtime'
import type { SpeechPolishDebugState } from '../../shared/speech'
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
import type { FacialDebugState } from '../avatar/embodiment/facial/AvatarExpressionMixer'
import type { HeadMotionDebugState } from '../avatar/embodiment/gaze/HeadMotionRuntime'
import type { LookAtDebugState } from '../avatar/embodiment/gaze/LookAtRuntime'
import type { EarBehaviorDebugState } from '../avatar/embodiment/secondary-motion/EarBehaviorRuntime'
import type { TailBehaviorDebugState } from '../avatar/embodiment/secondary-motion/TailBehaviorRuntime'
import type { MouthWeights } from '../avatar/embodiment/speech/LipSync'
import type { GeneratedBodyDebugState } from '../avatar/rendering/three/VrmModel'
import type { OverlayViewMode } from '../avatar/tuning/cameraTuning'
import type { BacklogSelectorDiagnostics } from '../conversation/admission/BacklogSelector'
import type { AvatarMode, AvatarRuntime } from '../runtime/AvatarRuntime'
import type { RuntimeHealth } from '../runtime/RuntimeStateInvariantValidator'
import type { SpeechStateTimelineEntry } from '../runtime/SpeechRuntime'
import type { SpeechCapabilitiesState } from '../runtime/speechCapabilities'
import type { ContinuousListeningProjection } from '../speech/continuous-listening/types'

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
  streaming?: boolean
  interrupted?: boolean
  grounding?: ReplyGrounding
}

export type HealthState = 'checking' | 'ok' | 'warn' | 'err'

export interface ControllerState {
  alive: AliveSnapshot | null
  status: AppStatus
  responseInterruptionPending: boolean
  messages: ChatMsg[]
  chatDraft: string
  health: { state: HealthState; text: string }
  /** Read-only projection of Speech API capability availability (ASR/TTS/streaming). */
  speechCapabilities: SpeechCapabilitiesState
  voiceWarmup: {
    state: 'idle' | 'warming' | 'ready' | 'failed'
    voiceId: string
    language: string
  }
  llmHealth: { state: 'unknown' | 'checking' | 'ok' | 'error'; detail: string }
  llmReadiness: LlmReadiness
  vrmConfigured: boolean
  vrmLoaded: boolean
  faceTrackingEnabled: boolean
  continuousListening: ContinuousListeningProjection
  overlayState: 'off' | 'opening' | 'on' | 'closing' | 'error'
  overlayCameraMode: OverlayViewMode
  overlayError: string
  speechProgress: number
  overlayAnimationHudEnabled: boolean
  overlayMotionProfileId: string
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
  continuousListening: ContinuousListeningProjection
  backlogArbitration: BacklogSelectorDiagnostics
  avatarRuntimeHealth: AvatarRuntimeHealth
  characterState: CharacterState
  eventHistory: readonly RuntimeEvent[]
  avatarMode: AvatarMode
  emotionKey: string
  vrmEmotion: string
  currentBodyAnimation: string
  requestedMotionContinuous: boolean
  motionRequestStatus: AnimationPlaybackStatus
  bodyMotion: GeneratedBodyDebugState
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
  tailBehavior: TailBehaviorDebugState
  performance: ReturnType<AvatarRuntime['getDebugState']>['performance']
  playbackRequests: AvatarPlaybackRequestDebugState
  speechTimeline: SpeechStateTimelineEntry[]
  speechPolish: SpeechPolishDebugState
  behaviorTimeline: AvatarBehaviorTransitionLogEntry[]
  ttsLatencyMs: string
  ttsCache: string
  overlayState: string
  controllers: Record<string, string>
  timeline: RuntimeTimelineEvent[]
  runtimeHealth: RuntimeHealth | null
}
