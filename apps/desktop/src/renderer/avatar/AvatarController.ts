import type * as THREE from 'three'

import {
  type CharacterEmbodimentIntent,
  type ConversationPerformance,
  EMBODIMENT_PROPOSAL_TTL_MS,
  type EmbodimentGazeHint,
  type EmbodimentIntentContext,
} from '../../shared/character-response'
import { type DeliveryMood, resolveDeliveryStyle } from '../../shared/embodiment'
import { type BodyPresentation, getMotionProfile, type MotionKeypose } from '../../shared/motion'
import type { CharacterState } from '../../shared/runtime'
import type { PcmPlaybackClock } from '../audio/audioPlayer'
import { AvatarAnimationController } from './AvatarAnimationController'
import type { AvatarAnimationQueueItem } from './AvatarAnimationQueue'
import { AvatarBehaviorEngine, type AvatarBehaviorEngineDecision } from './AvatarBehaviorEngine'
import { type AvatarBehaviorResolution, AvatarBehaviorResolver } from './AvatarBehaviorResolver'
import {
  type AvatarBehaviorTransitionLogEntry,
  type AvatarControllerDebugState,
  AvatarDebugSnapshotBuilder,
} from './AvatarDebugSnapshotBuilder'
import { AvatarGestureScheduler } from './AvatarGestureScheduler'
import { AvatarIdleBehaviorController } from './AvatarIdleBehaviorController'
import { AvatarIdleOrchestrator, type IdleOrchestratorDebugState } from './AvatarIdleOrchestrator'
import { AvatarPlaybackCoordinator } from './AvatarPlaybackCoordinator'
import type { AvatarPlaybackRequestSource } from './AvatarPlaybackRequestLog'
import { toAvatarMode, toProceduralMode } from './AvatarRuntimeMappers'
import {
  AvatarSpeakingGestureScheduler,
  type SpeakingGestureDecision,
  type SpeakingGestureSchedulerDebugState,
} from './AvatarSpeakingGestureScheduler'
import { AvatarStateEffectApplier } from './AvatarStateEffectApplier'
import { type AvatarMode, type AvatarStateEffect, AvatarStateMachine } from './AvatarStateMachine'
import { getAnimation } from './animationManifest'
import type { DebugAvatarMode } from './avatarAnimations'
import { resolveEmotionEmbodimentProfile } from './EmotionEmbodimentProfile'
import { AvatarGazeArbiter } from './embodiment/gaze/AvatarGazeArbiter'
import type { EarAxisOverride, EarImpulse } from './embodiment/secondary-motion/EarBehaviorRuntime'
import { LipSync, type LipSyncStartRequest, type MouthWeights } from './embodiment/speech/LipSync'
import type { SpeechPhrasePhase } from './embodiment/speech/PhraseEnvelopeController'
import {
  MotionAttenuationAggregator,
  type MotionAttenuationDebug,
  NOOP_MOTION_ATTENUATION_PROBE,
} from './MotionAttenuation'
import type { ConversationViewConfig } from './rendering/three/ConversationFraming'
import { previewHandBounds } from './rendering/three/previewHandBounds'
import { VrmModel } from './rendering/three/VrmModel'
import type { OverlayViewMode } from './tuning/cameraTuning'
import { speakingGestureTuning } from './tuning/speechTuning'
import { avatarStartupTuning } from './tuning/startupTuning'

export type { AvatarMode } from './AvatarStateMachine'
export type { AvatarBehaviorTransitionLogEntry }
export type ReactionGestureTrigger =
  | 'direct-address'
  | 'question'
  | 'surprise'
  | 'user-interruption'

const THINKING_PRESENTATION_DELAY_MS = 400

export class AvatarController {
  private vrmModel = new VrmModel()
  private animations = new AvatarAnimationController(this.vrmModel)
  private behaviorEngine = new AvatarBehaviorEngine()
  private behaviorResolver = new AvatarBehaviorResolver()
  private gestures = new AvatarGestureScheduler()
  private speakingGestures = new AvatarSpeakingGestureScheduler()
  private idleBehaviors = new AvatarIdleBehaviorController(this.vrmModel)
  private idleOrchestrator = new AvatarIdleOrchestrator()
  private playback = new AvatarPlaybackCoordinator(this.animations, this.vrmModel)
  private debugSnapshots = new AvatarDebugSnapshotBuilder()
  private lipSync = new LipSync(this.vrmModel)
  private motionAttenuation: MotionAttenuationAggregator | null = null
  private stateEffects = new AvatarStateEffectApplier(this.vrmModel, this.lipSync)
  private stateMachine = new AvatarStateMachine()
  private gaze = new AvatarGazeArbiter()
  private lastEffect: AvatarStateEffect | null = null
  private lastBehaviorEngineDecision: AvatarBehaviorEngineDecision | null = null
  private lastBehaviorResolution: AvatarBehaviorResolution | null = null
  private externalMouthWeights: MouthWeights | null = null
  private frame = 0
  private lastCharacterStateKey: string | null = null
  private conversationEmbodimentIntent: CharacterEmbodimentIntent | undefined
  private behaviorEmbodimentIntent: CharacterEmbodimentIntent | undefined
  private activeConversationPerformance: ConversationPerformance | undefined
  private pauseGaze: EmbodimentGazeHint | undefined
  private lastCharacterState: CharacterState | undefined
  /** Visual hysteresis only; the authoritative Character State changes immediately. */
  private thinkingPresentationDue: number | null = null
  private speechDeliveryEmotion: string | null = null
  private deliveryMood: DeliveryMood | null = null
  private pcmClock: PcmPlaybackClock | null = null
  private scheduledPcmOffset = 0
  private scheduledPlaybackId = ''
  private intentContext: EmbodimentIntentContext | undefined
  private processedIntentKey: string | undefined
  private requestedMotionTurnId: string | undefined
  private preparedGesture:
    | {
        key: string
        resolved: AvatarBehaviorResolution
        playback: NonNullable<ReturnType<AvatarPlaybackCoordinator['getCurrentContext']>>
      }
    | undefined
  private previewPlan: string[] = []
  private previewExecutionId: string | null = null
  private previewExpectedProfile: string | null = null
  private previewPreviousExecution: string | null = null
  private lastStartedExecutionId: string | null = null

  constructor(options: { overlayMode?: boolean } = {}) {
    this.vrmModel.setPresentationOnly(options.overlayMode === true)
  }

