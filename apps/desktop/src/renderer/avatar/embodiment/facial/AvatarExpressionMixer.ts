import type { VRM } from '@pixiv/three-vrm'

import { facialTuning } from '../../tuning/facialTuning'
import { resolveEffectiveBlinkProfile } from './BlinkProfileResolver'
import type {
  BlinkTuningDebug,
  ExpressionSource,
  FacialDebugState,
  FacialExpressionEntry,
  MouthTuningDebug,
} from './FacialDebugTypes'
import { FacialDiagnostics, type FacialLifecycleState } from './FacialDiagnostics'
import {
  completeMouthWeights,
  type FacialProfile,
  getFacialProfile,
  type MouthWeights,
  VISEME_NAMES,
  type VisemeName,
} from './FacialProfile'
import type { MouthClosureDebug } from './MouthClosureController'
import type { SpeakingEyeDebug } from './SpeakingEyeController'

export type {
  BlinkTuningDebug,
  ExpressionSource,
  FacialDebugState,
  FacialExpressionEntry,
  FacialSourceLifecycleDebug,
  MouthTuningDebug,
  SourceLifecycleStatus,
} from './FacialDebugTypes'

/**
 * AvatarExpressionMixer — the single authority over VRM facial expressions.
 *
 * Facial motion is produced by several independent sources (Auto Blink, LipSync,
 * Emotion Runtime, LookAt). Historically each wrote into the VRM Expression
 * Manager directly, which produced conflicts (eyes vanishing on blink, unstable
 * mouth during speech, competing expression writes, multiple `manager.update()`
 * calls per frame).
 *
 * The mixer collects each source's contribution into a disjoint expression
 * *domain*, resolves them deterministically, and performs the ONE authoritative
 * write per frame. No other component may call `expressionManager.setValue`.
 *
 * Domain ownership (no domain may overwrite another):
 *   - Auto Blink  -> blink / blinkLeft / blinkRight
 *   - LipSync     -> aa / ih / ou (mouth)
 *   - Emotion     -> happy / angry / sad / surprised / relaxed / neutral / ...
 *   - LookAt      -> eye direction (owned by `vrm.lookAt`; the mixer never writes
 *                    look* expressions so gaze stays independent)
 *
 * Body (skeletal) animation is a separate pipeline entirely; VRMA facial tracks
 * are stripped before playback (see VrmModel.loadAnimation) so clips only drive
 * bones.
 */

const MOUTH_NAMES = VISEME_NAMES

// VRM lookAt preset expressions — owned by the LookAt domain (vrm.lookAt), so the
// mixer must never zero or write them.
const LOOKAT_NAMES = new Set(['lookUp', 'lookDown', 'lookLeft', 'lookRight'])

export class AvatarExpressionMixer {
  private vrm: VRM | null = null
  private blinkNames: string[] = []
  private blinkNameSet = new Set<string>()
  private supportedNames = new Set<string>()
  private currentProfile: FacialProfile = getFacialProfile('neutral')
  private unsupportedExpressionRequests = new Set<string>()

  // Domain contributions for the current frame.
  private blinkWeight = 0
  private mouth: MouthWeights = completeMouthWeights({})
  private emotion = new Map<string, number>()
  private lookAtActive = false
  private speakingEyeLeft = 0
  private speakingEyeRight = 0
  private mouthClosure = 0
  /** Expression names the Speaking Eye squint targets (per eye when available). */
  private squintLeftName: string | null = null
  private squintRightName: string | null = null
  private speakingEyeDebug: SpeakingEyeDebug | null = null
  private mouthClosureDebug: MouthClosureDebug | null = null
  private appliedSquintLeft = 0
  private appliedSquintRight = 0
  private squintHeadroom = 0

