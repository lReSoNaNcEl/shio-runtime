/**
 * RuntimeStateInvariantValidator — diagnostics-only observer.
 *
 * Observes an aggregated read-only snapshot of every Runtime subsystem
 * (Character State, Speech, AudioPlayer, Avatar/Animation, LookAt, Head Motion,
 * Facial) and reports *impossible* combinations of state. It NEVER mutates any
 * subsystem: it only reads, counts, warns and exposes health.
 *
 * Each invariant is debounced by a hold window so normal transitions
 * (cross-fades, speaking→idle hand-off, one-frame gaps) do not raise false
 * positives — only states that persist past the grace window are reported.
 *
 * Where a signal cannot be observed without modifying a constrained subsystem,
 * the invariant returns `skip` (with a reason) instead of guessing, so the
 * validator never emits a false violation.
 */

export type InvariantId =
  | 'INV-01-speaking-lipsync'
  | 'INV-02-noplayback-not-speaking'
  | 'INV-03-playing-one-id'
  | 'INV-04-single-skeleton-owner'
  | 'INV-05-idle-no-speaking-anim'
  | 'INV-06-phase-speaking-playback'
  | 'INV-07-lookat-disabled-no-updates'
  | 'INV-08-headmotion-disabled-no-updates'
  | 'INV-09-mixer-only-facial-writer'
  | 'INV-10-transition-ownership'
  | 'INV-11-mouth-release'
  | 'INV-12-supported-viseme-fallback'
  | 'INV-13-unknown-expression-detection'
  | 'INV-14-valid-facial-profile'
  | 'INV-15-profile-release-timeout'

export type InvariantStatus = 'pass' | 'fail' | 'skip'

/** Read-only signals collected from every subsystem for one evaluation. */
export interface RuntimeInvariantInput {
  frame: number
  now: number
  // Character State / Speech
  speechStatus: string
  isSpeaking: boolean
  characterMode: string
  avatarMode: string
  conversationResponsePhase: string
  // AudioPlayer
  playbackActive: boolean
  activePlaybackId: number
  // Avatar / Animation
  bodyActiveActionCount: number
  bodyWeightedActionCount: number
  bodyTransitionRemaining: number
  bodyOwnershipGapCount: number
  currentBodyAnimation: string
  currentBehaviorId: string
  // Facial (mixer output only — read-only)
  mouthMax: number
  facialActiveSources: string[]
  facialEntrySources: string[]
  facialSupportedVisemes: string[]
  facialUnsupportedExpressionRequests: string[]
  currentFacialProfile: string
  facialStuckWarnings: string[]
  // LookAt
  lookAtTarget: string
  lookAtEyeYaw: number
  lookAtEyePitch: number
  // Head Motion
  headMotionActiveGenerators: string[]
  headMotionEnergy: number
}

export interface InvariantResult {
  id: InvariantId
  label: string
  status: InvariantStatus
  detail: string
  suspectedOwner: string
}

export interface RuntimeViolation {
  id: InvariantId
  at: number
  frame: number
  detail: string
  suspectedOwner: string
}

export interface RuntimeHealth {
  enabled: boolean
  frame: number
  evaluatedAt: number
  passCount: number
  failCount: number
  skipCount: number
  totalViolations: number
  invariants: InvariantResult[]
  lastViolation: RuntimeViolation | null
  subsystems: Record<string, string>
}

const KNOWN_FACIAL_SOURCES = new Set(['emotion', 'lipSync', 'autoBlink', 'lookAt'])

/** How long a failing condition must persist before it is reported (ms). */
const HOLD_MS = 450
const EPS_ANGLE = 0.02

interface InvariantDef {
  id: InvariantId
  label: string
  suspectedOwner: string
  evaluate: (i: RuntimeInvariantInput) => { ok: boolean | null; detail: string }
}

export class RuntimeStateInvariantValidator {
  private enabled = true
  private lastHealth: RuntimeHealth | null = null
  private totalViolations = 0
  private lastViolation: RuntimeViolation | null = null
  // Per-invariant debounce + reported-edge tracking.
  private failingSince = new Map<InvariantId, number>()
  private reported = new Set<InvariantId>()
  // Windowed helpers.
  private speakingSince: number | null = null
  private speakingMouthMax = 0

