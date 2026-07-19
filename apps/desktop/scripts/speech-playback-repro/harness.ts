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

import { AudioPlayer, type PreparedAudio } from '../../src/renderer/audio/audioPlayer'
import { EmotionSpeechPipeline } from '../../src/renderer/runtime/EmotionSpeechPipeline'
import type { SuccessfulSpeechReply } from '../../src/renderer/runtime/SpeechRuntime'
import { type EmotionTextSegment, parseEmotionalReply } from '../../src/shared/emotion'

// ---------------------------------------------------------------------------
// WebAudio mocks
// ---------------------------------------------------------------------------

let clock = 0
const stopEndedQueue: FakeSource[] = [] // sources whose stop() will deliver ended

class FakeAnalyser {
  fftSize = 256
  connections = 0
  connect() {
    this.connections++
  }
  disconnect() {
    this.connections = Math.max(0, this.connections - 1)
  }
}

class FakeSource {
  buffer: unknown = null
  onended: (() => void) | null = null
  started = false
  stopped = false
  connectedTo = 0
  readonly label: string
  constructor(label: string) {
    this.label = label
  }
  connect() {
    this.connectedTo++
  }
  disconnect() {
    this.connectedTo = 0
  }
  start() {
    this.started = true
  }
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
  async resume() {
    this.state = 'running'
  }
  createAnalyser() {
    return new FakeAnalyser() as unknown as AnalyserNode
  }
  createBufferSource() {
    const s = new FakeSource(`src${createdSources.length + 1}`)
    createdSources.push(s)
    return s as unknown as AudioBufferSourceNode
  }
  async decodeAudioData(_buf: ArrayBuffer) {
    // Resolves on a microtask, like the real API.
    const samples = new Float32Array(72_000)
    samples.fill(0.1)
    return {
      duration: 1.5,
      sampleRate: 48_000,
      length: samples.length,
      numberOfChannels: 1,
      getChannelData: () => samples,
    } as unknown as AudioBuffer
  }
}

// Install globals BEFORE instantiating any player.
const g = globalThis as unknown as Record<string, unknown>
g.AudioContext = FakeAudioContext
const timers = new Set<number>()
let timerSeq = 1
g.window = {
  setInterval: () => {
    const id = timerSeq++
    timers.add(id)
    return id
  },
  clearInterval: (id: number) => {
    timers.delete(id)
  },
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

  async play(
    _wav: ArrayBuffer,
    onEnd?: () => void,
    onProgress?: (p: number) => void,
  ): Promise<void> {
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

  isPlaying() {
    return this.source !== null
  }
}

// ---------------------------------------------------------------------------
// Scenario driver + LipSync attach/detach modelling
// ---------------------------------------------------------------------------

interface Ev {
  t: number
  frame: number
  type: string
  detail: string
}

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
      onProgress,
    })
    onEnd?.()
  }

  stop(): void {
    this.player.stop()
  }
  isPlaying(): boolean {
    return this.player.isPlaying()
  }
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

  attach(pb: number) {
    this.attaches++
    this.emit('LIPSYNC attach', `playback#${pb}`)
  }
  detach(pb: number) {
    this.detaches++
    const other =
      this.activeAudible !== null && this.activeAudible !== pb
        ? ` (while #${this.activeAudible} audible)`
        : ''
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
        if (info.naturalEndFrame === null)
          spurious++ // interrupted playback should never finish
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
    () => {
      run.finish(pb)
      run.detach(pb)
    },
    () => {},
  )
}

/** Mark a playback as ending naturally at the current frame and fire its buffer end. */
function endNaturally(run: ScenarioRun, src: FakeSource | undefined, pb: number) {
  const info = run.playbacks.get(pb)
  if (info) info.naturalEndFrame = run.frame
  src?.fireNatural()
  run.activeAudible = null
}

