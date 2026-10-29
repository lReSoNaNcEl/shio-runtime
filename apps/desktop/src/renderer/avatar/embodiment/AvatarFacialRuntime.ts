import type { VRM } from '@pixiv/three-vrm'
import type * as THREE from 'three'

import {
  FACIAL_ACTING_CHANNELS,
  type FacialActingPresentation,
} from '../../../shared/facial-acting'
import type { PcmPlaybackClock } from '../../audio/audioPlayer'
import {
  type EmotionEmbodimentProfile,
  resolveEmotionEmbodimentProfile,
} from '../EmotionEmbodimentProfile'
import { facialTuning } from '../tuning/facialTuning'
import { phraseLipSyncTuning } from '../tuning/speechTuning'
import { AvatarExpressionMixer, type FacialDebugState } from './facial/AvatarExpressionMixer'
import { BlinkController } from './facial/BlinkController'
import { resolveEffectiveBlinkProfile } from './facial/BlinkProfileResolver'
import { ExpressionController } from './facial/ExpressionController'
import { FacialActingController } from './facial/FacialActingController'
import { completeMouthWeights, type MouthWeights } from './facial/FacialProfile'
import { MouthClosureController } from './facial/MouthClosureController'
import { SpeakingEyeController } from './facial/SpeakingEyeController'
import {
  type HeadAttentionImpulse,
  type HeadMotionDebugState,
  type HeadMotionProfile,
  HeadMotionRuntime,
} from './gaze/HeadMotionRuntime'
import { type LookAtDebugState, type LookAtMode, LookAtRuntime } from './gaze/LookAtRuntime'
import {
  type AvatarBodyMotionLayer,
  resolveAvatarMotionAuthority,
} from './motion/AvatarMotionLayer'
import { ProceduralMotionController } from './motion/ProceduralMotionController'
import {
  type EarAxisOverride,
  type EarBehaviorDebugState,
  EarBehaviorRuntime,
  type EarImpulse,
} from './secondary-motion/EarBehaviorRuntime'
import {
  type TailBehaviorDebugState,
  TailBehaviorRuntime,
} from './secondary-motion/TailBehaviorRuntime'
import { LipSyncVariationController } from './speech/LipSyncVariationController'
import { PhraseEnvelopeController, type SpeechPhrasePhase } from './speech/PhraseEnvelopeController'
import type { SpeechPhraseTimingPlan } from './speech/SpeechPhraseTiming'
import type { AvatarProceduralMode } from './types'

export class AvatarFacialRuntime {
  private facialActingController = new FacialActingController()
  private presentationOnly = false
  private mirroredActing: FacialActingPresentation | null = null
  private mirrorActingFrom: FacialActingPresentation | null = null
  private mirrorActingElapsed = 0
  private blinkController = new BlinkController()
  private expressionController = new ExpressionController()
  private expressionMixer = new AvatarExpressionMixer()
  private proceduralMotionController = new ProceduralMotionController()
  private lookAtRuntime = new LookAtRuntime()
  private headMotionRuntime = new HeadMotionRuntime()
  private earBehaviorRuntime = new EarBehaviorRuntime()
  private tailBehaviorRuntime = new TailBehaviorRuntime()
  private speakingEyeController = new SpeakingEyeController()
  private mouthClosureController = new MouthClosureController()
  private lipSyncVariationController = new LipSyncVariationController()
  private phraseEnvelopeController = new PhraseEnvelopeController()
  private proceduralMode: AvatarProceduralMode = 'idle'
  private bodyMotionLayer: AvatarBodyMotionLayer = 'base'
  private lookAtMode: LookAtMode = 'idle'
  private speechEnergy = 0
  private antiStallActive = false
  private currentEmotionKey = 'neutral'
  private currentEmbodimentProfile: EmotionEmbodimentProfile =
    resolveEmotionEmbodimentProfile('neutral')
  private mouthWeights = completeMouthWeights({})
  private externalMouthComposed = false

  detach(): void {
    this.facialActingController.reset()
    this.mirroredActing = null
    this.mirrorActingFrom = null
    this.speechEnergy = 0
    this.blinkController.detach()
    this.expressionController.detach()
    this.expressionMixer.detach()
    this.proceduralMotionController.detach()
    this.lookAtRuntime.detach()
    this.headMotionRuntime.detach()
    this.earBehaviorRuntime.detach()
    this.tailBehaviorRuntime.detach()
    this.speakingEyeController.detach()
    this.mouthClosureController.detach()
    this.lipSyncVariationController.reset()
    this.phraseEnvelopeController.reset()
    this.mouthWeights = completeMouthWeights({})
    this.externalMouthComposed = false
  }

