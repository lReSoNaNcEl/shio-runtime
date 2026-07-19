import type { VRM } from '@pixiv/three-vrm'
import type * as THREE from 'three'

import { AvatarFacialRuntime } from '../../embodiment/AvatarFacialRuntime'
import type { FacialDebugState } from '../../embodiment/facial/FacialDebugTypes'
import type { MouthWeights } from '../../embodiment/facial/FacialProfile'
import type {
  HeadAttentionImpulse,
  HeadMotionDebugState,
  HeadMotionProfile,
} from '../../embodiment/gaze/HeadMotionRuntime'
import type { LookAtDebugState, LookAtMode } from '../../embodiment/gaze/LookAtRuntime'
import type {
  EarAxisOverride,
  EarBehaviorDebugState,
  EarImpulse,
} from '../../embodiment/secondary-motion/EarBehaviorRuntime'
import type { SpeechPhrasePhase } from '../../embodiment/speech/PhraseEnvelopeController'
import type { SpeechPhraseTimingPlan } from '../../embodiment/speech/SpeechPhraseTiming'
import type { AvatarProceduralMode } from '../../embodiment/types'
import type { VrmBodyActionDebugState, VrmPerformanceDebugState } from './AnimationDebugTypes'
import { AvatarPerformanceMonitor } from './AvatarPerformanceMonitor'
import type { VrmAnimationLoadContext } from './VrmAnimationTypes'
import { VrmBodyPlayback } from './VrmBodyPlayback'
import { VrmModelLoader } from './VrmModelLoader'

export type {
  VrmBodyActionDebugEntry,
  VrmBodyActionDebugState,
  VrmPerformanceDebugState,
  VrmTransitionFrameTraceEntry,
} from './AnimationDebugTypes'
export type { VrmAnimationLoadContext, VrmRootMotionPolicy } from './VrmAnimationTypes'

export class VrmModel {
  vrm: VRM | null = null
  private readonly facialRuntime = new AvatarFacialRuntime()
  private readonly modelLoader = new VrmModelLoader()
  private readonly performanceMonitor = new AvatarPerformanceMonitor()
  private readonly bodyPlayback = new VrmBodyPlayback((count) =>
    this.facialRuntime.notifyVrmaFacialTracksDisabled(count),
  )

  async load(scene: THREE.Scene, buffer: ArrayBuffer): Promise<void> {
    this.facialRuntime.detach()
    if (this.vrm) {
      this.modelLoader.dispose(scene, this.vrm)
      this.vrm = null
    }
    this.bodyPlayback.detach()

    const vrm = await this.modelLoader.load(scene, buffer)
    this.vrm = vrm
    this.bodyPlayback.attach(vrm)
    this.facialRuntime.attach(vrm)
  }

  loadAnimation(
    buffer: ArrayBuffer,
    loop = true,
    blendDuration = 0.3,
    context?: VrmAnimationLoadContext,
  ): Promise<void> {
    return this.bodyPlayback.loadAnimation(buffer, loop, blendDuration, context)
  }

  stopAnimation(): void {
    this.bodyPlayback.stopAnimation()
  }

  update(delta: number): void {
    if (!this.vrm) {
      this.facialRuntime.update(delta)
      return
    }
    this.performanceMonitor.updatePerformanceDebug(delta)
    this.facialRuntime.removeProceduralMotion()
    this.bodyPlayback.update(delta, () => {
      this.updateProceduralMotion(delta)
      this.facialRuntime.updateProceduralMotion(delta)
    })
    this.facialRuntime.update(delta)
    this.vrm.update(delta)
  }

  forceBlink(duration = 1.2): void {
    this.facialRuntime.forceBlink(duration)
  }

  nudgeMicroMotion(options: {
    headX?: number
    headY?: number
    eyeX?: number
    eyeY?: number
    duration?: number
  }): void {
    this.facialRuntime.nudgeMicroMotion(options)
  }

  setLookAtTarget(target: THREE.Object3D | null): boolean {
    return this.facialRuntime.setLookAtTarget(target)
  }

