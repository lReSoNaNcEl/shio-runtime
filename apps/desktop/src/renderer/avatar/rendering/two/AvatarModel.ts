import { emotionRegistry } from '../../../../shared/emotion'
import {
  AvatarExpressionMixer,
  type FacialDebugState,
  type FacialTarget,
} from '../../embodiment/facial/AvatarExpressionMixer'
import { BlinkController } from '../../embodiment/facial/BlinkController'
import { resolveEffectiveBlinkProfile } from '../../embodiment/facial/BlinkProfileResolver'
import { ExpressionController } from '../../embodiment/facial/ExpressionController'
import { completeMouthWeights, type MouthWeights } from '../../embodiment/facial/FacialProfile'
import type {
  HeadAttentionImpulse,
  HeadMotionDebugState,
  HeadMotionProfile,
} from '../../embodiment/gaze/HeadMotionRuntime'
import type { LookAtDebugState, LookAtMode } from '../../embodiment/gaze/LookAtRuntime'
import type {
  EarBehaviorDebugState,
  EarImpulse,
} from '../../embodiment/secondary-motion/EarBehaviorRuntime'
import type { TailBehaviorDebugState } from '../../embodiment/secondary-motion/TailBehaviorRuntime'
import {
  PhraseEnvelopeController,
  type SpeechPhrasePhase,
} from '../../embodiment/speech/PhraseEnvelopeController'
import type { SpeechPhraseTimingPlan } from '../../embodiment/speech/SpeechPhraseTiming'
import type { AvatarProceduralMode } from '../../embodiment/types'
import type { AvatarBodyActionDebugState, AvatarPerformanceDebugState } from './AnimationDebugTypes'
import type { AvatarAnimationLoadContext } from './AnimationTypes'

export type {
  AvatarBodyActionDebugState,
  AvatarPerformanceDebugState,
} from './AnimationDebugTypes'
export type { AvatarAnimationLoadContext } from './AnimationTypes'

export interface GazeTarget {
  x: number
  y: number
}
interface PuppetPose {
  yaw: number
  pitch: number
  roll: number
  tail: number
  torsoYaw?: number
  ears: number[]
  pelvisY?: number
}
interface Puppet {
  state: string
  mouthTarget: number
  viseme: string
  time: number
  last: number
  pose: PuppetPose
  gesture: { name: string; start: number } | null
  facialGesture: { name: string; start: number } | null
  externalBlink?: number
  onFrame: ((puppet: Puppet) => void) | null
  model: { camera: Record<string, number[]> }
  load(): Promise<void>
  setEmotion(name: string, intensity: number): boolean
  setMouth(open: number, viseme: string): boolean
  setGaze(x: number, y: number): boolean
  setState(state: string): boolean
  setView(view: string): boolean
  setLiveliness(value: number): boolean
  setRenderQuality(value: string): boolean
  setTailStyle(value: string): boolean
  react(gesture: string): boolean
  stop(): void
  dispose(): void
}

/** Avatar Runtime's concrete S22 adapter. No caller receives the puppet. */
export class AvatarModel {
  private puppet: Puppet | null = null
  private generation = 0
  private readonly mixer = new AvatarExpressionMixer()
  private readonly expressions = new ExpressionController()
  private readonly blink = new BlinkController()
  private readonly phrase = new PhraseEnvelopeController()
  private readonly values = new Map<string, number>()
  private readonly target: FacialTarget = {
    supportedExpressions: [
      ...new Set(emotionRegistry.supported().map((id) => emotionRegistry.avatarExpression(id))),
      'aa',
      'ih',
      'ou',
      'ee',
      'oh',
      'blink',
      'blinkLeft',
      'blinkRight',
    ],
    setValue: (name, value) => this.values.set(name, value),
  }
  private mouth = completeMouthWeights({})
  private emotion = 'neutral'
  private speechEmotion: string | null = null
  private mode: AvatarProceduralMode = 'idle'
  private lookMode: LookAtMode = 'idle'
  private headProfile: HeadMotionProfile = 'idle'
  private gazeTarget: GazeTarget | null = null
  private look = { x: 0, y: 0 }
  private energy = 0
  private intensity = 0.8
  private frame = 0
  private fps = 0
  private lastFrame = 0
  private playing = false
  private loop = false
  private animation = 'neutral_idle'
  private animationStarted = 0
  private duration = 0
  private durations: Record<string, number> = {}
  private context: AvatarAnimationLoadContext | null = null
  private restarts = 0
  private earAmplitude = 1
  private idleGaze: { x: number; y: number; remaining: number } | null = null
  private impulse: { impulse: EarImpulse; accepted: boolean; reason: string } | null = null

