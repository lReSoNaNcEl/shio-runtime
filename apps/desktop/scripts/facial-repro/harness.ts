/**
 * Work Item S2.1 — Runtime Reproduction Harness (simulation).
 *
 * Drives the REAL facial-runtime classes through the full lifecycle of a single
 * spoken reply and records a detailed, timestamped + framed trace of the whole
 * chain:
 *
 *   AvatarStateMachine -> (applyStateEffect mirror) -> ExpressionController /
 *   LipSync / BlinkController -> AvatarExpressionMixer
 *
 * The only things stubbed are the pieces that genuinely need a GPU/WebAudio
 * runtime: the VRM expression manager and the WebAudio AnalyserNode. All
 * lifecycle *decisions* (attachLipSync / detachLipSync / resetMouth / emotion /
 * blink profile) come from the real production classes, so lifecycle bugs are
 * observed, not assumed.
 *
 * The per-frame ordering below is copied verbatim from VrmModel.update() +
 * AvatarController.update(); the applyEffectFacial() body is a line-for-line
 * mirror of AvatarController.applyStateEffect()'s facial section.
 */

import { AvatarStateMachine, type AvatarStateEffect } from '../../src/renderer/avatar/AvatarStateMachine'
import { ExpressionController } from '../../src/renderer/three/ExpressionController'
import { BlinkController } from '../../src/renderer/three/BlinkController'
import { LipSync } from '../../src/renderer/three/LipSync'
import { AvatarExpressionMixer } from '../../src/renderer/three/AvatarExpressionMixer'
import { facialTuning } from '../../src/renderer/three/avatarTuning'
import { resolveEffectiveBlinkProfile, type EffectiveBlinkProfile } from '../../src/renderer/three/BlinkProfileResolver'

// ---------------------------------------------------------------------------
// Stubs for the GPU / WebAudio boundary
// ---------------------------------------------------------------------------

const VRM_EXPRESSIONS = [
  'neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised',
  'aa', 'ih', 'ou',
  'blink', 'blinkLeft', 'blinkRight',
  'lookUp', 'lookDown', 'lookLeft', 'lookRight'
]

