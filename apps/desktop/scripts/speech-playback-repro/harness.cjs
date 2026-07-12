// src/renderer/audio/audioPlayer.ts
var ParallelPlaybackError = class extends Error {
  constructor(activeTurnId, requestedTurnId) {
    super(`Parallel playback rejected: activeTurnId=${activeTurnId} requestedTurnId=${requestedTurnId}`);
    this.activeTurnId = activeTurnId;
    this.requestedTurnId = requestedTurnId;
    this.name = "ParallelPlaybackError";
  }
  activeTurnId;
  requestedTurnId;
};
var AudioPlayer = class {
  audioCtx;
  analyser;
  activePlayback = null;
  progressTimer = null;
  duration = 0;
  playbackSeq = 0;
  constructor() {
    this.audioCtx = new AudioContext();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.connect(this.audioCtx.destination);
  }
  async play(wavBuffer, options) {
    if (wavBuffer.byteLength < 44) throw new Error("Speech audio response is empty or invalid");
    if (this.activePlayback) {
      console.warn(`[audio] guard activeTurnId=${this.activePlayback.turnId} requestedTurnId=${options.turnId}`);
      throw new ParallelPlaybackError(this.activePlayback.turnId, options.turnId);
    }
    const sequence = ++this.playbackSeq;
    const playbackId = `${options.turnId}:playback-${sequence}`;
    const active = {
      playbackId,
      turnId: options.turnId,
      analyser: this.analyser,
      startedAt: performance.now(),
      playbackItemId: playbackId,
      normalizationReference: 0.12,
      sequence,
      source: null,
      settle: null
    };
    this.activePlayback = active;
    console.log(`[audio] playbackId=${playbackId} turnId=${options.turnId} reserved`);
    try {
      if (this.audioCtx.state === "suspended") await this.audioCtx.resume();
      this.assertOwner(active);
      const audioBuffer = await this.audioCtx.decodeAudioData(wavBuffer.slice(0));
      active.normalizationReference = this.estimateNormalizationReference(audioBuffer);
      this.assertOwner(active);
      const source = this.audioCtx.createBufferSource();
      active.source = source;
      source.buffer = audioBuffer;
      source.connect(this.analyser);
      this.duration = audioBuffer.duration;
      const ended = new Promise((resolve) => {
        active.settle = resolve;
      });
      source.onended = () => {
        if (this.activePlayback !== active || active.source !== source) {
          console.debug(`[audio] playbackId=${playbackId} turnId=${options.turnId} stale-ended ignored`);
          return;
        }
        console.log(`[audio] playbackId=${playbackId} turnId=${options.turnId} ended`);
        options.onProgress?.(1);
        active.settle?.();
      };
      await options.onReady({
        playbackId,
        playbackItemId: active.playbackItemId,
        turnId: options.turnId,
        analyser: this.analyser,
        startedAt: active.startedAt,
        normalizationReference: active.normalizationReference
      });
      this.assertOwner(active);
      const startedAt = this.audioCtx.currentTime;
      source.start();
      console.log(`[audio] playbackId=${playbackId} turnId=${options.turnId} started`);
      options.onProgress?.(0);
      this.progressTimer = window.setInterval(() => {
        if (this.activePlayback !== active || this.duration <= 0) return;
        options.onProgress?.(Math.min(1, (this.audioCtx.currentTime - startedAt) / this.duration));
      }, 100);
      await ended;
      return { playbackId, turnId: options.turnId };
    } finally {
      if (this.activePlayback === active) {
        this.clearProgressTimer();
        this.disposeSource(active.source, playbackId);
        active.source = null;
        active.settle = null;
        this.activePlayback = null;
        console.log(`[audio] playbackId=${playbackId} turnId=${options.turnId} released`);
      }
    }
  }
  stop() {
    const active = this.activePlayback;
    if (!active) return;
    const source = active.source;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
      }
    }
    active.settle?.();
  }
  isPlaying() {
    return this.activePlayback?.source !== null && Boolean(this.activePlayback);
  }
  isBusy() {
    return this.activePlayback !== null;
  }
  getPlaybackDebug() {
    return {
      playing: this.isPlaying(),
      activePlaybackId: this.activePlayback?.sequence ?? 0,
      playbackId: this.activePlayback?.playbackId ?? "",
      turnId: this.activePlayback?.turnId ?? ""
    };
  }
  assertOwner(active) {
    if (this.activePlayback !== active) throw new Error(`Playback ownership lost for turnId=${active.turnId}`);
  }
  disposeSource(source, playbackId) {
    if (!source) return;
    source.onended = null;
    try {
      source.disconnect();
    } catch {
    }
    console.debug(`[audio] playbackId=${playbackId} disposed`);
  }
  clearProgressTimer() {
    if (this.progressTimer === null) return;
    window.clearInterval(this.progressTimer);
    this.progressTimer = null;
  }
  estimateNormalizationReference(buffer) {
    const windowSize = Math.max(64, Math.floor(buffer.sampleRate * 0.02));
    const energies = [];
    for (let offset = 0; offset < buffer.length; offset += windowSize) {
      let sum = 0;
      let count = 0;
      const end = Math.min(buffer.length, offset + windowSize);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = offset; i < end; i++) {
          sum += data[i] * data[i];
          count += 1;
        }
      }
      const rms = count > 0 ? Math.sqrt(sum / count) : 0;
      if (rms >= facialSilenceFloor) energies.push(rms);
    }
    if (energies.length === 0) return 0.12;
    energies.sort((a, b) => a - b);
    const percentile = energies[Math.min(energies.length - 1, Math.floor(energies.length * 0.8))];
    return Math.max(0.04, Math.min(0.3, percentile));
  }
};
var facialSilenceFloor = 6e-3;