  attach(vrm: VRM): void {
    this.blinkController.attach()
    this.proceduralMotionController.attach(vrm)
    this.expressionController.attach(vrm)
    this.expressionMixer.attach(vrm)
    this.lookAtRuntime.attach(vrm)
    this.headMotionRuntime.attach(vrm)
    this.earBehaviorRuntime.attach(vrm)
    this.tailBehaviorRuntime.attach(vrm)
    this.speakingEyeController.attach()
    this.mouthClosureController.attach()
    this.lipSyncVariationController.reset()
    this.phraseEnvelopeController.reset()
    this.externalMouthComposed = false
    this.lipSyncVariationController.setEmotion(this.currentEmbodimentProfile.lipSyncProfile)
    this.updateEffectiveBlinkProfile()
    this.earBehaviorRuntime.setProfile(this.proceduralMode)
    this.tailBehaviorRuntime.setProfile(this.proceduralMode)
    this.proceduralMotionController.setMode(this.proceduralMode)
    this.proceduralMotionController.setBodyMotionLayer(this.bodyMotionLayer)
    this.proceduralMotionController.setLookAtMode(this.lookAtMode)
    this.updateMotionAuthority()
  }

  update(delta: number): void {
    this.expressionMixer.beginFrame(delta)
    this.expressionController.setSpeechEnergy(this.speechEnergy)
    this.expressionController.update(delta)
    this.expressionMixer.setEmotion(this.expressionController.getValues())
    if (!this.presentationOnly) this.blinkController.update(delta)
    this.expressionMixer.setBlinkDebug(this.blinkController.getDebugState())
    this.expressionMixer.setBlink(this.blinkController.getWeight())
    if (!this.presentationOnly)
      this.expressionMixer.setBilateralBlink(...this.blinkController.getBilateralWeights())

    // Speaking Eye Micro-Expression — small drifting squint layered under Blink.
    const speaking = this.proceduralMode === 'speaking'
    this.speakingEyeController.update(delta, speaking, this.currentEmotionKey)
    this.expressionMixer.setSpeakingEye(
      this.speakingEyeController.getLeft(),
      this.speakingEyeController.getRight(),
    )
    this.expressionMixer.setSpeakingEyeDebug(this.speakingEyeController.getDebugState())

    // Mouth Closure Envelope — brief procedural lip closures over LipSync.
    this.lipSyncVariationController.update(delta)
    const phrase = this.phraseEnvelopeController.getOutput()
    const mouthOpenness = Math.max(...Object.values(this.mouthWeights))
    this.mouthClosureController.update(
      delta,
      speaking,
      this.speechEnergy,
      mouthOpenness,
      this.antiStallActive,
    )
    if (this.externalMouthComposed) {
      this.expressionMixer.setMouth(this.mouthWeights)
      this.expressionMixer.setMouthClosure(0)
    } else {
      const variedMouth = this.lipSyncVariationController.apply(this.mouthWeights)
      const emotionMouth =
        phraseLipSyncTuning.emotionProfiles[this.currentEmbodimentProfile.lipSyncProfile]
      const articulationScale = phrase.articulationScale
      const jawScale = phrase.jawScale * emotionMouth.jawScale
      this.expressionMixer.setMouth({
        aa: variedMouth.aa * articulationScale * jawScale,
        ih: variedMouth.ih * articulationScale,
        ou: variedMouth.ou * articulationScale * jawScale,
        ee: variedMouth.ee * articulationScale,
        oh: variedMouth.oh * articulationScale * jawScale,
      })
      this.expressionMixer.setMouthClosure(
        Math.max(this.mouthClosureController.getStrength(), phrase.closureStrength),
      )
    }
    this.expressionMixer.setMouthClosureDebug(this.mouthClosureController.getDebugState())

    if (this.presentationOnly) {
      const mirror = this.mirroredActing
      this.mirrorActingElapsed += Math.max(0, delta)
      const blend = Math.min(1, this.mirrorActingElapsed * 30)
      const from = this.mirrorActingFrom ?? mirror
      const acting = Object.fromEntries(
        FACIAL_ACTING_CHANNELS.map((name) => [
          name,
          (from?.acting[name] ?? 0) +
            ((mirror?.acting[name] ?? 0) - (from?.acting[name] ?? 0)) * blend,
        ]),
      )
      this.expressionMixer.setFacialActing(acting, true)
      const left =
        (from?.blinkLeft ?? 0) + ((mirror?.blinkLeft ?? 0) - (from?.blinkLeft ?? 0)) * blend
      const right =
        (from?.blinkRight ?? 0) + ((mirror?.blinkRight ?? 0) - (from?.blinkRight ?? 0)) * blend
      this.expressionMixer.setBlink(Math.max(left, right))
      this.expressionMixer.setBilateralBlink(left, right)
    } else {
      this.expressionMixer.setFacialActing(
        this.facialActingController.update(delta, this.currentEmotionKey, speaking),
      )
    }
    this.expressionMixer.apply()
  }