  setLookAtMode(mode: LookAtMode): void {
    this.facialRuntime.setLookAtMode(mode)
  }

  setHeadMotionProfile(profile: HeadMotionProfile): void {
    this.facialRuntime.setHeadMotionProfile(profile)
  }

  triggerHeadAttentionImpulse(impulse: HeadAttentionImpulse): boolean {
    return this.facialRuntime.triggerHeadAttentionImpulse(impulse)
  }

  setProceduralMode(mode: AvatarProceduralMode): void {
    this.facialRuntime.setProceduralMode(mode)
  }

  applyEmotion(emotionKey: string, vrmEmotion?: string): void {
    this.facialRuntime.applyEmotion(emotionKey, vrmEmotion)
  }

  private updateProceduralMotion(delta: number): void {
    this.facialRuntime.updateProceduralMotion(delta)
  }

  setMouthWeight(weight: number): void {
    this.facialRuntime.setMouthWeight(weight)
  }

  setSceneVisible(visible: boolean): void {
    if (this.vrm) this.vrm.scene.visible = visible
  }

  setMouthWeights(weights: Partial<MouthWeights>, composed = false): void {
    // LipSync domain → Expression Mixer (applied on the next frame's mix).
    this.facialRuntime.setMouthWeights(weights, composed)
  }

  setMouthDebug(debug: FacialDebugState['mouthTuning']): void {
    this.facialRuntime.setMouthDebug(debug)
  }

  setSpeechEnergy(energy: number): void {
    this.facialRuntime.setSpeechEnergy(energy)
  }

  startSpeechPhrase(plan: SpeechPhraseTimingPlan): void {
    this.facialRuntime.startSpeechPhrase(plan)
  }

  updateSpeechPhrase(delta: number, progress: number, speechEnergy: number): void {
    this.facialRuntime.updateSpeechPhrase(delta, progress, speechEnergy)
  }

  finishSpeechPhrase(): void {
    this.facialRuntime.finishSpeechPhrase()
  }

  interruptSpeechPhrase(): void {
    this.facialRuntime.interruptSpeechPhrase()
  }

  getSpeechPhrasePhase(): SpeechPhrasePhase {
    return this.facialRuntime.getSpeechPhrasePhase()
  }

  getFacialDebugState(): FacialDebugState {
    return this.facialRuntime.getFacialDebugState()
  }

  getFinalMouthWeights(): MouthWeights {
    return this.facialRuntime.getFinalMouthWeights()
  }

  getLookAtDebugState(): LookAtDebugState {
    return this.facialRuntime.getLookAtDebugState()
  }

  getHeadMotionDebugState(): HeadMotionDebugState {
    return this.facialRuntime.getHeadMotionDebugState()
  }

  getEarBehaviorDebugState(): EarBehaviorDebugState {
    return this.facialRuntime.getEarBehaviorDebugState()
  }

  syncEarState(mode: AvatarProceduralMode, emotion: string): void {
    this.facialRuntime.syncEarState(mode, emotion)
  }

  triggerEarImpulse(impulse: EarImpulse, identity?: string): boolean {
    return this.facialRuntime.triggerEarImpulse(impulse, identity)
  }

  getLastEarImpulseDecision(): ReturnType<AvatarFacialRuntime['getLastEarImpulseDecision']> {
    return this.facialRuntime.getLastEarImpulseDecision()
  }

  setEarAxisOverride(axis: EarAxisOverride): void {
    this.facialRuntime.setEarAxisOverride(axis)
  }

  setEarAmplitudeScale(scale: number): void {
    this.facialRuntime.setEarAmplitudeScale(scale)
  }

  getPerformanceDebugState(): VrmPerformanceDebugState {
    return this.performanceMonitor.getPerformanceDebugState()
  }

  isLoaded(): boolean {
    return this.vrm !== null
  }

  isAnimationPlaying(): boolean {
    return this.bodyPlayback.isAnimationPlaying()
  }

  getBodyActionDebugState(): VrmBodyActionDebugState {
    return this.bodyPlayback.getBodyActionDebugState()
  }
}