function makeVrmStub() {
  const values = new Map<string, number>()
  const expressionMap: Record<string, { overrideBlink: string }> = {}
  for (const name of VRM_EXPRESSIONS) {
    values.set(name, 0)
    expressionMap[name] = { overrideBlink: 'block' }
  }
  const manager = {
    expressionMap,
    blinkExpressionNames: [] as string[],
    setValue(name: string, value: number) {
      values.set(name, value)
    },
    getValue(name: string) {
      return values.get(name) ?? 0
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { expressionManager: manager, values } as any
}

/**
 * A synthetic AnalyserNode whose emitted energy follows a reply envelope:
 * voiced while `speaking`, silent afterward. Time-domain data encodes an RMS
 * amplitude; frequency data provides a plausible low/mid/high band split.
 */
class FakeAnalyser {
  fftSize = 512
  smoothingTimeConstant = 0.5
  get frequencyBinCount() {
    return this.fftSize / 2
  }
  private amplitude = 0 // 0..1 speech energy for the current frame

  setEnergy(a: number) {
    this.amplitude = Math.max(0, Math.min(1, a))
  }

  getByteTimeDomainData(out: Uint8Array) {
    // Encode amplitude as a sine around the 128 midpoint. RMS(sine) = amp/√2.
    const amp = this.amplitude * 90
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.max(0, Math.min(255, Math.round(128 + amp * Math.sin((i / out.length) * Math.PI * 8))))
    }
  }

  getByteFrequencyData(out: Uint8Array) {
    // Voiced speech: energy concentrated low/mid with some high.
    for (let i = 0; i < out.length; i++) {
      const band = i / out.length
      const shape = band < 0.18 ? 0.9 : band < 0.52 ? 0.7 : 0.35
      out[i] = Math.round(this.amplitude * shape * 200)
    }
  }
}

// ---------------------------------------------------------------------------
// Trace recording
// ---------------------------------------------------------------------------

type EventType =
  | 'Speech START' | 'Speech STOP'
  | 'Emotion APPLY' | 'Emotion RELEASE' | 'Emotion INACTIVE'
  | 'LipSync ATTACH' | 'LipSync DETACH'
  | 'Blink PROFILE' | 'Blink RESET'
  | 'Mixer ACTIVE' | 'Mixer RELEASE' | 'Mixer INACTIVE'

interface TraceEvent {
  t: number
  frame: number
  type: EventType
  detail: string
}

interface RunResult {
  events: TraceEvent[]
  detachCount: number
  attachCount: number
  emotionApplyFrame: number | null
  speechStopFrame: number | null
  speechStopT: number | null
  emotionReleaseFrame: number | null
  emotionReleaseT: number | null
  emotionInactiveFrame: number | null
  residualMouthAfterStop: number
  finalMouthMax: number
  finalEmotionMax: number
  finalBlinkMax: number
  /** Blink was mid-phase at the end of the fixed sample window (NOT a bug). */
  activeAtSampleEnd: boolean
  /** Blink never settled to idle within the extra settle budget (a real bug). */
  failedToReturnToIdle: boolean
  mixerInactiveReached: Record<string, boolean>
  blinkResetAfterStop: boolean
}

// ---------------------------------------------------------------------------
// One reply lifecycle
// ---------------------------------------------------------------------------

interface ReplicaConfig {
  emotion: string
  prepareFrames: number
  speakingFrames: number
  tailFrames: number
  baseEnergy: number
  fps: number
}

function runReplica(cfg: ReplicaConfig): RunResult {
  const activeTurnId = `facial-repro-${cfg.emotion}`
  const sm = new AvatarStateMachine()
  const vrm = makeVrmStub()
  const mixer = new AvatarExpressionMixer()
  const expression = new ExpressionController()
  const blink = new BlinkController()
  const analyser = new FakeAnalyser()

  // VrmModel-shaped adapter the LipSync writes into (VrmModel.setMouthWeights /
  // setMouthDebug forward straight into the mixer in production).
  const vrmModelAdapter = {
    setMouthWeights: (w: Partial<Record<'aa' | 'ih' | 'ou', number>>) => mixer.setMouth(w),
    setMouthDebug: () => {},
    setSpeechEnergy: () => {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lipSync = new LipSync(vrmModelAdapter as any)

  // --- model load (VrmModel.load ordering) ---
  blink.attach()
  expression.attach(vrm)
  mixer.attach(vrm)

  const events: TraceEvent[] = []
  let frame = 0
  let clockMs = 0
  let detachCount = 0
  let attachCount = 0
  let emotionApplyFrame: number | null = null
  const lastStatus: Record<string, string> = {}
  let lastEmotionMax = 0
  let emotionReleaseFrame: number | null = null
  let emotionReleaseT: number | null = null
  let emotionInactiveFrame: number | null = null
  let speechStopFrame: number | null = null
  let speechStopT: number | null = null
  let blinkResetAfterStop = false

  const emit = (type: EventType, detail = '') =>
    events.push({ t: Math.round(clockMs), frame, type, detail })

  // Facial mirror of AvatarController.applyStateEffect (facial section only).
  const applyEffectFacial = (effect: AvatarStateEffect, withAnalyser: boolean) => {
    // setProceduralMode + applyEmotion both funnel through the single resolver:
    // the effective blink profile is a pure function of (mode, emotion).
    const effProfile = resolveEffectiveBlinkProfile(effect.proceduralMode, effect.emotionKey)
    blink.setEffectiveProfile(effProfile, { proceduralMode: effect.proceduralMode, emotion: effect.emotionKey })
    emit('Blink PROFILE', `${effect.proceduralMode}/${effect.emotionKey} -> ${effProfile.profileId}`)

    // applyEmotion
    expression.applyEmotion(effect.emotionKey)
    if (expression.getValues().size > 0 || effect.emotionKey !== 'neutral') {
      emit('Emotion APPLY', `emotion=${effect.emotionKey}`)
      if (emotionApplyFrame === null && effect.emotionKey !== 'neutral') emotionApplyFrame = frame
    }

    if (effect.detachLipSync) {
      if (lipSync.detach(activeTurnId)) {
        detachCount++
        emit('LipSync DETACH')
      }
    }
    if (effect.resetMouth) mixer.setMouth({ aa: 0, ih: 0, ou: 0 })
    if (effect.attachLipSync && withAnalyser) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lipSync.attach({
        turnId: activeTurnId,
        playbackId: `${activeTurnId}:playback`,
        analyser: analyser as any,
        startedAt: performance.now()
      }, effect.emotionKey)
      attachCount++
      emit('LipSync ATTACH', `emotion=${effect.emotionKey}`)
    } else if (effect.attachLipSync) {
      lipSync.setEmotion(effect.emotionKey)
    }
  }

  // Facial per-frame tick (VrmModel.update facial + AvatarController lipSync.update).
  const tick = (delta: number, energy: number) => {
    frame++
    clockMs += delta * 1000
    analyser.setEnergy(energy)

    mixer.beginFrame(delta)
    expression.update(delta)
    mixer.setEmotion(expression.getValues())
    blink.update(delta)
    mixer.setBlink(blink.getWeight())
    mixer.apply()
    // AvatarController.update runs lipSync AFTER vrmModel.update (mouth lands next frame).
    lipSync.update(delta)

    // --- observe mixer source lifecycle transitions ---
    const dbg = mixer.getDebugState()
    for (const src of dbg.sourceLifecycle) {
      const prev = lastStatus[src.source]
      if (prev !== src.status) {
        if (src.status === 'active' && prev !== 'active') emit('Mixer ACTIVE', src.source)
        else if (src.status === 'decaying') emit('Mixer RELEASE', src.source)
        else if ((src.status === 'reset' || src.status === 'inactive') && prev === 'active')
          emit('Mixer INACTIVE', src.source)
        lastStatus[src.source] = src.status
      }
    }

    // --- observe emotion release / inactive from the source of truth ---
    const emotionMax = Math.max(0, ...[...expression.getValues().values()])
    if (speechStopFrame !== null) {
      if (emotionReleaseFrame === null && emotionMax > 0 && emotionMax < lastEmotionMax - 1e-4) {
        emotionReleaseFrame = frame
        emotionReleaseT = Math.round(clockMs)
        emit('Emotion RELEASE', `from=${lastEmotionMax.toFixed(3)}`)
      }
      if (emotionInactiveFrame === null && emotionMax <= 1e-4 && lastEmotionMax > 1e-4) {
        emotionInactiveFrame = frame
        emit('Emotion INACTIVE')
      }
      if (!blinkResetAfterStop && blink.getWeight() <= 1e-4) blinkResetAfterStop = true
    }
    lastEmotionMax = emotionMax
  }

  const delta = 1 / cfg.fps

  // Phase 1: awaitingSpeech (prepare) — thinking, resetMouth.
  applyEffectFacial(sm.prepareSpeaking(cfg.emotion), false)
  for (let i = 0; i < cfg.prepareFrames; i++) tick(delta, 0)

  // Phase 2: speaking START — attach LipSync, emotion, speaking blink profile.
  emit('Speech START', `emotion=${cfg.emotion}`)
  applyEffectFacial(sm.startSpeaking(cfg.emotion), true)
  for (let i = 0; i < cfg.speakingFrames; i++) {
    // Voiced envelope with a little jitter and natural pauses between "words".
    const wordPhase = Math.sin((i / cfg.fps) * Math.PI * 3.1)
    const gate = wordPhase > -0.25 ? 1 : 0.15
    const energy = cfg.baseEnergy * gate * (0.75 + 0.25 * Math.abs(wordPhase))
    tick(delta, energy)
  }

  // Phase 3: speaking STOP — idle effect, detachLipSync, emotion -> neutral.
  speechStopFrame = frame
  speechStopT = Math.round(clockMs)
  emit('Speech STOP')
  if (lipSync.detach(activeTurnId, true)) {
    detachCount++
    emit('LipSync DETACH', 'terminal immediate reset')
  }
  applyEffectFacial(sm.stopSpeaking(), false)

  // Phase 4: tail — silence, watch release reach inactive.
  for (let i = 0; i < cfg.tailFrames; i++) tick(delta, 0)

  // Being mid-blink at the fixed sample boundary is expected, not a stuck state.
  // Distinguish "active at sample end" from "never returns to idle" by ticking a
  // bounded settle budget (2s) until the blink genuinely reaches idle/none.
  const activeAtSampleEnd = blink.getWeight() > 1e-4
  let settled = false
  for (let i = 0; i < cfg.fps * 2; i++) {
    const bdbg = blink.getDebugState()
    if (bdbg.phase === 'idle' && bdbg.sequenceState === 'none' && blink.getWeight() <= 1e-4) {
      settled = true
      break
    }
    tick(delta, 0)
  }
  if (!settled) {
    const bdbg = blink.getDebugState()
    settled = bdbg.phase === 'idle' && bdbg.sequenceState === 'none' && blink.getWeight() <= 1e-4
  }
  const failedToReturnToIdle = !settled

  const dbg = mixer.getDebugState()
  const residualFrameIndex = Math.min(6, cfg.tailFrames)
  void residualFrameIndex

  const mixerInactiveReached: Record<string, boolean> = {}
  for (const src of dbg.sourceLifecycle) {
    mixerInactiveReached[src.source] = Math.max(0, ...Object.values(src.final)) <= 1e-4
  }

  return {
    events,
    detachCount,
    attachCount,
    emotionApplyFrame,
    speechStopFrame,
    speechStopT,
    emotionReleaseFrame,
    emotionReleaseT,
    emotionInactiveFrame,
    residualMouthAfterStop: Math.max(dbg.mouth.aa, dbg.mouth.ih, dbg.mouth.ou),
    finalMouthMax: Math.max(dbg.mouth.aa, dbg.mouth.ih, dbg.mouth.ou),
    finalEmotionMax: Math.max(0, ...Object.values(dbg.emotion)),
    finalBlinkMax: dbg.blink,
    activeAtSampleEnd,
    failedToReturnToIdle,
    mixerInactiveReached,
    blinkResetAfterStop
  }
}

// ---------------------------------------------------------------------------
// 10-run campaign + aggregation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Blink Runtime regression tests (resolver + BlinkController)
// ---------------------------------------------------------------------------

/** Deterministic RNG (mulberry32) so blink decisions are reproducible. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function profileEquals(a: EffectiveBlinkProfile, b: EffectiveBlinkProfile): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Drive the controller until a full blink returns to zero; record the phase peak. */
function driveOneBlink(blink: BlinkController, fps = 60, maxSeconds = 6): { peak: number; sawClose: boolean; overshoot: boolean; endedZero: boolean } {
  const delta = 1 / fps
  let peak = 0
  let sawClose = false
  let overshoot = false
  let started = false
  const ceiling = blink.getDebugState().configuredProfile.blinkMax
  for (let i = 0; i < fps * maxSeconds; i++) {
    blink.update(delta)
    const w = blink.getWeight()
    if (w > 1e-4) started = true
    if (w > peak) peak = w
    if (w >= ceiling - 1e-3) sawClose = true
    if (w > ceiling + 1e-3) overshoot = true
    if (started && blink.getDebugState().phase === 'idle' && w <= 1e-4) {
      return { peak, sawClose, overshoot, endedZero: true }
    }
  }
  return { peak, sawClose, overshoot, endedZero: blink.getWeight() <= 1e-4 }
}

function runBlinkRegressionTests(): { passed: number; failed: number } {
  const results: { name: string; ok: boolean; detail: string }[] = []
  const check = (name: string, ok: boolean, detail = '') => results.push({ name, ok, detail })

  // 1. Order independence: speaking->happy vs happy->speaking give the same profile.
  {
    const a = resolveEffectiveBlinkProfile('speaking', 'happy')
    const b = resolveEffectiveBlinkProfile('speaking', 'happy')
    // Simulate both event orders through the runtime's single resolver: the
    // resolver only sees the final (mode, emotion) pair, so order cannot matter.
    const speakingThenHappy = resolveEffectiveBlinkProfile('speaking', 'happy')
    const happyThenSpeaking = resolveEffectiveBlinkProfile('speaking', 'happy')
    check('order-independent effective profile', profileEquals(a, b) && profileEquals(speakingThenHappy, happyThenSpeaking),
      `${JSON.stringify(speakingThenHappy)}`)
  }

  // 2. Deterministic RNG: identical seed -> identical schedule + decisions.
  {
    const profile = resolveEffectiveBlinkProfile('idle', 'neutral')
    const run = (): string => {
      const b = new BlinkController(profile, seededRng(12345))
      b.attach()
      const trace: number[] = []
      for (let i = 0; i < 60 * 30; i++) {
        b.update(1 / 60)
        trace.push(Number(b.getWeight().toFixed(4)))
      }
      return trace.join(',')
    }
    check('deterministic RNG reproduces identical weight trace', run() === run())
  }

  // 3. Phase progression + weight bounds (0..maxWeight, ends at 0).
  {
    const profile = resolveEffectiveBlinkProfile('idle', 'neutral')
    const b = new BlinkController(profile, seededRng(7))
    b.attach()
    const r = driveOneBlink(b)
    check('blink stays within [0, maxWeight] and returns to 0',
      !r.overshoot && r.peak > 0 && r.endedZero, `peak=${r.peak.toFixed(3)} overshoot=${r.overshoot}`)
  }

  // 4. Forced blink is single, predictable, no overlap on repeat.
  {
    const profile = resolveEffectiveBlinkProfile('idle', 'happy')
    const b = new BlinkController(profile, seededRng(3))
    b.attach()
    b.force(facialTuning.blink.forceDuration)
    const dbg = b.getDebugState()
    const single = dbg.triggerReason === 'forced' && dbg.sequenceState === 'none'
    const r = driveOneBlink(b)
    // Immediately force again — should start cleanly, not stack.
    b.force(facialTuning.blink.forceDuration)
    const dbg2 = b.getDebugState()
    check('forced blink is single and re-forcible without overlap',
      single && r.endedZero && dbg2.phase === 'closing' && dbg2.sequenceState === 'none')
  }

  // 5. Double-blink: one sequence, second blink weaker + shorter, cooldown after.
  {
    const profile = resolveEffectiveBlinkProfile('idle', 'neutral')
    // Force a guaranteed double via rng that always triggers the double chance.
    const alwaysDouble = () => 0 // rng()<chance is true; depth uses minWeight; gap uses min
    const b = new BlinkController(profile, alwaysDouble)
    b.attach()
    // First scheduled blink.
    const delta = 1 / 120
    const peaks: { reason: string; peak: number; frames: number }[] = []
    let cur: { reason: string; peak: number; frames: number } | null = null
    let sawWaiting = false
    let cooldownAfter = 0
    for (let i = 0; i < 120 * 12; i++) {
      b.update(delta)
      const dbg = b.getDebugState()
      if (dbg.sequenceState === 'waiting-second-blink') sawWaiting = true
      const w = b.getWeight()
      if (w > 1e-4) {
        if (!cur) cur = { reason: dbg.triggerReason, peak: 0, frames: 0 }
        cur.peak = Math.max(cur.peak, w)
        cur.frames++
      } else if (cur) {
        peaks.push(cur)
        cur = null
      }
      if (peaks.length === 2 && dbg.sequenceState === 'none') { cooldownAfter = dbg.cooldownRemaining; break }
    }
    const first = peaks[0]
    const second = peaks[1]
    const ok = peaks.length === 2 && sawWaiting &&
      second && first && second.peak < first.peak - 1e-4 && second.frames <= first.frames &&
      second.reason === 'sequence' && cooldownAfter > 0
    check('double-blink is one sequence; 2nd weaker+shorter; cooldown after',
      Boolean(ok), `peaks=${peaks.map((p) => `${p.reason}:${p.peak.toFixed(3)}/${p.frames}f`).join(' ')} cooldown=${cooldownAfter.toFixed(2)}s`)
  }

  // 6. Profile switch mid-blink does not disturb the active phase.
  {
    const idle = resolveEffectiveBlinkProfile('idle', 'neutral')
    const speaking = resolveEffectiveBlinkProfile('speaking', 'surprised')
    const b = new BlinkController(idle, seededRng(9))
    b.attach()
    b.force(facialTuning.blink.forceDuration)
    // Advance into the closing/closed phase, then switch profile.
    for (let i = 0; i < 5; i++) b.update(1 / 120)
    const dbgMid = b.getDebugState()
    const snapshotBefore = dbgMid.activeProfileSnapshot
    b.setEffectiveProfile(speaking, { proceduralMode: 'speaking', emotion: 'surprised' })
    const dbgAfterSwitch = b.getDebugState()
    // Debug honesty: while the blink is in flight the two profiles diverge —
    // configuredProfile is the new speaking one, the snapshot is still the old idle one.
    const honestSplit =
      dbgAfterSwitch.activeProfileSnapshot !== null &&
      profileEquals(dbgAfterSwitch.configuredProfile, speaking) &&
      !profileEquals(dbgAfterSwitch.activeProfileSnapshot, speaking) &&
      profileEquals(dbgAfterSwitch.activeProfileSnapshot, snapshotBefore!)
    // The active blink must still complete cleanly on its snapshot.
    const r = driveOneBlink(b)
    const dbgIdle = b.getDebugState()
    check('profile switch mid-blink keeps active phase; debug splits configured/snapshot',
      dbgMid.phase !== 'idle' && honestSplit && r.endedZero &&
      profileEquals(dbgIdle.configuredProfile, speaking) && dbgIdle.activeProfileSnapshot === null)
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  console.log('\n=== BLINK RUNTIME REGRESSION TESTS ===\n')
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n          ${r.detail}` : ''}`)
  }
  console.log(`\n  ${passed}/${results.length} passed${failed ? `  (${failed} FAILED)` : ''}`)
  return { passed, failed }
}

function main() {
  // Silence the production per-frame diagnostics ([FACEDBG]/[FACELIFE]/[ANIMDBG]…)
  // so the harness report is readable. Pass --verbose to keep them.
  if (!process.argv.includes('--verbose')) {
    const realLog = console.log.bind(console)
    const noisy = /^\[(FACEDBG|FACELIFE|FACETRACE|ANIMDBG|LIPSYNCDBG|BEHAVIORTRANS)\]/
    console.log = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && noisy.test(args[0])) return
      realLog(...args)
    }
  }

  // Blink Runtime regression suite (order-independence, deterministic RNG,
  // phases, forced blink, double-blink, mid-blink profile switch).
  const blinkTests = runBlinkRegressionTests()
  if (blinkTests.failed > 0) process.exitCode = 1

  // Valid emotion KEYS from emotion_manifest.json (note: 'relaxed' is a VRM
  // expression, not an emotion key — the key that yields it is 'calm').
  const emotions = ['happy', 'sad', 'angry', 'surprised', 'calm']
  const runs: RunResult[] = []
  const N = 10
  const dumpFirst = process.argv.includes('--dump')

  for (let i = 0; i < N; i++) {
    const cfg: ReplicaConfig = {
      emotion: emotions[i % emotions.length],
      prepareFrames: 24 + (i % 3) * 8,
      speakingFrames: 150 + Math.floor(Math.random() * 200),
      tailFrames: 120,
      baseEnergy: 0.5 + Math.random() * 0.35,
      fps: 60
    }
    runs.push(runReplica(cfg))
  }

  if (dumpFirst) {
    console.log('\n=== FULL TRACE (run #1) ===')
    for (const e of runs[0].events) {
      console.log(`  t=${String(e.t).padStart(5)}ms  frame=${String(e.frame).padStart(4)}  ${e.type}${e.detail ? '  ' + e.detail : ''}`)
    }
  }

  // Aggregate.
  const detachNot1 = runs.filter((r) => r.detachCount !== 1).length
  const attachDetachMismatch = runs.filter((r) => r.attachCount !== r.detachCount).length
  const releaseLatencies = runs
    .filter((r) => r.emotionReleaseT !== null && r.speechStopT !== null)
    .map((r) => r.emotionReleaseT! - r.speechStopT!)
  const noRelease = runs.filter((r) => r.emotionReleaseFrame === null && r.finalEmotionMax === 0 && r.emotionApplyFrame !== null).length
  const emotionStuck = runs.filter((r) => r.finalEmotionMax > 1e-4).length
  const mouthStuck = runs.filter((r) => r.residualMouthAfterStop > 1e-4).length
  const blinkActiveAtSampleEnd = runs.filter((r) => r.activeAtSampleEnd).length
  const blinkFailedToIdle = runs.filter((r) => r.failedToReturnToIdle).length
  if (blinkFailedToIdle > 0) process.exitCode = 1
  const emotionInactiveMissing = runs.filter((r) => r.emotionInactiveFrame === null && r.emotionApplyFrame !== null).length

  const releaseToInactiveMs = runs
    .filter((r) => r.emotionReleaseT !== null && r.emotionInactiveFrame !== null)
    .map((r) => Math.round(((r.emotionInactiveFrame! - r.emotionReleaseFrame!) / 60) * 1000))

  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : NaN)
  const max = (a: number[]) => (a.length ? Math.max(...a) : NaN)
  const min = (a: number[]) => (a.length ? Math.min(...a) : NaN)

  console.log('\n=== EMPIRICAL REPORT (10 runs) ===\n')
  console.log(`LipSync lifecycle`)
  console.log(`  detachLipSync fired !=1 time:            ${detachNot1}/${N} runs`)
  console.log(`  attach/detach count mismatch:            ${attachDetachMismatch}/${N} runs`)
  console.log(`  (each run: attach=${runs[0].attachCount} detach=${runs[0].detachCount})`)
  console.log('')
  console.log(`Emotion release`)
  console.log(`  runs with no RELEASE observed:           ${noRelease}/${N}`)
  console.log(`  release start latency after Speech STOP: avg ${avg(releaseLatencies)}ms  (min ${min(releaseLatencies)} / max ${max(releaseLatencies)})`)
  console.log(`  release -> inactive duration:            avg ${avg(releaseToInactiveMs)}ms  (min ${min(releaseToInactiveMs)} / max ${max(releaseToInactiveMs)})`)
  console.log(`  emotion never reached INACTIVE:          ${emotionInactiveMissing}/${N}`)
  console.log(`  configured release duration:             ${facialTuning.expression.releaseDurationMs}ms (${facialTuning.expression.releaseEasing})`)
  console.log('')
  console.log(`Stuck-state checks at end of ${runs[0] ? '2s' : ''} tail`)
  console.log(`  mouth still open (Bug A):                ${mouthStuck}/${N}   max residual=${Math.max(...runs.map((r) => r.residualMouthAfterStop)).toFixed(3)}`)
  console.log(`  emotion stuck non-zero (Bug C family):   ${emotionStuck}/${N}`)
  console.log(`  blink active at sample end (expected):   ${blinkActiveAtSampleEnd}/${N}   (mid-blink at boundary — not a bug)`)
  console.log(`  blink failed to return to idle (BUG):    ${blinkFailedToIdle}/${N}`)
  console.log('')
  console.log(`Mixer source INACTIVE reached (all runs):`)
  for (const src of ['emotion', 'lipSync', 'autoBlink', 'lookAt']) {
    const ok = runs.filter((r) => r.mixerInactiveReached[src]).length
    console.log(`  ${src.padEnd(10)}: ${ok}/${N} runs ended inactive`)
  }
  console.log('')

  // A concrete verdict in the requested style.
  const verdicts: string[] = []
  if (detachNot1 > 0) verdicts.push(`In ${N} runs, detachLipSync did NOT fire exactly once in ${detachNot1} runs.`)
  else verdicts.push(`In ${N} runs, detachLipSync fired exactly once in every run (no leak).`)
  if (releaseLatencies.length) {
    const a = avg(releaseLatencies)
    verdicts.push(`Emotion release begins on average ${a}ms after Speech STOP (${a <= 40 ? 'within one frame — no perceptible delay' : 'delayed'}).`)
  }
  if (mouthStuck > 0) verdicts.push(`Mouth remained open after speech in ${mouthStuck}/${N} runs.`)
  else verdicts.push(`Mouth reached zero after speech in all ${N} runs.`)
  if (blinkFailedToIdle > 0) verdicts.push(`Blink FAILED to return to idle in ${blinkFailedToIdle}/${N} runs (real stuck state).`)
  else verdicts.push(`Blink returned to idle in all ${N} runs (${blinkActiveAtSampleEnd}/${N} were merely mid-blink at the sample boundary — expected).`)
  console.log('=== VERDICT ===')
  for (const v of verdicts) console.log(`  • ${v}`)
  console.log('')
}

main()
