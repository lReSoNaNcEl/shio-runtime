/**
 * Work Item S2.2 — Live Speech Playback Lifecycle Harness (simulation).
 *
 * Drives the REAL AudioPlayer (fixed) and a verbatim copy of the ORIGINAL
 * (pre-fix) play()/stop() logic through the four Phase-3 scenarios:
 *   normal · interrupted · manual stop · consecutive
 *
 * The WebAudio graph is mocked with a faithful model of the one behaviour that
 * matters for the bug: calling stop() on a playing BufferSource delivers its
 * `ended` event ASYNCHRONOUSLY (from the audio thread), i.e. AFTER the
 * synchronous JS that issued the stop — in practice after the interrupting
 * play() has already created and started its new source.
 *
 * LipSync attach/detach are modelled around each playback exactly as the live
 * integration wires them: ATTACH just before play() (startSpeech), DETACH inside
 * the end callback (finishSpeech). This exposes whether a stale source's late
 * `ended` detaches LipSync while a newer playback is still audible.
 */

import { AudioPlayer } from '../../src/renderer/audio/audioPlayer'

// ---------------------------------------------------------------------------
// WebAudio mocks
// ---------------------------------------------------------------------------

let clock = 0
const stopEndedQueue: FakeSource[] = [] // sources whose stop() will deliver ended

class FakeAnalyser {
  fftSize = 256
  connections = 0
  connect() { this.connections++ }
  disconnect() { this.connections = Math.max(0, this.connections - 1) }
}

class FakeSource {
  buffer: unknown = null
  onended: (() => void) | null = null
  started = false
  stopped = false
  connectedTo = 0
  readonly label: string
  constructor(label: string) { this.label = label }
  connect() { this.connectedTo++ }
  disconnect() { this.connectedTo = 0 }
  start() { this.started = true }
  stop() {
    if (this.stopped) return
    this.stopped = true
    // Browser delivers `ended` asynchronously after stop(); queue it.
    if (this.started) stopEndedQueue.push(this)
  }
  /** Simulate the audio thread delivering the natural end-of-buffer event. */
  fireNatural() {
    if (!this.started || this.stopped) return
    this.stopped = true
    this.onended?.()
  }
}

const createdSources: FakeSource[] = []

class FakeAudioContext {
  state = 'running'
  currentTime = 0
  destination = { kind: 'destination' }
  async resume() { this.state = 'running' }
  createAnalyser() { return new FakeAnalyser() as unknown as AnalyserNode }
  createBufferSource() {
    const s = new FakeSource(`src${createdSources.length + 1}`)
    createdSources.push(s)
    return s as unknown as AudioBufferSourceNode
  }
  async decodeAudioData(_buf: ArrayBuffer) {
    // Resolves on a microtask, like the real API.
    return { duration: 1.5 } as unknown as AudioBuffer
  }
}

// Install globals BEFORE instantiating any player.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any
g.AudioContext = FakeAudioContext
const timers = new Set<number>()
let timerSeq = 1
g.window = {
  setInterval: () => { const id = timerSeq++; timers.add(id); return id },
  clearInterval: (id: number) => { timers.delete(id) }
}

const drainStopEnded = () => {
  // Deliver all queued stop()-ended events (the audio thread catching up).
  const batch = stopEndedQueue.splice(0)
  for (const s of batch) s.onended?.()
}

// ---------------------------------------------------------------------------
// Verbatim copy of the ORIGINAL (pre-fix) AudioPlayer.play()/stop() logic.
// Kept minimal but behaviourally identical to prove the original defect.
// ---------------------------------------------------------------------------

class OriginalAudioPlayer {
  private audioCtx = new FakeAudioContext()
  analyser = this.audioCtx.createAnalyser() as unknown as FakeAnalyser
  private source: FakeSource | null = null
  private onEndCallback: (() => void) | null = null
  private duration = 0

  async play(_wav: ArrayBuffer, onEnd?: () => void, onProgress?: (p: number) => void): Promise<void> {
    if (this.source) {
      this.source.stop()
      this.source = null
    }
    this.onEndCallback = onEnd ?? null
    const audioBuffer = await this.audioCtx.decodeAudioData(new ArrayBuffer(44))
    this.source = this.audioCtx.createBufferSource() as unknown as FakeSource
    this.source.buffer = audioBuffer
    this.source.connect()
    this.duration = (audioBuffer as { duration: number }).duration
    this.source.onended = () => {
      onProgress?.(1)
      this.source = null
      this.onEndCallback?.()
    }
    this.source.start()
    onProgress?.(0)
  }

