import type * as THREE from 'three'
import { AvatarController, type AvatarBehaviorTransitionLogEntry } from '../avatar/AvatarController'
import type { AvatarMode } from '../avatar/AvatarController'
import type { DebugAvatarMode } from '../avatar/avatarAnimations'
import type { AnimationControllerDebugState, AnimationPlaybackStatus } from '../avatar/AvatarAnimationController'
import type { AnimationCooldownState } from '../avatar/AvatarAnimationCooldownManager'
import type { AvatarAnimationQueueDebugState } from '../avatar/AvatarAnimationQueue'
import type { AvatarBehaviorEngineDecision } from '../avatar/AvatarBehaviorEngine'
import type { AvatarBehaviorCandidate } from '../avatar/AvatarBehaviorResolver'
import type { IdleOrchestratorDebugState } from '../avatar/AvatarIdleOrchestrator'
import type { AvatarPlaybackRequestDebugState } from '../avatar/AvatarPlaybackRequestLog'
import type { SpeakingGestureSchedulerDebugState } from '../avatar/AvatarSpeakingGestureScheduler'
import type { FacialDebugState } from '../three/AvatarExpressionMixer'
import type { VrmBodyActionDebugState, VrmPerformanceDebugState } from '../three/VrmModel'
import type { LookAtDebugState } from '../three/LookAtRuntime'
import type { HeadMotionDebugState } from '../three/HeadMotionRuntime'
import type { EarBehaviorDebugState, EarAxisOverride } from '../three/EarBehaviorRuntime'
import type { CharacterAvatarState, CharacterState } from '../../shared/runtime/characterState'
import type { EventBus, RuntimeEventCategory, RuntimeEventType } from '../../shared/runtime/events'
import type { LipSyncSession, MouthWeights } from '../three/LipSync'
import type { OverlayViewMode } from '../three/avatarTuning'

export type { AvatarMode }

export interface AvatarRuntimeDebugState {
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

export type AvatarRuntimeMirrorState = Partial<Omit<CharacterAvatarState, 'mode' | 'expression' | 'vrmExpression'>>

export class AvatarRuntime {
  private controller: AvatarController

  constructor(private readonly events: EventBus, options: { overlayMode?: boolean } = {}) {
    this.controller = new AvatarController(options)
  }

  update(delta: number, state?: CharacterState): void {
    this.controller.update(delta, state)
  }

  async loadVrm(scene: THREE.Scene, buffer: ArrayBuffer): Promise<void> {
    await this.controller.loadVrm(scene, buffer)
    this.publishAvatarEvent('RuntimeInitialized', 'VRM Loaded')
  }

  async loadAnimation(buffer: ArrayBuffer, loop = true): Promise<void> {
    await this.controller.loadAnimation(buffer, loop)
    this.publishAvatarEvent('RuntimeDebugEvent', loop ? 'Animation Loaded: loop' : 'Animation Loaded')
  }

  stopAnimation(): void {
    const previous = this.controller.getDebugState()
    this.controller.stopAnimation()
    if (previous.currentGesture !== 'none') this.publishAvatarEvent('GestureFinished', previous.currentGesture)
    if (previous.currentBodyAnimation !== 'none') this.publishAvatarEvent('AnimationFinished', previous.currentBodyAnimation)
  }

  applyCharacterState(
    state: CharacterState,
    options: { lipSyncSession?: LipSyncSession; stopLipSyncTurnId?: string } = {}
  ): void {
    const previous = this.controller.getDebugState()
    this.controller.applyCharacterState(state, options)
    this.publishAvatarChanges(previous)
  }

  getMirrorState(): AvatarRuntimeMirrorState {
    return {
      loaded: this.controller.isLoaded(),
      lipsync: this.controller.getMouthWeights()
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
    this.publishAvatarEvent('RuntimeDebugEvent', paused ? 'Idle Orchestrator Paused' : 'Idle Orchestrator Resumed')
  }

  testTransition(kind: 'idle-to-idle' | 'idle-to-speaking' | 'speaking-to-idle' | 'thinking-to-idle' | 'greeting-to-idle'): void {
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

  setPassiveCompanionMode(enabled: boolean): void {
    this.controller.setPassiveCompanionMode(enabled)
    this.publishAvatarEvent('RuntimeDebugEvent', enabled ? 'Passive Companion Mode: on' : 'Passive Companion Mode: off')
  }

  private publishAvatarChanges(previous: AvatarRuntimeDebugState): void {
    const current = this.controller.getDebugState()
    if (current.currentGesture !== previous.currentGesture && current.currentGesture !== 'none') {
      this.publishAvatarEvent('GestureStarted', current.currentGesture)
    }
    if (current.currentBodyAnimation !== previous.currentBodyAnimation && current.currentBodyAnimation !== 'none') {
      this.publishAvatarEvent('AnimationStarted', current.currentBodyAnimation)
    }
  }

  private publishAvatarEvent(type: RuntimeEventType, detail?: string): void {
    this.events.publish({
      type,
      category: this.categoryFor(type),
      source: 'renderer.avatarRuntime',
      detail
    })
  }

  private categoryFor(type: RuntimeEventType): RuntimeEventCategory {
    return type === 'RuntimeDebugEvent' ? 'system' : 'avatar'
  }
}
