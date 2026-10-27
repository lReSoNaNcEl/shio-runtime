import type * as THREE from 'three'

import type {
  CharacterEmbodimentIntent,
  EmbodimentIntentContext,
} from '../../shared/character-response'
import type { BodyPresentation } from '../../shared/motion'
import type {
  AvatarRuntimeHealth,
  CharacterAvatarState,
  CharacterState,
  EventBus,
  RuntimeEventCategory,
  RuntimeEventType,
} from '../../shared/runtime'
import type { PcmPlaybackClock } from '../audio/audioPlayer'
import type { AnimationPlaybackStatus } from '../avatar/AvatarAnimationController'
import type { AnimationCooldownState } from '../avatar/AvatarAnimationCooldownManager'
import type { AvatarAnimationQueueDebugState } from '../avatar/AvatarAnimationQueue'
import type { AvatarBehaviorEngineDecision } from '../avatar/AvatarBehaviorEngine'
import type { AvatarBehaviorCandidate } from '../avatar/AvatarBehaviorResolver'
import type { AvatarMode } from '../avatar/AvatarController'
import {
  type AvatarBehaviorTransitionLogEntry,
  AvatarController,
  type ReactionGestureTrigger,
} from '../avatar/AvatarController'
import type { IdleOrchestratorDebugState } from '../avatar/AvatarIdleOrchestrator'
import type { AvatarPlaybackRequestDebugState } from '../avatar/AvatarPlaybackRequestLog'
import type { SpeakingGestureSchedulerDebugState } from '../avatar/AvatarSpeakingGestureScheduler'
import type { DebugAvatarMode } from '../avatar/avatarAnimations'
import { resolveEmotionEmbodimentProfile } from '../avatar/EmotionEmbodimentProfile'
import type { FacialDebugState } from '../avatar/embodiment/facial/AvatarExpressionMixer'
import type { HeadMotionDebugState } from '../avatar/embodiment/gaze/HeadMotionRuntime'
import type { LookAtDebugState } from '../avatar/embodiment/gaze/LookAtRuntime'
import type {
  EarAxisOverride,
  EarBehaviorDebugState,
  EarImpulse,
} from '../avatar/embodiment/secondary-motion/EarBehaviorRuntime'
import type { TailBehaviorDebugState } from '../avatar/embodiment/secondary-motion/TailBehaviorRuntime'
import type { LipSyncStartRequest, MouthWeights } from '../avatar/embodiment/speech/LipSync'
import type {
  GeneratedBodyDebugState,
  VrmPerformanceDebugState,
} from '../avatar/rendering/three/VrmModel'
import type { OverlayViewMode } from '../avatar/tuning/cameraTuning'
import { AvatarRuntimeHealthTracker } from './AvatarRuntimeHealthTracker'
import type { AvatarCharacterStateProjection } from './CharacterStateStore'

export type { AvatarMode }

export interface AvatarRuntimeDebugState {
  mode: AvatarMode
  emotionKey: string
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
  scheduledAnimationKey: string
  idleBehavior: string
  nextIdleBehaviorIn: number
  idleOrchestrator: IdleOrchestratorDebugState
  ambientIdleBehavior: boolean
  lipsyncWeights: MouthWeights
  facial: FacialDebugState
  lookAt: LookAtDebugState
  headMotion: HeadMotionDebugState
  earBehavior: EarBehaviorDebugState
  tailBehavior: TailBehaviorDebugState
  performance: VrmPerformanceDebugState
  playbackRequests: AvatarPlaybackRequestDebugState
  behaviorTimeline: AvatarBehaviorTransitionLogEntry[]
  animationFailures: string[]
}

export type AvatarRuntimeMirrorState = Partial<
  Omit<CharacterAvatarState, 'mode' | 'expression' | 'vrmExpression'>
>

export class AvatarRuntime {
  private controller: AvatarController
  private readonly health: AvatarRuntimeHealthTracker
  private lastPhrasePhase = 'idle'
  private lastEmotionProfile = 'neutral'
  private lastSpeakingGesturePhase = 'idle'
  private lastSpeakingGesture = 'none'
  private pcmClock: PcmPlaybackClock | null = null
  private diagnosticsElapsed = 0

  constructor(
    private readonly events: EventBus,
    options: {
      overlayMode?: boolean
      onHealthChange?: (health: AvatarRuntimeHealth) => void
    } = {},
  ) {
    this.controller = new AvatarController(options)
    this.health = new AvatarRuntimeHealthTracker(options.onHealthChange)
  }