  update(delta: number, state?: CharacterState): void {
    if (state) this.lastCharacterState = state
    if (
      this.thinkingPresentationDue !== null &&
      performance.now() >= this.thinkingPresentationDue &&
      this.lastCharacterState
    )
      this.applyCharacterState(this.lastCharacterState)
    this.frame += 1
    if (this.preparedGesture && !this.hasPreparedGesture()) this.releasePreparedGesture()
    const mode = this.stateMachine.getMode()
    this.idleBehaviors.update(delta, mode)
    this.advanceAnimationQueue()
    this.updateSpeakingGestureSession(state)
    if (
      this.thinkingPresentationDue === null &&
      !this.hasPreparedGesture() &&
      this.idleOrchestrator.update(delta, mode)
    ) {
      const effect = this.stateMachine.getIdleEffect()
      const behaviorDecision = this.behaviorEngine.decide(effect)
      this.lastBehaviorEngineDecision = behaviorDecision
      const idleEffect = { ...effect, behaviorId: behaviorDecision.intent }
      if (this.idleOrchestrator.shouldUseExtendedIdle()) {
        const lastExtendedIdle = this.idleOrchestrator.getLastExtendedIdleAnimation()
        const resolved = this.behaviorResolver.resolveBehaviorTag(
          idleEffect,
          'idle-presence',
          'idle',
          [...(lastExtendedIdle ? [lastExtendedIdle] : [])],
        )
        this.playResolvedBehavior(
          idleEffect,
          'idle-orchestrator',
          'idle presence tick',
          false,
          resolved,
          'extended-idle',
        )
      } else {
        this.playResolvedBehavior(idleEffect, 'idle-orchestrator', 'idle orchestrator tick')
      }
    }
    // Keep the Ear Runtime self-driven from the render loop: sync its profile +
    // emotion every frame from the current Character State (falling back to the
    // state machine) so idle / AFK procedural motion keeps progressing on both
    // the main avatar and the independent Mirror Overlay, without depending on
    // discrete applyCharacterState events. Ear-only — facial profiles stay
    // event-driven.
    const earMode = toProceduralMode(
      this.thinkingPresentationDue !== null ? mode : (state?.mode ?? mode),
    )
    const earEmotion = state
      ? state.emotion || state.avatar.expression || 'neutral'
      : this.stateMachine.getEmotion()
    this.vrmModel.syncEarState(earMode, earEmotion)

    // Mirror weights are already the main avatar's final mixer output. Preserve
    // that composition marker on every frame; otherwise the overlay falls back
    // into its local idle PhraseEnvelope (articulationScale=0) and mutes the
    // externally supplied mouth immediately after the first synced frame.
    if (this.externalMouthWeights) {
      this.vrmModel.setMouthWeights(this.externalMouthWeights, true)
    } else {
      // Resolve the current analyser frame before the facial mixer writes the
      // frame. The previous order mixed yesterday's mouth state and only then
      // sampled the current audio, adding a permanent frame of latency to every
      // viseme and phrase-envelope transition.
      this.lipSync.update(delta)
    }
    if (this.updateConversationPerformance(mode)) this.applyCurrentGaze()
    if (this.speechDeliveryEmotion !== null) this.vrmModel.applyEmotion(this.speechDeliveryEmotion)
    this.vrmModel.update(delta)
    this.advancePreviewSequence()
  }

  async loadVrm(scene: THREE.Scene, buffer: ArrayBuffer, current = () => true): Promise<void> {
    // A replacement model must not inherit the previous skeleton's queue or
    // active-animation identity; otherwise the initial idle may be rejected as
    // a duplicate even though the new skeleton has no body action yet.
    this.stopAnimation()
    await this.vrmModel.settleMotionCancellation()
    if (!current()) return
    await this.vrmModel.load(scene, buffer, current)
    if (!current()) return
    this.lipSync.restorePresentation()
    this.vrmModel.setSceneVisible(false)
    try {
      this.lastCharacterStateKey = ''
      if (this.lastCharacterState) this.applyCharacterState(this.lastCharacterState)
      else this.setMode('idle')
      const animationReady = await this.animations.waitForLatestPlaybackRequest(
        avatarStartupTuning.initialAnimationTimeoutMs,
      )
      if (!animationReady) {
        console.warn('[ANIMDBG] initial animation bootstrap fell back to visible bind pose')
      }
    } finally {
      // Bootstrap visibility is one-shot and failure-safe. Later animation
      // loads never own scene visibility; stale/error startup falls back to the
      // visible bind pose instead of leaving an empty overlay.
      this.vrmModel.setSceneVisible(true)
    }
  }

  attachScene(scene: THREE.Scene): void {
    this.vrmModel.attachScene(scene)
  }
  getHeadPosition(): THREE.Vector3 | null {
    return this.vrmModel.getHeadPosition()
  }

  stopAnimation(): void {
    this.thinkingPresentationDue = null
    this.preparedGesture = undefined
    this.conversationEmbodimentIntent = undefined
    this.activeConversationPerformance = undefined
    this.pauseGaze = undefined
    this.vrmModel.setConversationPerformance(undefined)
    this.intentContext = undefined
    this.requestedMotionTurnId = undefined
    this.gaze.setConversationIntent(undefined)
    this.lastCharacterStateKey = null
    this.previewPlan = []
    this.previewExecutionId = null
    this.gestures.reset()
    this.speakingGestures.reset()
    this.idleBehaviors.reset()
    this.idleOrchestrator.reset()
    this.playback.reset()
    this.animations.stop()
  }

  dispose(): void {
    this.stopAnimation()
    this.lipSync.detach(undefined, true, true)
    this.externalMouthWeights = null
    this.vrmModel.dispose()
  }

  setMode(mode: AvatarMode): void {
    this.applyStateEffect(this.stateMachine.setMode(mode))
  }

