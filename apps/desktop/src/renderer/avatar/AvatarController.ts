import type * as THREE from 'three'

import type { CharacterState } from '../../shared/runtime/characterState'
import type { OverlayViewMode } from '../three/avatarTuning'
import { speakingGestureTuning } from '../three/avatarTuning'
import type { EarAxisOverride } from '../three/EarBehaviorRuntime'
import { LipSync, type LipSyncSession, type MouthWeights } from '../three/LipSync'
import { VrmModel } from '../three/VrmModel'
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
} from './AvatarSpeakingGestureScheduler'
import { AvatarStateEffectApplier } from './AvatarStateEffectApplier'
import { type AvatarMode, type AvatarStateEffect, AvatarStateMachine } from './AvatarStateMachine'
import { getAnimation } from './animationManifest'
import type { DebugAvatarMode } from './avatarAnimations'
import { OverlayAnimationPolicy } from './OverlayAnimationPolicy'

export type { AvatarMode } from './AvatarStateMachine'
export type { AvatarBehaviorTransitionLogEntry }

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

    if (this.externalMouthWeights) this.vrmModel.setMouthWeights(this.externalMouthWeights)
    this.vrmModel.update(delta)
    if (!this.externalMouthWeights) this.lipSync.update(delta)
  }

  async loadVrm(scene: THREE.Scene, buffer: ArrayBuffer): Promise<void> {
    await this.vrmModel.load(scene, buffer)
    this.setMode('idle')
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

  setPassiveCompanionMode(enabled: boolean): void {
    this.idleBehaviors.setPassiveCompanionMode(enabled)
  }

  setMode(mode: AvatarMode): void {
    this.applyStateEffect(this.stateMachine.setMode(mode))
  }

  applyCharacterState(
    state: CharacterState,
    options: { lipSyncSession?: LipSyncSession; stopLipSyncTurnId?: string } = {},
  ): void {
    const mode = toAvatarMode(state.mode)
    const emotionKey = state.emotion || state.avatar.expression || 'neutral'
    const vrmEmotion = state.avatar.vrmExpression
    const semanticKey = `${mode}|${emotionKey}|${vrmEmotion ?? ''}|${options.lipSyncSession?.playbackId ?? ''}`

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
      if (options.lipSyncSession)
        this.startSpeaking(options.lipSyncSession, emotionKey, vrmEmotion, state)
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
    session: LipSyncSession,
    emotionKey?: string,
    vrmEmotion?: string,
    state?: CharacterState,
  ): void {
    const effect = this.stateMachine.startSpeaking(emotionKey)
    this.applyStateEffect(effect, vrmEmotion, session, state, 'character-state', 'start speaking')
  }

  showSpeaking(emotionKey?: string, vrmEmotion?: string, state?: CharacterState): void {
    const effect = this.stateMachine.startSpeaking(emotionKey)
    this.applyStateEffect(effect, vrmEmotion, undefined, state, 'character-state', 'show speaking')
  }

  getMouthWeights(): MouthWeights {
    if (this.externalMouthWeights) return { ...this.externalMouthWeights }
    return this.lipSync.getMouthWeights()
  }

  setMouthWeights(weights: Partial<MouthWeights>): void {
    this.externalMouthWeights = {
      aa: weights.aa ?? 0,
      ih: weights.ih ?? 0,
      ou: weights.ou ?? 0,
      ee: weights.ee ?? 0,
      oh: weights.oh ?? 0,
    }
    this.vrmModel.setMouthWeights(this.externalMouthWeights)
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
    return this.lipSync.detach(turnId, true)
  }

  interruptLipSync(turnId: string): boolean {
    return this.lipSync.detach(turnId)
  }

  triggerUserInterruption(): boolean {
    const earTriggered = this.vrmModel.triggerEarImpulse('user-interruption')
    const headTriggered = this.vrmModel.triggerHeadAttentionImpulse('user-interruption')
    return earTriggered || headTriggered
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
    lipSyncSession?: LipSyncSession,
    state?: CharacterState,
    source: AvatarPlaybackRequestSource = 'state-effect',
    reason = 'state effect',
    stopLipSyncTurnId?: string,
  ): void {
    this.stateEffects.apply({ effect, vrmEmotion, lipSyncSession, stopLipSyncTurnId, state })

    if (effect.mode === 'speaking') {
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
    const resolved = this.behaviorResolver.resolveBehaviorTag(
      effect,
      `behavior:${decision.behaviorId}`,
      decision.behaviorId,
      excluded,
    )
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