  update(delta: number, state?: CharacterState): void {
    this.controller.update(delta, state)
    this.diagnosticsElapsed += delta
    if (this.diagnosticsElapsed >= 0.1) {
      this.diagnosticsElapsed = 0
      const debug = this.controller.getDebugState()
      this.health.setDiagnostics(
        debug.bodyMotion.generated,
        {
          firstPcmAt: this.pcmClock?.firstPcmAt,
          firstOutputAt: this.pcmClock?.firstOutputAt,
          firstAudibleAt: this.pcmClock?.firstAudibleAt,
          hardwareLatencyMs: this.pcmClock?.hardwareLatencyMs,
          cueCount: this.pcmClock?.cueCount,
          maxCueErrorMs: this.pcmClock?.maxCueErrorMs,
          active: this.pcmClock?.state === 'playing',
          sourceSampleOffset: this.pcmClock?.sourceSampleOffset ?? 0,
          sourceSampleRate: this.pcmClock?.sourceSampleRate ?? 44100,
          rawRms:
            this.pcmClock?.state === 'playing'
              ? Math.max(0, Math.min(1, debug.facial.mouthTuning.currentRawRms))
              : 0,
          mouthWeight: Math.max(...Object.values(debug.lipsyncWeights)),
          blinkWeight: debug.facial.blink,
        },
        this.controller.getEmbodimentAvailability(),
      )
    }
    const phrase = this.controller.getSpeechPhraseSnapshot()
    if (phrase.phase !== this.lastPhrasePhase) {
      this.lastPhrasePhase = phrase.phase
      this.publishAvatarEvent(
        'SpeechPhrasePhaseChanged',
        `turn=${phrase.turnId ?? 'none'} phase=${phrase.phase}`,
      )
    }
    const scheduler = this.controller.getSpeakingGestureSnapshot()
    if (scheduler.phase !== this.lastSpeakingGesturePhase) {
      this.lastSpeakingGesturePhase = scheduler.phase
      this.publishAvatarEvent(
        'SpeakingGesturePhaseChanged',
        `phase=${scheduler.phase} behavior=${scheduler.nextBehavior}`,
      )
    }
    if (scheduler.currentGesture !== this.lastSpeakingGesture) {
      this.lastSpeakingGesture = scheduler.currentGesture
      if (scheduler.currentGesture !== 'none')
        this.publishAvatarEvent('SpeakingGestureSwitched', `behavior=${scheduler.currentGesture}`)
    }
  }

  setPcmClock(clock: PcmPlaybackClock | null): void {
    this.pcmClock = clock
    this.controller.setPcmClock(clock)
  }
  settleMotionCancellation(): Promise<void> {
    return this.controller.settleMotionCancellation()
  }
  getBodyPresentation(): BodyPresentation | null {
    return this.controller.getBodyPresentation()
  }
  applyBodyPresentation(value: BodyPresentation | null): void {
    this.controller.applyBodyPresentation(value)
  }

  async loadVrm(scene: THREE.Scene, buffer: ArrayBuffer): Promise<void> {
    this.health.markLoading()
    try {
      await this.controller.loadVrm(scene, buffer)
      this.health.markReady(this.controller.isLoaded())
      this.publishAvatarEvent('RuntimeInitialized', 'VRM Loaded')
    } catch (error) {
      this.health.markFailed(error, this.controller.isLoaded())
      throw error
    }
  }

  attachScene(scene: THREE.Scene): void {
    this.controller.attachScene(scene)
  }
  getHeadPosition(): THREE.Vector3 | null {
    return this.controller.getHeadPosition()
  }

  getMotionLibraryDebug() {
    return this.controller.getMotionLibraryDebug()
  }
  previewSequence(ids: readonly string[]): void {
    this.controller.previewSequence(ids)
  }
  previewVariation(
    id: string,
    seed?: number,
    bodyAction?: import('../../shared/motion').BodyTurnIntent,
  ): void {
    this.controller.previewVariation(id, seed, bodyAction)
  }
  recoverMotion(): void {
    this.controller.recoverMotion()
  }
  getHandBounds(side: 'left' | 'right'): THREE.Sphere | null {
    return this.controller.getHandBounds(side)
  }
  getAvatarFrontSign(): -1 | 1 {
    return this.controller.getAvatarFrontSign()
  }