  applyCharacterState(
    state: CharacterState,
    options: { lipSyncStart?: LipSyncStartRequest; stopLipSyncTurnId?: string } = {},
  ): void {
    this.lastCharacterState = state
    const mode = toAvatarMode(state.mode)
    const thinking = mode === 'thinking' || mode === 'awaitingSpeech'
    if (!thinking) this.thinkingPresentationDue = null
    else if (
      this.stateMachine.getMode() === 'idle' ||
      this.stateMachine.getMode() === 'listening'
    ) {
      if (this.thinkingPresentationDue === null) {
        this.thinkingPresentationDue = performance.now() + THINKING_PRESENTATION_DELAY_MS
        // Returning to the previous mode must still release early preparation.
        this.lastCharacterStateKey = null
        // Preparation may overlap the visual delay; never delay an audible gesture.
        this.prepareConversationGesture()
      }
      if (performance.now() < this.thinkingPresentationDue) {
        if (options.stopLipSyncTurnId) this.lipSync.detach(options.stopLipSyncTurnId)
        return
      }
    }
    this.thinkingPresentationDue = null
    const emotionKey = state.emotion || state.avatar.expression || 'neutral'
    const vrmEmotion = state.avatar.vrmExpression
    const semanticKey = `${mode}|${emotionKey}|${vrmEmotion ?? ''}|${JSON.stringify(this.effectiveEmbodimentIntent()) ?? ''}|browser=${this.gaze.browserScreenGazeActive()}|${options.lipSyncStart?.session.playbackId ?? ''}`

    if (semanticKey === this.lastCharacterStateKey) {
      this.vrmModel.applyEmotion(emotionKey || 'neutral', vrmEmotion)
      this.playback.recordPlaybackOnly({
        animationId: this.playback.getCurrentContext()?.animationId ?? 'none',
        behaviorId: this.playback.getCurrentContext()?.behaviorId ?? 'none',
        source: 'character-state',
        reason: 'equivalent Character State',
        accepted: false,
        decision: 'ignored',
        rejectionReason: 'semantic state unchanged',
        frame: this.frame,
      })
      return
    }

    this.lastCharacterStateKey = semanticKey

    if (mode === 'speaking') {
      if (options.lipSyncStart)
        this.startSpeaking(options.lipSyncStart, emotionKey, vrmEmotion, state)
      else this.showSpeaking(emotionKey, vrmEmotion, state)
      return
    }

    if (mode === 'awaitingSpeech') {
      this.prepareSpeaking(emotionKey, vrmEmotion, state)
      return
    }

    this.applyStateEffect(
      this.stateMachine.setMode(mode),
      vrmEmotion,
      undefined,
      state,
      'character-state',
      'CharacterState mode/emotion changed',
      options.stopLipSyncTurnId,
    )
    if (emotionKey || vrmEmotion) this.setEmotion(emotionKey, vrmEmotion)
  }

  setEmotion(emotionKey: string, vrmEmotion?: string): void {
    this.vrmModel.applyEmotion(emotionKey || 'neutral', vrmEmotion)
    const effect = this.stateMachine.setEmotion(emotionKey)
    if (effect)
      this.applyStateEffect(
        effect,
        vrmEmotion,
        undefined,
        undefined,
        'character-state',
        'speech emotion update',
        undefined,
        this.lipSync.getActiveSession() !== null,
      )
  }

  /** Bounded Mood modulation of the delivery style; applies from the next audible segment. */
  setDeliveryMood(mood: DeliveryMood | null): void {
    this.deliveryMood = mood ? { ...mood } : null
  }

  setSpeechDelivery(emotion: string | null): void {
    const changed = this.speechDeliveryEmotion !== emotion
    this.speechDeliveryEmotion = emotion
    // The audible segment boundary (consumed PCM cue) is the only style switch.
    this.vrmModel.setDeliveryStyle(
      emotion ? resolveDeliveryStyle(emotion, 'normal', this.deliveryMood) : null,
    )
    this.lipSync.setEmotion(emotion ?? this.lastCharacterState?.emotion ?? 'neutral')
    this.vrmModel.applyEmotion(emotion ?? this.lastCharacterState?.emotion ?? 'neutral')
    if (changed && emotion && this.stateMachine.getMode() === 'speaking') {
      this.speakingGestures.beginSegment(resolveEmotionEmbodimentProfile(emotion).id)
    }
  }

  setEmbodimentIntent(
    intent: CharacterEmbodimentIntent | undefined,
    context?: EmbodimentIntentContext,
  ): void {
    const activeTurn = this.lipSync.getActiveSession()?.turnId
    if (
      context &&
      (Date.now() - context.receivedAt > EMBODIMENT_PROPOSAL_TTL_MS ||
        context.receivedAt > Date.now() + 1000 ||
        (activeTurn && activeTurn !== context.turnId))
    )
      return
    const key = context
      ? `${context.turnId}|${context.receivedAt}|${JSON.stringify(intent)}`
      : undefined
    if (this.preparedGesture?.key !== key) this.releasePreparedGesture()
    this.intentContext = context
    this.conversationEmbodimentIntent = intent
    this.behaviorEmbodimentIntent = undefined
    this.gaze.setConversationIntent(intent)
    this.gaze.setBehaviorIntent(undefined)
    this.lastCharacterStateKey = null
    this.updateConversationPerformance(this.stateMachine.getMode())
    this.applyCurrentGaze()
    if (intent && context && key && key !== this.processedIntentKey)
      if (this.startRequestedMotion(intent, context, key)) return
    this.prepareConversationGesture()
  }

  private startRequestedMotion(
    intent: CharacterEmbodimentIntent,
    context: EmbodimentIntentContext,
    key: string,
  ): boolean {
    const animationId = intent.bodyAction
      ? this.getEmbodimentAvailability().availableBodyActions?.includes(intent.bodyAction.action)
        ? intent.bodyAction.action === 'dance-in-place'
          ? 'dance_in_place'
          : 'turn_in_place'
        : undefined
      : this.vrmModel.supportsContextualMotion() && intent.gestureHint && !intent.performance
        ? this.resolveConversationGesture(this.speakingGestureEffect())?.animationId
        : undefined
    if (!animationId) return false
    this.processedIntentKey = key
    this.requestedMotionTurnId = context.turnId
    this.idleOrchestrator.leaveIdle()
    this.playback.previewAnimation({
      animationId,
      loop: false,
      mode: 'idle',
      frame: this.frame,
      bodyAction: intent.bodyAction,
      requestSource: 'character-state',
    })
    return true
  }

  setBehaviorEmbodimentIntent(intent: CharacterEmbodimentIntent | undefined): void {
    this.behaviorEmbodimentIntent = intent
    this.gaze.setBehaviorIntent(intent)
    this.lastCharacterStateKey = null
    this.applyCurrentGaze()
  }

  setBrowserScreenGaze(sessionId: string, active: boolean): void {
    this.gaze.setBrowserScreenGaze(sessionId, active)
    this.lastCharacterStateKey = null
    this.applyCurrentGaze()
  }

  isBrowserScreenGazeActive(): boolean {
    return this.gaze.browserScreenGazeActive()
  }

  prepareSpeaking(emotionKey?: string, vrmEmotion?: string, state?: CharacterState): void {
    const effect = this.stateMachine.prepareSpeaking(emotionKey)
    this.applyStateEffect(
      effect,
      vrmEmotion,
      undefined,
      state,
      'character-state',
      'prepare speaking',
    )
  }

  startSpeaking(
    request: LipSyncStartRequest,
    emotionKey?: string,
    vrmEmotion?: string,
    state?: CharacterState,
  ): void {
    const continuingSpeech = this.lipSync.getActiveSession()?.turnId === request.session.turnId
    const effect = this.stateMachine.startSpeaking(emotionKey)
    this.applyStateEffect(
      effect,
      vrmEmotion,
      request,
      state,
      'character-state',
      'start speaking',
      undefined,
      continuingSpeech,
    )
  }

  showSpeaking(emotionKey?: string, vrmEmotion?: string, state?: CharacterState): void {
    const effect = this.stateMachine.startSpeaking(emotionKey)
    this.applyStateEffect(
      effect,
      vrmEmotion,
      undefined,
      state,
      'character-state',
      'show speaking',
      undefined,
      this.lipSync.getActiveSession() !== null,
    )
  }