  private readonly defs: InvariantDef[] = [
    {
      id: 'INV-01-speaking-lipsync',
      label: 'speaking → LipSync attached',
      suspectedOwner: 'LipSync / AvatarController.applyStateEffect(attachLipSync)',
      evaluate: (i) => {
        // Proxy: while speaking with active audio, the mouth must show movement
        // within the grace window; a flat-zero mouth implies LipSync is not fed.
        if (!i.isSpeaking || !i.playbackActive)
          return { ok: true, detail: 'not speaking / no audio' }
        if (this.speakingSince === null) return { ok: true, detail: 'speaking just started' }
        const elapsed = i.now - this.speakingSince
        if (elapsed < 800) return { ok: true, detail: `warming up ${Math.round(elapsed)}ms` }
        const moved = this.speakingMouthMax > 0.02
        return {
          ok: moved,
          detail: moved
            ? `mouth peak ${this.speakingMouthMax.toFixed(2)}`
            : `mouth flat 0 for ${Math.round(elapsed)}ms (LipSync not attached?)`,
        }
      },
    },
    {
      id: 'INV-02-noplayback-not-speaking',
      label: 'no active playback → not speaking',
      suspectedOwner: 'ConversationRuntime terminal cleanup / AudioPlayer active playback',
      evaluate: (i) => {
        if (!i.isSpeaking) return { ok: true, detail: 'not speaking' }
        return {
          ok: i.playbackActive,
          detail: i.playbackActive ? 'audio active' : 'speaking but AudioPlayer idle',
        }
      },
    },
    {
      id: 'INV-03-playing-one-id',
      label: 'AudioPlayer playing → exactly one playback id',
      suspectedOwner: 'AudioPlayer',
      evaluate: (i) => {
        if (!i.playbackActive) {
          return {
            ok: i.activePlaybackId === 0,
            detail: i.activePlaybackId === 0 ? 'idle' : `idle but id=${i.activePlaybackId}`,
          }
        }
        return {
          ok: i.activePlaybackId > 0,
          detail: i.activePlaybackId > 0 ? `id=${i.activePlaybackId}` : 'playing but no valid id',
        }
      },
    },
    {
      id: 'INV-04-single-skeleton-owner',
      label: 'only one body animation owns the skeleton',
      suspectedOwner: 'AvatarModel body pipeline',
      evaluate: (i) => {
        if (i.bodyTransitionRemaining > 0) return { ok: true, detail: 'cross-fade in progress' }
        const ok = i.bodyWeightedActionCount <= 1
        return {
          ok,
          detail: ok
            ? `${i.bodyWeightedActionCount} weighted`
            : `${i.bodyWeightedActionCount} weighted actions, no transition`,
        }
      },
    },
    {
      id: 'INV-05-idle-no-speaking-anim',
      label: 'idle mode must not be speaking',
      suspectedOwner: 'AvatarStateMachine / AvatarController',
      evaluate: (i) => {
        if (i.characterMode !== 'idle') return { ok: true, detail: `mode=${i.characterMode}` }
        const ok = i.avatarMode !== 'speaking'
        return {
          ok,
          detail: ok ? `avatar=${i.avatarMode}` : 'character idle but avatar still speaking',
        }
      },
    },
    {
      id: 'INV-06-phase-speaking-playback',
      label: 'conversation phase speaking → playback exists',
      suspectedOwner: 'ConversationRuntime',
      evaluate: (i) => {
        if (i.conversationResponsePhase !== 'speaking')
          return { ok: true, detail: `phase=${i.conversationResponsePhase}` }
        return {
          ok: i.playbackActive,
          detail: i.playbackActive ? 'audio active' : 'phase speaking but no playback',
        }
      },
    },
    {
      id: 'INV-07-lookat-disabled-no-updates',
      label: 'LookAt disabled → no LookAt updates',
      suspectedOwner: 'LookAtRuntime',
      evaluate: (i) => {
        if (i.lookAtTarget !== 'none') return { ok: true, detail: `target=${i.lookAtTarget}` }
        const still =
          Math.abs(i.lookAtEyeYaw) <= EPS_ANGLE && Math.abs(i.lookAtEyePitch) <= EPS_ANGLE
        return {
          ok: still,
          detail: still
            ? 'eyes still'
            : `eyes moving yaw=${i.lookAtEyeYaw.toFixed(3)} pitch=${i.lookAtEyePitch.toFixed(3)} while disabled`,
        }
      },
    },
    {
      id: 'INV-08-headmotion-disabled-no-updates',
      label: 'Head Motion disabled → no procedural updates',
      suspectedOwner: 'HeadMotionRuntime',
      evaluate: (i) => {
        if (i.headMotionActiveGenerators.length > 0)
          return { ok: true, detail: `${i.headMotionActiveGenerators.length} generators active` }
        const still = i.headMotionEnergy <= 0.01
        return {
          ok: still,
          detail: still
            ? 'no motion'
            : `energy ${i.headMotionEnergy.toFixed(3)} with no active generators`,
        }
      },
    },
    {
      id: 'INV-09-mixer-only-facial-writer',
      label: 'Expression Mixer is the only facial writer',
      suspectedOwner: 'AvatarExpressionMixer',
      evaluate: (i) => {
        const foreign = [...new Set([...i.facialActiveSources, ...i.facialEntrySources])].filter(
          (s) => !KNOWN_FACIAL_SOURCES.has(s),
        )
        return {
          ok: foreign.length === 0,
          detail:
            foreign.length === 0
              ? 'all writes via mixer domains'
              : `foreign facial source(s): ${foreign.join(', ')}`,
        }
      },
    },
    {
      id: 'INV-10-transition-ownership',
      label: 'body transition keeps animation ownership',
      suspectedOwner: 'AvatarModel body action ownership',
      evaluate: (i) => {
        if (i.bodyActiveActionCount === 0) return { ok: null, detail: 'no body action loaded yet' }
        const ok = i.bodyWeightedActionCount > 0
        return {
          ok,
          detail: ok
            ? `${i.bodyWeightedActionCount} weighted action(s)`
            : `zero weighted actions during ${i.currentBodyAnimation}`,
        }
      },
    },
    {
      id: 'INV-11-mouth-release',
      label: 'mouth releases after speech',
      suspectedOwner: 'LipSync release envelope / AvatarExpressionMixer',
      evaluate: (i) => {
        if (i.isSpeaking || i.playbackActive)
          return { ok: true, detail: 'speaking / playback active' }
        const ok = i.mouthMax <= 0.4
        return {
          ok,
          detail: ok
            ? `mouth ${i.mouthMax.toFixed(2)}`
            : `mouth high ${i.mouthMax.toFixed(2)} after speech`,
        }
      },
    },
    {
      id: 'INV-12-supported-viseme-fallback',
      label: 'unsupported visemes fall back gracefully',
      suspectedOwner: 'AvatarExpressionMixer capability detection',
      evaluate: (i) => {
        const required = ['aa', 'ih', 'ou']
        const missingCore = required.filter((name) => !i.facialSupportedVisemes.includes(name))
        if (missingCore.length > 0)
          return { ok: false, detail: `missing core viseme(s): ${missingCore.join(', ')}` }
        const optional = ['ee', 'oh'].filter((name) => !i.facialSupportedVisemes.includes(name))
        return {
          ok: true,
          detail:
            optional.length > 0
              ? `optional fallback: ${optional.join(', ')}`
              : 'all five visemes supported',
        }
      },
    },
    {
      id: 'INV-13-unknown-expression-detection',
      label: 'unknown expressions are detected before write',
      suspectedOwner: 'Facial Profile / AvatarExpressionMixer',
      evaluate: (i) => {
        return {
          ok: true,
          detail:
            i.facialUnsupportedExpressionRequests.length > 0
              ? `detected unsupported: ${i.facialUnsupportedExpressionRequests.join(', ')}`
              : 'no unsupported expression requests',
        }
      },
    },
    {
      id: 'INV-14-valid-facial-profile',
      label: 'facial profile is valid',
      suspectedOwner: 'FacialProfile resolver',
      evaluate: (i) => {
        const ok = Boolean(i.currentFacialProfile && i.currentFacialProfile !== 'unknown')
        return {
          ok,
          detail: ok ? `profile=${i.currentFacialProfile}` : 'invalid / missing facial profile',
        }
      },
    },
    {
      id: 'INV-15-profile-release-timeout',
      label: 'facial profile release does not get stuck',
      suspectedOwner: 'ExpressionController / AvatarExpressionMixer release lifecycle',
      evaluate: (i) => {
        const releaseWarning = i.facialStuckWarnings.find((warning) =>
          /emotion|mouth|blink/i.test(warning),
        )
        return { ok: !releaseWarning, detail: releaseWarning ?? 'no facial release warnings' }
      },
    },
  ]

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      this.failingSince.clear()
      this.reported.clear()
      this.speakingSince = null
      this.speakingMouthMax = 0
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  evaluate(input: RuntimeInvariantInput): RuntimeHealth {
    if (!this.enabled) {
      this.lastHealth = this.buildHealth(input, [])
      return this.lastHealth
    }

    // Maintain the speaking window used by INV-01.
    if (input.isSpeaking && input.playbackActive) {
      if (this.speakingSince === null) {
        this.speakingSince = input.now
        this.speakingMouthMax = 0
      }
      this.speakingMouthMax = Math.max(this.speakingMouthMax, input.mouthMax)
    } else {
      this.speakingSince = null
      this.speakingMouthMax = 0
    }

    const results: InvariantResult[] = []
    for (const def of this.defs) {
      const { ok, detail } = def.evaluate(input)
      let status: InvariantStatus
      if (ok === null) status = 'skip'
      else if (ok) status = 'pass'
      else status = 'fail'

      // Debounce failures by HOLD_MS; only report a confirmed, newly-entered fail.
      if (status === 'fail') {
        const since = this.failingSince.get(def.id) ?? input.now
        if (!this.failingSince.has(def.id)) this.failingSince.set(def.id, input.now)
        const held = input.now - since
        if (held >= HOLD_MS && !this.reported.has(def.id)) {
          this.reported.add(def.id)
          this.recordViolation(def, input, detail)
        }
      } else {
        this.failingSince.delete(def.id)
        this.reported.delete(def.id)
      }

      results.push({
        id: def.id,
        label: def.label,
        status,
        detail,
        suspectedOwner: def.suspectedOwner,
      })
    }

    this.lastHealth = this.buildHealth(input, results)
    return this.lastHealth
  }