  constructor() {
    this.mixer.attach(this.target)
    this.expressions.attach()
    this.blink.attach()
  }

  async load(canvas: HTMLCanvasElement): Promise<void> {
    this.unload()
    const generation = this.generation
    const url = new URL('./shio-2d/runtime.mjs', document.baseURI).href
    const module = (await import(/* @vite-ignore */ url)) as {
      ShioPuppet: new (canvas: HTMLCanvasElement) => Puppet
      GESTURE_DURATIONS: Record<string, number>
    }
    const puppet = new module.ShioPuppet(canvas)
    try {
      puppet.setRenderQuality('auto')
      await puppet.load()
      if (generation !== this.generation) {
        puppet.dispose()
        throw new DOMException('Stale S22 presentation load', 'AbortError')
      }
      this.puppet = puppet
      const portrait = puppet.model.camera.portrait
      puppet.model.camera.face = [
        portrait[0] + portrait[2] * 0.2,
        portrait[1],
        portrait[2] * 0.6,
        portrait[3] * 0.6,
      ]
      this.durations = module.GESTURE_DURATIONS
      this.lastFrame = performance.now()
      puppet.onFrame = () => {
        const now = performance.now()
        const delta = now - this.lastFrame
        if (delta > 0) this.fps += (1000 / delta - this.fps) * 0.08
        this.lastFrame = now
      }
      puppet.setState(this.mode)
    } catch (error) {
      puppet.dispose()
      throw error
    }
  }

  unload(): void {
    this.generation += 1
    this.puppet?.dispose()
    this.puppet = null
    this.playing = false
    this.fps = 0
  }

  dispose(): void {
    this.unload()
    this.mixer.detach()
    this.expressions.detach()
    this.blink.detach()
    this.phrase.reset()
  }

  update(delta: number): void {
    this.frame += 1
    this.mixer.beginFrame(delta)
    this.expressions.setSpeechEnergy(this.energy)
    this.expressions.update(delta)
    this.blink.update(delta)
    this.mixer.setEmotion(this.expressions.getValues())
    this.mixer.setBlinkDebug(this.blink.getDebugState())
    const winkActive = this.puppet?.facialGesture?.name === 'wink'
    this.mixer.setBlink(winkActive ? 0 : this.blink.getWeight())
    this.mixer.setMouth(this.mouth)
    this.mixer.apply()
    const puppet = this.puppet
    if (!puppet) return
    const effectiveEmotion = this.speechEmotion ?? this.emotion
    const visual = emotionRegistry.avatarExpression(effectiveEmotion)
    puppet.setEmotion(visual, Math.min(1, this.values.get(visual) ?? 1) * this.intensity)
    puppet.externalBlink = this.values.get('blink') ?? 0
    const [vowel, openness] = Object.entries(this.getFinalMouthWeights()).sort(
      (a, b) => b[1] - a[1],
    )[0]
    const viseme =
      effectiveEmotion === 'laugh'
        ? 'laugh'
        : effectiveEmotion === 'chuckle'
          ? 'grin'
          : ({ aa: 'a', ih: 'e', ou: 'u', ee: 'e', oh: 'o' } as Record<string, string>)[vowel]
    puppet.setMouth(openness, viseme)
    this.look =
      this.lookMode === 'screenFocus'
        ? { x: -0.35, y: 0.15 }
        : this.lookMode === 'away'
          ? { x: 0.65, y: 0.15 }
          : this.gazeTarget && this.lookMode !== 'thinking'
            ? { ...this.gazeTarget }
            : {
                x: this.lookMode === 'thinking' ? 0.2 : 0,
                y: this.lookMode === 'thinking' ? -0.15 : 0,
              }
    if (this.idleGaze) {
      this.idleGaze.remaining -= delta
      if (this.idleGaze.remaining <= 0 || this.mode !== 'idle') this.idleGaze = null
      else if (this.lookMode === 'idle') this.look = { x: this.idleGaze.x, y: this.idleGaze.y }
    }
    puppet.setGaze(this.look.x, this.look.y)
    if (this.playing && this.duration > 0 && puppet.time - this.animationStarted >= this.duration) {
      if (this.loop) {
        puppet.react(this.animation)
        this.animationStarted = puppet.time
      } else this.playing = false
    }
  }

