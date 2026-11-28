import type { AliveSnapshot } from '../../shared/alive'
import type { ReplyGrounding } from '../../shared/conversation'
import type { LlmReadiness } from '../../shared/llm'
import type { AvatarRuntimeHealth, CharacterState, RuntimeEvent } from '../../shared/runtime'
import type { SpeechPolishDebugState } from '../../shared/speech'
import type { MicrophoneGateState } from '../audio/microphoneGateTypes'
import type { OverlayViewMode } from '../avatar/tuning/cameraTuning'
import type { BacklogSelectorDiagnostics } from '../conversation/admission/BacklogSelector'
import type { AvatarMode, AvatarRuntimeDebugState } from '../runtime/AvatarRuntime'
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

export interface ChatMsg {
  id: string
  role: 'user' | 'assistant' | 'error' | 'meta'
  text: string
  streaming?: boolean
  interrupted?: boolean
  grounding?: ReplyGrounding
}

export interface ControllerState {
  alive: AliveSnapshot | null
  status: AppStatus
  responseInterruptionPending: boolean
  messages: ChatMsg[]
  chatDraft: string
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
  flashMotionEnabled: boolean
  faceTrackingEnabled: boolean
  continuousListening: ContinuousListeningProjection
  watchVoiceFeedback?: 'classifying' | 'aside' | 'ignore' | 'unavailable'
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

export interface RuntimeDebugSnapshot
  extends Omit<
    AvatarRuntimeDebugState,
    | 'mode'
    | 'scheduledAnimationKey'
    | 'idleBehavior'
    | 'nextIdleBehaviorIn'
    | 'ambientIdleBehavior'
    | 'animationFailures'
  > {
  appStatus: AppStatus
  continuousListening: ContinuousListeningProjection
  backlogSelection: BacklogSelectorDiagnostics
  avatarRuntimeHealth: AvatarRuntimeHealth
  characterState: CharacterState
  eventHistory: readonly RuntimeEvent[]
  avatarMode: AvatarMode
  vrmEmotion: string
  speechTimeline: SpeechStateTimelineEntry[]
  speechPolish: SpeechPolishDebugState
  ttsLatencyMs: string
  ttsCache: string
  overlayState: string
  controllers: Record<string, string>
  timeline: RuntimeTimelineEvent[]
  runtimeHealth: RuntimeHealth | null
}