  getMouthWeights(): MouthWeights {
    if (this.externalMouthWeights) return { ...this.externalMouthWeights }
    return this.vrmModel.getFinalMouthWeights()
  }

  setMouthWeights(weights: Partial<MouthWeights>): void {
    this.externalMouthWeights = {
      aa: weights.aa ?? 0,
      ih: weights.ih ?? 0,
      ou: weights.ou ?? 0,
      ee: weights.ee ?? 0,
      oh: weights.oh ?? 0,
    }
    this.vrmModel.setMouthWeights(this.externalMouthWeights, true)
  }

  stopSpeaking(): void {
    this.releasePreparedGesture()
    this.processedIntentKey = this.conversationIntentKey()
    this.applyStateEffect(
      this.stateMachine.stopSpeaking(),
      undefined,
      undefined,
      undefined,
      'character-state',
      'stop speaking',
    )
  }

  stopLipSync(turnId: string): boolean {
    return this.lipSync.detach(turnId)
  }

  interruptLipSync(turnId: string): boolean {
    const active = this.lipSync.getActiveSession()
    if (active && active.turnId !== turnId) return false
    const stopped = this.lipSync.detach(turnId, true, true)
    if (
      active ||
      (this.requestedMotionTurnId === turnId && this.requestedMotionActive()) ||
      this.stateMachine.getMode() === 'thinking' ||
      this.stateMachine.getMode() === 'awaitingSpeech'
    )
      this.stopAnimation()
    return stopped
  }

  settleMotionCancellation(): Promise<void> {
    return this.vrmModel.settleMotionCancellation()
  }
  getBodyPresentation(): BodyPresentation | null {
    return this.vrmModel.getBodyPresentation()
  }
  applyBodyPresentation(value: BodyPresentation | null): void {
    this.vrmModel.applyBodyPresentation(value)
  }

  triggerUserInterruption(): boolean {
    const earTriggered = this.triggerEarImpulse('user-interruption')
    const headTriggered = this.vrmModel.triggerHeadAttentionImpulse('user-interruption')
    return earTriggered || headTriggered
  }

  triggerEarImpulse(impulse: EarImpulse, identity?: string): boolean {
    return this.vrmModel.triggerEarImpulse(impulse, identity)
  }

  /** The user started speaking: ears perk and the head lifts attentively, once per utterance. */
  reactToUserSpeechOnset(): boolean {
    if (this.stateMachine.getMode() === 'speaking') return false
    const ears = this.triggerEarImpulse('direct-address')
    const head = this.vrmModel.triggerHeadAttentionImpulse('speech-onset')
    return ears || head
  }

  /** A prosodic pause in the user's speech: a small nod and a facial acknowledgement. */
  acknowledgeUserSpeech(): boolean {
    if (this.stateMachine.getMode() === 'speaking') return false
    const nodded = this.vrmModel.triggerHeadAttentionImpulse('backchannel-nod')
    if (nodded) this.vrmModel.acknowledgeUserSpeech()
    return nodded
  }

  triggerReactionGesture(trigger: ReactionGestureTrigger): string | null {
    if (trigger === 'user-interruption' || !this.lastEffect) return null
    const effect = { ...this.lastEffect, loop: false }
    const behaviorId = trigger === 'surprise' ? 'surprised' : this.lastEffect.behaviorId
    const resolved = this.behaviorResolver.resolveAnimationTags(
      effect,
      [`reaction:${trigger}`],
      behaviorId,
      'reaction',
    )
    if (!resolved || resolved.loop) return null

    return this.playReactionWithReturn(effect, resolved, `semantic reaction:${trigger}`)
  }

  /** Executes one Main-selected idle activity gesture; semantics are never chosen here. */
  playIdleActivityGesture(intent: CharacterEmbodimentIntent): string | null {
    const hint = intent.gestureHint
    if (
      !hint ||
      !this.lastEffect ||
      this.stateMachine.getMode() !== 'idle' ||
      this.hasPreparedGesture() ||
      !this.vrmModel.isLoaded() ||
      !this.getEmbodimentAvailability().availableSemanticIntents.includes(hint)
    )
      return null
    const effect = { ...this.lastEffect, loop: false }
    const resolved = this.behaviorResolver.resolveEmbodimentIntent(
      effect,
      intent,
      'reaction',
      [],
      (id) => this.vrmModel.isConversationalMotionAvailable(id),
    )
    if (!resolved || resolved.loop || getMotionProfile(resolved.animationId)?.kind !== 'gesture')
      return null
    return this.playReactionWithReturn(effect, resolved, `idle activity:${hint}`)
  }

  private playReactionWithReturn(
    effect: AvatarStateEffect,
    resolved: AvatarBehaviorResolution,
    reason: string,
  ): string | null {
    const returnEffect = this.lastEffect
    const returnResolution = this.lastBehaviorResolution
    const decision = this.playback.requestResolvedBehavior({
      effect,
      resolved,
      source: 'state-effect',
      reason,
      frame: this.frame,
      interruptible: false,
    })
    if (decision.action !== 'play' && decision.action !== 'queue') return null
    if (returnEffect && returnResolution) {
      this.playback.requestResolvedBehavior({
        effect: returnEffect,
        resolved: returnResolution,
        source: 'queue',
        reason: `return after ${reason}`,
        frame: this.frame,
        interruptible: this.isInterruptible(returnResolution),
      })
    }
    return resolved.animationId
  }

  getLastEarImpulseDecision(): ReturnType<VrmModel['getLastEarImpulseDecision']> {
    return this.vrmModel.getLastEarImpulseDecision()
  }

  getSpeechPhraseSnapshot(): { phase: SpeechPhrasePhase; turnId: string | null } {
    return {
      phase: this.vrmModel.getSpeechPhrasePhase(),
      turnId: this.lipSync.getActiveSession()?.turnId ?? null,
    }
  }

  getSpeakingGestureSnapshot(): SpeakingGestureSchedulerDebugState {
    return this.speakingGestures.getDebugState()
  }

  isLoaded(): boolean {
    return this.vrmModel.isLoaded()
  }

  getMode(): AvatarMode {
    return this.stateMachine.getMode()
  }

  getDebugState(): AvatarControllerDebugState {
    return this.debugSnapshots.build({
      stateMachine: this.stateMachine,
      animations: this.animations,
      animationQueue: this.playback.getQueue(),
      behaviorEngine: this.lastBehaviorEngineDecision,
      behaviorResolver: this.behaviorResolver,
      lastBehaviorResolution: this.lastBehaviorResolution,
      lastTransitionDecision: this.playback.getLastTransitionDecision(),
      gestures: this.gestures,
      speakingGestures: this.speakingGestures,
      idleBehaviors: this.idleBehaviors,
      idleOrchestrator: this.idleOrchestrator,
      playbackRequests: this.playback.getPlaybackRequests(),
      vrmModel: this.vrmModel,
      mouthWeights: this.getMouthWeights(),
      behaviorTimeline: this.playback.getBehaviorTimeline(),
    })
  }

