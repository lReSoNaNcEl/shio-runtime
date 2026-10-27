import { facialTuning } from '../../tuning/facialTuning'
import { phraseLipSyncTuning } from '../../tuning/speechTuning'
import type { FacialDebugState } from '../facial/AvatarExpressionMixer'
import {
  completeMouthWeights,
  type FacialProfile,
  getFacialProfile,
  type MouthWeights,
  type VisemeName,
} from '../facial/FacialProfile'
import { buildSpeechPhraseTimingPlan } from './SpeechPhraseTiming'

export type { MouthWeights } from '../facial/FacialProfile'

export interface LipSyncSession {
  turnId: string
  playbackId: string
  analyser: AnalyserNode
  startedAt: number
  playbackItemId: string
  normalizationReference: number
  durationMs: number
  durationFinal?: boolean
  getPcmPosition?: () => {
    sourceSampleRate: number
    sourceSampleOffset: number
    state: string
  } | null
}

export interface LipSyncStartRequest {
  session: LipSyncSession
  text: string
  emotionKey: string
}

export interface LipSyncOutput {
  startSpeechPhrase(plan: ReturnType<typeof buildSpeechPhraseTimingPlan>): void
  updateSpeechPhrase(delta: number, progress: number, speechEnergy: number): void
  finishSpeechPhrase(): void
  interruptSpeechPhrase(): void
  setSpeechEnergy(value: number): void
  setMouthWeights(weights: MouthWeights): void
  setMouthDebug(debug: FacialDebugState['mouthTuning']): void
}

interface LipSyncStats {
  playbackSeq: number
  frameCount: number
  sumOpenness: number
  peakOpenness: number
  highOpenFrames: number
  closedFrames: number
  currentOpenMs: number
  longestOpenMs: number
  releaseAfterDetachMs: number | null
  detachAtMs: number | null
  saturatedFrames: number
  nonZeroEnergyFrames: number
  audibleDeadMouthMs: number
  audibleDeadMouthFrames: number
  antiStallActivationCount: number
  opennessBuckets: [number, number, number, number]
}

interface VisemeProfile {
  amplitude: number
  attack: number
  release: number
  hold: number
  overlap: number
}

const VISEME_PROFILES: Record<VisemeName, VisemeProfile> = {
  aa: { amplitude: 1, attack: 1.28, release: 0.78, hold: 0.08, overlap: 0.26 },
  ih: { amplitude: 0.72, attack: 1.38, release: 1.12, hold: 0.02, overlap: 0.18 },
  ou: { amplitude: 0.78, attack: 0.82, release: 0.74, hold: 0.12, overlap: 0.34 },
  ee: { amplitude: 0.68, attack: 0.96, release: 1.04, hold: 0.04, overlap: 0.2 },
  oh: { amplitude: 0.86, attack: 0.92, release: 0.7, hold: 0.16, overlap: 0.32 },
}

type MouthReleaseStage = 'speaking' | 'open' | 'half' | 'closed'

export class LipSync {
  private analyser: AnalyserNode | null = null
  private timeData: Uint8Array<ArrayBuffer> | null = null
  private freqData: Uint8Array<ArrayBuffer> | null = null
  private smoothed: MouthWeights = completeMouthWeights({})
  private rawTarget: MouthWeights = completeMouthWeights({})
  private profiledTarget: MouthWeights = completeMouthWeights({})
  private blendedTarget: MouthWeights = completeMouthWeights({})
  private afterSilenceTarget: MouthWeights = completeMouthWeights({})
  private afterAttackRelease: MouthWeights = completeMouthWeights({})
  private afterClosedBias: MouthWeights = completeMouthWeights({})
  private clampedTarget: MouthWeights = completeMouthWeights({})
  private signalWarning: string | null = null
  private profile: FacialProfile = getFacialProfile('neutral')
  private output: LipSyncOutput
  private previousBlendTarget: MouthWeights = completeMouthWeights({})
  private releaseBase: MouthWeights = completeMouthWeights({})
  private speechEnergy = 0
  private releaseStage: MouthReleaseStage = 'closed'
  private playbackSeq = 0
  private releasing = false
  private silenceMs = 0
  private noisePhase = 0
  private lastEnvelope = 0
  private speechMouthGain = 1
  private stats: LipSyncStats = this.createStats(0)
  private summaryLogged = false
  // Startup grace window (ms remaining) opened on each attach so a soft phrase
  // onset is not zeroed by the closed-mouth bias before the voice ramps up.
  private graceRemainingMs = 0
  // Anti-stall fallback state: guards against a "dead mouth" while audible.
  private stallMs = 0
  private antiStallActive = false
  private fallbackPhase = 0
  private recoveryMs = 0
  private currentRawRms = 0
  private activeSession: LipSyncSession | null = null
  private activityLogged = false
  private phraseElapsedMs = 0
  private phraseDurationMs = 1
  private phrasePlan: ReturnType<typeof buildSpeechPhraseTimingPlan> | null = null

