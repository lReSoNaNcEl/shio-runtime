import type { VRM } from '@pixiv/three-vrm'
import type * as THREE from 'three'

import type { BodyPresentation } from '../../../../shared/motion'
import type { PcmPlaybackClock } from '../../../audio/audioPlayer'
import { AvatarFacialRuntime } from '../../embodiment/AvatarFacialRuntime'
import type { FacialDebugState } from '../../embodiment/facial/FacialDebugTypes'
import type { MouthWeights } from '../../embodiment/facial/FacialProfile'
import type {
  HeadAttentionImpulse,
  HeadMotionDebugState,
  HeadMotionProfile,
} from '../../embodiment/gaze/HeadMotionRuntime'
import type { LookAtDebugState, LookAtMode } from '../../embodiment/gaze/LookAtRuntime'
import type { AvatarBodyMotionLayer } from '../../embodiment/motion/AvatarMotionLayer'
import type {
  EarAxisOverride,
  EarBehaviorDebugState,
  EarImpulse,
} from '../../embodiment/secondary-motion/EarBehaviorRuntime'
import type { TailBehaviorDebugState } from '../../embodiment/secondary-motion/TailBehaviorRuntime'
import type { SpeechPhrasePhase } from '../../embodiment/speech/PhraseEnvelopeController'
import type { SpeechPhraseTimingPlan } from '../../embodiment/speech/SpeechPhraseTiming'
import type { AvatarProceduralMode } from '../../embodiment/types'
import { AvatarPerformanceMonitor } from './AvatarPerformanceMonitor'
import type { ConversationViewConfig } from './ConversationFraming'
import { GeneratedBodyPlayback } from './GeneratedBodyPlayback'
import type {
  GeneratedBodyDebugState,
  GeneratedMotionRequestContext,
  VrmPerformanceDebugState,
} from './GeneratedMotionTypes'
import { VrmModelLoader } from './VrmModelLoader'

export type {
  GeneratedBodyDebugState,
  GeneratedMotionRequestContext,
  VrmPerformanceDebugState,
} from './GeneratedMotionTypes'

export class VrmModel {
  vrm: VRM | null = null
  private scene: THREE.Scene | null = null
  private readonly facialRuntime = new AvatarFacialRuntime()
  private readonly modelLoader = new VrmModelLoader()
  private readonly performanceMonitor = new AvatarPerformanceMonitor()
  private readonly bodyPlayback = new GeneratedBodyPlayback((count) =>
    this.facialRuntime.notifyBodyFacialChannelsRejected(count),
  )

  async load(scene: THREE.Scene, buffer: ArrayBuffer): Promise<void> {
    this.dispose()

    const vrm = await this.modelLoader.load(scene, buffer)
    this.scene = scene
    this.vrm = vrm
    this.bodyPlayback.attach(vrm)
    this.facialRuntime.attach(vrm)
  }

  attachScene(scene: THREE.Scene): void {
    if (this.vrm) scene.add(this.vrm.scene)
    this.scene = scene
  }

  getHeadPosition(): THREE.Vector3 | null {
    return (
      this.vrm?.humanoid
        .getNormalizedBoneNode('head')
        ?.getWorldPosition(this.vrm.scene.position.clone()) ?? null
    )
  }

  requestGeneratedMotion(id: string, context: GeneratedMotionRequestContext): Promise<void> {
    return this.bodyPlayback.playProfile(id, context)
  }

  setPcmClock(clock: PcmPlaybackClock | null): void {
    this.bodyPlayback.setClock(clock)
    this.facialRuntime.setPcmClock(clock)
  }
  setBodyCameraMode(mode: string): void {
    this.bodyPlayback.setCameraMode(mode)
  }
  setConversationView(config: ConversationViewConfig): void {
    this.bodyPlayback.setConversationView(config)
  }
  setPresentationOnly(value: boolean): void {
    this.bodyPlayback.setPresentationOnly(value)
    this.facialRuntime.setPresentationOnly(value)
  }
  getBodyPresentation(): BodyPresentation | null {
    const body = this.bodyPlayback.getPresentation()
    return body ? { ...body, facialActing: this.facialRuntime.getActingPresentation() } : null
  }
  applyBodyPresentation(value: BodyPresentation | null): void {
    this.bodyPlayback.setMirror(value)
    this.facialRuntime.applyActingPresentation(value?.facialActing ?? null)
  }
  settleMotionCancellation(): Promise<void> {
    return this.bodyPlayback.settleCancellation()
  }

  getEmbodimentAvailability() {
    return this.bodyPlayback.getEmbodimentAvailability()
  }
  getMotionLibraryDebug() {
    return this.bodyPlayback.getLibraryDebug()
  }
  recoverMotion(): void {
    this.bodyPlayback.recover()
  }

  releaseSpeechPreparation(profileId: string): void {
    this.bodyPlayback.releaseSpeechPreparation(profileId)
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
      this.facialRuntime.setBodyMotionLayer(this.bodyPlayback.getAppliedMotionLayer())
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

  dispose(): void {
    this.facialRuntime.detach()
    this.bodyPlayback.detach()
    if (this.vrm && this.scene) this.modelLoader.dispose(this.scene, this.vrm)
    this.vrm = null
    this.scene = null
  }

  setBodyMotionLayer(_requestedLayer: AvatarBodyMotionLayer): void {
    // Coordinator notifications may arrive between composed frames. A request
    // still waiting for body application has no authority over current presence.
    this.facialRuntime.setBodyMotionLayer(this.bodyPlayback.getAppliedMotionLayer())
  }

  applyEmotion(emotionKey: string, vrmEmotion?: string): void {
    this.facialRuntime.applyEmotion(emotionKey, vrmEmotion)
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

  getTailBehaviorDebugState(): TailBehaviorDebugState {
    return this.facialRuntime.getTailBehaviorDebugState()
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

  getBodyMotionDebugState(): GeneratedBodyDebugState {
    return this.bodyPlayback.getBodyMotionDebugState()
  }
}