  /** Debug Preview only: production keeps every layer on the inactive probe. */
  setMotionAttenuationEnabled(enabled: boolean): void {
    if (enabled === (this.motionAttenuation !== null)) return
    this.motionAttenuation = enabled
      ? new MotionAttenuationAggregator({ now: () => performance.now() })
      : null
    const probe = this.motionAttenuation ?? NOOP_MOTION_ATTENUATION_PROBE
    this.vrmModel.setMotionAttenuationProbe(probe)
    this.lipSync.setAttenuationProbe(probe)
  }

  captureKeypose(
    side: 'left' | 'right',
    anchor: 'hips' | 'chest' | 'neck' | 'head',
  ): MotionKeypose | null {
    return this.vrmModel.captureKeypose(side, anchor)
  }

  getMotionAttenuation(): MotionAttenuationDebug | null {
    if (!this.motionAttenuation) return null
    return {
      ...this.motionAttenuation.snapshot(),
      filterLimits: this.vrmModel.isLoaded() ? this.vrmModel.getMotionFilterLimits() : null,
    }
  }

  previewMode(mode: DebugAvatarMode): void {
    this.setMode(mode)
  }

  /** Play a specific manifest animation directly (debug preview). */
  previewAnimation(id: string): void {
    this.releasePreparedGesture()
    this.processedIntentKey = this.conversationIntentKey()
    this.previewPlan = []
    const loop = getAnimation(id)?.loop ?? true
    this.playback.previewAnimation({
      animationId: id,
      loop,
      mode: this.lastEffect?.mode ?? 'idle',
      frame: this.frame,
    })
  }

  previewVariation(
    id: string,
    seed?: number,
    bodyAction?: import('../../shared/motion').BodyActionIntent,
  ): void {
    this.releasePreparedGesture()
    this.processedIntentKey = this.conversationIntentKey()
    this.previewPlan = []
    this.playback.previewAnimation({
      animationId: id,
      seed,
      bodyAction,
      loop: getAnimation(id)?.loop ?? false,
      mode: this.lastEffect?.mode ?? 'idle',
      frame: this.frame,
    })
  }

  getEmbodimentAvailability() {
    return this.vrmModel.getEmbodimentAvailability()
  }
  getMotionLibraryDebug() {
    return this.vrmModel.getMotionLibraryDebug()
  }
  recoverMotion(): void {
    this.preparedGesture = undefined
    this.processedIntentKey = this.conversationIntentKey()
    this.previewPlan = []
    this.vrmModel.recoverMotion()
  }

  setFlashMotionEnabled(enabled: boolean): void {
    this.vrmModel.setFlashMotionEnabled(enabled)
    if (!enabled) {
      this.preparedGesture = undefined
      this.previewPlan = []
      this.previewExecutionId = null
      this.processedIntentKey = this.conversationIntentKey()
      this.playback.reset()
    } else if (this.vrmModel.isLoaded() && this.lastEffect) {
      this.playResolvedBehavior(this.lastEffect, 'external', 'FlashMotion enabled', true)
    }
  }
  getHandBounds(side: 'left' | 'right'): THREE.Sphere | null {
    return previewHandBounds(this.vrmModel.vrm, side)
  }
  getAvatarFrontSign(): -1 | 1 {
    return this.vrmModel.vrm?.meta.metaVersion === '1' ? 1 : -1
  }
  previewSequence(ids: readonly string[]): void {
    if (ids.length < 3 || ids.length > 5 || ids.some((id) => !getAnimation(id))) return
    this.previewPreviousExecution = this.getMotionLibraryDebug().executionId
    this.previewExecutionId = null
    this.previewExpectedProfile = ids[0]
    this.previewAnimation(ids[0])
    this.previewPlan = ids.slice(1)
  }
  private advancePreviewSequence(): void {
    const debug = this.getMotionLibraryDebug()
    const applied = this.vrmModel.getBodyMotionDebugState().appliedPose
    const appliedGesture =
      getMotionProfile(debug.runningProfileId ?? '')?.kind !== 'gesture' ||
      (applied?.executionId === debug.executionId && applied?.phaseId === 'stroke')
    if (
      debug.executionId &&
      debug.executionId !== this.lastStartedExecutionId &&
      this.vrmModel.isAnimationPlaying() &&
      appliedGesture
    ) {
      this.lastStartedExecutionId = debug.executionId
      if (debug.runningProfileId)
        this.behaviorResolver.recordStarted(
          debug.runningProfileId as import('./animationManifest').AnimationId,
        )
    }
    if (!this.previewPlan.length) return
    if (this.playback.getCurrentContext()?.behaviorId !== 'debug-preview') {
      this.previewPlan = []
      return
    }
    if (!this.previewExecutionId) {
      if (
        debug.runningProfileId !== this.previewExpectedProfile ||
        debug.executionId === this.previewPreviousExecution
      )
        return
      this.previewExecutionId = debug.executionId
    }
    if (
      debug.executionId !== this.previewExecutionId ||
      debug.outcome === 'failed' ||
      debug.outcome === 'timed-out' ||
      debug.outcome === 'cancelled'
    ) {
      this.previewPlan = []
      return
    }
    if (debug.phase === 'hold' && getAnimation(debug.runningProfileId ?? '')?.loop)
      this.vrmModel.recoverMotion()
    if (debug.outcome !== 'completed' && debug.outcome !== 'superseded') return
    const remaining = [...this.previewPlan]
    const next = remaining.shift()
    if (!next) return
    this.previewPreviousExecution = debug.executionId
    this.previewExecutionId = null
    this.previewExpectedProfile = next
    this.previewAnimation(next)
    this.previewPlan = remaining
  }

  rerollAnimation(): void {
    this.releasePreparedGesture()
    this.processedIntentKey = this.conversationIntentKey()
    const current = this.playback.getCurrentContext()
    if (current?.behaviorId === 'debug-preview') {
      this.playback.previewAnimation({
        animationId: current.animationId,
        loop:
          this.playback.getQueue().getCurrent()?.loop ??
          getAnimation(current.animationId)?.loop ??
          true,
        mode: current.mode,
        frame: this.frame,
      })
      return
    }
    if (!this.lastEffect) return
    this.playResolvedBehavior(this.lastEffect, 'debug-reroll', 'manual reroll', true)
  }