async function runScenario(
  name: string,
  make: () => PlayerLike,
  body: (run: ScenarioRun, p: PlayerLike, getSrc: (i: number) => FakeSource) => Promise<void>,
): Promise<ScenarioRun> {
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
    const playback = speak(run, p, 1)
    await Promise.resolve()
    await Promise.resolve()
    run.frame += 90 // ~1.5s of speaking frames
    endNaturally(run, getSrc(0), 1)
    await playback
  })
}

async function scenarioInterrupted(make: () => PlayerLike) {
  return runScenario('INTERRUPTED', make, async (run, p, getSrc) => {
    const first = speak(run, p, 1)
    await Promise.resolve()
    await Promise.resolve()
    run.frame += 20
    p.stop()
    await first
    // New reply starts before #1 finishes → #1 is interrupted (never ends naturally).
    const second = speak(run, p, 2)
    await Promise.resolve()
    await Promise.resolve()
    run.frame += 1
    // Audio thread now delivers the stop()-ended for the superseded source #1.
    drainStopEnded()
    // At this instant #2 is the audible playback; is the player still tracking it?
    run.emit('CHECK isPlaying', `${p.isPlaying()} (expected true: #2 audible)`)
    run.frame += 70
    endNaturally(run, getSrc(1), 2) // #2 finishes naturally
    await second
  })
}

async function scenarioManualStop(make: () => PlayerLike) {
  return runScenario('MANUAL_STOP', make, async (run, p) => {
    const playback = speak(run, p, 1)
    await Promise.resolve()
    await Promise.resolve()
    run.frame += 15
    p.stop()
    await playback
    run.activeAudible = null
    drainStopEnded()
    run.emit('CHECK isPlaying', `${p.isPlaying()} (expected false: stopped)`)
  })
}