  async playAnimation(
    id: string,
    loop: boolean,
    context: AvatarAnimationLoadContext,
  ): Promise<void> {
    const native = id === 'neutral_idle' || id === 'neutral2' || id === 'thinking'
    if (native && this.puppet) this.puppet.gesture = null
    if (!native && !this.puppet?.react(id)) throw new Error(`Unsupported S22 gesture: ${id}`)
    this.restarts += this.animation === id ? 1 : 0
    this.animation = id
    this.context = context
    this.loop = loop
    this.playing = Boolean(this.puppet)
    this.duration = this.durations[id] ?? 0
    this.animationStarted = this.puppet?.time ?? 0
  }

  stopAnimation(): void {
    this.playing = false
    this.puppet?.stop()
  }
  setView(view: string, _scale = 1): void {
    if (!this.puppet) return
    // Keep the persisted legacy `bust` key as the full-body S22 framing.
    const key = view === 'full' || view === 'bust' ? 'full' : view === 'face' ? 'face' : 'portrait'
    this.puppet.setView(key)
  }
  setExpressionIntensity(value: number): void {
    this.intensity = Math.max(0, Math.min(1, value))
  }
  setTailStyle(value: 'side' | 'back'): void {
    this.puppet?.setTailStyle(value)
  }
  forceBlink(duration = 1.2): void {
    this.blink.force(duration)
  }
  nudgeMicroMotion(options: {
    headX?: number
    headY?: number
    eyeX?: number
    eyeY?: number
    duration?: number
  }): void {
    if (this.mode === 'idle')
      this.idleGaze = {
        x: options.eyeX ?? (options.headY ?? 0) * 5,
        y: options.eyeY ?? (options.headX ?? 0) * 5,
        remaining: Math.min(3, Math.max(0, options.duration ?? 1)),
      }
  }
  setLookAtTarget(target: GazeTarget | null): boolean {
    this.gazeTarget = target
    return true
  }
  setLookAtMode(mode: LookAtMode): void {
    this.lookMode = mode
  }
  setHeadMotionProfile(profile: HeadMotionProfile): void {
    this.headProfile = profile
  }
  triggerHeadAttentionImpulse(_impulse: HeadAttentionImpulse): boolean {
    return this.puppet?.react('nod') ?? false
  }
  setProceduralMode(mode: AvatarProceduralMode): void {
    this.mode = mode
    this.puppet?.setState(mode)
  }