  private lastFinal = new Map<string, FacialExpressionEntry>()
  /** Expression names the mixer wrote a non-zero value for last frame. */
  private writtenNames = new Set<string>()
  private vrmaFacialTracksDisabled = 0
  private frame = 0
  private clockMs = 0
  private lastDeltaMs = 16.67
  private diagnostics = new FacialDiagnostics()
  private lastFinalValues: Record<string, number> = {}
  private sourceLifecycle = new Map<ExpressionSource, FacialLifecycleState>()
  private mouthTuning: MouthTuningDebug = {
    attached: false,
    envelope: 0,
    openness: 0,
    raw: completeMouthWeights({}),
    afterSilenceThreshold: completeMouthWeights({}),
    afterAttackRelease: completeMouthWeights({}),
    afterMouthClosedBias: completeMouthWeights({}),
    afterClamp: completeMouthWeights({}),
    filtered: completeMouthWeights({}),
    clamped: completeMouthWeights({}),
    final: completeMouthWeights({}),
    speechEnergy: 0,
    playbackItemId: '',
    analyserAttached: false,
    lipSyncActive: false,
    currentRawRms: 0,
    currentNormalizedEnergy: 0,
    currentMouthOpenness: 0,
    antiStallActive: false,
    activeVisemes: [],
    visemeBlend: completeMouthWeights({}),
    releaseStage: 'closed',
    mouthClosedBias: 0,
    signalWarning: null,
    attackPerSecond: 0,
    releasePerSecond: 0,
    silentReleasePerSecond: 0,
    detachedReleasePerSecond: 0,
    silenceThreshold: 0,
    clamps: completeMouthWeights({ aa: 1, ih: 1, ou: 1, ee: 1, oh: 1 }),
    stats: {
      playbackSeq: 0,
      frameCount: 0,
      averageOpenness: 0,
      peakOpenness: 0,
      percentHighOpen: 0,
      percentClosed: 0,
      longestOpenMs: 0,
      releaseAfterDetachMs: null,
      saturatedSignal: false,
      nonZeroEnergyFrames: 0,
      audibleDeadMouthMs: 0,
      audibleDeadMouthFrames: 0,
      antiStallActivationCount: 0,
    },
  }
  private blinkTuning: BlinkTuningDebug = {
    weight: 0,
    rawWeight: 0,
    finalWeight: 0,
    phase: 'idle',
    triggerReason: 'scheduled',
    proceduralMode: 'idle',
    emotion: 'neutral',
    profileId: 'idle',
    configuredProfile: resolveEffectiveBlinkProfile('idle', 'neutral'),
    activeProfileSnapshot: null,
    sequenceState: 'none',
    blinkCount: 0,
    doubleBlinkCount: 0,
    duration: 0,
    targetWeight: 0,
    intervalMin: 0,
    intervalMax: 0,
    weightMin: 0,
    weightMax: 0,
    blinkMax: 1,
    nextBlinkIn: 0,
    cooldownRemaining: 0,
    cooldown: 0,
    source: 'AutoBlink',
  }

  attach(vrm: VRM): void {
    this.detach()
    this.vrm = vrm

    const manager = vrm.expressionManager
    const allNames = Object.keys(manager?.expressionMap ?? {})
    this.supportedNames = new Set(allNames)
    this.blinkNames = this.resolveBlinkNames(allNames)
    this.blinkNameSet = new Set(this.blinkNames)
    this.resolveSquintNames(allNames)
    this.unsupportedExpressionRequests = new Set()
    this.writtenNames = new Set()
    this.resetLifecycle()

    this.allowBlinkOverExpressions()

    // TEMP WI12.1 DIAGNOSTIC: model's expression set.
    console.log(
      `[ANIMDBG] mixer attach expressions=[${allNames.join(',')}] blink=[${this.blinkNames.join(',')}]`,
    )
  }

  detach(): void {
    this.vrm = null
    this.blinkNames = []
    this.blinkNameSet = new Set()
    this.supportedNames = new Set()
    this.blinkWeight = 0
    this.mouth = completeMouthWeights({})
    this.emotion.clear()
    this.speakingEyeLeft = 0
    this.speakingEyeRight = 0
    this.mouthClosure = 0
    this.squintLeftName = null
    this.squintRightName = null
    this.lastFinal.clear()
    this.writtenNames = new Set()
    this.lookAtActive = false
    this.frame = 0
    this.clockMs = 0
    this.lastDeltaMs = 16.67
    this.diagnostics.reset()
    this.lastFinalValues = {}
    this.resetLifecycle()
  }

  // ---- domain inputs (called once per frame by each source) ----------------

  beginFrame(delta: number): void {
    this.frame += 1
    this.lastDeltaMs = Math.max(0, delta) * 1000
    this.clockMs += this.lastDeltaMs

    this.refreshBlinkLifecycle()
    this.refreshMouthLifecycle(delta)
    this.refreshEmotionLifecycle(delta)
    this.refreshSpeakingEyeLifecycle()
  }