async function scenarioConsecutive(make: () => PlayerLike) {
  return runScenario('CONSECUTIVE', make, async (run, p, getSrc) => {
    const first = speak(run, p, 1)
    await Promise.resolve()
    await Promise.resolve()
    run.frame += 88
    endNaturally(run, getSrc(0), 1)
    await first
    run.frame += 2
    const second = speak(run, p, 2)
    await Promise.resolve()
    await Promise.resolve()
    run.frame += 88
    endNaturally(run, getSrc(1), 2)
    await second
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
    console.log(
      `\n[${name}] ${bad ? '✗' : '✓'} prematureFinish=${m.premature} spuriousFinish=${m.spurious} doubleFinish=${m.double}`,
    )
    for (const e of run.events) {
      if (e.type.startsWith('---')) continue
      console.log(
        `   t=${String(e.t).padStart(3)} frame=${String(e.frame).padStart(3)}  ${e.type}${e.detail ? `  ${e.detail}` : ''}`,
      )
    }
  }
}

interface PipelineTrace {
  synthStart: number[]
  synthEnd: number[]
  prepared: number[]
  playStart: number[]
  playEnd: number[]
  progress: number[]
  maxSynthesis: number
  maxPlayback: number
  maxBufferedAhead: number
  transitionGaps: number[]
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Emotion pipeline repro failed: ${message}`)
}

function emotionSegments(count: number): EmotionTextSegment[] {
  const emotions = ['happy', 'sad', 'calm']
  return Array.from({ length: count }, (_, index) => ({
    id: `segment-${index}`,
    index,
    emotion: emotions[index],
    text: `segment ${index + 1} spoken words`,
    boundaryAfter: 'sentence',
    targetMaxGapMs: 180,
  }))
}

async function runPipeline(options: {
  count: number
  synthesisDelayMs: number[]
  audioDurationMs: number[]
  playbackDelayMs: number[]
  failSynthesisIndex?: number
  cancelDuringFirstPlayback?: boolean
}): Promise<{ trace: PipelineTrace; result: 'completed' | 'cancelled' | 'failed' }> {
  const trace: PipelineTrace = {
    synthStart: [],
    synthEnd: [],
    prepared: [],
    playStart: [],
    playEnd: [],
    progress: [],
    maxSynthesis: 0,
    maxPlayback: 0,
    maxBufferedAhead: 0,
    transitionGaps: [],
  }
  const buffers = new WeakMap<ArrayBuffer, number>()
  const segments = emotionSegments(options.count)
  const weights = segments.map((segment) => segment.text.length)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let completedWeight = 0
  let synthesisActive = 0
  let playbackActive = 0
  let pipeline!: EmotionSpeechPipeline
  pipeline = new EmotionSpeechPipeline({
    turnId: 'pipeline-repro',
    segments,
    synthesize: async (segment) => {
      synthesisActive += 1
      trace.maxSynthesis = Math.max(trace.maxSynthesis, synthesisActive)
      trace.synthStart[segment.index] = performance.now()
      await delay(options.synthesisDelayMs[segment.index] ?? 1)
      synthesisActive -= 1
      if (segment.index === options.failSynthesisIndex)
        throw new Error(`synthetic synthesis failure index=${segment.index}`)
      trace.synthEnd[segment.index] = performance.now()
      const audioBuffer = new ArrayBuffer(44)
      buffers.set(audioBuffer, segment.index)
      return { ok: true, audioBuffer } as SuccessfulSpeechReply
    },
    prepareAudio: async (audioBuffer) => {
      const index = buffers.get(audioBuffer)
      check(index !== undefined, 'prepared buffer must retain its segment identity')
      trace.prepared[index] = performance.now()
      return {
        audioBuffer: { duration: options.audioDurationMs[index] / 1000 } as AudioBuffer,
        durationMs: options.audioDurationMs[index],
        normalizationReference: 0.12,
      } satisfies PreparedAudio
    },
    playPrepared: async (item, onStarted) => {
      const index = item.segment.index
      playbackActive += 1
      trace.maxPlayback = Math.max(trace.maxPlayback, playbackActive)
      trace.playStart[index] = performance.now()
      onStarted()
      const weight = weights[index]
      for (const progress of [0, 0.5, 1])
        trace.progress.push((completedWeight + progress * weight) / totalWeight)
      if (index === 0 && options.cancelDuringFirstPlayback) setTimeout(() => pipeline.cancel(), 2)
      await delay(options.playbackDelayMs[index] ?? 1)
      trace.playEnd[index] = performance.now()
      playbackActive -= 1
      completedWeight += weight
    },
    isCurrentTurn: () => true,
    recordEvent: (label, detail) => {
      const buffered = /bufferedAhead=(\d+)/.exec(detail)
      if (buffered) trace.maxBufferedAhead = Math.max(trace.maxBufferedAhead, Number(buffered[1]))
      const transitionGap = /transitionGapMs=(\d+)/.exec(detail)
      if (label === 'Emotion Speech Segment Started' && transitionGap)
        trace.transitionGaps.push(Number(transitionGap[1]))
    },
  })
  try {
    await pipeline.execute()
    return { trace, result: 'completed' }
  } catch (error) {
    if (options.cancelDuringFirstPlayback) return { trace, result: 'cancelled' }
    if (options.failSynthesisIndex !== undefined) return { trace, result: 'failed' }
    throw error
  }
}

async function runEmotionPipelineRegression(): Promise<void> {
  console.log('\n===== EMOTION SPEECH PIPELINE 2.0 =====')

  const parsed = parseEmotionalReply('[happy]Первая часть, [sad]вторая часть. [calm]Пауза…')
  check(parsed.segments[0].boundaryAfter === 'clause', 'comma produces clause boundary')
  check(parsed.segments[1].boundaryAfter === 'sentence', 'period produces sentence boundary')
  check(parsed.segments[2].boundaryAfter === 'expressive', 'ellipsis produces expressive boundary')
  check(
    parseEmotionalReply('[happy]Первая часть\n\n[sad]Вторая часть').segments[0].boundaryAfter ===
      'expressive',
    'double newline produces expressive boundary',
  )
  check(
    parseEmotionalReply('[happy]Один. [sad]Два. [calm]Три. [angry]Четыре.').segments.length === 3,
    'parser preserves the three-segment limit',
  )

  let ttsCount = 0
  let playbackCount = 0
  let cleanupCount = 0
  if (emotionSegments(1).length === 1) {
    ttsCount += 1
    playbackCount += 1
  }
  cleanupCount += 1
  check(ttsCount === 1 && playbackCount === 1 && cleanupCount === 1, 'single fast path')

  const long = await runPipeline({
    count: 2,
    synthesisDelayMs: [2, 8],
    audioDurationMs: [1800, 1600],
    playbackDelayMs: [30, 10],
  })
  check(long.result === 'completed', 'two long segments complete')
  check(long.trace.synthStart[1] < long.trace.playEnd[0], 'synthesis 2 overlaps playback 1')
  check(long.trace.maxSynthesis === 1, 'TTS requests do not overlap')
  check(long.trace.maxPlayback === 1, 'playbacks do not overlap')
  check((long.trace.transitionGaps[1] ?? Infinity) <= 180, 'prepared transition gap stays bounded')

  const short = await runPipeline({
    count: 2,
    synthesisDelayMs: [2, 12],
    audioDurationMs: [350, 1200],
    playbackDelayMs: [5, 5],
  })
  check(
    short.trace.prepared[1] <= short.trace.playStart[0],
    'short first segment waits for segment 2',
  )

  const three = await runPipeline({
    count: 3,
    synthesisDelayMs: [2, 4, 4],
    audioDurationMs: [1800, 1000, 1000],
    playbackDelayMs: [25, 15, 10],
  })
  check(three.result === 'completed', 'three segments complete')
  check(three.trace.maxSynthesis === 1 && three.trace.maxPlayback === 1, 'single-flight limits')
  check(three.trace.maxBufferedAhead <= 2, 'at most two prepared segments ahead')

  const cancelled = await runPipeline({
    count: 3,
    synthesisDelayMs: [2, 25, 2],
    audioDurationMs: [1800, 1000, 1000],
    playbackDelayMs: [12, 5, 5],
    cancelDuringFirstPlayback: true,
  })
  check(cancelled.result === 'cancelled', 'interruption cancels pipeline')
  check(cancelled.trace.playStart[1] === undefined, 'cancelled segment 2 never starts')
  check(cancelled.trace.synthStart[2] === undefined, 'cancelled segment 3 never synthesizes')

  const failed = await runPipeline({
    count: 3,
    synthesisDelayMs: [2, 8, 2],
    audioDurationMs: [1800, 1000, 1000],
    playbackDelayMs: [20, 5, 5],
    failSynthesisIndex: 1,
  })
  check(failed.result === 'failed', 'background synthesis failure reaches consumer')
  check(failed.trace.playStart[1] === undefined, 'failed segment never plays')
  check(failed.trace.synthStart[2] === undefined, 'production stops after synthesis failure')

  const progress = three.trace.progress
  check(
    progress.every((value, index) => index === 0 || value >= progress[index - 1]),
    'aggregate progress is monotonic',
  )
  check(progress.at(-1) === 1, 'aggregate progress reaches 1')
  console.log('PASS: cases 1-7')
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
    CONSECUTIVE: await scenarioConsecutive(origMake),
  }
  const fixed = {
    NORMAL: await scenarioNormal(fixedMake),
    INTERRUPTED: await scenarioInterrupted(fixedMake),
    MANUAL_STOP: await scenarioManualStop(fixedMake),
    CONSECUTIVE: await scenarioConsecutive(fixedMake),
  }

  summarize('ORIGINAL (pre-fix)', original)
  summarize('FIXED (current AudioPlayer)', fixed)

  console.log('\n===== VERDICT =====')
  const fmt = (r: ScenarioRun) => {
    const m = r.metrics()
    return `premature=${m.premature} spurious=${m.spurious} double=${m.double}`
  }
  console.log(
    `ORIGINAL / INTERRUPTED : ${fmt(original.INTERRUPTED)}  → stale source#1 ended fires finishSpeech#2 early (frame 21) while #2 is still audible`,
  )
  console.log(
    `FIXED    / INTERRUPTED : ${fmt(fixed.INTERRUPTED)}  → only #2 finishes, at its real buffer end`,
  )
  await runEmotionPipelineRegression()
}

void main()