  setPresentationOnly(value: boolean): void {
    this.presentationOnly = value
    this.proceduralMotionController.setPresentationOnly(value)
    this.headMotionRuntime.setPresentationOnly(value)
  }

  setPcmClock(clock: PcmPlaybackClock | null): void {
    this.facialActingController.setClock(clock)
  }

  getActingPresentation(): FacialActingPresentation {
    return this.expressionMixer.getActingPresentation()
  }

  applyActingPresentation(value: FacialActingPresentation | null): void {
    this.mirrorActingFrom = this.expressionMixer.getActingPresentation()
    this.mirroredActing = value
    this.mirrorActingElapsed = 0
  }

  removeProceduralMotion(): void {
    this.proceduralMotionController.remove()
    this.lookAtRuntime.remove()
    this.headMotionRuntime.remove()
    this.tailBehaviorRuntime.remove()
  }

  updateProceduralMotion(delta: number): void {
    this.proceduralMotionController.update(delta)
    this.lookAtRuntime.update(delta)
    this.headMotionRuntime.update(delta)
    // The torso follows the head orientation on the next frame (smoothed both ways).
    this.proceduralMotionController.setOrientation(this.headMotionRuntime.getTorsoPose())
    this.earBehaviorRuntime.update(delta)
    this.tailBehaviorRuntime.update(delta)
  }

  notifyBodyFacialChannelsRejected(count: number): void {
    this.expressionMixer.notifyBodyFacialChannelsRejected(count)
  }

  forceBlink(duration = 1.2): void {
    this.blinkController.force(duration === 1.2 ? facialTuning.blink.forceDuration : duration)
  }

  nudgeMicroMotion(options: {
    headX?: number
    headY?: number
    eyeX?: number
    eyeY?: number
    duration?: number
  }): void {
    this.proceduralMotionController.nudge(options)
  }

  setLookAtTarget(target: THREE.Object3D | null): boolean {
    this.proceduralMotionController.setLookAtActive(Boolean(target))
    this.expressionMixer.setLookAtActive(Boolean(target))
    return this.lookAtRuntime.setBaseTarget(target)
  }

  setLookAtMode(mode: LookAtMode): void {
    this.lookAtMode = mode
    this.lookAtRuntime.setMode(mode)
    this.proceduralMotionController.setLookAtMode(mode)
    this.updateMotionAuthority()
  }

  setHeadMotionProfile(profile: HeadMotionProfile): void {
    this.headMotionRuntime.setProfile(profile)
  }

  triggerHeadAttentionImpulse(impulse: HeadAttentionImpulse): boolean {
    return this.headMotionRuntime.triggerAttentionImpulse(impulse)
  }

  setProceduralMode(mode: AvatarProceduralMode): void {
    const wasSpeaking = this.proceduralMode === 'speaking'
    const isSpeaking = mode === 'speaking'
    this.proceduralMode = mode
    // A new speech session must wait for its own playback analyser sample.
    if (!isSpeaking || !wasSpeaking) {
      this.headMotionRuntime.setSpeechEnergy(0)
      this.proceduralMotionController.setSpeechEnergy(0)
    }
    if (!wasSpeaking && isSpeaking) this.lipSyncVariationController.startSpeechSegment()
    else if (wasSpeaking && !isSpeaking) this.lipSyncVariationController.endSpeech()
    this.updateEffectiveBlinkProfile()
    this.proceduralMotionController.setMode(mode)
    this.earBehaviorRuntime.setProfile(mode)
    this.tailBehaviorRuntime.setProfile(mode)
  }

  setBodyMotionLayer(layer: AvatarBodyMotionLayer): void {
    this.bodyMotionLayer = layer
    this.proceduralMotionController.setBodyMotionLayer(layer)
    this.updateMotionAuthority()
  }

