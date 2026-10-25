import type { CharacterEmbodimentIntent } from '../../shared/character-response'
import type {
  AvatarRuntimeHealth,
  CharacterAvatarState,
  CharacterState,
  EventBus,
  RuntimeEventCategory,
  RuntimeEventType,
} from '../../shared/runtime'
import type { AvatarMode } from '../avatar/AvatarController'
import { AvatarController, type ReactionGestureTrigger } from '../avatar/AvatarController'
import type { AvatarControllerDebugState } from '../avatar/AvatarDebugSnapshotBuilder'
import type { DebugAvatarMode } from '../avatar/avatarAnimations'
import { resolveEmotionEmbodimentProfile } from '../avatar/EmotionEmbodimentProfile'
import type { EarImpulse } from '../avatar/embodiment/secondary-motion/EarBehaviorRuntime'
import type { LipSyncStartRequest, MouthWeights } from '../avatar/embodiment/speech/LipSync'
import type { GazeTarget } from '../avatar/rendering/two/AvatarModel'
import type { OverlayViewMode } from '../avatar/tuning/cameraTuning'
import { AvatarRuntimeHealthTracker } from './AvatarRuntimeHealthTracker'
import type { AvatarCharacterStateProjection } from './CharacterStateStore'

export type { AvatarMode }

export type AvatarRuntimeDebugState = AvatarControllerDebugState

export type AvatarRuntimeMirrorState = Partial<
  Omit<CharacterAvatarState, 'mode' | 'expression' | 'avatarExpression'>
>

export class AvatarRuntime {
  private controller: AvatarController
  private readonly health: AvatarRuntimeHealthTracker
  private lastPhrasePhase = 'idle'
  private lastEmotionProfile = 'neutral'
  private lastSpeakingGesturePhase = 'idle'
  private lastSpeakingGesture = 'none'

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

  async loadPuppet(canvas: HTMLCanvasElement): Promise<void> {
    this.health.markLoading()
    try {
      await this.controller.loadPuppet(canvas)
      this.health.markReady(this.controller.isLoaded())
      this.publishAvatarEvent('RuntimeInitialized', 'Shio S22 Loaded')
    } catch (error) {
      this.health.markFailed(error, this.controller.isLoaded())
      throw error
    }
  }

  getHealth(): AvatarRuntimeHealth {
    return this.health.getSnapshot()
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

  unloadPresentation(): void {
    this.controller.unloadPresentation()
  }
  setPresentationView(view: string, scale = 1): void {
    this.controller.setPresentationView(view, scale)
  }
  previewEmotion(emotion: string, intensity: number): void {
    this.controller.previewEmotion(emotion, intensity)
  }
  previewTailStyle(style: 'side' | 'back'): void {
    this.controller.previewTailStyle(style)
  }
  setSpeechDelivery(emotion: string | null): void {
    this.controller.setSpeechDelivery(emotion)
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
  setEmbodimentIntent(intent: CharacterEmbodimentIntent | undefined): void {
    this.controller.setEmbodimentIntent(intent)
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

  setLookAtTarget(target: GazeTarget | null): boolean {
    return this.controller.setLookAtTarget(target)
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