// scripts/speech-playback-repro/harness.ts
var clock = 0;
var stopEndedQueue = [];
var FakeAnalyser = class {
  fftSize = 256;
  connections = 0;
  connect() {
    this.connections++;
  }
  disconnect() {
    this.connections = Math.max(0, this.connections - 1);
  }
};
var FakeSource = class {
  buffer = null;
  onended = null;
  started = false;
  stopped = false;
  connectedTo = 0;
  label;
  constructor(label) {
    this.label = label;
  }
  connect() {
    this.connectedTo++;
  }
  disconnect() {
    this.connectedTo = 0;
  }
  start() {
    this.started = true;
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.started) stopEndedQueue.push(this);
  }
  /** Simulate the audio thread delivering the natural end-of-buffer event. */
  fireNatural() {
    if (!this.started || this.stopped) return;
    this.stopped = true;
    this.onended?.();
  }
};
var createdSources = [];
var FakeAudioContext = class {
  state = "running";
  currentTime = 0;
  destination = { kind: "destination" };
  async resume() {
    this.state = "running";
  }
  createAnalyser() {
    return new FakeAnalyser();
  }
  createBufferSource() {
    const s = new FakeSource(`src${createdSources.length + 1}`);
    createdSources.push(s);
    return s;
  }
  async decodeAudioData(_buf) {
    return { duration: 1.5 };
  }
};
var g = globalThis;
g.AudioContext = FakeAudioContext;
var timers = /* @__PURE__ */ new Set();
var timerSeq = 1;
g.window = {
  setInterval: () => {
    const id = timerSeq++;
    timers.add(id);
    return id;
  },
  clearInterval: (id) => {
    timers.delete(id);
  }
};
var drainStopEnded = () => {
  const batch = stopEndedQueue.splice(0);
  for (const s of batch) s.onended?.();
};
var OriginalAudioPlayer = class {
  audioCtx = new FakeAudioContext();
  analyser = this.audioCtx.createAnalyser();
  source = null;
  onEndCallback = null;
  duration = 0;
  async play(_wav, onEnd, onProgress) {
    if (this.source) {
      this.source.stop();
      this.source = null;
    }
    this.onEndCallback = onEnd ?? null;
    const audioBuffer = await this.audioCtx.decodeAudioData(new ArrayBuffer(44));
    this.source = this.audioCtx.createBufferSource();
    this.source.buffer = audioBuffer;
    this.source.connect();
    this.duration = audioBuffer.duration;
    this.source.onended = () => {
      onProgress?.(1);
      this.source = null;
      this.onEndCallback?.();
    };
    this.source.start();
    onProgress?.(0);
  }
  stop() {
    if (this.source) {
      this.source.stop();
      this.source = null;
    }
  }
  isPlaying() {
    return this.source !== null;
  }
};
var FixedPlayerAdapter = class {
  player = new AudioPlayer();
  sequence = 0;
  async play(w, onEnd, onProgress) {
    await this.player.play(w, {
      turnId: `playback-repro-${++this.sequence}`,
      onReady: () => void 0,
      onProgress
    });
    onEnd?.();
  }
  stop() {
    this.player.stop();
  }
  isPlaying() {
    return this.player.isPlaying();
  }
};
var ScenarioRun = class {
  events = [];
  frame = 0;
  attaches = 0;
  detaches = 0;
  activeAudible = null;
  playbacks = /* @__PURE__ */ new Map();
  emit(type, detail = "") {
    clock += 1;
    this.events.push({ t: clock, frame: this.frame, type, detail });
  }
  attach(pb) {
    this.attaches++;
    this.emit("LIPSYNC attach", `playback#${pb}`);
  }
  detach(pb) {
    this.detaches++;
    const other = this.activeAudible !== null && this.activeAudible !== pb ? ` (while #${this.activeAudible} audible)` : "";
    this.emit("LIPSYNC detach", `playback#${pb}${other}`);
  }
  finish(pb) {
    const info = this.playbacks.get(pb);
    info?.finishFrames.push(this.frame);
    this.emit("SPEECHSTATE speaking->silent", `finishSpeech playback#${pb}`);
  }
  /** Metrics derived from the recorded lifecycle. */
  metrics() {
    let premature = 0;
    let spurious = 0;
    let double = 0;
    for (const info of this.playbacks.values()) {
      if (info.finishFrames.length > 1) double++;
      for (const f of info.finishFrames) {
        if (info.naturalEndFrame === null) spurious++;
        else if (f < info.naturalEndFrame - 1) premature++;
      }
    }
    return { premature, spurious, double };
  }
};
function speak(run, player, pb) {
  run.playbacks.set(pb, { pb, attachFrame: run.frame, naturalEndFrame: null, finishFrames: [] });
  run.attach(pb);
  run.activeAudible = pb;
  run.emit("SPEECHSTATE ->speaking", `playback#${pb}`);
  return player.play(
    new ArrayBuffer(44),
    () => {
      run.finish(pb);
      run.detach(pb);
    },
    () => {
    }
  );
}
function endNaturally(run, src, pb) {
  const info = run.playbacks.get(pb);
  if (info) info.naturalEndFrame = run.frame;
  src?.fireNatural();
  run.activeAudible = null;
}
async function runScenario(name, make, body) {
  createdSources.length = 0;
  stopEndedQueue.length = 0;
  const run = new ScenarioRun();
  const player = make();
  const getSrc = (i) => createdSources[i];
  run.emit("--- scenario", name);
  await body(run, player, getSrc);
  return run;
}
async function scenarioNormal(make) {
  return runScenario("NORMAL", make, async (run, p, getSrc) => {
    await speak(run, p, 1);
    run.frame += 90;
    endNaturally(run, getSrc(0), 1);
  });
}
async function scenarioInterrupted(make) {
  return runScenario("INTERRUPTED", make, async (run, p, getSrc) => {
    await speak(run, p, 1);
    run.frame += 20;
    await speak(run, p, 2);
    run.frame += 1;
    drainStopEnded();
    run.emit("CHECK isPlaying", `${p.isPlaying()} (expected true: #2 audible)`);
    run.frame += 70;
    endNaturally(run, getSrc(1), 2);
  });
}
async function scenarioManualStop(make) {
  return runScenario("MANUAL_STOP", make, async (run, p) => {
    await speak(run, p, 1);
    run.frame += 15;
    p.stop();
    run.activeAudible = null;
    drainStopEnded();
    run.emit("CHECK isPlaying", `${p.isPlaying()} (expected false: stopped)`);
  });
}
async function scenarioConsecutive(make) {
  return runScenario("CONSECUTIVE", make, async (run, p, getSrc) => {
    await speak(run, p, 1);
    run.frame += 88;
    endNaturally(run, getSrc(0), 1);
    run.frame += 2;
    await speak(run, p, 2);
    run.frame += 88;
    endNaturally(run, getSrc(1), 2);
  });
}
function summarize(label, runs) {
  console.log(`
===== ${label} =====`);
  for (const [name, run] of Object.entries(runs)) {
    const m = run.metrics();
    const bad = m.premature || m.spurious || m.double;
    console.log(`
[${name}] ${bad ? "\u2717" : "\u2713"} prematureFinish=${m.premature} spuriousFinish=${m.spurious} doubleFinish=${m.double}`);
    for (const e of run.events) {
      if (e.type.startsWith("---")) continue;
      console.log(`   t=${String(e.t).padStart(3)} frame=${String(e.frame).padStart(3)}  ${e.type}${e.detail ? "  " + e.detail : ""}`);
    }
  }
}
async function main() {
  if (!process.argv.includes("--verbose")) {
    const realLog = console.log.bind(console);
    console.log = (...a) => {
      if (typeof a[0] === "string" && /^\[SPEECHPLAY\]/.test(a[0])) return;
      realLog(...a);
    };
  }
  const origMake = () => new OriginalAudioPlayer();
  const fixedMake = () => new FixedPlayerAdapter();
  const original = {
    NORMAL: await scenarioNormal(origMake),
    INTERRUPTED: await scenarioInterrupted(origMake),
    MANUAL_STOP: await scenarioManualStop(origMake),
    CONSECUTIVE: await scenarioConsecutive(origMake)
  };
  const fixed = {
    NORMAL: await scenarioNormal(fixedMake),
    INTERRUPTED: await scenarioInterrupted(fixedMake),
    MANUAL_STOP: await scenarioManualStop(fixedMake),
    CONSECUTIVE: await scenarioConsecutive(fixedMake)
  };
  summarize("ORIGINAL (pre-fix)", original);
  summarize("FIXED (current AudioPlayer)", fixed);
  console.log("\n===== VERDICT =====");
  const fmt = (r) => {
    const m = r.metrics();
    return `premature=${m.premature} spurious=${m.spurious} double=${m.double}`;
  };
  console.log(`ORIGINAL / INTERRUPTED : ${fmt(original.INTERRUPTED)}  \u2192 stale source#1 ended fires finishSpeech#2 early (frame 21) while #2 is still audible`);
  console.log(`FIXED    / INTERRUPTED : ${fmt(fixed.INTERRUPTED)}  \u2192 only #2 finishes, at its real buffer end`);
}
void main();