  stop(): void {
    if (this.source) {
      this.source.stop()
      this.source = null
    }
  }

  isPlaying() { return this.source !== null }
}

// ---------------------------------------------------------------------------
// Scenario driver + LipSync attach/detach modelling
// ---------------------------------------------------------------------------

interface Ev { t: number; frame: number; type: string; detail: string }

interface PlayerLike {
  play(w: ArrayBuffer, onEnd?: () => void, onProgress?: (p: number) => void): Promise<void>
  stop(): void
  isPlaying(): boolean
}

class FixedPlayerAdapter implements PlayerLike {
  private readonly player = new AudioPlayer()
  private sequence = 0

  async play(w: ArrayBuffer, onEnd?: () => void, onProgress?: (p: number) => void): Promise<void> {
    await this.player.play(w, {
      turnId: `playback-repro-${++this.sequence}`,
      onReady: () => undefined,
      onProgress
    })
    onEnd?.()
  }

  stop(): void { this.player.stop() }
  isPlaying(): boolean { return this.player.isPlaying() }
}

interface PlaybackInfo {
  pb: number
  attachFrame: number
  /** Frame the buffer naturally ends; null => this playback was interrupted. */
  naturalEndFrame: number | null
  finishFrames: number[]
}

class ScenarioRun {
  events: Ev[] = []
  frame = 0
  attaches = 0
  detaches = 0
  activeAudible: number | null = null
  playbacks = new Map<number, PlaybackInfo>()

  emit(type: string, detail = '') {
    clock += 1
    this.events.push({ t: clock, frame: this.frame, type, detail })
  }

  attach(pb: number) { this.attaches++; this.emit('LIPSYNC attach', `playback#${pb}`) }
  detach(pb: number) {
    this.detaches++
    const other = this.activeAudible !== null && this.activeAudible !== pb ? ` (while #${this.activeAudible} audible)` : ''
    this.emit('LIPSYNC detach', `playback#${pb}${other}`)
  }
  finish(pb: number) {
    const info = this.playbacks.get(pb)
    info?.finishFrames.push(this.frame)
    this.emit('SPEECHSTATE speaking->silent', `finishSpeech playback#${pb}`)
  }

  /** Metrics derived from the recorded lifecycle. */
  metrics() {
    let premature = 0
    let spurious = 0
    let double = 0
    for (const info of this.playbacks.values()) {
      if (info.finishFrames.length > 1) double++
      for (const f of info.finishFrames) {
        if (info.naturalEndFrame === null) spurious++ // interrupted playback should never finish
        else if (f < info.naturalEndFrame - 1) premature++ // finished before its audio ended
      }
    }
    return { premature, spurious, double }
  }
}

/** startSpeech + play wiring for one reply. naturalEndFrame set later by caller. */
function speak(run: ScenarioRun, player: PlayerLike, pb: number): Promise<void> {
  run.playbacks.set(pb, { pb, attachFrame: run.frame, naturalEndFrame: null, finishFrames: [] })
  run.attach(pb)
  run.activeAudible = pb
  run.emit('SPEECHSTATE ->speaking', `playback#${pb}`)
  return player.play(
    new ArrayBuffer(44),
    () => { run.finish(pb); run.detach(pb) },
    () => {}
  )
}

/** Mark a playback as ending naturally at the current frame and fire its buffer end. */
function endNaturally(run: ScenarioRun, src: FakeSource | undefined, pb: number) {
  const info = run.playbacks.get(pb)
  if (info) info.naturalEndFrame = run.frame
  src?.fireNatural()
  run.activeAudible = null
}