  setBlink(weight: number): void {
    const raw = this.clamp(weight)
    this.blinkWeight = Math.min(this.blinkTuning.blinkMax || 1, raw)
    this.blinkTuning = {
      ...this.blinkTuning,
      rawWeight: raw,
      finalWeight: this.blinkWeight,
      weight: this.blinkWeight,
    }
    this.markSource('autoBlink', { blink: raw })
  }

  setMouth(weights: Partial<MouthWeights>): void {
    this.mouth = completeMouthWeights(
      Object.fromEntries(
        MOUTH_NAMES.map((name) => [name, this.clamp(weights[name] ?? 0)]),
      ) as Partial<MouthWeights>,
    )
    this.markSource('lipSync', this.mouth)
  }

  setEmotion(values: Map<string, number>): void {
    this.emotion = new Map(values)
    this.markSource(
      'emotion',
      Object.fromEntries([...this.emotion].map(([name, value]) => [name, this.clamp(value)])),
    )
  }

  setLookAtActive(active: boolean): void {
    this.lookAtActive = active
    this.markSource('lookAt', { active: active ? 1 : 0 })
  }

  setSpeakingEye(left: number, right: number): void {
    this.speakingEyeLeft = this.clamp(left)
    this.speakingEyeRight = this.clamp(right)
    this.markSource('speakingEye', { left: this.speakingEyeLeft, right: this.speakingEyeRight })
  }

  setMouthClosure(strength: number): void {
    this.mouthClosure = this.clamp(strength)
  }

  setSpeakingEyeDebug(debug: SpeakingEyeDebug): void {
    this.speakingEyeDebug = debug
  }

  setMouthClosureDebug(debug: MouthClosureDebug): void {
    this.mouthClosureDebug = debug
  }

  setFacialProfile(profile: FacialProfile): void {
    this.currentProfile = profile
  }

  setMouthDebug(debug: MouthTuningDebug): void {
    this.mouthTuning = debug
  }

  setBlinkDebug(debug: BlinkTuningDebug): void {
    this.blinkTuning = debug
  }

  notifyVrmaFacialTracksDisabled(count: number): void {
    this.vrmaFacialTracksDisabled = count
  }

  /**
   * Combine every domain and perform the single authoritative write into the VRM
   * Expression Manager. Does NOT call `manager.update()` — VrmModel.vrm.update()
   * runs it exactly once per frame after this.
   */
  apply(): void {
    const manager = this.vrm?.expressionManager
    if (!manager) return

    const final = new Map<string, FacialExpressionEntry>()

    // Emotion domain first — but never touching mouth, blink or lookAt names.
    for (const [name, value] of this.emotion) {
      if (
        this.blinkNameSet.has(name) ||
        MOUTH_NAMES.includes(name as VisemeName) ||
        LOOKAT_NAMES.has(name)
      ) {
        continue
      }
      if (!this.isSupportedExpression(name)) continue
      const v = this.clamp(value)
      if (v > 0.001) final.set(name, { expression: name, value: v, source: 'emotion' })
    }

    // Mouth domain (LipSync) — the Mouth Closure Envelope multiplies the final
    // mouth value so the lips briefly meet without rewriting the LipSync signal.
    const closureGain = 1 - this.mouthClosure
    for (const name of MOUTH_NAMES) {
      if (!this.isSupportedExpression(name)) continue
      const v = this.clamp(this.mouth[name] * closureGain)
      if (v > 0.001) final.set(name, { expression: name, value: v, source: 'lipSync' })
    }

    // Eye domain: Blink and the Speaking Eye micro-expression share the eye
    // expressions. Blink owns full closure and always wins via max; the squint
    // only shows through where Blink is not already more closed. This is why the
    // eyes ease back to the *current* drifting squint after a blink rather than
    // to one fixed openness.
    const eyeValues = new Map<string, FacialExpressionEntry>()
    if (this.blinkWeight > 0.001) {
      for (const name of this.blinkNames) {
        if (!this.isSupportedExpression(name)) continue
        eyeValues.set(name, {
          expression: name,
          value: this.clamp(this.blinkWeight),
          source: 'autoBlink',
        })
      }
    }
    // Speaking Eye squint composes WITHIN the headroom left by the emotion's own
    // eye narrowing, so a strongly narrowed emotion (angry/happy) does not stack
    // an extra squint on top and turn the eyes into slits. Blink is untouched and
    // still wins full closure below.
    const emotionEyeSquint = this.computeEmotionEyeSquint()
    this.squintHeadroom = Math.max(
      0,
      facialTuning.facialComposition.maxSpeakingSquint - emotionEyeSquint,
    )
    this.appliedSquintLeft = Math.min(this.speakingEyeLeft, this.squintHeadroom)
    this.appliedSquintRight = Math.min(this.speakingEyeRight, this.squintHeadroom)
    this.mergeSquint(eyeValues, this.squintLeftName, this.appliedSquintLeft)
    this.mergeSquint(eyeValues, this.squintRightName, this.appliedSquintRight)
    for (const entry of eyeValues.values()) final.set(entry.expression, entry)

    // Write ONLY the expressions the mixer owns this frame, plus a zero for any
    // it wrote last frame but no longer contributes (to release finished
    // emotions / blinks / mouth). Expressions the mixer never touches — e.g. the
    // model's own default eye/brow state — are LEFT ALONE, matching the previous
    // per-source behaviour and avoiding accidental suppression (eyes vanishing).
    // VRMA facial curves are already stripped in VrmModel.loadAnimation, so the
    // mixer does not need to blanket-zero every expression to stay authoritative.
    const namesToWrite = new Set<string>([...this.writtenNames, ...final.keys()])
    for (const name of namesToWrite) {
      if (LOOKAT_NAMES.has(name)) continue
      const entry = final.get(name)
      this.setValueSafe(manager, name, entry ? entry.value : 0)
    }
    this.writtenNames = new Set(final.keys())

    this.lastFinal = final
    this.lastFinalValues = Object.fromEntries(
      [...final.values()].map((entry) => [entry.expression, Number(entry.value.toFixed(3))]),
    )
    this.updateSourceFinals(final)
    this.diagnostics.updateStuckWarnings(
      this.sourceLifecycle,
      this.blinkWeight,
      this.mouth,
      this.lastDeltaMs,
    )
    this.diagnostics.logLifecycleTransitions(this.sourceLifecycle, this.frame, this.clockMs)
    this.diagnostics.logFacialFrame(
      this.sourceLifecycle,
      this.mouth,
      this.blinkWeight,
      this.lastFinalValues,
    )
  }

