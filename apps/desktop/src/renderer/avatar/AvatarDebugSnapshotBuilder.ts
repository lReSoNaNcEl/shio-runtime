import type { MouthWeights } from '../three/LipSync'
import type { FacialDebugState } from '../three/AvatarExpressionMixer'
import type { HeadMotionDebugState } from '../three/HeadMotionRuntime'
import type { EarBehaviorDebugState } from '../three/EarBehaviorRuntime'
import type { LookAtDebugState } from '../three/LookAtRuntime'
import type { VrmBodyActionDebugState, VrmPerformanceDebugState, VrmModel } from '../three/VrmModel'
import type { AnimationControllerDebugState, AnimationPlaybackStatus, AvatarAnimationController } from './AvatarAnimationController'
import type { AnimationCooldownState } from './AvatarAnimationCooldownManager'
import type { AvatarAnimationQueue, AvatarAnimationQueueDebugState } from './AvatarAnimationQueue'
import type { AvatarBehaviorEngine, AvatarBehaviorEngineDecision } from './AvatarBehaviorEngine'
import type { AvatarBehaviorCandidate, AvatarBehaviorResolution } from './AvatarBehaviorResolver'
import type { AvatarBehaviorResolver } from './AvatarBehaviorResolver'
import type { AvatarGestureScheduler } from './AvatarGestureScheduler'
import type { AvatarIdleBehaviorController } from './AvatarIdleBehaviorController'
import type { AvatarIdleOrchestrator, IdleOrchestratorDebugState } from './AvatarIdleOrchestrator'
import type { AvatarPlaybackRequestDebugState, AvatarPlaybackRequestLog, AvatarPlaybackRequestSource } from './AvatarPlaybackRequestLog'
import type { AvatarSpeakingGestureScheduler, SpeakingGestureSchedulerDebugState } from './AvatarSpeakingGestureScheduler'
import type { AvatarStateMachine, AvatarMode } from './AvatarStateMachine'
import type { AvatarTransitionDecision } from './AvatarTransitionPolicy'

export interface AvatarBehaviorTransitionLogEntry {
  at: number
  frame: number
  fromBehaviorId: string
  toBehaviorId: string
  fromAnimationId: string | null
  toAnimationId: string
  mode: AvatarMode
  source: AvatarPlaybackRequestSource
  reason: string
  accepted: boolean
}

export interface AvatarControllerDebugState {
  mode: AvatarMode
  emotionKey: string
  currentBodyAnimation: string
  currentBodyAnimationFile: string
  currentBodyAnimationLoop: boolean
  currentBodyAnimationStatus: AnimationPlaybackStatus
  bodyActions: VrmBodyActionDebugState
  animationAssetCache: AnimationControllerDebugState['assetCache']
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
  scheduledAnimationKey: string
  idleBehavior: string
  nextIdleBehaviorIn: number
  idleOrchestrator: IdleOrchestratorDebugState
  passiveCompanionMode: boolean
  lipsyncWeights: MouthWeights
  facial: FacialDebugState
  lookAt: LookAtDebugState
  headMotion: HeadMotionDebugState
  earBehavior: EarBehaviorDebugState
  performance: VrmPerformanceDebugState
  playbackRequests: AvatarPlaybackRequestDebugState
  behaviorTimeline: AvatarBehaviorTransitionLogEntry[]
  animationFailures: string[]
}

interface AvatarDebugSnapshotInput {
  stateMachine: AvatarStateMachine
  animations: AvatarAnimationController
  animationQueue: AvatarAnimationQueue
  behaviorEngine: AvatarBehaviorEngineDecision | null
  behaviorResolver: AvatarBehaviorResolver
  lastBehaviorResolution: AvatarBehaviorResolution | null
  lastTransitionDecision: AvatarTransitionDecision | null
  gestures: AvatarGestureScheduler
  speakingGestures: AvatarSpeakingGestureScheduler
  idleBehaviors: AvatarIdleBehaviorController
  idleOrchestrator: AvatarIdleOrchestrator
  playbackRequests: AvatarPlaybackRequestLog
  vrmModel: VrmModel
  mouthWeights: MouthWeights
  behaviorTimeline: AvatarBehaviorTransitionLogEntry[]
}

export class AvatarDebugSnapshotBuilder {
  build(input: AvatarDebugSnapshotInput): AvatarControllerDebugState {
    const animation = input.animations.getDebugState()
    const gesture = input.gestures.getDebugState()
    const speakingGesture = input.speakingGestures.getDebugState()
    const idle = input.idleBehaviors.getDebugState()
    const idleOrchestrator = input.idleOrchestrator.getDebugState()

    return {
      mode: input.stateMachine.getMode(),
      emotionKey: input.stateMachine.getEmotion(),
      currentBodyAnimation: animation.activeAnimationId ?? animation.requestedAnimationId ?? 'none',
      currentBodyAnimationFile: animation.activeFileName ?? animation.requestedFileName ?? 'none',
      currentBodyAnimationLoop: animation.loop,
      currentBodyAnimationStatus: animation.playbackStatus,
      bodyActions: animation.bodyActions,
      animationAssetCache: animation.assetCache,
      previousBodyAnimation: animation.previousAnimationId ?? 'none',
      activeTransitionPolicy: input.lastTransitionDecision?.policyId ?? 'none',
      activeBlendDuration: animation.lastBlendDuration,
      animationQueue: input.animationQueue.getDebugState(),
      speakingGestureScheduler: speakingGesture,
      behaviorEngine: input.behaviorEngine,
      currentBehaviorId: input.lastBehaviorResolution?.behaviorId ?? 'none',
      currentBehaviorCandidates: input.lastBehaviorResolution?.candidates ?? [],
      behaviorSelectionReason: input.lastBehaviorResolution?.selectionReason ?? 'none',
      activeAnimationCooldowns: input.behaviorResolver.getActiveCooldowns(),
      selectedBehaviorAnimation: input.lastBehaviorResolution?.animationId ?? 'none',
      currentGesture: speakingGesture.active ? speakingGesture.currentGesture : gesture.currentGesture,
      scheduledAnimationKey: animation.requestedAnimationId ?? 'none',
      idleBehavior: idle.activeBehavior,
      nextIdleBehaviorIn: idle.nextBehaviorIn,
      idleOrchestrator,
      passiveCompanionMode: idle.passiveCompanionMode,
      lipsyncWeights: input.mouthWeights,
      facial: input.vrmModel.getFacialDebugState(),
      lookAt: input.vrmModel.getLookAtDebugState(),
      headMotion: input.vrmModel.getHeadMotionDebugState(),
      earBehavior: input.vrmModel.getEarBehaviorDebugState(),
      performance: input.vrmModel.getPerformanceDebugState(),
      playbackRequests: input.playbackRequests.getDebugState({
        currentAnimation: animation.activeAnimationId,
        requestedAnimation: animation.requestedAnimationId,
        currentTransition: input.lastTransitionDecision?.policyId ?? 'none',
        transitionPending: animation.bodyActions.transitionRemaining > 0
      }),
      behaviorTimeline: [...input.behaviorTimeline],
      animationFailures: animation.failedAnimationIds
    }
  }
}