  getHealth(): AvatarRuntimeHealth {
    return this.health.getSnapshot()
  }

  setSpeechDelivery(emotion: string | null): void {
    this.controller.setSpeechDelivery(emotion)
  }

  reportHealth(): void {
    this.health.reportCurrent()
  }

  attachPresentation(): void {
    this.health.setPresentationAttached(true)
  }

  detachPresentation(): void {
    this.health.setPresentationAttached(false)
  }

  dispose(): void {
    this.controller.dispose()
    this.health.markDisposed()
  }

  stopAnimation(): void {
    const previous = this.controller.getDebugState()
    this.controller.stopAnimation()
    if (previous.currentGesture !== 'none')
      this.publishAvatarEvent('GestureFinished', previous.currentGesture)
    if (previous.currentBodyAnimation !== 'none')
      this.publishAvatarEvent('AnimationFinished', previous.currentBodyAnimation)
  }

  applyCharacterState(
    state: CharacterState,
    options: { lipSyncStart?: LipSyncStartRequest; stopLipSyncTurnId?: string } = {},
  ): void {
    const previous = this.controller.getDebugState()
    this.controller.applyCharacterState(state, options)
    this.publishAvatarChanges(previous)
    const emotionProfile = resolveEmotionEmbodimentProfile(state.emotion).id
    if (emotionProfile !== this.lastEmotionProfile) {
      this.lastEmotionProfile = emotionProfile
      this.publishAvatarEvent('EmotionEmbodimentResolved', `emotion=${emotionProfile}`)
    }
  }

  /** Stable semantic input; concrete gaze and clip selection remain internal. */
  setEmbodimentIntent(
    intent: CharacterEmbodimentIntent | undefined,
    context?: EmbodimentIntentContext,
  ): void {
    this.controller.setEmbodimentIntent(intent, context)
  }

  setBehaviorEmbodimentIntent(intent: CharacterEmbodimentIntent | undefined): void {
    this.controller.setBehaviorEmbodimentIntent(intent)
  }

  setBrowserScreenGaze(sessionId: string, active: boolean): void {
    this.controller.setBrowserScreenGaze(sessionId, active)
  }

  isBrowserScreenGazeActive(): boolean {
    return this.controller.isBrowserScreenGazeActive()
  }

  getMirrorState(): AvatarRuntimeMirrorState {
    return {
      loaded: this.controller.isLoaded(),
      lipsync: this.controller.getMouthWeights(),
    }
  }

  getCharacterStateProjection(state: CharacterState): AvatarCharacterStateProjection {
    const avatar = this.controller.getDebugState()
    const mode = state.mode
    return {
      avatar: {
        loaded: this.controller.isLoaded(),
        lipsync: avatar.lipsyncWeights,
      },
      animation: {
        behavior: avatar.currentBehaviorId,
        animationId: avatar.currentBodyAnimation,
        queueLength: avatar.animationQueue.length,
      },
      posture:
        mode === 'thinking' || mode === 'awaitingSpeech'
          ? 'thinking'
          : mode === 'idle'
            ? 'relaxed'
            : state.posture,
      behaviorReplyType: avatar.behaviorEngine?.replyType,
    }
  }

  getDebugState(): AvatarRuntimeDebugState {
    return this.controller.getDebugState()
  }

  getMouthWeights(): MouthWeights {
    return this.controller.getMouthWeights()
  }

  setMouthWeights(weights: Partial<MouthWeights>): void {
    this.controller.setMouthWeights(weights)
  }

  setCameraMode(cameraMode: OverlayViewMode | undefined): void {
    this.controller.setCameraMode(cameraMode)
  }

  stopLipSync(turnId: string): boolean {
    return this.controller.stopLipSync(turnId)
  }

  interruptLipSync(turnId: string): boolean {
    return this.controller.interruptLipSync(turnId)
  }

  triggerUserInterruption(): boolean {
    const triggered = this.controller.triggerUserInterruption()
    const decision = this.controller.getLastEarImpulseDecision()
    if (decision?.impulse === 'user-interruption') {
      this.publishAvatarEvent(
        decision.accepted ? 'EarImpulseTriggered' : 'EarImpulseRejected',
        `impulse=user-interruption reason=${decision.reason}`,
      )
    }
    if (triggered) this.publishAvatarEvent('RuntimeDebugEvent', 'User Interruption Reaction')
    return triggered
  }