  getDebugState(): FacialDebugState {
    const sources = new Set<ExpressionSource>()
    for (const entry of this.lastFinal.values()) sources.add(entry.source)
    if (this.lookAtActive) sources.add('lookAt')

    const emotion: Record<string, number> = {}
    for (const [name, value] of this.emotion) {
      if (value > 0.001) emotion[name] = Number(value.toFixed(2))
    }

    return {
      currentProfile: this.currentProfile.id,
      expressionBlend: this.diagnostics.roundValues(this.currentProfile.expressionWeights),
      supportedExpressions: [...this.supportedNames].sort(),
      supportedVisemes: MOUTH_NAMES.filter((name) => this.supportedNames.has(name)),
      unsupportedExpressionRequests: [...this.unsupportedExpressionRequests].sort(),
      releaseCurve: `${this.currentProfile.releaseProfile.curve} ${this.currentProfile.releaseProfile.releaseDurationMs}ms`,
      eyeProfile: { ...this.currentProfile.eyeProfile },
      mouthProfile: { ...this.currentProfile.mouthProfile },
      activeSources: [...sources],
      entries: [...this.lastFinal.values()]
        .map((entry) => ({ ...entry, value: Number(entry.value.toFixed(2)) }))
        .sort((a, b) => b.value - a.value),
      blink: Number(this.blinkWeight.toFixed(2)),
      mouth: {
        aa: Number(this.mouth.aa.toFixed(2)),
        ih: Number(this.mouth.ih.toFixed(2)),
        ou: Number(this.mouth.ou.toFixed(2)),
        ee: Number(this.mouth.ee.toFixed(2)),
        oh: Number(this.mouth.oh.toFixed(2)),
      },
      emotion,
      finalValues: { ...this.lastFinalValues },
      sourceLifecycle: [...this.sourceLifecycle.entries()].map(([source, state]) => ({
        source,
        active: state.active,
        lastUpdateMs:
          state.lastUpdateMs === null
            ? null
            : Math.max(0, Math.round(this.clockMs - state.lastUpdateMs)),
        raw: this.diagnostics.roundValues(state.raw),
        final: this.diagnostics.roundValues(state.final),
        status: state.status,
        maxObservedValue: Number(state.maxObservedValue.toFixed(2)),
        stuckWarning: state.stuckWarning,
      })),
      stuckWarnings: [...this.sourceLifecycle.values()]
        .map((state) => state.stuckWarning)
        .filter((value): value is string => Boolean(value)),
      mouthTuning: {
        ...this.mouthTuning,
        attached: this.mouthTuning.attached,
        envelope: Number(this.mouthTuning.envelope.toFixed(3)),
        openness: Number(this.mouthTuning.openness.toFixed(2)),
        raw: this.diagnostics.roundMouthWeights(this.mouthTuning.raw),
        afterSilenceThreshold: this.diagnostics.roundMouthWeights(
          this.mouthTuning.afterSilenceThreshold,
        ),
        afterAttackRelease: this.diagnostics.roundMouthWeights(this.mouthTuning.afterAttackRelease),
        afterMouthClosedBias: this.diagnostics.roundMouthWeights(
          this.mouthTuning.afterMouthClosedBias,
        ),
        afterClamp: this.diagnostics.roundMouthWeights(this.mouthTuning.afterClamp),
        filtered: this.diagnostics.roundMouthWeights(this.mouthTuning.filtered),
        clamped: this.diagnostics.roundMouthWeights(this.mouthTuning.clamped),
        final: this.diagnostics.roundMouthWeights(this.mouth),
        speechEnergy: Number(this.mouthTuning.speechEnergy.toFixed(2)),
        activeVisemes: [...this.mouthTuning.activeVisemes],
        visemeBlend: this.diagnostics.roundMouthWeights(this.mouthTuning.visemeBlend),
        releaseStage: this.mouthTuning.releaseStage,
        clamps: {
          aa: Number(this.mouthTuning.clamps.aa.toFixed(2)),
          ih: Number(this.mouthTuning.clamps.ih.toFixed(2)),
          ou: Number(this.mouthTuning.clamps.ou.toFixed(2)),
          ee: Number(this.mouthTuning.clamps.ee.toFixed(2)),
          oh: Number(this.mouthTuning.clamps.oh.toFixed(2)),
        },
      },
      blinkTuning: {
        ...this.blinkTuning,
        weight: Number(this.blinkTuning.weight.toFixed(2)),
        rawWeight: Number(this.blinkTuning.rawWeight.toFixed(2)),
        finalWeight: Number(this.blinkTuning.finalWeight.toFixed(2)),
        duration: Number(this.blinkTuning.duration.toFixed(2)),
        targetWeight: Number(this.blinkTuning.targetWeight.toFixed(2)),
        intervalMin: Number(this.blinkTuning.intervalMin.toFixed(2)),
        intervalMax: Number(this.blinkTuning.intervalMax.toFixed(2)),
        weightMin: Number(this.blinkTuning.weightMin.toFixed(2)),
        weightMax: Number(this.blinkTuning.weightMax.toFixed(2)),
        blinkMax: Number(this.blinkTuning.blinkMax.toFixed(2)),
        nextBlinkIn: Number(this.blinkTuning.nextBlinkIn.toFixed(2)),
        cooldownRemaining: Number(this.blinkTuning.cooldownRemaining.toFixed(2)),
        cooldown: Number(this.blinkTuning.cooldown.toFixed(2)),
      },
      blinkExpressions: this.blinkNames.slice(),
      vrmaFacialTracksDisabled: this.vrmaFacialTracksDisabled,
      speakingEye: {
        enabled: this.speakingEyeDebug?.enabled ?? false,
        speaking: this.speakingEyeDebug?.speaking ?? false,
        targetLeft: Number((this.speakingEyeDebug?.targetLeft ?? 0).toFixed(3)),
        targetRight: Number((this.speakingEyeDebug?.targetRight ?? 0).toFixed(3)),
        currentLeft: Number((this.speakingEyeDebug?.currentLeft ?? 0).toFixed(3)),
        currentRight: Number((this.speakingEyeDebug?.currentRight ?? 0).toFixed(3)),
        leftOffset: Number((this.speakingEyeDebug?.leftOffset ?? 0).toFixed(3)),
        rightOffset: Number((this.speakingEyeDebug?.rightOffset ?? 0).toFixed(3)),
        nextVariationMs: Math.round(this.speakingEyeDebug?.nextVariationMs ?? 0),
        emotion: this.speakingEyeDebug?.emotion ?? 'neutral',
        leftExpression: this.squintLeftName ?? 'none',
        rightExpression: this.squintRightName ?? 'none',
        finalLeft: Number(this.appliedSquintLeft.toFixed(3)),
        finalRight: Number(this.appliedSquintRight.toFixed(3)),
      },
      mouthClosure: {
        enabled: this.mouthClosureDebug?.enabled ?? false,
        active: this.mouthClosureDebug?.active ?? false,
        strength: Number((this.mouthClosureDebug?.strength ?? this.mouthClosure).toFixed(3)),
        sinceLastClosureMs: Math.round(this.mouthClosureDebug?.sinceLastClosureMs ?? 0),
        nextClosureInMs: Math.round(this.mouthClosureDebug?.nextClosureInMs ?? 0),
        boundary: this.mouthClosureDebug?.boundary ?? false,
        graceRemainingMs: Math.round(this.mouthClosureDebug?.graceRemainingMs ?? 0),
        rawMouthMax: Number(this.maxValue(this.mouth).toFixed(3)),
        finalMouthMax: Number((this.maxValue(this.mouth) * (1 - this.mouthClosure)).toFixed(3)),
      },
    }
  }

