import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'
import { BlinkController } from './BlinkController'
import { resolveEffectiveBlinkProfile } from './BlinkProfileResolver'
import { BreathController, type BreathProfile } from './BreathController'
import { ExpressionController } from './ExpressionController'
import { AvatarExpressionMixer, type FacialDebugState } from './AvatarExpressionMixer'
import { MicroMotionController, type MicroMotionProfile } from './MicroMotionController'
import { LookAtRuntime, type LookAtDebugState, type LookAtMode } from './LookAtRuntime'
import { HeadMotionRuntime, type HeadMotionDebugState, type HeadMotionProfile } from './HeadMotionRuntime'
import { EarBehaviorRuntime, type EarBehaviorDebugState, type EarAxisOverride } from './EarBehaviorRuntime'
import { SpeakingEyeController } from './SpeakingEyeController'
import { MouthClosureController } from './MouthClosureController'
import { LipSyncVariationController } from './LipSyncVariationController'
import { facialTuning } from './avatarTuning'
import { completeMouthWeights, type MouthWeights } from './FacialProfile'
import type { VrmProceduralMode } from './VrmModel'

const BREATH_PROFILES: Record<VrmProceduralMode, BreathProfile> = {
  idle: { speed: 0.38, intensity: 0.01, weight: 1, smoothing: 2.8 },
  listening: { speed: 0.4, intensity: 0.009, weight: 0.95, smoothing: 3 },
  thinking: { speed: 0.32, intensity: 0.008, weight: 0.82, smoothing: 2.6 },
  speaking: { speed: 0.5, intensity: 0.009, weight: 1.05, smoothing: 3.2 }
}

const MICRO_MOTION_PROFILES: Record<VrmProceduralMode, MicroMotionProfile> = {
  idle: { swayWeight: 0.7, eyeWeight: 0, headWeight: 0.08, headSpeed: 0.55 },
  listening: { swayWeight: 0.82, eyeWeight: 0, headWeight: 0.06, headSpeed: 0.5 },
  thinking: { swayWeight: 0.5, eyeWeight: 0, headWeight: 0.07, headSpeed: 0.42 },
  speaking: { swayWeight: 0.72, eyeWeight: 0, headWeight: 0.05, headSpeed: 1.05 }
}

export class AvatarFacialRuntime {
  private blinkController = new BlinkController()
  private breathController = new BreathController()
  private expressionController = new ExpressionController()
  private expressionMixer = new AvatarExpressionMixer()
  private microMotionController = new MicroMotionController()
  private lookAtRuntime = new LookAtRuntime()
  private headMotionRuntime = new HeadMotionRuntime()
  private earBehaviorRuntime = new EarBehaviorRuntime()
  private speakingEyeController = new SpeakingEyeController()
  private mouthClosureController = new MouthClosureController()
  private lipSyncVariationController = new LipSyncVariationController()
  private proceduralMode: VrmProceduralMode = 'idle'
  private speechEnergy = 0
  private antiStallActive = false
  private currentEmotionKey = 'neutral'
  private mouthWeights = completeMouthWeights({})

  detach(): void {
    this.breathController.detach()
    this.blinkController.detach()
    this.expressionController.detach()
    this.expressionMixer.detach()
    this.microMotionController.detach()
    this.lookAtRuntime.detach()
    this.headMotionRuntime.detach()
    this.earBehaviorRuntime.detach()
    this.speakingEyeController.detach()
    this.mouthClosureController.detach()
    this.lipSyncVariationController.reset()
    this.mouthWeights = completeMouthWeights({})
  }

  attach(vrm: VRM): void {
    this.blinkController.attach()
    this.breathController.attach(vrm)
    this.expressionController.attach(vrm)
    this.expressionMixer.attach(vrm)
    this.microMotionController.attach(vrm)
    this.lookAtRuntime.attach(vrm)
    this.headMotionRuntime.attach(vrm)
    this.earBehaviorRuntime.attach(vrm)
    this.speakingEyeController.attach()
    this.mouthClosureController.attach()
    this.lipSyncVariationController.reset()
    this.lipSyncVariationController.setEmotion(this.currentEmotionKey)
    this.updateEffectiveBlinkProfile()
    this.earBehaviorRuntime.setProfile(this.proceduralMode)
    this.breathController.setProfile(BREATH_PROFILES[this.proceduralMode])
    this.microMotionController.setProfile(MICRO_MOTION_PROFILES[this.proceduralMode])
  }

  update(delta: number): void {
    this.expressionMixer.beginFrame(delta)
    this.expressionController.setSpeechEnergy(this.speechEnergy)
    this.expressionController.update(delta)
    this.expressionMixer.setEmotion(this.expressionController.getValues())
    this.blinkController.update(delta)
    this.expressionMixer.setBlinkDebug(this.blinkController.getDebugState())
    this.expressionMixer.setBlink(this.blinkController.getWeight())

    // Speaking Eye Micro-Expression — small drifting squint layered under Blink.
    const speaking = this.proceduralMode === 'speaking'
    this.speakingEyeController.update(delta, speaking, this.currentEmotionKey)
    this.expressionMixer.setSpeakingEye(this.speakingEyeController.getLeft(), this.speakingEyeController.getRight())
    this.expressionMixer.setSpeakingEyeDebug(this.speakingEyeController.getDebugState())

    // Mouth Closure Envelope — brief procedural lip closures over LipSync.
    this.lipSyncVariationController.update(delta)
    this.expressionMixer.setMouth(this.lipSyncVariationController.apply(this.mouthWeights))
    const mouthOpenness = Math.max(...Object.values(this.mouthWeights))
    this.mouthClosureController.update(delta, speaking, this.speechEnergy, mouthOpenness, this.antiStallActive)
    this.expressionMixer.setMouthClosure(this.mouthClosureController.getStrength())
    this.expressionMixer.setMouthClosureDebug(this.mouthClosureController.getDebugState())

    this.expressionMixer.apply()
  }