  applyEmotion(emotionKey: string, vrmEmotion?: string): void {
    const entering = emotionKey !== this.currentEmotionKey
    this.currentEmotionKey = emotionKey
    const embodiment = resolveEmotionEmbodimentProfile(emotionKey)
    this.currentEmbodimentProfile = embodiment
    this.lipSyncVariationController.setEmotion(embodiment.lipSyncProfile)
    this.expressionController.applyEmotion(emotionKey, vrmEmotion)
    const profile = this.expressionController.getProfile()
    this.expressionMixer.setFacialProfile(profile)
    this.blinkController.setAsymmetry(profile.eyeProfile.blinkAsymmetry)
    this.updateEffectiveBlinkProfile()
    if (
      entering &&
      !this.presentationOnly &&
      profile.id === 'chuckle' &&
      this.expressionMixer.supportsBilateralBlink()
    )
      this.blinkController.requestWink('left')
    this.earBehaviorRuntime.applyEmotion(embodiment)
    this.tailBehaviorRuntime.applyEmotion(embodiment.id)
    this.headMotionRuntime.applyEmotionProfile(embodiment)
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
      emotion: this.currentEmotionKey,
    })
  }

  private updateMotionAuthority(): void {
    const authority = resolveAvatarMotionAuthority({
      bodyLayer: this.bodyMotionLayer,
      directedGaze:
        this.lookAtMode === 'userFocus' ||
        this.lookAtMode === 'listening' ||
        this.lookAtMode === 'speaking',
      screenGaze: this.lookAtMode === 'screenFocus',
    })
    this.headMotionRuntime.setAuthorityWeight(authority.proceduralHeadWeight)
  }

  setMouthWeight(weight: number): void {
    this.setMouthWeights({ aa: weight })
  }

  setMouthWeights(weights: Partial<MouthWeights>, composed = false): void {
    this.mouthWeights = completeMouthWeights(weights)
    this.externalMouthComposed = composed
  }

  setMouthDebug(debug: FacialDebugState['mouthTuning']): void {
    this.antiStallActive = debug.antiStallActive
    this.expressionMixer.setMouthDebug(debug)
  }

  setSpeechEnergy(energy: number): void {
    this.speechEnergy = Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0
    this.headMotionRuntime.setSpeechEnergy(
      this.proceduralMode === 'speaking' ? this.speechEnergy : 0,
    )
    this.proceduralMotionController.setSpeechEnergy(
      this.speechEnergy * this.currentEmbodimentProfile.head.energyScale,
    )
  }

  startSpeechPhrase(plan: SpeechPhraseTimingPlan): void {
    this.phraseEnvelopeController.start(plan)
  }

  updateSpeechPhrase(delta: number, progress: number, speechEnergy: number): void {
    this.phraseEnvelopeController.update(delta, progress, speechEnergy)
  }

  finishSpeechPhrase(): void {
    this.phraseEnvelopeController.finish()
  }

  interruptSpeechPhrase(): void {
    this.phraseEnvelopeController.interrupt()
  }

  getSpeechPhrasePhase(): SpeechPhrasePhase {
    return this.phraseEnvelopeController.getPhase()
  }

  getFacialDebugState(): FacialDebugState {
    return this.expressionMixer.getDebugState()
  }

  getFinalMouthWeights(): MouthWeights {
    return this.expressionMixer.getFinalMouthWeights()
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

  getTailBehaviorDebugState(): TailBehaviorDebugState {
    return this.tailBehaviorRuntime.getDebugState()
  }

  /**
   * Keep only the Ear Runtime's profile + emotion synced from the per-frame
   * render loop, without disturbing the blink / breath / expression profiles
   * (those stay event-driven via {@link setProceduralMode} / {@link applyEmotion}).
   * This makes the Ear Runtime self-driven so idle / AFK procedural motion keeps
   * progressing on both the main avatar and the independent Mirror Overlay.
   */
  syncEarState(mode: AvatarProceduralMode, emotion: string): void {
    this.earBehaviorRuntime.setProfile(mode)
    this.tailBehaviorRuntime.setProfile(mode)
    if (emotion === this.currentEmotionKey) {
      this.earBehaviorRuntime.applyEmotion(this.currentEmbodimentProfile)
      this.tailBehaviorRuntime.applyEmotion(this.currentEmbodimentProfile.id)
      return
    }
    const embodiment = resolveEmotionEmbodimentProfile(emotion)
    this.earBehaviorRuntime.applyEmotion(embodiment)
    this.tailBehaviorRuntime.applyEmotion(embodiment.id)
  }

  triggerEarImpulse(impulse: EarImpulse, identity?: string): boolean {
    return this.earBehaviorRuntime.triggerImpulse(impulse, identity)
  }

  getLastEarImpulseDecision(): ReturnType<EarBehaviorRuntime['getLastImpulseDecision']> {
    return this.earBehaviorRuntime.getLastImpulseDecision()
  }

  setEarAxisOverride(axis: EarAxisOverride): void {
    this.earBehaviorRuntime.setAxisOverride(axis)
  }

  setEarAmplitudeScale(scale: number): void {
    this.earBehaviorRuntime.setAmplitudeScale(scale)
  }
}