  getFinalMouthWeights(): MouthWeights {
    const closureGain = 1 - this.mouthClosure
    return completeMouthWeights(
      Object.fromEntries(
        MOUTH_NAMES.map((name) => [name, this.clamp(this.mouth[name] * closureGain)]),
      ) as Partial<MouthWeights>,
    )
  }

  private resetLifecycle(): void {
    this.sourceLifecycle = new Map()
    for (const source of ['autoBlink', 'lipSync', 'emotion', 'lookAt', 'speakingEye'] as const) {
      this.sourceLifecycle.set(source, {
        active: false,
        lastUpdateFrame: -1,
        lastUpdateMs: null,
        raw: {},
        final: {},
        status: 'inactive',
        loggedStatus: null,
        maxObservedValue: 0,
        stuckWarning: null,
      })
    }
  }

  private refreshBlinkLifecycle(): void {
    const state = this.getSourceState('autoBlink')
    if (state.lastUpdateFrame < this.frame - 1) {
      this.blinkWeight = 0
      state.active = false
      state.raw = { blink: 0 }
      state.status = 'reset'
    }
  }

  private refreshSpeakingEyeLifecycle(): void {
    const state = this.getSourceState('speakingEye')
    if (state.lastUpdateFrame < this.frame - 1) {
      this.speakingEyeLeft = 0
      this.speakingEyeRight = 0
      state.active = false
      state.raw = { left: 0, right: 0 }
      state.status = 'reset'
    }
  }