  clearAnimationCooldowns(): void {
    this.behaviorResolver.clearCooldowns()
    if (!this.lastBehaviorResolution) return
    this.lastBehaviorResolution = {
      ...this.lastBehaviorResolution,
      activeCooldowns: [],
    }
  }

  setCameraMode(cameraMode: OverlayViewMode | undefined): void {
    this.vrmModel.setBodyCameraMode(cameraMode ?? 'full')
    this.behaviorResolver.setCameraMode(cameraMode)
  }
  setConversationView(config: ConversationViewConfig): void {
    this.vrmModel.setConversationView(config)
    if (config.overlayViewMode)
      this.behaviorResolver.setCameraMode(
        config.overlayViewMode === 'portrait'
          ? 'face'
          : config.overlayViewMode === 'face'
            ? 'face'
            : 'bust',
      )
  }

  setPcmClock(clock: PcmPlaybackClock | null): void {
    this.pcmClock = clock
    this.vrmModel.setPcmClock(clock)
    if (
      clock?.state === 'cancelled' &&
      clock.turnId === this.requestedMotionTurnId &&
      this.requestedMotionActive()
    )
      this.stopAnimation()
  }

  clearAnimationQueue(): void {
    this.playback.clearPending()
  }

  setIdleOrchestratorPaused(paused: boolean): void {
    this.idleOrchestrator.setPaused(paused)
  }

  previewGreeting(): void {
    this.applyStateEffect(this.stateMachine.previewGreeting())
  }

  previewBlink(): void {
    this.vrmModel.forceBlink()
  }

  testTransition(
    kind:
      | 'idle-to-idle'
      | 'idle-to-speaking'
      | 'speaking-to-idle'
      | 'thinking-to-idle'
      | 'greeting-to-idle',
  ): void {
    switch (kind) {
      case 'idle-to-idle':
        this.applyStateEffect(this.stateMachine.setMode('idle'))
        this.playResolvedBehavior(
          this.stateMachine.getIdleEffect(),
          'idle-orchestrator',
          'debug transition idle-to-idle',
          true,
        )
        return
      case 'idle-to-speaking':
        this.applyStateEffect(this.stateMachine.setMode('idle'))
        this.showSpeaking('happy')
        return
      case 'speaking-to-idle':
        this.showSpeaking('happy')
        this.stopSpeaking()
        return
      case 'thinking-to-idle':
        this.setMode('thinking')
        this.setMode('idle')
        return
      case 'greeting-to-idle':
        this.previewGreeting()
        this.setMode('idle')
        return
    }
  }

  queueTestSequence(): void {
    const idleEffect = this.stateMachine.getIdleEffect()
    this.applyStateEffect(this.stateMachine.previewGreeting())
    const behaviorDecision = this.behaviorEngine.decide(idleEffect)
    this.lastBehaviorEngineDecision = behaviorDecision
    this.playResolvedBehavior(
      { ...idleEffect, behaviorId: behaviorDecision.intent },
      'idle-orchestrator',
      'queue test sequence',
    )
    this.playResolvedBehavior(
      { ...idleEffect, behaviorId: behaviorDecision.intent },
      'idle-orchestrator',
      'queue test sequence duplicate',
    )
  }

  setLookAtTarget(target: THREE.Object3D | null): boolean {
    return this.vrmModel.setLookAtTarget(target)
  }

  setEarAxisOverride(axis: EarAxisOverride): void {
    this.vrmModel.setEarAxisOverride(axis)
  }

  setEarAmplitudeScale(scale: number): void {
    this.vrmModel.setEarAmplitudeScale(scale)
  }

  private applyStateEffect(
    effect: AvatarStateEffect,
    vrmEmotion?: string,
    lipSyncStart?: LipSyncStartRequest,
    state?: CharacterState,
    source: AvatarPlaybackRequestSource = 'state-effect',
    reason = 'state effect',
    stopLipSyncTurnId?: string,
    continuingSpeech = false,
  ): void {
    this.thinkingPresentationDue = null
    this.updateConversationPerformance(effect.mode)
    this.stateEffects.apply({
      effect,
      vrmEmotion,
      lipSyncStart,
      stopLipSyncTurnId,
      state,
      gazeHint: this.resolveGaze(effect.mode),
    })
    if (this.requestedMotionActive()) {
      this.lastEffect = effect
      return
    }

    if (effect.mode === 'speaking') {
      this.lastEffect = effect
      if (continuingSpeech) {
        this.speakingGestures.beginSegment(resolveEmotionEmbodimentProfile(effect.emotionKey).id)
        return
      }
      const decision = this.speakingGestures.begin(effect, state)
      const prepared = this.preparedGesture
      if (
        prepared &&
        this.hasPreparedGesture() &&
        this.playback.adoptPreparedSpeaking(prepared.playback, this.frame)
      ) {
        this.preparedGesture = undefined
        this.lastBehaviorResolution = prepared.resolved
        this.speakingGestures.recordSelection({
          animationId: prepared.resolved.animationId,
          behaviorId: prepared.resolved.behaviorId,
          skippedCandidates: [],
          selectionReason: 'adopt prepared semantic gesture',
          phase: 'opening',
        })
        return
      }
      this.releasePreparedGesture()
      this.playSpeakingGestureDecision(
        { ...effect, behaviorId: decision.behaviorId },
        state,
        decision,
        'speech start',
      )
      return
    }

    this.speakingGestures.end()
    if (effect.mode === 'awaitingSpeech' || effect.mode === 'thinking') {
      this.prepareConversationGesture()
      if (this.hasPreparedGesture()) {
        this.lastEffect = effect
        this.idleOrchestrator.leaveIdle()
        return
      }
    } else {
      this.releasePreparedGesture()
      this.processedIntentKey = this.conversationIntentKey()
    }
    this.gestures.schedule(effect)
    const behaviorDecision = this.behaviorEngine.decide(effect, state)
    this.lastBehaviorEngineDecision = behaviorDecision
    this.playResolvedBehavior({ ...effect, behaviorId: behaviorDecision.intent }, source, reason)
  }

  private playResolvedBehavior(
    effect: AvatarStateEffect,
    source: AvatarPlaybackRequestSource,
    reason: string,
    forceReplay = false,
    preResolved?: AvatarBehaviorResolution,
    idleStage: IdleOrchestratorDebugState['idleStage'] = 'normal-idle',
  ): void {
    this.lastEffect = effect
    const resolved = preResolved ?? this.behaviorResolver.resolve(effect)
    this.lastBehaviorResolution = resolved
    if (!forceReplay && this.playback.shouldHoldSpeakingBehavior(effect, resolved)) {
      this.playback.recordRejectedResolvedBehavior({
        effect,
        resolved,
        source,
        reason: `${reason}; held during active speech`,
        frame: this.frame,
        rejectionReason: 'speaking semantic behavior unchanged',
      })
      return
    }
    if (effect.mode === 'idle') {
      this.idleOrchestrator.recordTransition(resolved, idleStage)
    } else {
      this.idleOrchestrator.leaveIdle()
    }
    this.playback.requestResolvedBehavior({
      effect,
      resolved,
      source,
      reason,
      frame: this.frame,
      forceReplay,
      interruptible: this.isInterruptible(resolved),
    })
    if (source !== 'idle-orchestrator' && effect.mode === 'idle') this.idleOrchestrator.enterIdle()
  }

