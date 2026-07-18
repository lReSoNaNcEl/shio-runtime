import { type VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { AnimationDiagnostics } from './AnimationDiagnostics'
import { AvatarAnimationLoader } from './AvatarAnimationLoader'
import type { FacialDebugState } from './AvatarExpressionMixer'
import { AvatarFacialRuntime } from './AvatarFacialRuntime'
import { AvatarPerformanceMonitor } from './AvatarPerformanceMonitor'
import { avatarStartupTuning, facialTuning } from './avatarTuning'
import type { EarAxisOverride, EarBehaviorDebugState, EarImpulse } from './EarBehaviorRuntime'
import type { MouthWeights } from './FacialProfile'
import type {
  HeadAttentionImpulse,
  HeadMotionDebugState,
  HeadMotionProfile,
} from './HeadMotionRuntime'
import type { LookAtDebugState, LookAtMode } from './LookAtRuntime'
import type { SpeechPhrasePhase } from './PhraseEnvelopeController'
import { RootMotionController } from './RootMotionController'
import type { SpeechPhraseTimingPlan } from './SpeechPhraseTiming'

export type VrmProceduralMode = 'idle' | 'listening' | 'thinking' | 'speaking'
export type VrmRootMotionPolicy = 'allow' | 'lockY' | 'lockXZ' | 'lockAll'

export interface VrmAnimationLoadContext {
  animationId: string
  file: string
  behaviorId: string
  source: string
  reason: string
  previousAnimationId: string | null
  forceReplay: boolean
  frame?: number
  rootMotionPolicy: VrmRootMotionPolicy
}

export interface VrmBodyActionDebugEntry {
  name: string
  actionInstanceId: number
  clipInstanceId: number
  weight: number
  time: number
  duration: number
  enabled: boolean
  running: boolean
  fadingOut: boolean
  current: boolean
  previous: boolean
}

export interface VrmBodyActionDebugState {
  activeActionCount: number
  weightedActionCount: number
  currentClipName: string | null
  currentClipDuration: number | null
  currentClipTime: number | null
  transitionRemaining: number
  rootMotionPolicy: VrmRootMotionPolicy
  hipsDeltaY: number
  rootDeltaY: number
  maxHipsDeltaY: number
  maxRootDeltaY: number
  lastLoadSource: string
  lastLoadReason: string
  lastLoadAnimationId: string | null
  lastLoadFile: string | null
  restartCount: number
  ownershipGapCount: number
  lastTransitionEvent: string
  clipCache: {
    loads: number
    reuses: number
    hits: number
    misses: number
    parses: number
  }
  facialControlTracksDisabled: number
  facialControlTrackNames: string[]
  frameTrace: VrmTransitionFrameTraceEntry[]
  actions: VrmBodyActionDebugEntry[]
}

export interface VrmPerformanceDebugState {
  avatarFps: number
}

export interface VrmTransitionFrameTraceEntry {
  at: number
  frame: number
  label: string
  animationId: string | null
  previousAnimationId: string | null
  mixerActionCount: number
  bodyActionCount: number
  weightedActionCount: number
  totalEffectiveWeight: number
  hasWeightGap: boolean
  hasZeroWeightedActions: boolean
  currentActionInfluential: boolean
  currentWeight: number
  previousWeight: number
  transitionRemaining: number
  cleanupState: string
  localRootQuaternion: string
  hipsQuaternion: string
  firstBoneChangeAfterPlayFrame: number | null
  framesSincePlayWithoutBoneChange: number | null
  hipsDeltaY: number
  rootDeltaY: number
  mixerActions: VrmBodyActionDebugEntry[]
  actions: VrmBodyActionDebugEntry[]
}

export class VrmModel {
  vrm: VRM | null = null
  private mixer: THREE.AnimationMixer | null = null
  private currentBodyAction: THREE.AnimationAction | null = null
  private previousBodyAction: THREE.AnimationAction | null = null
  private currentBodyClip: THREE.AnimationClip | null = null
  private bodyActions = new Set<THREE.AnimationAction>()
  private fadingOutActions = new Map<
    THREE.AnimationAction,
    { clip: THREE.AnimationClip; startAt: number; endAt: number }
  >()
  private bodyActionNames = new WeakMap<THREE.AnimationAction, string>()
  private bodyClockTime = 0
  private transitionEndTime = 0
  private transitionStartTime = 0
  private animationPlaying = false
  private animationRemaining: number | null = null
  private facialRuntime = new AvatarFacialRuntime()
  private performanceMonitor = new AvatarPerformanceMonitor()
  private rootMotionController = new RootMotionController()
  private animationLoader = new AvatarAnimationLoader((clip) =>
    this.rootMotionController.hasSceneRootPositionTrack(clip),
  )
  private diagnostics = new AnimationDiagnostics(() => ({
    vrm: this.vrm,
    mixer: this.mixer,
    bodyActions: this.bodyActions,
    fadingOutActions: this.fadingOutActions,
    bodyActionNames: this.bodyActionNames,
    currentBodyAction: this.currentBodyAction,
    previousBodyAction: this.previousBodyAction,
    lastLoadContext: this.lastLoadContext,
    bodyFrame: this.bodyFrame,
    bodyClockTime: this.bodyClockTime,
    transitionEndTime: this.transitionEndTime,
    cleanupAllowedAfterFrame: this.cleanupAllowedAfterFrame,
    hipsDeltaY: this._dbgHipsDeltaY,
    rootDeltaY: this._dbgRootDeltaY,
  }))
  private _dbgHipsWorld = new THREE.Vector3()
  private _dbgRootWorld = new THREE.Vector3()
  private _dbgLastHipsY = 0
  private _dbgLastRootY = 0
  private _dbgHipsDeltaY = 0
  private _dbgRootDeltaY = 0
  private _dbgMaxHipsDeltaY = 0
  private _dbgMaxRootDeltaY = 0
  private _dbgLastLoad = 'none'
  private lastLoadContext: VrmAnimationLoadContext | null = null
  private restartCount = 0
  private bodyFrame = 0
  private ownershipGapCount = 0
  private cleanupAllowedAfterFrame = 0
  private transitionSettledLogged = true
  private animationLoadSeq = 0
  private clipCacheStats = {
    loads: 0,
    reuses: 0,
    hits: 0,
    misses: 0,
    parses: 0,
  }
  private lastFacialControlTracksDisabled = 0
  private lastFacialControlTrackNames: string[] = []

  async load(scene: THREE.Scene, buffer: ArrayBuffer): Promise<void> {
    this.facialRuntime.detach()

    if (this.vrm) {
      scene.remove(this.vrm.scene)
      VRMUtils.deepDispose(this.vrm.scene)
      this.vrm = null
    }
    this.mixer = null
    this.resetBodyActionOwnership()
    this.animationPlaying = false
    this.animationRemaining = null

    const blob = new Blob([buffer], { type: 'model/gltf-binary' })
    const blobUrl = URL.createObjectURL(blob)

    try {
      const loader = new GLTFLoader()
      loader.register((parser) => new VRMLoaderPlugin(parser))
      const gltf = await loader.loadAsync(blobUrl)
      const vrm = gltf.userData.vrm as VRM
      VRMUtils.removeUnnecessaryJoints(vrm.scene)
      this.applyStartupTransform(vrm.scene)
      scene.add(vrm.scene)
      this.vrm = vrm
      this.rootMotionController.setAnchorFromVrm(vrm)
      this.mixer = new THREE.AnimationMixer(vrm.scene)
      this.facialRuntime.attach(vrm)
      console.log(
        `[ANIMDBG] avatar startup transform position=${this.formatVector(vrm.scene.position)} rotation=${this.diagnostics.formatEuler(vrm.scene.rotation)}`,
      )
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  }

  /** Load and play a .vrma animation clip retargeted onto the current VRM. */
  async loadAnimation(
    buffer: ArrayBuffer,
    loop = true,
    blendDuration = 0.3,
    context: VrmAnimationLoadContext = {
      animationId: 'external',
      file: 'external',
      behaviorId: 'external',
      source: 'external',
      reason: 'external load',
      previousAnimationId: null,
      forceReplay: false,
      rootMotionPolicy: 'allow',
    },
  ): Promise<void> {
    if (!this.vrm || !this.mixer) {
      throw new Error('Сначала загрузите VRM-модель')
    }

    const blob = new Blob([buffer], { type: 'model/gltf-binary' })
    const blobUrl = URL.createObjectURL(blob)
    const loadSeq = ++this.animationLoadSeq

    try {
      this.diagnostics.logAnimationTransition('before loadAnimation', context)
      // S3.1 recovery: VRM-bound AnimationClip reuse is disabled because it broke
      // playback before action activation. Keep only the existing ArrayBuffer cache.
      const cachedClip: THREE.AnimationClip | null = null
      const cacheHit = Boolean(cachedClip)
      this.clipCacheStats.loads += 1
      if (cacheHit) this.clipCacheStats.hits += 1
      else this.clipCacheStats.misses += 1

      let clip: THREE.AnimationClip
      let facialTrackCount = 0
      let facialControlTrackNames: string[] = []
      let bindDurationMs = 0
      let hasSceneRootPositionTrack = false
      if (cachedClip) {
        clip = cachedClip
        this.clipCacheStats.reuses += 1
      } else {
        if (loadSeq !== this.animationLoadSeq) {
          console.log(
            `[ANIMDBG] discard stale animation load animation=${context.animationId} file=${context.file} source=${context.source} frame=${context.frame ?? 'n/a'} seq=${loadSeq}->${this.animationLoadSeq}`,
          )
          return
        }

        const loaded = await this.animationLoader.load(
          blobUrl,
          this.vrm,
          context,
          () => loadSeq === this.animationLoadSeq,
        )
        if (!loaded) {
          console.log(
            `[ANIMDBG] discard stale animation load animation=${context.animationId} file=${context.file} source=${context.source} frame=${context.frame ?? 'n/a'} seq=${loadSeq}->${this.animationLoadSeq}`,
          )
          return
        }
        clip = loaded.clip
        facialTrackCount = loaded.facialTracksRemoved
        facialControlTrackNames = loaded.facialTrackNames
        bindDurationMs = loaded.bindDuration
        hasSceneRootPositionTrack = loaded.hasSceneRootTrack
        this.clipCacheStats.parses = this.animationLoader.parses
      }
      if (cachedClip)
        hasSceneRootPositionTrack = this.rootMotionController.hasSceneRootPositionTrack(clip)

      this.facialRuntime.notifyVrmaFacialTracksDisabled(facialTrackCount)
      if (this.lastLoadContext?.animationId === context.animationId) this.restartCount += 1
      this.lastLoadContext = context

      this.cleanupExpiredActions(false)
      const previousAction = this.currentBodyAction
      const previousClip = this.currentBodyClip
      const isInitialBodyAction = previousAction === null && this.currentBodyAction === null
      const safeBlendDuration = Math.max(0, blendDuration)

      const action = this.mixer.clipAction(clip)
      this.diagnostics.ensureClipInstanceId(clip)
      this.bodyActionNames.set(action, clip.name || `body-${Date.now()}`)
      this.diagnostics.assignActionId(action)
      this.diagnostics.recordFrameTrace('after clipAction before reset')
      action.reset()
      this.diagnostics.recordFrameTrace('after action.reset before configure')
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
      action.clampWhenFinished = !loop
      action.enabled = true
      action.paused = false
      action.setEffectiveTimeScale(1)
      action.setEffectiveWeight(
        previousAction && safeBlendDuration > 0
          ? facialTuning.animation.minimumTransitionWeight
          : 1,
      )
      this.diagnostics.recordFrameTrace('after action enabled before play')
      action.play()
      if (isInitialBodyAction) {
        this.mixer.update(0)
      }
      this.diagnostics.startActionInfluenceProbe(action, context)
      this.diagnostics.recordFrameTrace('after action.play before transition policy')

      if (previousAction && previousClip && safeBlendDuration > 0) {
        previousAction.stopFading()
        action.stopFading()
        previousAction.setEffectiveWeight(1 - facialTuning.animation.minimumTransitionWeight)
        action.setEffectiveWeight(facialTuning.animation.minimumTransitionWeight)
        this.diagnostics.recordFrameTrace('after normalized crossfade weights initialized')
        this.previousBodyAction = previousAction
        this.transitionStartTime = this.bodyClockTime
        this.fadingOutActions.set(previousAction, {
          clip: previousClip,
          startAt: this.bodyClockTime,
          endAt: this.bodyClockTime + safeBlendDuration,
        })
        this.transitionEndTime = Math.max(
          this.transitionEndTime,
          this.bodyClockTime + safeBlendDuration,
        )
        this.cleanupAllowedAfterFrame = this.bodyFrame + facialTuning.animation.cleanupGraceFrames
        this.transitionSettledLogged = false
      } else {
        this.diagnostics.recordFrameTrace('before stop previous immediate transition')
        this.stopAndUncacheAction(previousAction, previousClip)
        action.setEffectiveWeight(1)
        this.diagnostics.recordFrameTrace('after stop previous before ownership swap')
        this.previousBodyAction = null
        this.transitionStartTime = this.bodyClockTime
        this.transitionEndTime = this.bodyClockTime
        this.cleanupAllowedAfterFrame = this.bodyFrame
        this.transitionSettledLogged = true
      }

      this.bodyActions.add(action)
      this.currentBodyAction = action
      this.currentBodyClip = clip
      this.animationPlaying = true
      this.animationRemaining = loop ? null : clip.duration
      this.diagnostics.recordFrameTrace('after ownership assigned')

      const actionCount = (this.mixer as unknown as { _actions?: unknown[] })._actions?.length ?? -1
      this._dbgLastLoad = `${context.animationId}/${context.file}/dur${clip.duration.toFixed(1)}/t+0/source=${context.source}/policy=${context.rootMotionPolicy}`
      console.log(
        `[ANIMDBG] load animation=${context.animationId} file=${context.file} behavior=${context.behaviorId} source=${context.source} reason="${context.reason}" prev=${context.previousAnimationId ?? 'none'} forceReplay=${context.forceReplay} frame=${context.frame ?? 'n/a'} loop=${loop} dur=${clip.duration.toFixed(2)} tracks=${clip.tracks.length} facialStripped=${facialTrackCount} facialBoneStripped=${facialControlTrackNames.length} facialBoneTracks=[${facialControlTrackNames.join(',') || 'none'}] rootPolicy=${context.rootMotionPolicy} sceneRootPositionTrack=${hasSceneRootPositionTrack} rootCompensation=${context.rootMotionPolicy !== 'allow'} blend=${blendDuration} actions=${actionCount} restartCount=${this.restartCount} cache=${cacheHit ? 'hit' : 'miss'} clipLoads=${this.clipCacheStats.loads} clipReuses=${this.clipCacheStats.reuses} parses=${this.clipCacheStats.parses} bindMs=${Math.round(bindDurationMs)}`,
      )
      this.diagnostics.logAnimationTransition('after loadAnimation', context)
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  }

  stopAnimation(): void {
    this.diagnostics.logAnimationTransition('before stopAnimation')
    console.log(
      `[ANIMDBG] stopAnimation had=${Boolean(this.currentBodyAction)} remaining=${this.animationRemaining}`,
    )
    if (this.currentBodyAction && this.currentBodyClip) {
      const action = this.currentBodyAction
      const clip = this.currentBodyClip
      const fadeDuration = 0.3
      action.fadeOut(fadeDuration)
      this.previousBodyAction = action
      this.fadingOutActions.set(action, {
        clip,
        endAt: this.bodyClockTime + fadeDuration,
      })
      this.transitionEndTime = Math.max(this.transitionEndTime, this.bodyClockTime + fadeDuration)
      this.currentBodyAction = null
      this.currentBodyClip = null
    }
    this.animationPlaying = false
    this.animationRemaining = null
    this.diagnostics.logAnimationTransition('after stopAnimation')
  }

  update(delta: number): void {
    if (!this.vrm) return
    this.performanceMonitor.updatePerformanceDebug(delta)

    this.facialRuntime.removeProceduralMotion()

    // --- Body pipeline: VRMA clip drives the skeleton only ---
    this.bodyFrame += 1
    this.bodyClockTime += delta
    this.applyNormalizedCrossfadeWeights()
    this.enforceBodyOwnership('before mixer.update')
    this.diagnostics.recordFrameTrace('before mixer.update')
    if (this.mixer) this.mixer.update(delta)
    this.diagnostics.updateActionInfluenceProbe('after mixer.update')
    this.enforceBodyOwnership('after mixer.update')
    this.rootMotionController.applyRootMotionCompensation(
      this.vrm,
      this.lastLoadContext?.rootMotionPolicy,
    )
    this.cleanupExpiredActions()
    this.diagnostics.recordFrameTrace('after cleanup')
    if (this.animationRemaining !== null) {
      this.animationRemaining -= delta
      if (this.animationRemaining <= 0) {
        console.log('[ANIMDBG] oneshot completion → stopAnimation (remaining<=0)')
        this.stopAnimation()
      }
    }
    this.updateProceduralMotion(delta)

    this.facialRuntime.updateProceduralMotion(delta)

    // TEMP WI12.1 DIAGNOSTIC: detect a per-frame jump of the raw (rendered) hips
    // world position — the "falls from the ceiling" pop — and log it immediately.
    const rawHips = this.vrm.humanoid?.getRawBoneNode('hips')
    if (rawHips) {
      rawHips.getWorldPosition(this._dbgHipsWorld)
      const y = this._dbgHipsWorld.y
      const dy = y - this._dbgLastHipsY
      this._dbgHipsDeltaY = this._dbgLastHipsY === 0 ? 0 : dy
      this._dbgMaxHipsDeltaY = Math.max(this._dbgMaxHipsDeltaY, Math.abs(this._dbgHipsDeltaY))
      if (this._dbgLastHipsY !== 0 && Math.abs(dy) > 0.1) {
        const actions = (this.mixer as unknown as { _actions?: unknown[] })._actions ?? []
        console.log(
          `[ANIMDBG] HIPS JUMP dy=${dy.toFixed(3)} y=${y.toFixed(3)} curWeight=${this.currentBodyAction?.getEffectiveWeight().toFixed(2) ?? 'none'} actions=${actions.length} lastLoad=${this._dbgLastLoad}`,
        )
        this.diagnostics.recordFrameTrace('hips jump')
      }
      this._dbgLastHipsY = y
    }
    this.vrm.scene.getWorldPosition(this._dbgRootWorld)
    const rootY = this._dbgRootWorld.y
    this._dbgRootDeltaY = this._dbgLastRootY === 0 ? 0 : rootY - this._dbgLastRootY
    this._dbgMaxRootDeltaY = Math.max(this._dbgMaxRootDeltaY, Math.abs(this._dbgRootDeltaY))
    this._dbgLastRootY = rootY

    // --- Facial pipeline: each source contributes to its own domain, then the
    // Expression Mixer performs the single authoritative write. LipSync feeds its
    // mouth contribution separately via setMouthWeights(). ---
    this.facialRuntime.update(delta)

    // Single expressionManager.update() for the frame happens inside vrm.update(),
    // which also drives lookAt (eye direction) and spring bones.
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

  setProceduralMode(mode: VrmProceduralMode): void {
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

  syncEarState(mode: VrmProceduralMode, emotion: string): void {
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
    return this.animationPlaying
  }

  getBodyActionDebugState(): VrmBodyActionDebugState {
    const actions = this.diagnostics.getBodyActionDebugEntries()

    return {
      activeActionCount: actions.length,
      weightedActionCount: actions.filter((action) => action.weight > 0.01).length,
      currentClipName: this.currentBodyAction
        ? (this.bodyActionNames.get(this.currentBodyAction) ??
          this.currentBodyClip?.name ??
          'unnamed')
        : null,
      currentClipDuration: this.currentBodyClip?.duration ?? null,
      currentClipTime: this.currentBodyAction?.time ?? null,
      transitionRemaining: Math.max(0, this.transitionEndTime - this.bodyClockTime),
      rootMotionPolicy: this.lastLoadContext?.rootMotionPolicy ?? 'allow',
      hipsDeltaY: this._dbgHipsDeltaY,
      rootDeltaY: this._dbgRootDeltaY,
      maxHipsDeltaY: this._dbgMaxHipsDeltaY,
      maxRootDeltaY: this._dbgMaxRootDeltaY,
      lastLoadSource: this.lastLoadContext?.source ?? 'none',
      lastLoadReason: this.lastLoadContext?.reason ?? 'none',
      lastLoadAnimationId: this.lastLoadContext?.animationId ?? null,
      lastLoadFile: this.lastLoadContext?.file ?? null,
      restartCount: this.restartCount,
      ownershipGapCount: this.ownershipGapCount,
      lastTransitionEvent: this.diagnostics.lastTransitionEvent,
      clipCache: { ...this.clipCacheStats },
      facialControlTracksDisabled: this.lastFacialControlTracksDisabled,
      facialControlTrackNames: [...this.lastFacialControlTrackNames],
      frameTrace: [...this.diagnostics.getFrameTrace()],
      actions,
    }
  }

  private applyStartupTransform(root: THREE.Object3D): void {
    root.position.set(
      avatarStartupTuning.rootPosition.x,
      avatarStartupTuning.rootPosition.y,
      avatarStartupTuning.rootPosition.z,
    )
    root.rotation.set(
      avatarStartupTuning.rootRotation.x,
      avatarStartupTuning.rootRotation.y,
      avatarStartupTuning.rootRotation.z,
    )
    root.updateMatrixWorld(true)
  }

  private formatVector(vector: THREE.Vector3): string {
    return `${vector.x.toFixed(2)},${vector.y.toFixed(2)},${vector.z.toFixed(2)}`
  }

  private cleanupExpiredActions(force = false): void {
    if (!this.mixer) return

    this.applyNormalizedCrossfadeWeights()
    const transitionSettled =
      this.currentBodyAction && (force || this.bodyClockTime >= this.transitionEndTime)
    if (transitionSettled) {
      this.currentBodyAction.enabled = true
      this.currentBodyAction.paused = false
      this.currentBodyAction.setEffectiveWeight(1)
    }

    for (const [action, { clip, endAt }] of [...this.fadingOutActions.entries()]) {
      if (!force && this.bodyClockTime < endAt) continue
      if (!force && this.bodyFrame <= this.cleanupAllowedAfterFrame) continue
      if (!force && this.getTotalBodyWeight() <= facialTuning.animation.ownershipGapWeight) continue
      this.stopAndUncacheAction(action, clip)
      this.fadingOutActions.delete(action)
      if (this.previousBodyAction === action) {
        this.previousBodyAction = null
      }
      if (this.fadingOutActions.size === 0) {
        this.transitionStartTime = this.bodyClockTime
      }
      this.diagnostics.logAnimationTransition('cleanup expired action')
    }

    for (const action of [...this.bodyActions]) {
      if (action === this.currentBodyAction || this.fadingOutActions.has(action)) continue
      this.stopAndUncacheAction(action, action.getClip())
      this.diagnostics.logAnimationTransition('cleanup orphan action')
    }

    if (transitionSettled && this.fadingOutActions.size === 0 && !this.transitionSettledLogged) {
      this.transitionSettledLogged = true
      this.diagnostics.logAnimationTransition('transition settled')
    }
  }

  private enforceBodyOwnership(label: string): void {
    if (!this.currentBodyAction || this.bodyActions.size === 0) return
    const totalWeight = this.getTotalBodyWeight()
    if (totalWeight > facialTuning.animation.ownershipGapWeight) return

    this.ownershipGapCount += 1
    this.currentBodyAction.enabled = true
    this.currentBodyAction.paused = false
    this.currentBodyAction.setEffectiveWeight(facialTuning.animation.minimumTransitionWeight)
    this.diagnostics.logAnimationTransition(`${label} ownership gap repaired`)
  }

  private getTotalBodyWeight(): number {
    return [...this.bodyActions].reduce((sum, action) => sum + action.getEffectiveWeight(), 0)
  }

  private applyNormalizedCrossfadeWeights(): void {
    if (!this.currentBodyAction || !this.previousBodyAction || this.fadingOutActions.size === 0)
      return

    const duration = Math.max(0.0001, this.transitionEndTime - this.transitionStartTime)
    const progress = Math.min(
      1,
      Math.max(0, (this.bodyClockTime - this.transitionStartTime) / duration),
    )
    const newWeight = Math.max(facialTuning.animation.minimumTransitionWeight, progress)
    const oldWeight = Math.max(0, 1 - newWeight)

    this.currentBodyAction.enabled = true
    this.currentBodyAction.paused = false
    this.previousBodyAction.enabled = true
    this.previousBodyAction.paused = false
    this.currentBodyAction.stopFading()
    this.previousBodyAction.stopFading()
    this.currentBodyAction.setEffectiveWeight(newWeight)
    this.previousBodyAction.setEffectiveWeight(oldWeight)
  }

  private stopAndUncacheAction(
    action: THREE.AnimationAction | null,
    clip: THREE.AnimationClip | null,
  ): void {
    if (!action || !clip || !this.mixer) return
    this.diagnostics.recordFrameTrace('before stopAndUncacheAction')
    action.stop()
    this.diagnostics.recordFrameTrace('after action.stop before disable')
    action.enabled = false
    action.setEffectiveWeight(0)
    this.diagnostics.recordFrameTrace('after action disabled before uncache')
    this.bodyActions.delete(action)
    this.fadingOutActions.delete(action)
    this.mixer.uncacheAction(clip)
    this.diagnostics.recordFrameTrace('after mixer.uncacheAction')
  }

  private resetBodyActionOwnership(): void {
    this.currentBodyAction = null
    this.previousBodyAction = null
    this.currentBodyClip = null
    this.bodyActions.clear()
    this.fadingOutActions.clear()
    this.bodyClockTime = 0
    this.transitionStartTime = 0
    this.transitionEndTime = 0
    this.bodyFrame = 0
    this.ownershipGapCount = 0
    this.diagnostics.reset()
    this.cleanupAllowedAfterFrame = 0
    this.transitionSettledLogged = true
    this.animationLoadSeq += 1
    this.clipCacheStats = {
      loads: 0,
      reuses: 0,
      hits: 0,
      misses: 0,
      parses: 0,
    }
  }
}