  triggerEarImpulse(impulse: EarImpulse, identity?: string): boolean {
    const triggered = this.controller.triggerEarImpulse(impulse, identity)
    const decision = this.controller.getLastEarImpulseDecision()
    this.publishAvatarEvent(
      triggered ? 'EarImpulseTriggered' : 'EarImpulseRejected',
      `impulse=${impulse} reason=${decision?.reason ?? (triggered ? 'accepted' : 'rejected')}`,
    )
    return triggered
  }

  triggerReactionGesture(trigger: ReactionGestureTrigger): boolean {
    const animationId = this.controller.triggerReactionGesture(trigger)
    if (!animationId) return false
    this.publishAvatarEvent('ReactionGestureSelected', `behavior=${animationId} reason=${trigger}`)
    return true
  }

  isLoaded(): boolean {
    return this.controller.isLoaded()
  }

  previewMode(mode: DebugAvatarMode): void {
    const previous = this.controller.getDebugState()
    this.controller.previewMode(mode)
    this.publishAvatarChanges(previous)
  }

  previewAnimation(id: string): void {
    const previous = this.controller.getDebugState()
    this.controller.previewAnimation(id)
    this.publishAvatarChanges(previous)
  }

  rerollAnimation(): void {
    const previous = this.controller.getDebugState()
    this.controller.rerollAnimation()
    this.publishAvatarChanges(previous)
  }

  clearAnimationCooldowns(): void {
    this.controller.clearAnimationCooldowns()
    this.publishAvatarEvent('RuntimeDebugEvent', 'Animation Cooldowns Cleared')
  }

  clearAnimationQueue(): void {
    this.controller.clearAnimationQueue()
    this.publishAvatarEvent('RuntimeDebugEvent', 'Animation Queue Cleared')
  }

  queueTestSequence(): void {
    const previous = this.controller.getDebugState()
    this.controller.queueTestSequence()
    this.publishAvatarChanges(previous)
  }

  setIdleOrchestratorPaused(paused: boolean): void {
    this.controller.setIdleOrchestratorPaused(paused)
    this.publishAvatarEvent(
      'RuntimeDebugEvent',
      paused ? 'Idle Orchestrator Paused' : 'Idle Orchestrator Resumed',
    )
  }

  testTransition(
    kind:
      | 'idle-to-idle'
      | 'idle-to-speaking'
      | 'speaking-to-idle'
      | 'thinking-to-idle'
      | 'greeting-to-idle',
  ): void {
    const previous = this.controller.getDebugState()
    this.controller.testTransition(kind)
    this.publishAvatarChanges(previous)
  }

  previewGreeting(): void {
    const previous = this.controller.getDebugState()
    this.controller.previewGreeting()
    this.publishAvatarChanges(previous)
  }

  previewBlink(): void {
    this.controller.previewBlink()
    this.publishAvatarEvent('RuntimeDebugEvent', 'Blink Preview')
  }

  setLookAtTarget(target: THREE.Object3D | null): boolean {
    return this.controller.setLookAtTarget(target)
  }

  setEarAxisOverride(axis: EarAxisOverride): void {
    this.controller.setEarAxisOverride(axis)
    this.publishAvatarEvent('RuntimeDebugEvent', `Ear Axis Override: ${axis}`)
  }

  setEarAmplitudeScale(scale: number): void {
    this.controller.setEarAmplitudeScale(scale)
    this.publishAvatarEvent('RuntimeDebugEvent', `Ear Amplitude Scale: ${scale.toFixed(2)}`)
  }

  private publishAvatarChanges(previous: AvatarRuntimeDebugState): void {
    const current = this.controller.getDebugState()
    if (current.currentGesture !== previous.currentGesture && current.currentGesture !== 'none') {
      this.publishAvatarEvent('GestureStarted', current.currentGesture)
    }
    if (
      current.currentBodyAnimation !== previous.currentBodyAnimation &&
      current.currentBodyAnimation !== 'none'
    ) {
      this.publishAvatarEvent('AnimationStarted', current.currentBodyAnimation)
    }
  }

  private publishAvatarEvent(type: RuntimeEventType, detail?: string): void {
    this.events.publish({
      type,
      category: this.categoryFor(type),
      source: 'renderer.avatarRuntime',
      detail,
    })
  }

  private categoryFor(type: RuntimeEventType): RuntimeEventCategory {
    return type === 'RuntimeDebugEvent' ? 'system' : 'avatar'
  }
}