  private updateSpeakingGestureSession(state?: CharacterState): void {
    if (this.requestedMotionActive()) return
    if (this.stateMachine.getMode() !== 'speaking' || this.lastEffect?.mode !== 'speaking') return
    const clock = this.pcmClock
    if (clock?.state !== 'playing') return
    if (clock.playbackId !== this.scheduledPlaybackId) {
      this.scheduledPlaybackId = clock.playbackId
      this.scheduledPcmOffset = clock.sourceSampleOffset
    }
    const offset = clock.sourceSampleOffset
    const consumedDelta = Math.max(0, offset - this.scheduledPcmOffset) / clock.sourceSampleRate
    this.scheduledPcmOffset = offset
    if (this.canAdmitLateGesture(state)) {
      this.playSpeakingGestureDecision(
        this.lastEffect,
        state,
        {
          shouldRequest: true,
          phase: 'holding',
          behaviorId: this.lastEffect.behaviorId,
          reason: 'fresh late proposal at an interruptible body boundary',
        },
        'late semantic gesture',
      )
      return
    }
    if (this.vrmModel.supportsContextualMotion()) return
    const decision = this.speakingGestures.update(consumedDelta, this.lastEffect, state)
    if (!decision?.shouldRequest) return
    this.playSpeakingGestureDecision(
      { ...this.lastEffect, behaviorId: decision.behaviorId },
      state,
      decision,
      'scheduled speaking gesture',
    )
  }

  private requestedMotionActive(): boolean {
    return this.playback.getCurrentContext()?.behaviorId === 'requested-motion'
  }

  private playSpeakingGestureDecision(
    effect: AvatarStateEffect,
    state: CharacterState | undefined,
    decision: SpeakingGestureDecision,
    reason: string,
  ): void {
    const excluded = this.speakingGestures.getExcludedAnimationIds()
    const embodimentIntent = this.effectiveEmbodimentIntent()
    const contextual = this.vrmModel.supportsContextualMotion()
    const intentResolution =
      ((decision.phase === 'opening' && this.intentContext?.eligibility !== 'future-only') ||
        (decision.phase !== 'opening' && this.canAdmitLateGesture(state))) &&
      (!this.intentContext || this.conversationIntentKey() !== this.processedIntentKey) &&
      embodimentIntent?.gestureHint
        ? this.resolveConversationGesture(effect, excluded)
        : null
    const resolved =
      intentResolution ??
      (contextual
        ? this.behaviorResolver.resolveSpeakingPresence(effect)
        : this.resolveScheduledSpeakingBehavior(effect, decision, excluded, embodimentIntent))
    if (!resolved) {
      this.playback.recordPlaybackOnly({
        animationId: 'none',
        behaviorId: decision.behaviorId,
        source: 'speaking-gesture-scheduler',
        reason: `${reason}; ${decision.reason}; no compatible reaction candidate`,
        accepted: false,
        decision: 'ignored',
        rejectionReason: 'no compatible manifest reaction candidate',
        frame: this.frame,
      })
      return
    }
    const skippedCandidates = resolved.candidates
      .filter(
        (candidate) =>
          candidate.excludedByCooldown ||
          candidate.excludedByUsage ||
          excluded.includes(candidate.animationId),
      )
      .map((candidate) => {
        const why = excluded.includes(candidate.animationId)
          ? 'previous'
          : candidate.excludedByUsage
            ? 'usage'
            : 'cooldown'
        return `${candidate.animationId}:${why}`
      })

    this.lastEffect = effect
    this.lastBehaviorResolution = resolved
    this.lastBehaviorEngineDecision = this.behaviorEngine.decide(effect, state)
    this.idleOrchestrator.leaveIdle()

    const duplicate = this.playback.getCurrentContext()?.animationId === resolved.animationId
    if (duplicate) {
      const requestReason = `${reason}; ${decision.reason}; ${resolved.selectionReason}; skipped duplicate speaking gesture`
      this.playback.recordDuplicateImmediate({
        effect,
        resolved,
        source: 'speaking-gesture-scheduler',
        reason: requestReason,
        frame: this.frame,
      })
      return
    }

    const item: AvatarAnimationQueueItem = {
      id: 0,
      animationId: resolved.animationId,
      behaviorId: resolved.behaviorId,
      mode: effect.mode,
      loop: resolved.loop,
      motionLayer: resolved.motionLayer,
      enqueueTime: Date.now(),
      interruptible: false,
    }
    const requestReason = `${reason}; ${decision.reason}; phase:${decision.phase}; ${resolved.selectionReason}`
    this.playback.playResolvedImmediately({
      effect,
      resolved,
      item,
      source: 'speaking-gesture-scheduler',
      reason: requestReason,
      frame: this.frame,
      blendDurationOverride: speakingGestureTuning.blendDuration,
    })
    this.speakingGestures.recordSelection({
      animationId: resolved.animationId,
      behaviorId: resolved.behaviorId,
      skippedCandidates,
      selectionReason: resolved.selectionReason,
      phase: decision.phase,
    })
  }

  private resolveScheduledSpeakingBehavior(
    effect: AvatarStateEffect,
    decision: SpeakingGestureDecision,
    excluded: readonly string[],
    intent: CharacterEmbodimentIntent | undefined,
  ): AvatarBehaviorResolution | null {
    if (intent?.gestureHint && decision.phase === 'opening')
      return this.behaviorResolver.resolveBehaviorTag(
        effect,
        'behavior:neutral',
        'neutral',
        excluded,
      )
    const embodiment = resolveEmotionEmbodimentProfile(effect.emotionKey)
    return (
      this.behaviorResolver.resolveAnimationTags(
        effect,
        embodiment.animationTags,
        decision.behaviorId,
        decision.phase === 'emphasis' ? 'reaction' : 'speaking',
        excluded,
      ) ??
      (decision.phase === 'emphasis'
        ? null
        : this.behaviorResolver.resolveBehaviorTag(
            effect,
            `behavior:${decision.behaviorId}`,
            decision.behaviorId,
            excluded,
          ))
    )
  }

  private effectiveEmbodimentIntent(): CharacterEmbodimentIntent | undefined {
    if (
      this.intentContext &&
      Date.now() - this.intentContext.receivedAt > EMBODIMENT_PROPOSAL_TTL_MS
    )
      return this.behaviorEmbodimentIntent
    return this.conversationEmbodimentIntent ?? this.behaviorEmbodimentIntent
  }