  private refreshMouthLifecycle(delta: number): void {
    const state = this.getSourceState('lipSync')
    if (state.lastUpdateFrame >= this.frame - 1) return

    const decay = 1 - Math.exp(-Math.max(0, delta) * 18)
    this.mouth = {
      aa: this.approachZero(this.mouth.aa, decay),
      ih: this.approachZero(this.mouth.ih, decay),
      ou: this.approachZero(this.mouth.ou, decay),
      ee: this.approachZero(this.mouth.ee, decay),
      oh: this.approachZero(this.mouth.oh, decay),
    }
    state.active = this.maxValue(this.mouth) > 0.001
    state.raw = completeMouthWeights({})
    state.status = state.active ? 'decaying' : 'reset'
  }

  private refreshEmotionLifecycle(delta: number): void {
    const state = this.getSourceState('emotion')
    if (state.lastUpdateFrame >= this.frame - 1) return

    const decay = 1 - Math.exp(-Math.max(0, delta) * 8)
    for (const [name, value] of this.emotion) {
      const next = this.approachZero(value, decay)
      if (next <= 0.001) this.emotion.delete(name)
      else this.emotion.set(name, next)
    }
    state.active = this.emotion.size > 0
    state.raw = {}
    state.status = state.active ? 'decaying' : 'reset'
  }

  private markSource(source: ExpressionSource, raw: Record<string, number>): void {
    const state = this.getSourceState(source)
    const roundedRaw = Object.fromEntries(
      Object.entries(raw).map(([name, value]) => [name, this.clamp(Number(value) || 0)]),
    )
    state.active =
      this.maxValue(roundedRaw) > 0.001 || (source === 'lookAt' && Boolean(roundedRaw.active))
    state.lastUpdateFrame = this.frame
    state.lastUpdateMs = this.clockMs
    state.raw = roundedRaw
    state.status = state.active ? 'active' : 'reset'
    state.maxObservedValue = Math.max(state.maxObservedValue, this.maxValue(roundedRaw))
    state.stuckWarning = null
  }