async function runScenario(name: string, make: () => PlayerLike, body: (run: ScenarioRun, p: PlayerLike, getSrc: (i: number) => FakeSource) => Promise<void>): Promise<ScenarioRun> {
  createdSources.length = 0
  stopEndedQueue.length = 0
  const run = new ScenarioRun()
  const player = make()
  const getSrc = (i: number) => createdSources[i]
  run.emit('--- scenario', name)
  await body(run, player, getSrc)
  return run
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function scenarioNormal(make: () => PlayerLike) {
  return runScenario('NORMAL', make, async (run, p, getSrc) => {
    await speak(run, p, 1)
    run.frame += 90 // ~1.5s of speaking frames
    endNaturally(run, getSrc(0), 1)
  })
}

async function scenarioInterrupted(make: () => PlayerLike) {
  return runScenario('INTERRUPTED', make, async (run, p, getSrc) => {
    await speak(run, p, 1)
    run.frame += 20
    // New reply starts before #1 finishes → #1 is interrupted (never ends naturally).
    await speak(run, p, 2)
    run.frame += 1
    // Audio thread now delivers the stop()-ended for the superseded source #1.
    drainStopEnded()
    // At this instant #2 is the audible playback; is the player still tracking it?
    run.emit('CHECK isPlaying', `${p.isPlaying()} (expected true: #2 audible)`)
    run.frame += 70
    endNaturally(run, getSrc(1), 2) // #2 finishes naturally
  })
}

async function scenarioManualStop(make: () => PlayerLike) {
  return runScenario('MANUAL_STOP', make, async (run, p) => {
    await speak(run, p, 1)
    run.frame += 15
    p.stop()
    run.activeAudible = null
    drainStopEnded()
    run.emit('CHECK isPlaying', `${p.isPlaying()} (expected false: stopped)`)
  })
}

async function scenarioConsecutive(make: () => PlayerLike) {
  return runScenario('CONSECUTIVE', make, async (run, p, getSrc) => {
    await speak(run, p, 1)
    run.frame += 88
    endNaturally(run, getSrc(0), 1)
    run.frame += 2
    await speak(run, p, 2)
    run.frame += 88
    endNaturally(run, getSrc(1), 2)
  })
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function summarize(label: string, runs: Record<string, ScenarioRun>) {
  console.log(`\n===== ${label} =====`)
  for (const [name, run] of Object.entries(runs)) {
    const m = run.metrics()
    const bad = m.premature || m.spurious || m.double
    console.log(`\n[${name}] ${bad ? '✗' : '✓'} prematureFinish=${m.premature} spuriousFinish=${m.spurious} doubleFinish=${m.double}`)
    for (const e of run.events) {
      if (e.type.startsWith('---')) continue
      console.log(`   t=${String(e.t).padStart(3)} frame=${String(e.frame).padStart(3)}  ${e.type}${e.detail ? '  ' + e.detail : ''}`)
    }
  }
}

async function main() {
  // Silence production [SPEECHPLAY] telemetry unless --verbose (keeps report readable).
  if (!process.argv.includes('--verbose')) {
    const realLog = console.log.bind(console)
    console.log = (...a: unknown[]) => {
      if (typeof a[0] === 'string' && /^\[SPEECHPLAY\]/.test(a[0])) return
      realLog(...a)
    }
  }

  const origMake = () => new OriginalAudioPlayer() as unknown as PlayerLike
  const fixedMake = () => new FixedPlayerAdapter()

  const original = {
    NORMAL: await scenarioNormal(origMake),
    INTERRUPTED: await scenarioInterrupted(origMake),
    MANUAL_STOP: await scenarioManualStop(origMake),
    CONSECUTIVE: await scenarioConsecutive(origMake)
  }
  const fixed = {
    NORMAL: await scenarioNormal(fixedMake),
    INTERRUPTED: await scenarioInterrupted(fixedMake),
    MANUAL_STOP: await scenarioManualStop(fixedMake),
    CONSECUTIVE: await scenarioConsecutive(fixedMake)
  }

  summarize('ORIGINAL (pre-fix)', original)
  summarize('FIXED (current AudioPlayer)', fixed)

  console.log('\n===== VERDICT =====')
  const fmt = (r: ScenarioRun) => { const m = r.metrics(); return `premature=${m.premature} spurious=${m.spurious} double=${m.double}` }
  console.log(`ORIGINAL / INTERRUPTED : ${fmt(original.INTERRUPTED)}  → stale source#1 ended fires finishSpeech#2 early (frame 21) while #2 is still audible`)
  console.log(`FIXED    / INTERRUPTED : ${fmt(fixed.INTERRUPTED)}  → only #2 finishes, at its real buffer end`)
}

void main()