  private conversationIntentKey(): string | undefined {
    const context = this.intentContext
    return context
      ? `${context.turnId}|${context.receivedAt}|${JSON.stringify(this.conversationEmbodimentIntent)}`
      : undefined
  }

  private resolveConversationGesture(
    effect: AvatarStateEffect,
    excluded: readonly string[] = [],
  ): AvatarBehaviorResolution | null {
    const intent = this.effectiveEmbodimentIntent()
    if (
      (this.intentContext &&
        Date.now() - this.intentContext.receivedAt > EMBODIMENT_PROPOSAL_TTL_MS) ||
      intent?.performance ||
      !intent?.gestureHint ||
      !this.vrmModel.isLoaded() ||
      !this.getEmbodimentAvailability().availableSemanticIntents.includes(intent.gestureHint)
    )
      return null
    const resolved = this.behaviorResolver.resolveEmbodimentIntent(
      effect,
      intent,
      'speaking',
      excluded,
      (id) => this.vrmModel.isConversationalMotionAvailable(id),
    )
    if (!resolved || getMotionProfile(resolved.animationId)?.kind !== 'gesture') return null
    this.processedIntentKey = this.conversationIntentKey()
    return resolved
  }

  private prepareConversationGesture(): void {
    if (
      this.hasPreparedGesture() ||
      this.intentContext?.eligibility !== 'opening' ||
      this.stateMachine.getMode() === 'speaking' ||
      this.playback.getCurrentContext()?.behaviorId === 'debug-preview'
    )
      return
    const key = this.conversationIntentKey()
    if (!key || key === this.processedIntentKey) return
    const effect = this.speakingGestureEffect()
    const resolved = this.resolveConversationGesture(effect)
    if (!resolved) return
    this.idleOrchestrator.leaveIdle()
    this.playback.playResolvedImmediately({
      effect: { ...effect, mode: 'awaitingSpeech' },
      resolved,
      item: {
        id: 0,
        animationId: resolved.animationId,
        behaviorId: resolved.behaviorId,
        mode: 'awaitingSpeech',
        loop: resolved.loop,
        motionLayer: resolved.motionLayer,
        enqueueTime: Date.now(),
        interruptible: false,
      },
      source: 'speaking-gesture-scheduler',
      reason: 'early speech-bound semantic preparation',
      frame: this.frame,
    })
    const playback = this.playback.getCurrentContext()
    if (playback) this.preparedGesture = { key, resolved, playback }
  }

  private speakingGestureEffect(): AvatarStateEffect {
    return {
      mode: 'speaking',
      proceduralMode: 'speaking',
      emotionKey: this.stateMachine.getEmotion(),
      behaviorId: 'neutral',
      loop: false,
    }
  }

  private hasPreparedGesture(): boolean {
    if (!this.preparedGesture) return false
    const animation = this.animations.getDebugState()
    return (
      !!this.preparedGesture &&
      this.preparedGesture.key === this.conversationIntentKey() &&
      !!this.intentContext &&
      Date.now() - this.intentContext.receivedAt <= EMBODIMENT_PROPOSAL_TTL_MS &&
      !!this.conversationEmbodimentIntent?.gestureHint &&
      this.playback.getCurrentContext() === this.preparedGesture.playback &&
      animation.activeAnimationId === this.preparedGesture.resolved.animationId &&
      animation.playbackStatus !== 'failed' &&
      (animation.playbackStatus === 'loading' || animation.isPlaybackActive)
    )
  }

  private releasePreparedGesture(): void {
    if (
      this.preparedGesture &&
      this.playback.getCurrentContext() === this.preparedGesture.playback
    ) {
      this.vrmModel.releaseSpeechPreparation(this.preparedGesture.resolved.animationId)
      this.playback.reset()
    }
    this.preparedGesture = undefined
  }

  private canAdmitLateGesture(state?: CharacterState): boolean {
    const context = this.intentContext
    const clock = this.pcmClock
    const intent = this.effectiveEmbodimentIntent()
    const hint = intent?.gestureHint
    if (
      context?.eligibility !== 'future-only' ||
      this.conversationIntentKey() === this.processedIntentKey ||
      intent?.performance ||
      !hint ||
      !this.getEmbodimentAvailability().availableSemanticIntents.includes(hint) ||
      clock?.state !== 'playing' ||
      clock.sourceSampleOffset <= 0 ||
      clock.turnId !== context.turnId ||
      this.lipSync.getActiveSession()?.turnId !== context.turnId ||
      state?.conversationPresence.responsePhase === 'finishingSpeech' ||
      this.playback.getCurrentContext()?.behaviorId === 'debug-preview'
    )
      return false
    const body = this.getMotionLibraryDebug()
    const profile = getMotionProfile(body.runningProfileId ?? '')
    return (
      body.outcome === 'completed' ||
      body.outcome === 'superseded' ||
      (body.outcome === null &&
        body.phase === 'hold' &&
        (profile?.kind === 'presence' ||
          !!profile?.interruptionPolicy.interruptiblePhases.includes('hold')))
    )
  }

  private applyCurrentGaze(): void {
    const mode = this.stateMachine.getMode()
    this.stateEffects.applyGaze(mode, this.lastCharacterState, this.resolveGaze(mode))
  }

  private resolveGaze(mode: AvatarMode): EmbodimentGazeHint | undefined {
    return this.gaze.resolve(
      mode,
      this.pauseGaze,
      !this.conversationEmbodimentIntent?.performance ||
        this.activeConversationPerformance !== undefined,
    )
  }

  private updateConversationPerformance(mode: AvatarMode): boolean {
    const context = this.intentContext
    const clock = this.pcmClock
    const duringReply = mode === 'speaking' || mode === 'thinking' || mode === 'awaitingSpeech'
    const performance =
      duringReply &&
      context &&
      (clock?.state === 'playing'
        ? clock.turnId === context.turnId
        : Date.now() - context.receivedAt <= EMBODIMENT_PROPOSAL_TTL_MS)
        ? this.conversationEmbodimentIntent?.performance
        : undefined
    const performanceChanged = performance !== this.activeConversationPerformance
    if (performanceChanged) {
      this.activeConversationPerformance = performance
      this.vrmModel.setConversationPerformance(performance)
    }
    const gaze =
      mode !== 'speaking' || this.vrmModel.isSpeechPause() ? performance?.pauseGaze : undefined
    const changed = gaze !== this.pauseGaze
    this.pauseGaze = gaze
    return changed || performanceChanged
  }

  private advanceAnimationQueue(): void {
    this.playback.advanceQueue(this.frame)
  }

  private isInterruptible(resolved: AvatarBehaviorResolution): boolean {
    return getAnimation(resolved.animationId)?.interruptible ?? false
  }
}