  removeProceduralMotion(): void {
    this.breathController.remove()
    this.microMotionController.remove()
    this.lookAtRuntime.remove()
    this.headMotionRuntime.remove()
  }

  updateProceduralMotion(delta: number): void {
    this.breathController.update(delta)
    this.microMotionController.update(delta)
    this.lookAtRuntime.update(delta)
    this.headMotionRuntime.update(delta)
    this.earBehaviorRuntime.update(delta)
  }

  notifyVrmaFacialTracksDisabled(count: number): void {
    this.expressionMixer.notifyVrmaFacialTracksDisabled(count)
  }

  forceBlink(duration = 1.2): void {
    this.blinkController.force(duration === 1.2 ? facialTuning.blink.forceDuration : duration)
  }

  nudgeMicroMotion(options: { headX?: number; headY?: number; eyeX?: number; eyeY?: number; duration?: number }): void {
    this.microMotionController.nudge(options)
  }

  setLookAtTarget(target: THREE.Object3D | null): boolean {
    this.microMotionController.setLookAtActive(Boolean(target))
    this.expressionMixer.setLookAtActive(Boolean(target))
    return this.lookAtRuntime.setBaseTarget(target)
  }

  setLookAtMode(mode: LookAtMode): void {
    this.lookAtRuntime.setMode(mode)
  }

  setHeadMotionProfile(profile: HeadMotionProfile): void {
    this.headMotionRuntime.setProfile(profile)
  }

  setProceduralMode(mode: VrmProceduralMode): void {
    const wasSpeaking = this.proceduralMode === 'speaking'
    const isSpeaking = mode === 'speaking'
    this.proceduralMode = mode
    if (!wasSpeaking && isSpeaking) this.lipSyncVariationController.startSpeechSegment()
    else if (wasSpeaking && !isSpeaking) this.lipSyncVariationController.endSpeech()
    this.updateEffectiveBlinkProfile()
    this.breathController.setProfile(BREATH_PROFILES[mode])
    this.microMotionController.setProfile(MICRO_MOTION_PROFILES[mode])
    this.earBehaviorRuntime.setProfile(mode)
  }

  applyEmotion(emotionKey: string, vrmEmotion?: string): void {
    this.currentEmotionKey = emotionKey
    this.lipSyncVariationController.setEmotion(emotionKey)
    this.expressionController.applyEmotion(emotionKey, vrmEmotion)
    const profile = this.expressionController.getProfile()
    this.expressionMixer.setFacialProfile(profile)
    this.updateEffectiveBlinkProfile()
    this.earBehaviorRuntime.applyEmotion(emotionKey)
  }

  /**
   * Single composition point for the blink profile. Both `setProceduralMode`
   * and `applyEmotion` funnel through here so the effective blink profile is a
   * pure function of `(proceduralMode, emotion)` and never depends on which
   * event fired last. See {@link resolveEffectiveBlinkProfile}.
   */
  private updateEffectiveBlinkProfile(): void {
    const profile = resolveEffectiveBlinkProfile(this.proceduralMode, this.currentEmotionKey)
    this.blinkController.setEffectiveProfile(profile, {
      proceduralMode: this.proceduralMode,
      emotion: this.currentEmotionKey
    })
  }

  setMouthWeight(weight: number): void {
    this.setMouthWeights({ aa: weight })
  }

  setMouthWeights(weights: Partial<MouthWeights>): void {
    this.mouthWeights = completeMouthWeights(weights)
  }

  setMouthDebug(debug: FacialDebugState['mouthTuning']): void {
    this.antiStallActive = debug.antiStallActive
    this.expressionMixer.setMouthDebug(debug)
  }

  setSpeechEnergy(energy: number): void {
    this.speechEnergy = Math.max(0, Math.min(1, energy))
  }

  getFacialDebugState(): FacialDebugState {
    return this.expressionMixer.getDebugState()
  }

  getLookAtDebugState(): LookAtDebugState {
    return this.lookAtRuntime.getDebugState()
  }

  getHeadMotionDebugState(): HeadMotionDebugState {
    return this.headMotionRuntime.getDebugState()
  }

  getEarBehaviorDebugState(): EarBehaviorDebugState {
    return this.earBehaviorRuntime.getDebugState()
  }

  /**
   * Keep only the Ear Runtime's profile + emotion synced from the per-frame
   * render loop, without disturbing the blink / breath / expression profiles
   * (those stay event-driven via {@link setProceduralMode} / {@link applyEmotion}).
   * This makes the Ear Runtime self-driven so idle / AFK procedural motion keeps
   * progressing on both the main avatar and the independent Mirror Overlay.
   */
  syncEarState(mode: VrmProceduralMode, emotion: string): void {
    this.earBehaviorRuntime.setProfile(mode)
    this.earBehaviorRuntime.applyEmotion(emotion)
  }

  setEarAxisOverride(axis: EarAxisOverride): void {
    this.earBehaviorRuntime.setAxisOverride(axis)
  }

  setEarAmplitudeScale(scale: number): void {
    this.earBehaviorRuntime.setAmplitudeScale(scale)
  }
}
