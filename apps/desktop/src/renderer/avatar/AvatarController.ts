import type * as THREE from 'three'

import type { CharacterState } from '../../shared/runtime'
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
import type { EarAxisOverride, EarImpulse } from './embodiment/secondary-motion/EarBehaviorRuntime'
import { LipSync, type LipSyncStartRequest, type MouthWeights } from './embodiment/speech/LipSync'
import type { SpeechPhrasePhase } from './embodiment/speech/PhraseEnvelopeController'
import { OverlayAnimationPolicy } from './OverlayAnimationPolicy'
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
  private stateEffects = new AvatarStateEffectApplier(this.vrmModel, this.lipSync)
  private stateMachine = new AvatarStateMachine()
  private lastEffect: AvatarStateEffect | null = null
  private lastBehaviorEngineDecision: AvatarBehaviorEngineDecision | null = null
  private lastBehaviorResolution: AvatarBehaviorResolution | null = null
  private externalMouthWeights: MouthWeights | null = null
  private frame = 0
  private lastCharacterStateKey: string | null = null
  private overlayAnimationPolicy: OverlayAnimationPolicy | null = null

  constructor(options: { overlayMode?: boolean } = {}) {
    this.overlayAnimationPolicy = options.overlayMode ? new OverlayAnimationPolicy() : null
  }

  update(delta: number, state?: CharacterState): void {
    this.frame += 1
    const mode = this.stateMachine.getMode()
    this.idleBehaviors.update(delta, mode)
    this.advanceAnimationQueue()
    this.updateSpeakingGestureSession(delta, state)
    if (this.idleOrchestrator.update(delta, mode)) {
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
          [
            ...(lastExtendedIdle ? [lastExtendedIdle] : []),
            ...this.getOverlayExcludedAnimationIds(idleEffect),
          ],
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
    const earMode = toProceduralMode(state?.mode ?? mode)
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
    this.vrmModel.update(delta)
  }

  async loadVrm(scene: THREE.Scene, buffer: ArrayBuffer): Promise<void> {
    // A replacement model must not inherit the previous skeleton's queue or
    // active-animation identity; otherwise the initial idle may be rejected as
    // a duplicate even though the new skeleton has no body action yet.
    this.stopAnimation()
    await this.vrmModel.load(scene, buffer)
    this.vrmModel.setSceneVisible(false)
    try {
      this.setMode('idle')
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

  async loadAnimation(buffer: ArrayBuffer, loop = true): Promise<void> {
    await this.animations.loadExternal(buffer, loop)
  }

  stopAnimation(): void {
    this.gestures.reset()
    this.speakingGestures.reset()
    this.idleBehaviors.reset()
    this.idleOrchestrator.reset()
    this.playback.reset()
    this.animations.stop()
  }

  setMode(mode: AvatarMode): void {
    this.applyStateEffect(this.stateMachine.setMode(mode))
  }

  applyCharacterState(
    state: CharacterState,
    options: { lipSyncStart?: LipSyncStartRequest; stopLipSyncTurnId?: string } = {},
  ): void {
    const mode = toAvatarMode(state.mode)
    const emotionKey = state.emotion || state.avatar.expression || 'neutral'
    const vrmEmotion = state.avatar.vrmExpression
    const semanticKey = `${mode}|${emotionKey}|${vrmEmotion ?? ''}|${options.lipSyncStart?.session.playbackId ?? ''}`

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
    if (effect) this.applyStateEffect(effect, vrmEmotion)
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
    this.applyStateEffect(effect, vrmEmotion, undefined, state, 'character-state', 'show speaking')
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
    return this.lipSync.detach(turnId, false, true)
  }

  triggerUserInterruption(): boolean {
    const earTriggered = this.triggerEarImpulse('user-interruption')
    const headTriggered = this.vrmModel.triggerHeadAttentionImpulse('user-interruption')
    return earTriggered || headTriggered
  }

  triggerEarImpulse(impulse: EarImpulse, identity?: string): boolean {
    return this.vrmModel.triggerEarImpulse(impulse, identity)
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

    const returnEffect = this.lastEffect
    const returnResolution = this.lastBehaviorResolution
    const decision = this.playback.requestResolvedBehavior({
      effect,
      resolved,
      source: 'state-effect',
      reason: `semantic reaction:${trigger}`,
      frame: this.frame,
      interruptible: false,
    })
    if (decision.action !== 'play' && decision.action !== 'queue') return null
    if (returnResolution) {
      this.playback.requestResolvedBehavior({
        effect: returnEffect,
        resolved: returnResolution,
        source: 'queue',
        reason: `return after semantic reaction:${trigger}`,
        frame: this.frame,
        interruptible: this.isInterruptible(returnEffect, returnResolution),
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

  previewMode(mode: DebugAvatarMode): void {
    this.setMode(mode)
  }

  /** Play a specific manifest animation directly (debug preview). */
  previewAnimation(id: string): void {
    const loop = getAnimation(id)?.loop ?? true
    this.playback.previewAnimation({
      animationId: id,
      loop,
      mode: this.lastEffect?.mode ?? 'idle',
      frame: this.frame,
    })
  }

  rerollAnimation(): void {
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
    this.behaviorResolver.setCameraMode(cameraMode)
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
    this.stateEffects.apply({ effect, vrmEmotion, lipSyncStart, stopLipSyncTurnId, state })

    if (effect.mode === 'speaking') {
      if (continuingSpeech) {
        this.speakingGestures.beginSegment(resolveEmotionEmbodimentProfile(effect.emotionKey).id)
        return
      }
      const decision = this.speakingGestures.begin(effect, state)
      this.playSpeakingGestureDecision(
        { ...effect, behaviorId: decision.behaviorId },
        state,
        decision,
        'speech start',
      )
      return
    }

    this.speakingGestures.end()
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
    const resolved =
      preResolved ??
      this.behaviorResolver.resolve(effect, this.getOverlayExcludedAnimationIds(effect))
    this.lastBehaviorResolution = resolved
    if (this.playback.shouldHoldSpeakingBehavior(effect, resolved)) {
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
      interruptible: this.isInterruptible(effect, resolved),
    })
    if (source !== 'idle-orchestrator' && effect.mode === 'idle') this.idleOrchestrator.enterIdle()
  }

  private updateSpeakingGestureSession(delta: number, state?: CharacterState): void {
    if (this.stateMachine.getMode() !== 'speaking' || this.lastEffect?.mode !== 'speaking') return
    const decision = this.speakingGestures.update(delta, this.lastEffect, state)
    if (!decision?.shouldRequest) return
    this.playSpeakingGestureDecision(
      { ...this.lastEffect, behaviorId: decision.behaviorId },
      state,
      decision,
      'scheduled speaking gesture',
    )
  }

  private playSpeakingGestureDecision(
    effect: AvatarStateEffect,
    state: CharacterState | undefined,
    decision: SpeakingGestureDecision,
    reason: string,
  ): void {
    const excluded = [
      ...this.speakingGestures.getExcludedAnimationIds(),
      ...this.getOverlayExcludedAnimationIds(effect),
    ]
    const embodiment = resolveEmotionEmbodimentProfile(effect.emotionKey)
    const resolved =
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
        const why = this.getOverlayExcludedAnimationIds(effect).includes(candidate.animationId)
          ? 'overlay-policy'
          : excluded.includes(candidate.animationId)
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

  private advanceAnimationQueue(): void {
    this.playback.advanceQueue(this.frame)
  }

  private isInterruptible(effect: AvatarStateEffect, resolved: AvatarBehaviorResolution): boolean {
    return effect.mode === 'idle' || resolved.behaviorId === 'greeting'
  }

  private getOverlayExcludedAnimationIds(effect: AvatarStateEffect): string[] {
    return this.overlayAnimationPolicy?.getExcludedAnimationIds(effect) ?? []
  }
}