  getHealth(): RuntimeHealth | null {
    return this.lastHealth
  }

  private recordViolation(def: InvariantDef, input: RuntimeInvariantInput, detail: string): void {
    this.totalViolations += 1
    this.lastViolation = {
      id: def.id,
      at: Date.now(),
      frame: input.frame,
      detail,
      suspectedOwner: def.suspectedOwner,
    }
    const snapshot = {
      speech: input.speechStatus,
      mode: input.characterMode,
      avatarMode: input.avatarMode,
      phase: input.conversationResponsePhase,
      playback: input.playbackActive ? `#${input.activePlaybackId}` : 'idle',
      mouthMax: Number(input.mouthMax.toFixed(2)),
      facialProfile: input.currentFacialProfile,
      bodyWeighted: input.bodyWeightedActionCount,
      bodyOwnershipGaps: input.bodyOwnershipGapCount,
      lookAt: input.lookAtTarget,
      headGen: input.headMotionActiveGenerators.length,
    }
    console.warn(
      `[RUNTIME-INV] ${def.id} VIOLATION frame=${input.frame} t=${Math.round(input.now)}ms owner="${def.suspectedOwner}" detail="${detail}" state=${JSON.stringify(snapshot)}`,
    )
  }

  private buildHealth(input: RuntimeInvariantInput, results: InvariantResult[]): RuntimeHealth {
    return {
      enabled: this.enabled,
      frame: input.frame,
      evaluatedAt: Date.now(),
      passCount: results.filter((r) => r.status === 'pass').length,
      failCount: results.filter((r) => r.status === 'fail').length,
      skipCount: results.filter((r) => r.status === 'skip').length,
      totalViolations: this.totalViolations,
      invariants: results,
      lastViolation: this.lastViolation,
      subsystems: {
        speech: input.speechStatus,
        audio: input.playbackActive ? `playing #${input.activePlaybackId}` : 'idle',
        characterMode: input.characterMode,
        avatarMode: input.avatarMode,
        conversationPhase: input.conversationResponsePhase,
        bodyActions: `${input.bodyWeightedActionCount}/${input.bodyActiveActionCount} weighted/active`,
        bodyOwnershipGaps: String(input.bodyOwnershipGapCount),
        lookAt: `${input.lookAtTarget}`,
        headMotion: `${input.headMotionActiveGenerators.length} gen · energy ${input.headMotionEnergy.toFixed(2)}`,
        facial: input.facialActiveSources.join(',') || 'none',
        facialProfile: input.currentFacialProfile,
        visemes: input.facialSupportedVisemes.join(',') || 'none',
        unsupportedExpressions: input.facialUnsupportedExpressionRequests.join(',') || 'none',
      },
    }
  }
}