  applyEmotion(key: string, _legacyExpression?: string): void {
    this.emotion = emotionRegistry.normalize(key)
    this.expressions.applyEmotion(this.speechEmotion ?? this.emotion)
    this.mixer.setFacialProfile(this.expressions.getProfile())
    this.blink.setEffectiveProfile(resolveEffectiveBlinkProfile(this.mode, this.emotion))
  }
  setSpeechDelivery(key: string | null): void {
    this.speechEmotion = key === null ? null : emotionRegistry.normalize(key)
    this.expressions.applyEmotion(this.speechEmotion ?? this.emotion)
    this.mixer.setFacialProfile(this.expressions.getProfile())
    this.blink.setEffectiveProfile(
      resolveEffectiveBlinkProfile(this.mode, this.speechEmotion ?? this.emotion),
    )
  }
  setMouthWeights(weights: Partial<MouthWeights>, _composed = false): void {
    this.mouth = completeMouthWeights(weights)
  }
  setMouthWeight(weight: number): void {
    this.setMouthWeights({ aa: weight })
  }
  setMouthDebug(debug: FacialDebugState['mouthTuning']): void {
    this.mixer.setMouthDebug(debug)
  }
  setSpeechEnergy(energy: number): void {
    this.energy = energy
  }
  startSpeechPhrase(plan: SpeechPhraseTimingPlan): void {
    this.phrase.start(plan)
  }
  updateSpeechPhrase(delta: number, progress: number, energy: number): void {
    this.phrase.update(delta, progress, energy)
  }
  finishSpeechPhrase(): void {
    this.phrase.finish()
  }
  interruptSpeechPhrase(): void {
    this.phrase.interrupt()
    this.setMouthWeights({})
  }
  getSpeechPhrasePhase(): SpeechPhrasePhase {
    return this.phrase.getPhase()
  }
  getFacialDebugState(): FacialDebugState {
    return this.mixer.getDebugState()
  }
  getFinalMouthWeights(): MouthWeights {
    return this.mixer.getDebugState().mouth
  }
  getLookAtDebugState(): LookAtDebugState {
    return {
      mode: this.lookMode,
      target:
        this.lookMode === 'screenFocus'
          ? 'screenContext'
          : this.gazeTarget
            ? 'camera'
            : 'idleOffset',
      eyeYaw: this.look.x,
      eyePitch: this.look.y,
      nextSaccadeMs: 0,
      thinkingTimerMs: 0,
      returnProgress: 1,
      focusHoldMs: 0,
      overshootMs: 0,
      microSaccade: { yaw: 0, pitch: 0 },
      headLagMs: 0,
    }
  }
  getHeadMotionDebugState(): HeadMotionDebugState {
    const pose = this.puppet?.pose
    return {
      profile: this.headProfile,
      activeGenerators: ['idleDrift'],
      yawOffset: pose?.yaw ?? 0,
      pitchOffset: pose?.pitch ?? 0,
      rollOffset: pose?.roll ?? 0,
      motionEnergy: this.energy,
      currentBlend: 1,
      generatorWeights: {
        idleDrift: 1,
        microTilt: 0,
        slowYaw: 0,
        speakingNod: 0,
        listeningTilt: 0,
        thinkingDrift: 0,
      },
      smoothing: 9,
      nextProceduralEventMs: 0,
      attentionImpulseActive: this.impulse?.accepted ?? false,
      authorityWeight: 1,
    }
  }
  getEarBehaviorDebugState(): EarBehaviorDebugState {
    return {
      enabled: Boolean(this.puppet),
      boneStatus: 'S22 articulated ear rig',
      profile: this.mode,
      emotion: this.emotion,
      axisOverride: 'auto',
      amplitudeScale: this.earAmplitude,
      idleMs: 0,
      updateTickCount: this.frame,
      lastDeltaMs: 0,
      activeImpulse: this.impulse?.impulse ?? null,
      left: null,
      right: null,
    }
  }
  getTailBehaviorDebugState(): TailBehaviorDebugState {
    return {
      available: Boolean(this.puppet),
      boneNames: ['S22 tail'],
      yawOffset: this.puppet?.pose.tail ?? 0,
      rollOffset: 0,
      limit: 90,
    }
  }
  triggerEarImpulse(impulse: EarImpulse, _identity?: string): boolean {
    const accepted = this.puppet?.react('ears') ?? false
    this.impulse = { impulse, accepted, reason: accepted ? 'S22 ears' : 'presentation unavailable' }
    return accepted
  }
  getLastEarImpulseDecision(): { impulse: EarImpulse; accepted: boolean; reason: string } | null {
    return this.impulse
  }
  setEarAmplitudeScale(scale: number): void {
    this.earAmplitude = scale
    this.puppet?.setLiveliness(Math.min(1.5, Math.max(0, scale)))
  }
  getPresentationDebugState() {
    return {
      model: 'Shio S22',
      loaded: this.isLoaded(),
      frame: this.frame,
      emotion: this.emotion,
      audibleEmotion: this.speechEmotion,
      mouth: this.getFinalMouthWeights(),
      gaze: { ...this.look },
      nativeGesture: this.puppet?.gesture?.name ?? null,
      nativeState: this.puppet?.state ?? null,
      nativeMouthTarget: this.puppet?.mouthTarget ?? 0,
      nativeViseme: this.puppet?.viseme ?? null,
      nativeFacialGesture: this.puppet?.facialGesture?.name ?? null,
      nativePose: this.puppet
        ? {
            yaw: this.puppet.pose.yaw,
            pitch: this.puppet.pose.pitch,
            roll: this.puppet.pose.roll,
            ears: [...this.puppet.pose.ears],
            tail: this.puppet.pose.tail,
          }
        : null,
    }
  }
  getPerformanceDebugState(): AvatarPerformanceDebugState {
    return { avatarFps: Math.round(this.fps) }
  }
  isLoaded(): boolean {
    return this.puppet !== null
  }
  isAnimationPlaying(): boolean {
    return this.playing
  }
  getBodyActionDebugState(): AvatarBodyActionDebugState {
    const count = this.playing ? 1 : 0
    return {
      activeActionCount: count,
      weightedActionCount: count,
      currentClipName: this.playing ? this.animation : null,
      currentClipDuration: this.duration,
      currentClipTime: Math.max(0, (this.puppet?.time ?? 0) - this.animationStarted),
      transitionRemaining: 0,
      lastLoadSource: this.context?.source ?? 'S22',
      lastLoadReason: this.context?.reason ?? 'native 2D',
      lastLoadAnimationId: this.context?.animationId ?? null,
      lastLoadFile: 'S22 procedural rig',
      restartCount: this.restarts,
      ownershipGapCount: 0,
      lastTransitionEvent: this.playing ? 'S22 playing' : 'S22 idle',
    }
  }
}