  constructor(output: LipSyncOutput) {
    this.output = output
  }

  setEmotion(emotionKey?: string): void {
    this.profile = getFacialProfile(emotionKey)
    this.speechMouthGain = this.resolveSpeechMouthGain(this.profile.id)
  }

  /**
   * Per-emotion gain guaranteeing readable articulation. Emotions whose
   * FacialProfile scales the mouth down (sad/thinking/embarrassed/…) are lifted
   * back toward readability; well-articulating emotions stay at 1.0. Bounded by
   * the tuning min/max so it can never silence or over-drive the mouth. This is
   * not a global amplitude boost — neutral/happy/angry/surprised remain 1.0.
   */
  private resolveSpeechMouthGain(profileId: string): number {
    const cfg = facialTuning.facialComposition.speechMouthGain
    const gain = cfg.byEmotion[profileId] ?? cfg.default
    return Math.max(cfg.minimum, Math.min(cfg.maximum, gain))
  }

  attach(request: LipSyncStartRequest): void {
    const { session, emotionKey, text } = request
    const plan = buildSpeechPhraseTimingPlan(text)
    this.phrasePlan = plan
    if (this.activeSession) {
      if (this.activeSession.turnId !== session.turnId) {
        throw new Error(
          `LipSync session overlap: activeTurnId=${this.activeSession.turnId} ` +
            `activePlaybackId=${this.activeSession.playbackId} requestedTurnId=${session.turnId} ` +
            `requestedPlaybackId=${session.playbackId}`,
        )
      }

      // A turn may contain multiple sequential audio items. Keep the single
      // turn session alive while replacing only the playback attachment;
      // resetting mouth state here would create an artificial closure between
      // chunks and would incorrectly trip the overlap invariant.
      this.activeSession = session
      this.analyser = session.analyser
      this.analyser.fftSize = 512
      this.analyser.smoothingTimeConstant = facialTuning.lipSync.analyserSmoothing
      this.timeData = new Uint8Array(new ArrayBuffer(this.analyser.fftSize))
      this.freqData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount))
      this.setEmotion(emotionKey)
      this.releasing = false
      this.releaseStage = 'speaking'
      this.graceRemainingMs = facialTuning.lipSync.startupGraceMs
      this.activityLogged = false
      this.phraseElapsedMs = 0
      this.phraseDurationMs = Math.max(1, session.durationMs)
      this.output.startSpeechPhrase(plan)
      console.log(
        `[lipsync] turnId=${session.turnId} playbackId=${session.playbackId} analyser=reattached session=continued`,
      )
      return
    }
    this.playbackSeq += 1
    this.activeSession = session
    this.analyser = session.analyser
    this.analyser.fftSize = 512
    this.analyser.smoothingTimeConstant = facialTuning.lipSync.analyserSmoothing
    this.timeData = new Uint8Array(new ArrayBuffer(this.analyser.fftSize))
    this.freqData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount))
    this.setEmotion(emotionKey)
    this.releasing = false
    this.releaseStage = 'speaking'
    this.releaseBase = completeMouthWeights({})
    this.previousBlendTarget = completeMouthWeights({})
    this.speechEnergy = 0
    this.silenceMs = 0
    this.noisePhase = Math.random() * Math.PI * 2
    this.stats = this.createStats(this.playbackSeq)
    this.summaryLogged = false
    this.graceRemainingMs = facialTuning.lipSync.startupGraceMs
    this.stallMs = 0
    this.antiStallActive = false
    this.fallbackPhase = Math.random() * Math.PI * 2
    this.activityLogged = false
    this.recoveryMs = 0
    this.currentRawRms = 0
    this.phraseElapsedMs = 0
    this.phraseDurationMs = Math.max(1, session.durationMs)
    this.output.startSpeechPhrase(plan)
    console.log(
      `[lipsync] turnId=${session.turnId} playbackId=${session.playbackId} analyser=attached session=started`,
    )
  }

  detach(turnId?: string, immediate = false, interrupted = false): boolean {
    if (turnId && !this.activeSession) {
      console.debug(`[lipsync] turnId=${turnId} stale-stop=ignored reason=no-active-session`)
      return false
    }
    if (turnId && this.activeSession && this.activeSession.turnId !== turnId) {
      console.debug(
        `[lipsync] turnId=${turnId} activeTurnId=${this.activeSession.turnId} stale-stop=ignored`,
      )
      return false
    }
    const stopped = this.activeSession
    this.phrasePlan = null
    this.activeSession = null
    this.analyser = null
    this.timeData = null
    this.freqData = null
    this.rawTarget = completeMouthWeights({})
    this.profiledTarget = completeMouthWeights({})
    this.blendedTarget = completeMouthWeights({})
    this.afterSilenceTarget = completeMouthWeights({})
    this.clampedTarget = completeMouthWeights({})
    this.signalWarning = null
    this.releasing = true
    if (interrupted) this.output.interruptSpeechPhrase()
    else this.output.finishSpeechPhrase()
    this.releaseStage = 'open'
    this.releaseBase = { ...this.smoothed }
    this.silenceMs = 0
    this.lastEnvelope = 0
    this.stats.detachAtMs = performance.now()
    if (immediate) {
      this.smoothed = completeMouthWeights({})
      this.releaseBase = completeMouthWeights({})
      this.afterAttackRelease = completeMouthWeights({})
      this.afterClosedBias = completeMouthWeights({})
      this.releasing = false
      this.releaseStage = 'closed'
      this.output.setSpeechEnergy(0)
      this.output.setMouthWeights(this.smoothed)
    }
    this.publishDebug()
    console.log(
      `[lipsync] turnId=${stopped?.turnId ?? turnId ?? 'none'} playbackId=${stopped?.playbackId ?? 'none'} session=stopped reset=${immediate ? 'immediate' : 'release'}`,
    )
    return true
  }

  restorePresentation(): void {
    if (!this.activeSession || !this.phrasePlan) return
    // The new VRM has a fresh facial envelope. Retain the AudioPlayer session
    // and consumed PCM position, restoring only its presentation contribution.
    this.output.startSpeechPhrase(this.phrasePlan)
    this.output.updateSpeechPhrase(
      0,
      Math.min(1, this.phraseElapsedMs / this.phraseDurationMs),
      this.speechEnergy,
    )
    this.output.setMouthWeights(this.smoothed)
  }

  getActiveSession(): Readonly<LipSyncSession> | null {
    return this.activeSession ? { ...this.activeSession } : null
  }

  getMouthWeights(): MouthWeights {
    return { ...this.smoothed }
  }

  update(_delta: number): void {
    this.graceRemainingMs = Math.max(0, this.graceRemainingMs - Math.max(0, _delta) * 1000)
    if (this.activeSession) {
      const position = this.activeSession.getPcmPosition?.()
      this.phraseElapsedMs = position
        ? (position.sourceSampleOffset / position.sourceSampleRate) * 1000
        : this.phraseElapsedMs + Math.max(0, _delta) * 1000
      if (position)
        this.phraseDurationMs = Math.max(
          this.activeSession.durationMs,
          this.activeSession.durationFinal ? 1 : this.phraseElapsedMs + 1000,
        )
      this.output.updateSpeechPhrase(
        _delta,
        Math.min(1, this.phraseElapsedMs / this.phraseDurationMs),
        this.speechEnergy,
      )
    } else {
      this.output.updateSpeechPhrase(_delta, 1, 0)
    }

    if (!this.analyser || !this.timeData || !this.freqData) {
      this.rawTarget = completeMouthWeights({})
      this.profiledTarget = completeMouthWeights({})
      this.blendedTarget = this.getDetachedReleaseTarget()
      this.afterSilenceTarget = { ...this.blendedTarget }
      this.clampedTarget = this.clampWeights(this.blendedTarget)
      this.afterAttackRelease = this.smoothWeights(
        this.smoothed,
        this.clampedTarget,
        _delta,
        'detached',
      )
      this.afterClosedBias = this.applyClosedBias(this.afterAttackRelease)
      this.smoothed = this.afterClosedBias
      this.updateAntiStall(_delta, 0)
      this.speechEnergy = this.smoothScalar(this.speechEnergy, 0, _delta, 5.8)
      if (this.releasing && this.maxWeight(this.smoothed) <= 0.01) {
        this.releasing = false
        this.releaseStage = 'closed'
        if (this.stats.detachAtMs !== null) {
          this.stats.releaseAfterDetachMs = performance.now() - this.stats.detachAtMs
        }
        this.logSummary()
      }
      this.recordStats(_delta, false, 0)
      this.updateSignalWarning()
      this.publishDebug()
      this.output.setSpeechEnergy(this.speechEnergy)
      this.output.setMouthWeights(this.smoothed)
      return
    }

    this.analyser.getByteTimeDomainData(this.timeData)
    this.analyser.getByteFrequencyData(this.freqData)

    const rms = this.getRms(this.timeData)
    this.currentRawRms = rms
    const reference = Math.max(0.04, this.activeSession?.normalizationReference ?? 0.12)
    // The per-buffer 80th-percentile reference maps to a readable mid-level
    // envelope; gain remains a bounded artistic tuning rather than compensating
    // for arbitrary file loudness.
    const rawEnergy = Math.min(
      1,
      (rms / reference) * 0.23 * facialTuning.lipSync.gain * this.profile.mouthProfile.gainScale,
    )
    if (!this.activityLogged && rawEnergy > facialTuning.lipSync.antiStall.minEnergy) {
      this.activityLogged = true
      console.debug(
        `[lipsync] turnId=${this.activeSession?.turnId ?? 'none'} playbackId=${this.activeSession?.playbackId ?? 'none'} sample=active`,
      )
    }
    this.speechEnergy = this.smoothScalar(
      this.speechEnergy,
      rawEnergy,
      _delta,
      rawEnergy > this.speechEnergy ? 7.5 : 3.6,
    )
    this.lastEnvelope = rawEnergy
    const silent = rawEnergy < facialTuning.lipSync.silenceThreshold
    this.silenceMs = silent ? this.silenceMs + _delta * 1000 : 0
    const bands = this.getBands(this.freqData)
    const target = this.toMouthWeights(rawEnergy, bands)

    this.rawTarget = target.raw
    this.profiledTarget = this.applyVisemeProfiles(target.raw)
    this.blendedTarget = this.blendVisemes(this.profiledTarget, _delta, silent)
    this.afterSilenceTarget = silent ? this.getShortPauseTarget() : this.blendedTarget
    this.clampedTarget = this.clampWeights(
      this.applyProceduralNoise(this.afterSilenceTarget, _delta, this.speechEnergy, silent),
    )
    this.afterAttackRelease = this.smoothWeights(
      this.smoothed,
      this.clampedTarget,
      _delta,
      silent
        ? this.silenceMs >= facialTuning.lipSync.shortPauseAfterMs
          ? 'short-pause'
          : 'silent'
        : 'voiced',
    )
    this.afterClosedBias = this.applyClosedBias(this.afterAttackRelease)
    this.smoothed = this.afterClosedBias
    this.updateAntiStall(_delta, rawEnergy)
    this.recordStats(_delta, true, rawEnergy)
    this.updateSignalWarning()
    this.publishDebug()
    this.output.setSpeechEnergy(this.speechEnergy)
    this.output.setMouthWeights(this.smoothed)
  }

  private applyVisemeProfiles(weights: MouthWeights): MouthWeights {
    return {
      aa: weights.aa * VISEME_PROFILES.aa.amplitude,
      ih: weights.ih * VISEME_PROFILES.ih.amplitude,
      ou: weights.ou * VISEME_PROFILES.ou.amplitude,
      ee: weights.ee * VISEME_PROFILES.ee.amplitude,
      oh: weights.oh * VISEME_PROFILES.oh.amplitude,
    }
  }

  private blendVisemes(target: MouthWeights, delta: number, silent: boolean): MouthWeights {
    if (silent) {
      this.previousBlendTarget = this.smoothWeights(
        this.previousBlendTarget,
        completeMouthWeights({}),
        delta,
        'short-pause',
      )
      return { ...this.previousBlendTarget }
    }

    const blended: MouthWeights = {
      aa:
        target.aa * (1 - VISEME_PROFILES.aa.overlap) +
        this.previousBlendTarget.aa * VISEME_PROFILES.aa.overlap,
      ih:
        target.ih * (1 - VISEME_PROFILES.ih.overlap) +
        this.previousBlendTarget.ih * VISEME_PROFILES.ih.overlap,
      ou:
        target.ou * (1 - VISEME_PROFILES.ou.overlap) +
        this.previousBlendTarget.ou * VISEME_PROFILES.ou.overlap,
      ee:
        target.ee * (1 - VISEME_PROFILES.ee.overlap) +
        this.previousBlendTarget.ee * VISEME_PROFILES.ee.overlap,
      oh:
        target.oh * (1 - VISEME_PROFILES.oh.overlap) +
        this.previousBlendTarget.oh * VISEME_PROFILES.oh.overlap,
    }
    this.previousBlendTarget = this.smoothWeights(
      this.previousBlendTarget,
      blended,
      delta,
      'viseme-switch',
    )
    return blended
  }

  private getShortPauseTarget(): MouthWeights {
    const half = Math.max(0.08, this.maxWeight(this.smoothed) * 0.38)
    if (this.silenceMs < facialTuning.lipSync.shortPauseAfterMs) {
      return this.scaleWeights(this.smoothed, 0.42)
    }
    return this.maxWeight(this.smoothed) > half
      ? this.scaleWeights(this.smoothed, 0.22)
      : completeMouthWeights({})
  }

  private getDetachedReleaseTarget(): MouthWeights {
    if (!this.releasing || this.stats.detachAtMs === null) {
      this.releaseStage = 'closed'
      return completeMouthWeights({})
    }
    const elapsed = performance.now() - this.stats.detachAtMs
    if (elapsed < 90) {
      this.releaseStage = 'open'
      return this.scaleWeights(this.releaseBase, 0.46)
    }
    if (elapsed < 240) {
      this.releaseStage = 'half'
      return this.scaleWeights(this.releaseBase, 0.18)
    }
    this.releaseStage = 'closed'
    return completeMouthWeights({})
  }

  private toMouthWeights(
    energy: number,
    bands: { low: number; mid: number; high: number },
  ): { raw: MouthWeights; clamped: MouthWeights } {
    if (energy <= 0) {
      const closed = completeMouthWeights({})
      return { raw: closed, clamped: closed }
    }

    const total = Math.max(0.001, bands.low + bands.mid + bands.high)
    const low = bands.low / total
    const mid = bands.mid / total
    const high = bands.high / total

    // Emotion character (opennessScale) then the readability gain, so
    // under-articulating emotions stay visible while keeping their softer shape.
    const open = energy * this.profile.mouthProfile.opennessScale * this.speechMouthGain
    const bias = completeMouthWeights(this.profile.visemeBias)
    const scale = completeMouthWeights({
      aa: this.profile.visemeScale.aa ?? 1,
      ih: this.profile.visemeScale.ih ?? 1,
      ou: this.profile.visemeScale.ou ?? 1,
      ee: this.profile.visemeScale.ee ?? 1,
      oh: this.profile.visemeScale.oh ?? 1,
    })
    const raw = {
      aa: (open * (0.58 + mid * 0.32 + low * 0.16) + bias.aa) * scale.aa,
      ih: (open * (0.14 + high * 0.95 + mid * 0.25) + bias.ih) * scale.ih,
      ou: (open * (0.22 + low * 0.9) + bias.ou) * scale.ou,
      ee: (open * (0.12 + high * 0.7 + mid * 0.45) + bias.ee) * scale.ee,
      oh: (open * (0.18 + low * 0.55 + mid * 0.18) + bias.oh) * scale.oh,
    }

    return {
      raw,
      clamped: this.clampWeights(raw),
    }
  }

  private clampWeights(weights: MouthWeights): MouthWeights {
    const limited = this.limitPeak(weights)
    return {
      aa: Math.min(facialTuning.lipSync.clamps.aa, limited.aa),
      ih: Math.min(facialTuning.lipSync.clamps.ih, limited.ih),
      ou: Math.min(facialTuning.lipSync.clamps.ou, limited.ou),
      ee: Math.min(facialTuning.lipSync.clamps.ee, limited.ee),
      oh: Math.min(facialTuning.lipSync.clamps.oh, limited.oh),
    }
  }

  private applyProceduralNoise(
    weights: MouthWeights,
    delta: number,
    energy: number,
    silent: boolean,
  ): MouthWeights {
    if (silent || energy <= facialTuning.lipSync.silenceThreshold) return weights
    this.noisePhase += Math.max(0, delta) * facialTuning.lipSync.proceduralNoiseSpeed
    const amount = facialTuning.lipSync.proceduralNoiseAmplitude * Math.min(1, energy * 2)
    const noise = (offset: number): number => 1 + Math.sin(this.noisePhase + offset) * amount
    return {
      aa: weights.aa * noise(0),
      ih: weights.ih * noise(1.7),
      ou: weights.ou * noise(3.1),
      ee: weights.ee * noise(4.4),
      oh: weights.oh * noise(5.6),
    }
  }

  private limitPeak(weights: MouthWeights): MouthWeights {
    const max = this.maxWeight(weights)
    const limit = facialTuning.lipSync.peakLimit
    if (max <= limit || max <= 0) return weights
    const scale = limit / max
    return {
      aa: weights.aa * scale,
      ih: weights.ih * scale,
      ou: weights.ou * scale,
      ee: weights.ee * scale,
      oh: weights.oh * scale,
    }
  }

  private getRms(data: Uint8Array<ArrayBuffer>): number {
    let sum = 0
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128
      sum += v * v
    }
    return Math.sqrt(sum / data.length)
  }

  private getBands(data: Uint8Array<ArrayBuffer>): { low: number; mid: number; high: number } {
    const lowEnd = Math.max(1, Math.floor(data.length * 0.18))
    const midEnd = Math.max(lowEnd + 1, Math.floor(data.length * 0.52))
    return {
      low: this.averageBand(data, 1, lowEnd),
      mid: this.averageBand(data, lowEnd, midEnd),
      high: this.averageBand(data, midEnd, data.length),
    }
  }

  private averageBand(data: Uint8Array<ArrayBuffer>, start: number, end: number): number {
    let sum = 0
    const count = Math.max(1, end - start)
    for (let i = start; i < end; i++) sum += data[i] / 255
    return sum / count
  }

  private smoothWeights(
    a: MouthWeights,
    b: MouthWeights,
    delta: number,
    releaseMode: 'voiced' | 'silent' | 'short-pause' | 'detached' | 'viseme-switch',
  ): MouthWeights {
    return {
      aa: this.smoothShape('aa', a.aa, b.aa, delta, releaseMode),
      ih: this.smoothShape('ih', a.ih, b.ih, delta, releaseMode),
      ou: this.smoothShape('ou', a.ou, b.ou, delta, releaseMode),
      ee: this.smoothShape('ee', a.ee, b.ee, delta, releaseMode),
      oh: this.smoothShape('oh', a.oh, b.oh, delta, releaseMode),
    }
  }

  private smoothShape(
    viseme: VisemeName,
    current: number,
    target: number,
    delta: number,
    releaseMode: 'voiced' | 'silent' | 'short-pause' | 'detached' | 'viseme-switch',
  ): number {
    const visemeProfile = VISEME_PROFILES[viseme]
    const holdBias =
      target < current ? visemeProfile.hold * Math.min(1, this.speechEnergy * 1.6) : 0
    const heldTarget = holdBias > 0 ? Math.max(target, current * holdBias) : target
    const profileId =
      this.profile.id === 'happy' ||
      this.profile.id === 'sad' ||
      this.profile.id === 'angry' ||
      this.profile.id === 'surprised'
        ? this.profile.id
        : this.profile.id === 'relaxed'
          ? 'calm'
          : 'neutral'
    const phraseProfile = phraseLipSyncTuning.emotionProfiles[profileId]
    const speed =
      releaseMode === 'viseme-switch'
        ? phraseLipSyncTuning.visemeSwitchSmoothing
        : heldTarget > current
          ? (facialTuning.lipSync.attackPerSecond *
              visemeProfile.attack *
              phraseProfile.attackScale) /
            this.profile.mouthProfile.softness
          : releaseMode === 'detached'
            ? (facialTuning.lipSync.detachedReleasePerSecond * visemeProfile.release) /
              this.profile.mouthProfile.releaseScale
            : releaseMode === 'short-pause'
              ? (facialTuning.lipSync.shortPauseReleasePerSecond * visemeProfile.release) /
                this.profile.mouthProfile.releaseScale
              : releaseMode === 'silent'
                ? (facialTuning.lipSync.silentReleasePerSecond * visemeProfile.release) /
                  this.profile.mouthProfile.releaseScale
                : (facialTuning.lipSync.releasePerSecond * visemeProfile.release) /
                  this.profile.mouthProfile.releaseScale
    const t = 1 - Math.exp(-Math.max(0, delta) * speed)
    const next = this.lerp(current, heldTarget, t)
    return next < 0.001 ? 0 : next
  }

  private applyClosedBias(weights: MouthWeights): MouthWeights {
    const steadyBias = Math.max(
      facialTuning.lipSync.mouthClosedBias,
      this.profile.mouthProfile.closedMouthBias,
    )
    // During the startup grace window relax the closed-mouth bias so a soft
    // phrase onset follows the raw LipSync signal instead of being zeroed into a
    // "dead mouth". Steady-state bias is unchanged once the window elapses.
    const bias =
      this.graceRemainingMs > 0
        ? Math.min(facialTuning.lipSync.startupGraceClosedBias, steadyBias)
        : steadyBias
    const openness = this.sumWeights(weights)
    const closeThreshold = bias
    const openThreshold = bias * 1.35
    const wasOpen = this.sumWeights(this.afterClosedBias) >= closeThreshold
    if (openness < (wasOpen ? closeThreshold : openThreshold)) return completeMouthWeights({})
    const scale = Math.min(1, openness / Math.max(openThreshold, 0.001))
    return this.scaleWeights(weights, scale)
  }

  /**
   * Anti-stall fallback. If audible speech is present but the resolved mouth
   * stays effectively closed for longer than `stallAfterMs` (e.g. a soft-attack
   * passage repeatedly zeroed by the closed-mouth bias), inject a small
   * procedural mouth motion so the mouth is never fully dead while there is
   * audible voice. It only *raises* the floor (never lowers real LipSync output)
   * and disengages the moment the audio goes quiet, so it supplements rather than
   * replaces normal LipSync.
   */
  private updateAntiStall(delta: number, rawEnergy: number): void {
    const cfg = facialTuning.lipSync.antiStall
    if (!cfg.enabled || !this.analyser) {
      this.stallMs = 0
      this.antiStallActive = false
      return
    }

    const audible = rawEnergy > cfg.minEnergy
    const dead = this.maxWeight(this.smoothed) < cfg.deadThreshold

    if (this.antiStallActive) {
      const recovered = audible && !dead
      this.recoveryMs = recovered ? this.recoveryMs + Math.max(0, delta) * 1000 : 0
      if (!audible || this.recoveryMs >= cfg.recoveryAfterMs) {
        this.antiStallActive = false
        this.stallMs = 0
        this.recoveryMs = 0
      }
    } else {
      const dtMs = Math.max(0, delta) * 1000
      this.stallMs = audible && dead ? this.stallMs + dtMs : Math.max(0, this.stallMs - dtMs * 0.5)
      if (this.stallMs >= cfg.stallAfterMs) {
        this.antiStallActive = true
        this.stats.antiStallActivationCount += 1
      }
    }

    if (!this.antiStallActive) return

    this.fallbackPhase += Math.max(0, delta) * cfg.speed
    const env = Math.sin(this.fallbackPhase) * 0.5 + 0.5
    const scale = Math.min(1, rawEnergy / Math.max(0.0001, cfg.minEnergy))
    const open = (cfg.floor + cfg.amplitude * env) * scale
    const clamps = facialTuning.lipSync.clamps
    this.smoothed = {
      ...this.smoothed,
      aa: Math.min(clamps.aa, Math.max(this.smoothed.aa, open)),
      ih: Math.min(clamps.ih, Math.max(this.smoothed.ih, open * 0.4)),
    }
  }

  private recordStats(delta: number, analyserActive: boolean, rawEnergy: number): void {
    const openness = this.maxWeight(this.smoothed)
    this.stats.frameCount += 1
    this.stats.sumOpenness += openness
    this.stats.peakOpenness = Math.max(this.stats.peakOpenness, openness)
    if (openness > facialTuning.lipSync.statsHighThreshold) this.stats.highOpenFrames += 1
    if (openness < facialTuning.lipSync.statsClosedThreshold) this.stats.closedFrames += 1
    if (openness < 0.15) this.stats.opennessBuckets[0] += 1
    else if (openness < 0.3) this.stats.opennessBuckets[1] += 1
    else if (openness < 0.45) this.stats.opennessBuckets[2] += 1
    else this.stats.opennessBuckets[3] += 1
    this.stats.currentOpenMs =
      openness > facialTuning.lipSync.statsOpenThreshold
        ? this.stats.currentOpenMs + delta * 1000
        : 0
    this.stats.longestOpenMs = Math.max(this.stats.longestOpenMs, this.stats.currentOpenMs)
    if (analyserActive && rawEnergy > 0.92) this.stats.saturatedFrames += 1
    if (analyserActive && rawEnergy > facialTuning.lipSync.antiStall.minEnergy) {
      this.stats.nonZeroEnergyFrames += 1
      if (openness < facialTuning.lipSync.antiStall.deadThreshold) {
        this.stats.audibleDeadMouthFrames += 1
        this.stats.audibleDeadMouthMs += Math.max(0, delta) * 1000
      }
    }
  }

  private createStats(playbackSeq: number): LipSyncStats {
    return {
      playbackSeq,
      frameCount: 0,
      sumOpenness: 0,
      peakOpenness: 0,
      highOpenFrames: 0,
      closedFrames: 0,
      currentOpenMs: 0,
      longestOpenMs: 0,
      releaseAfterDetachMs: null,
      detachAtMs: null,
      saturatedFrames: 0,
      nonZeroEnergyFrames: 0,
      audibleDeadMouthMs: 0,
      audibleDeadMouthFrames: 0,
      antiStallActivationCount: 0,
      opennessBuckets: [0, 0, 0, 0],
    }
  }

  private maxWeight(weights: MouthWeights): number {
    return Math.max(weights.aa, weights.ih, weights.ou, weights.ee, weights.oh)
  }

  private sumWeights(weights: MouthWeights): number {
    return weights.aa + weights.ih + weights.ou + weights.ee + weights.oh
  }

  private getActiveVisemes(weights: MouthWeights): VisemeName[] {
    return (Object.entries(weights) as [VisemeName, number][])
      .filter(([, value]) => value > 0.02)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)
  }

  private scaleWeights(weights: MouthWeights, scale: number): MouthWeights {
    return {
      aa: weights.aa * scale,
      ih: weights.ih * scale,
      ou: weights.ou * scale,
      ee: weights.ee * scale,
      oh: weights.oh * scale,
    }
  }

  private smoothScalar(current: number, target: number, delta: number, speed: number): number {
    return this.lerp(current, target, 1 - Math.exp(-Math.max(0, delta) * speed))
  }

  private updateSignalWarning(): void {
    const rawMax = this.maxWeight(this.rawTarget)
    const finalMax = this.maxWeight(this.smoothed)
    this.signalWarning =
      rawMax >= facialTuning.lipSync.significantRawThreshold &&
      finalMax <= facialTuning.lipSync.suppressedFinalThreshold
        ? `raw ${rawMax.toFixed(2)} suppressed to ${finalMax.toFixed(2)}`
        : null
    if (this.signalWarning) console.warn(`[LIPSYNCDBG] ${this.signalWarning}`)
  }

  private publishDebug(): void {
    this.output.setMouthDebug({
      attached: Boolean(this.analyser),
      envelope: this.lastEnvelope,
      openness: this.maxWeight(this.smoothed),
      raw: { ...this.rawTarget },
      afterSilenceThreshold: { ...this.afterSilenceTarget },
      afterAttackRelease: { ...this.afterAttackRelease },
      afterMouthClosedBias: { ...this.afterClosedBias },
      afterClamp: { ...this.clampedTarget },
      filtered: { ...this.afterAttackRelease },
      clamped: { ...this.clampedTarget },
      final: { ...this.smoothed },
      speechEnergy: this.speechEnergy,
      playbackItemId: this.activeSession?.playbackItemId ?? '',
      analyserAttached: Boolean(this.analyser),
      lipSyncActive: Boolean(this.activeSession),
      currentRawRms: this.currentRawRms,
      currentNormalizedEnergy: this.lastEnvelope,
      currentMouthOpenness: this.maxWeight(this.smoothed),
      antiStallActive: this.antiStallActive,
      activeVisemes: this.getActiveVisemes(this.smoothed),
      visemeBlend: { ...this.blendedTarget },
      releaseStage: this.releaseStage,
      mouthClosedBias: Math.max(
        facialTuning.lipSync.mouthClosedBias,
        this.profile.mouthProfile.closedMouthBias,
      ),
      signalWarning: this.signalWarning,
      attackPerSecond: facialTuning.lipSync.attackPerSecond,
      releasePerSecond: facialTuning.lipSync.releasePerSecond,
      silentReleasePerSecond: facialTuning.lipSync.silentReleasePerSecond,
      detachedReleasePerSecond: facialTuning.lipSync.detachedReleasePerSecond,
      silenceThreshold: facialTuning.lipSync.silenceThreshold,
      clamps: { ...facialTuning.lipSync.clamps },
      stats: {
        playbackSeq: this.stats.playbackSeq,
        frameCount: this.stats.frameCount,
        averageOpenness:
          this.stats.frameCount > 0 ? this.stats.sumOpenness / this.stats.frameCount : 0,
        peakOpenness: this.stats.peakOpenness,
        percentHighOpen:
          this.stats.frameCount > 0 ? (this.stats.highOpenFrames / this.stats.frameCount) * 100 : 0,
        percentClosed:
          this.stats.frameCount > 0 ? (this.stats.closedFrames / this.stats.frameCount) * 100 : 0,
        longestOpenMs: this.stats.longestOpenMs,
        releaseAfterDetachMs: this.stats.releaseAfterDetachMs,
        saturatedSignal:
          this.stats.frameCount > 0 && this.stats.saturatedFrames / this.stats.frameCount > 0.75,
        nonZeroEnergyFrames: this.stats.nonZeroEnergyFrames,
        audibleDeadMouthMs: this.stats.audibleDeadMouthMs,
        audibleDeadMouthFrames: this.stats.audibleDeadMouthFrames,
        antiStallActivationCount: this.stats.antiStallActivationCount,
      },
    })
  }

  private logSummary(): void {
    if (this.summaryLogged || this.stats.frameCount <= 0) return
    this.summaryLogged = true
    const averageOpenness = this.stats.sumOpenness / this.stats.frameCount
    const percentHighOpen = (this.stats.highOpenFrames / this.stats.frameCount) * 100
    const percentClosed = (this.stats.closedFrames / this.stats.frameCount) * 100
    const percentSaturated = (this.stats.saturatedFrames / this.stats.frameCount) * 100
    const histogram = this.stats.opennessBuckets
      .map((count) => `${((count / this.stats.frameCount) * 100).toFixed(1)}%`)
      .join('/')
    console.log(
      `[LIPSYNCDBG] summary playback=${this.stats.playbackSeq} frames=${this.stats.frameCount} ` +
        `avg=${averageOpenness.toFixed(3)} peak=${this.stats.peakOpenness.toFixed(3)} ` +
        `hist=<15/15-30/30-45/>45=${histogram} ` +
        `open>70=${percentHighOpen.toFixed(1)}% closed<15=${percentClosed.toFixed(1)}% ` +
        `longestOpen>40=${Math.round(this.stats.longestOpenMs)}ms ` +
        `release=${this.stats.releaseAfterDetachMs !== null ? `${Math.round(this.stats.releaseAfterDetachMs)}ms` : 'pending'} ` +
        `saturated=${percentSaturated.toFixed(1)}%`,
    )
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
  }
}