  private updateSourceFinals(final: Map<string, FacialExpressionEntry>): void {
    for (const state of this.sourceLifecycle.values()) state.final = {}
    for (const entry of final.values()) {
      const state = this.getSourceState(entry.source)
      state.final[entry.expression] = entry.value
    }
  }

  private getSourceState(source: ExpressionSource): FacialLifecycleState {
    const state = this.sourceLifecycle.get(source)
    if (!state) {
      this.resetLifecycle()
      const rebuilt = this.sourceLifecycle.get(source)
      if (!rebuilt) throw new Error(`Lifecycle state missing after reset for source: ${source}`)
      return rebuilt
    }
    return state
  }

  private isSupportedExpression(name: string): boolean {
    const supported = this.supportedNames.has(name)
    if (!supported) this.unsupportedExpressionRequests.add(name)
    return supported
  }

  private approachZero(value: number, amount: number): number {
    const next = value * (1 - Math.max(0, Math.min(1, amount)))
    return next < 0.001 ? 0 : next
  }

  private maxValue(values: Record<string, number>): number {
    return Object.values(values).reduce(
      (max, value) => Math.max(max, this.clamp(Number(value) || 0)),
      0,
    )
  }

  private resolveBlinkNames(available: string[]): string[] {
    if (available.includes('blink')) return ['blink']
    if (available.includes('blinkLeft') && available.includes('blinkRight'))
      return ['blinkLeft', 'blinkRight']
    return available.filter((name) => /blink|wink/i.test(name))
  }

  /**
   * Pick the expressions the Speaking Eye squint drives. Prefer the per-eye
   * blinkLeft / blinkRight so the micro-expression can carry a small asymmetry
   * even when the Blink domain uses the combined `blink`. Falls back to the
   * resolved blink names (shared with Blink, combined via max in {@link apply}).
   */
  private resolveSquintNames(available: string[]): void {
    if (available.includes('blinkLeft') && available.includes('blinkRight')) {
      this.squintLeftName = 'blinkLeft'
      this.squintRightName = 'blinkRight'
      return
    }
    this.squintLeftName = this.blinkNames[0] ?? null
    this.squintRightName = this.blinkNames[1] ?? this.blinkNames[0] ?? null
  }

  /**
   * Combine a Speaking Eye squint value into the eye expression map. Blink always
   * wins (max) so it never loses full closure; the squint only takes over where
   * it is the larger contribution.
   */
  /**
   * Estimate how much the currently active emotion *expression* morphs already
   * narrow the eyes, so the Speaking Eye squint can be limited to the remaining
   * headroom. Uses per-expression coefficients from tuning; unlisted / opening
   * expressions (e.g. surprised) contribute 0.
   */
  private computeEmotionEyeSquint(): number {
    const coeffs = facialTuning.facialComposition.emotionEyeSquint
    let sum = 0
    for (const [name, value] of this.emotion) {
      const coeff = coeffs[name]
      if (coeff) sum += this.clamp(value) * coeff
    }
    return sum
  }

  private mergeSquint(
    eyeValues: Map<string, FacialExpressionEntry>,
    name: string | null,
    value: number,
  ): void {
    if (!name || value <= 0.001) return
    if (!this.isSupportedExpression(name)) return
    const squint = this.clamp(value)
    const existing = eyeValues.get(name)
    if (existing && existing.value >= squint) return
    eyeValues.set(name, { expression: name, value: squint, source: 'speakingEye' })
  }

  /**
   * Prevent non-blink expressions from suppressing the blink domain via the VRM
   * override system, so the mixer's explicit domain writes are authoritative.
   * (Preserves the prior BlinkController behaviour, now owned by the mixer.)
   */
  private allowBlinkOverExpressions(): void {
    const manager = this.vrm?.expressionManager
    const map = manager?.expressionMap
    if (!manager || !map) return

    for (const [name, expression] of Object.entries(map)) {
      if (!this.blinkNameSet.has(name)) expression.overrideBlink = 'none'
    }
    manager.blinkExpressionNames = this.blinkNames.slice()
  }

  private setValueSafe(
    manager: NonNullable<VRM['expressionManager']>,
    name: string,
    value: number,
  ): void {
    try {
      manager.setValue(name, value)
    } catch {
      // Some VRM models do not define every recommended expression.
    }
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value))
  }
}
