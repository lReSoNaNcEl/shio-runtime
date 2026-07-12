var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/continuous-listening-repro/harness.ts
var import_strict = __toESM(require("node:assert/strict"));

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

// src/renderer/continuousListening/tuning.ts
var chunkBuilderTuning = {
  pauseCompletionMs: 900,
  hardTimeoutMs: 12e3,
  maxCharacters: 500,
  minimumCharacters: 2
};
var attentionTuning = {
  thresholds: {
    silent: Number.POSITIVE_INFINITY,
    passive: 70,
    active: 45,
    streamer: 28
  },
  score: {
    directNameMention: 80,
    question: 18,
    recentConversation: 20,
    followUpWindow: 15,
    secondPersonAddress: 30,
    streamerRelevance: 12,
    emotionalExpression: 12,
    likelySelfTalk: -35,
    tooShort: -45,
    replyCooldown: -60,
    speakingNonDirect: -15
  }
};
var backlogTuning = {
  maxItems: 10,
  ttlMs: { correction: 3e4, direct: 25e3, followUp: 18e3, nonDirect: 8e3 },
  maxSelectedTurnsPerDrain: 1,
  mergeWindowMs: 6e3,
  maxMergedCharacters: 600,
  recentIdLimit: 128
};

// src/renderer/continuousListening/BacklogSelector.ts
var priorityRank = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
var correctionPattern = /(?:^|\s)(?:нет|стоп|подожди|погоди|я имел[а]? в виду|поправка)(?:$|[\s,.!?])/iu;
var continuationPattern = /(?:^|\s)(?:и ещё|ещё|точнее|то есть|лучше|в смысле)(?:$|[\s,.!?])/iu;
var BacklogSelector = class {
  constructor(arbitrate) {
    this.arbitrate = arbitrate;
  }
  arbitrate;
  arbitrationInFlight = false;
  arbitrationId = 0;
  generation = 0;
  cancel() {
    this.generation += 1;
    this.arbitrationId += 1;
    this.arbitrationInFlight = false;
  }
  async select(backlog, context) {
    backlog.purge();
    const version = backlog.getVersion();
    const items = backlog.snapshot();
    if (!context.continuousEnabled || items.length === 0) return this.discard(version, "streaming_disabled_or_empty");
    const clearWinner = this.unambiguousHighPriorityWinner(items);
    if (clearWinner) return this.withSimpleMerge(clearWinner, items, version, "deterministic_high_priority");
    const llmConfig = {
      ...context.llm,
      providerId: context.llm.providerId.trim(),
      model: context.llm.model.trim()
    };
    const llmEligible = llmConfig.enabled && Boolean(llmConfig.providerId && llmConfig.model) && llmConfig.timeoutMs > 0 && llmConfig.minimumConfidence >= 0 && llmConfig.minimumConfidence <= 1 && items.length >= 2 && this.selectionIsAmbiguous(items) && !this.arbitrationInFlight && Boolean(this.arbitrate);
    if (llmEligible) {
      const generation = ++this.generation;
      const arbitrationId = ++this.arbitrationId;
      this.arbitrationInFlight = true;
      try {
        const result = await this.withTimeout(
          Promise.resolve().then(() => this.arbitrate(items, version, llmConfig)),
          llmConfig.timeoutMs
        );
        if (backlog.getVersion() !== version || result.backlogVersion !== version || generation !== this.generation) {
          return this.deterministic(backlog.snapshot(), backlog.getVersion(), "stale_llm_fallback");
        }
        const snapshotIds = new Set(items.map((item2) => item2.id));
        const validIds = result.selectedIds.every((id) => snapshotIds.has(id) && backlog.has(id));
        const validAction = result.action === "discard_all" ? result.selectedIds.length === 0 : Boolean(result.text?.trim()) && (result.action === "select" ? result.selectedIds.length === 1 : result.selectedIds.length >= 2);
        if (result.confidence >= llmConfig.minimumConfidence && validIds && validAction) return result;
        return this.deterministic(items, version, "low_confidence_or_schema_fallback");
      } catch {
        return this.deterministic(backlog.snapshot(), backlog.getVersion(), "llm_error_fallback");
      } finally {
        if (arbitrationId === this.arbitrationId) this.arbitrationInFlight = false;
      }
    }
    return this.deterministic(items, version, "deterministic_fallback");
  }
  deterministic(items, version, reason) {
    if (items.length === 0) return this.discard(version, reason);
    const sorted = [...items].sort((a, b) => this.compareItems(a, b));
    return this.withSimpleMerge(sorted[0], items, version, reason);
  }
  unambiguousHighPriorityWinner(items) {
    const high = items.filter((item2) => item2.priorityClass === "P0" || item2.priorityClass === "P1");
    if (high.length === 0) return null;
    const sorted = [...high].sort((a, b) => this.compareItems(a, b));
    const first = sorted[0];
    const second = sorted[1];
    return !second || priorityRank[first.priorityClass] < priorityRank[second.priorityClass] || first.attentionScore - second.attentionScore >= 15 ? first : null;
  }
  selectionIsAmbiguous(items) {
    if (items.length < 2) return false;
    const sorted = [...items].sort((a, b) => this.compareItems(a, b));
    return priorityRank[sorted[0].priorityClass] === priorityRank[sorted[1].priorityClass] && Math.abs(sorted[0].attentionScore - sorted[1].attentionScore) < 15;
  }
  withSimpleMerge(winner, items, version, reason) {
    const related = items.filter((item2) => item2.streamingSessionId === winner.streamingSessionId && Math.abs(item2.createdAt - winner.createdAt) <= backlogTuning.mergeWindowMs && (item2.id === winner.id || item2.followUpHint || item2.correctionHint || correctionPattern.test(item2.text) || continuationPattern.test(item2.text))).sort((a, b) => a.createdAt - b.createdAt);
    const mergedText = related.map((item2) => item2.text.trim()).join(" ");
    const selected = related.length > 1 && mergedText.length <= backlogTuning.maxMergedCharacters ? related : [winner];
    return {
      action: selected.length > 1 ? "merge" : "select",
      selectedIds: selected.map((item2) => item2.id),
      text: selected.length > 1 ? mergedText : winner.text,
      reason,
      confidence: 1,
      backlogVersion: version
    };
  }
  discard(version, reason) {
    return { action: "discard_all", selectedIds: [], reason, confidence: 1, backlogVersion: version };
  }
  compareItems(a, b) {
    return priorityRank[a.priorityClass] - priorityRank[b.priorityClass] || b.attentionScore - a.attentionScore || b.createdAt - a.createdAt || a.id.localeCompare(b.id);
  }
  withTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Backlog arbitration timeout")), timeoutMs);
      promise.then((value) => {
        clearTimeout(timer);
        resolve(value);
      }, (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }
};

// src/renderer/continuousListening/ConversationAdmissionCoordinator.ts
var admissionCycleSequence = 0;
var createCycleId = () => `admission-${Date.now()}-${++admissionCycleSequence}`;
var ConversationAdmissionCoordinator = class {
  constructor(runConversation, backlog, selector, onError = () => void 0) {
    this.runConversation = runConversation;
    this.backlog = backlog;
    this.selector = selector;
    this.onError = onError;
  }
  runConversation;
  backlog;
  selector;
  onError;
  activeExecution;
  drainPromise;
  arbitrationPromise;
  activeCycleId;
  continuousEnabled = false;
  pendingExplicit = null;
  llmConfig = {
    enabled: false,
    providerId: "",
    model: "",
    timeoutMs: 2e3,
    minimumConfidence: 0.72
  };
  isBusy() {
    return Boolean(this.activeExecution || this.drainPromise);
  }
  getActiveExecution() {
    return this.activeExecution ? { ...this.activeExecution } : void 0;
  }
  configureSelector(config) {
    const changed = JSON.stringify(config) !== JSON.stringify(this.llmConfig);
    this.llmConfig = { ...config };
    if (changed) this.selector.cancel();
  }
  setContinuousEnabled(enabled) {
    this.continuousEnabled = enabled;
    if (!enabled) {
      this.selector.cancel();
      this.backlog.clear();
    }
  }
  resetStreamingSession() {
    this.selector.cancel();
    this.backlog.clear();
  }
  enqueueStreaming(item2) {
    if (!this.continuousEnabled) return "ignored_busy";
    const outcome = this.backlog.enqueue(item2) ? "queued_backlog" : "ignored_busy";
    console.debug(`[admission] turnId=${item2.id} source=continuous_listening outcome=${outcome} activeTurnId=${this.activeExecution?.turnId ?? "none"}`);
    return outcome;
  }
  async admit(input2, buffered) {
    if (this.activeExecution || this.drainPromise) return this.handleBusyInput(input2, buffered);
    const cycleId = createCycleId();
    const initialTurn = { ...input2, admissionCycleId: cycleId };
    this.activeCycleId = cycleId;
    const currentPromise = this.executeCycle(initialTurn, cycleId);
    this.drainPromise = currentPromise;
    console.debug(`[admission] turnId=${input2.turnId} source=${input2.source} cycleId=${cycleId} outcome=accepted activeTurnId=none`);
    try {
      await currentPromise;
    } finally {
      if (this.drainPromise === currentPromise) {
        this.drainPromise = void 0;
        if (this.activeCycleId === cycleId) this.activeCycleId = void 0;
      }
    }
    return "started";
  }
  handleBusyInput(input2, buffered) {
    if (input2.source === "continuous_listening" && buffered) return this.enqueueStreaming(buffered);
    if (input2.source === "text_chat" || input2.source === "push_to_talk") {
      this.selector.cancel();
      if (input2.source === "text_chat") this.backlog.discardWeak();
      this.pendingExplicit = input2;
      console.debug(`[admission] turnId=${input2.turnId} source=${input2.source} outcome=buffered activeTurnId=${this.activeExecution?.turnId ?? "none"}`);
      return "queued_explicit";
    }
    console.debug(`[admission] turnId=${input2.turnId} source=${input2.source} outcome=discarded activeTurnId=${this.activeExecution?.turnId ?? "none"}`);
    return "ignored_busy";
  }
  async executeCycle(initialTurn, cycleId) {
    await this.executeTurn(initialTurn);
    if (initialTurn.source === "text_chat") this.backlog.discardWeak();
    await this.drainPendingExplicit(cycleId);
    if (!this.continuousEnabled) {
      this.backlog.clear();
      return;
    }
    await this.drainOneStreamingTurn(cycleId);
    await this.drainPendingExplicit(cycleId);
    this.backlog.discardWeak();
  }
  async executeTurn(turn) {
    if (this.activeExecution) {
      throw new Error(`Conversation execution overlap: activeTurnId=${this.activeExecution.turnId} requestedTurnId=${turn.turnId}`);
    }
    this.activeExecution = {
      turnId: turn.turnId,
      admissionCycleId: turn.admissionCycleId,
      phase: turn.source === "debug" ? "synthesizing" : "generating",
      startedAt: Date.now()
    };
    const reportPhase = (phase) => {
      if (this.activeExecution?.turnId !== turn.turnId) {
        console.debug(`[admission] turnId=${turn.turnId} phase=${phase} stale-phase=ignored`);
        return;
      }
      this.activeExecution = { ...this.activeExecution, phase };
      console.debug(`[conversation] turnId=${turn.turnId} cycleId=${turn.admissionCycleId} phase=${phase}`);
    };
    try {
      const result = await this.runConversation(turn, reportPhase);
      console.debug(`[conversation] turnId=${turn.turnId} terminal=${result.status}`);
    } catch (error) {
      this.onError(error, turn);
    } finally {
      if (this.activeExecution?.turnId === turn.turnId) this.activeExecution = void 0;
    }
  }
  async drainOneStreamingTurn(cycleId) {
    for (let budget = 0; budget < backlogTuning.maxSelectedTurnsPerDrain; budget += 1) {
      const selectionPromise = this.selector.select(this.backlog, {
        continuousEnabled: this.continuousEnabled,
        llm: this.llmConfig
      });
      this.arbitrationPromise = selectionPromise;
      const selection = await selectionPromise.finally(() => {
        if (this.arbitrationPromise === selectionPromise) this.arbitrationPromise = void 0;
      });
      if (this.activeCycleId !== cycleId || this.pendingExplicit || !this.continuousEnabled || selection.action === "discard_all" || !selection.text) return;
      if (!this.backlog.consume(selection.selectedIds, selection.backlogVersion)) return;
      await this.executeTurn({
        turnId: `backlog-${Date.now()}-${selection.selectedIds.join("-")}`,
        text: selection.text,
        source: "backlog_selected",
        createdAt: Date.now(),
        utteranceIds: selection.selectedIds,
        admissionCycleId: cycleId
      });
    }
  }
  async drainPendingExplicit(cycleId) {
    while (this.pendingExplicit) {
      const explicit = this.pendingExplicit;
      this.pendingExplicit = null;
      await this.executeTurn({ ...explicit, admissionCycleId: cycleId });
    }
  }
};

// src/renderer/continuousListening/AttentionEngine.ts
var NAME_PATTERN = /(?:^|[^\p{L}\p{N}_])(?:shio|шио)(?=$|[^\p{L}\p{N}_])/iu;
var SECOND_PERSON_PATTERN = /(?:^|[^\p{L}\p{N}_])(?:ты|тебя|тебе|твой|твоя|твоё|твои)(?=$|[^\p{L}\p{N}_])/iu;
var QUESTION_PATTERN = /\?|(?:^|[^\p{L}\p{N}_])(?:кто|что|где|когда|зачем|почему|как|можешь|скажешь|думаешь)(?=$|[^\p{L}\p{N}_])/iu;
var EMOTIONAL_PATTERN = /!{1,}|(?:^|[^\p{L}\p{N}_])(?:ужасн[\p{L}\p{M}]*|крут[\p{L}\p{M}]*|кошмар[\p{L}\p{M}]*|бесит|обожаю|ненавижу)(?=$|[^\p{L}\p{N}_])/iu;
var AttentionEngine = class {
  evaluate(chunk, context) {
    const text = chunk.text.trim();
    const directAddress = NAME_PATTERN.test(text);
    const question = QUESTION_PATTERN.test(text);
    const secondPerson = SECOND_PERSON_PATTERN.test(text);
    const emotional = EMOTIONAL_PATTERN.test(text);
    const reasons = [];
    let score = 0;
    const add = (value, reason) => {
      score += value;
      reasons.push(`${reason}:${value >= 0 ? "+" : ""}${value}`);
    };
    if (directAddress) add(attentionTuning.score.directNameMention, "direct_name");
    if (question) add(attentionTuning.score.question, "question");
    if (secondPerson) add(attentionTuning.score.secondPersonAddress, "second_person");
    if (context.recentConversation) add(attentionTuning.score.recentConversation, "recent_conversation");
    if (context.followUpWindow) add(attentionTuning.score.followUpWindow, "follow_up");
    if (context.mode === "streamer" && (emotional || question)) add(attentionTuning.score.streamerRelevance, "streamer_relevance");
    if (emotional) add(attentionTuning.score.emotionalExpression, "emotional_expression");
    if (text.length < 4) add(attentionTuning.score.tooShort, "too_short");
    if (context.mode === "passive" && !directAddress) add(attentionTuning.score.likelySelfTalk, "passive_self_talk");
    if (context.cooldownActive && !directAddress) add(attentionTuning.score.replyCooldown, "reply_cooldown");
    if (context.isSpeaking && !directAddress) add(attentionTuning.score.speakingNonDirect, "speaking_non_direct");
    const threshold = attentionTuning.thresholds[context.mode];
    let shouldAttend = score >= threshold;
    if (!shouldAttend && (context.mode === "active" || context.mode === "streamer") && !context.cooldownActive) {
      const curiosityHit = (context.rng ?? Math.random)() < context.curiosityChance;
      if (curiosityHit) {
        score = Math.max(score, threshold);
        reasons.push("curiosity:accepted");
        shouldAttend = true;
      }
    }
    if (context.mode === "silent") shouldAttend = false;
    if (reasons.length === 0) reasons.push("no_attention_signal");
    return { shouldAttend, score, threshold, reasons, mode: context.mode, directAddress };
  }
};

// src/renderer/continuousListening/RuleGate.ts
var RuleGate = class {
  decide(chunk, attention, context) {
    if (!chunk.text.trim()) return { type: "ignore", reason: "invalid_text" };
    if (context.alreadyHandled) return { type: "ignore", reason: "duplicate_chunk" };
    if (!attention.shouldAttend) return { type: "ignore", reason: attention.reasons.join(",") };
    if ((context.isSpeaking || context.conversationBusy) && attention.directAddress) {
      return { type: "backlog", userText: chunk.text, reason: "direct_address_while_busy" };
    }
    if (context.isSpeaking || context.conversationBusy) {
      return { type: "backlog", userText: chunk.text, reason: "attended_utterance_while_busy" };
    }
    if (context.cooldownActive && !attention.directAddress) return { type: "ignore", reason: "reply_cooldown" };
    return { type: "llm", userText: chunk.text, reason: attention.directAddress ? "direct_address" : "attended_utterance" };
  }
};

// src/renderer/continuousListening/UtteranceBacklog.ts
var priorityRank2 = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
var normalized = (text) => text.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
var UtteranceBacklog = class {
  items = [];
  seenIds = /* @__PURE__ */ new Set();
  consumedIds = /* @__PURE__ */ new Set();
  recentIds = [];
  version = 0;
  getVersion() {
    return this.version;
  }
  size() {
    return this.items.length;
  }
  snapshot() {
    return this.items.map((item2) => ({ ...item2 }));
  }
  has(id) {
    return this.items.some((item2) => item2.id === id);
  }
  enqueue(item2, now2 = Date.now()) {
    if (this.seenIds.has(item2.id) || this.consumedIds.has(item2.id) || item2.likelySelfEcho) return false;
    this.rememberId(item2.id, this.seenIds);
    this.purge(now2);
    if ((item2.priorityClass === "P3" || item2.priorityClass === "P4") && this.items.some((entry) => entry.priorityClass === "P0" || entry.priorityClass === "P1")) return false;
    const duplicate = this.items.find((entry) => normalized(entry.text) === normalized(item2.text));
    if (duplicate) {
      if (item2.createdAt > duplicate.createdAt) this.replace(duplicate.id, item2);
      return false;
    }
    this.items.push({ ...item2 });
    this.bump();
    this.trimOverflow();
    return true;
  }
  purge(now2 = Date.now()) {
    const next = this.items.filter((item2) => item2.expiresAt > now2 && !item2.likelySelfEcho);
    if (next.length !== this.items.length) {
      this.items = next;
      this.bump();
    }
  }
  consume(ids, expectedVersion) {
    if (expectedVersion !== this.version || ids.length === 0 || ids.some((id) => !this.has(id))) return false;
    const selected = new Set(ids);
    this.items = this.items.filter((item2) => !selected.has(item2.id));
    for (const id of ids) this.rememberId(id, this.consumedIds);
    this.bump();
    return true;
  }
  discardWeak(now2 = Date.now()) {
    const next = this.items.filter((item2) => item2.expiresAt > now2 && (item2.priorityClass === "P0" || item2.priorityClass === "P1"));
    if (next.length !== this.items.length) {
      this.items = next;
      this.bump();
    }
  }
  clear() {
    if (this.items.length === 0) return;
    this.items = [];
    this.bump();
  }
  replace(id, item2) {
    this.items = this.items.map((entry) => entry.id === id ? { ...item2 } : entry);
    this.bump();
  }
  trimOverflow() {
    while (this.items.length > backlogTuning.maxItems) {
      let worst = 0;
      for (let index = 1; index < this.items.length; index += 1) {
        const candidate = this.items[index];
        const current = this.items[worst];
        if (priorityRank2[candidate.priorityClass] > priorityRank2[current.priorityClass] || candidate.priorityClass === current.priorityClass && candidate.createdAt < current.createdAt) worst = index;
      }
      this.items.splice(worst, 1);
      this.bump();
    }
  }
  rememberId(id, target) {
    target.add(id);
    this.recentIds.push(id);
    while (this.recentIds.length > backlogTuning.recentIdLimit) {
      const oldest = this.recentIds.shift();
      if (oldest) {
        this.seenIds.delete(oldest);
        this.consumedIds.delete(oldest);
      }
    }
  }
  bump() {
    this.version += 1;
  }
};

// src/renderer/continuousListening/UtteranceChunkBuilder.ts
var normalizeText = (text) => text.trim().replace(/\s+/g, " ");
var duplicateKey = (text) => normalizeText(text).toLocaleLowerCase("ru-RU");
var UtteranceChunkBuilder = class {
  partial = "";
  startedAt = null;
  lastUpdatedAt = null;
  sequence = 0;
  completedKeys = [];
  options;
  now;
  constructor(options = {}) {
    this.options = { ...chunkBuilderTuning, ...options };
    this.now = options.now ?? Date.now;
  }
  speechStarted() {
    const now2 = this.now();
    this.startedAt ??= now2;
    this.lastUpdatedAt = now2;
  }
  pushPartial(text) {
    const normalized2 = normalizeText(text);
    if (!normalized2) return null;
    const now2 = this.now();
    this.startedAt ??= now2;
    this.lastUpdatedAt = now2;
    this.partial = normalized2.slice(0, this.options.maxCharacters);
    if (normalized2.length >= this.options.maxCharacters) return this.complete("max_length", void 0, now2);
    return null;
  }
  pushFinal(text, confidence, metadata = {}) {
    const normalized2 = normalizeText(text);
    if (!normalized2) {
      this.reset();
      return null;
    }
    const now2 = this.now();
    this.startedAt ??= now2;
    this.lastUpdatedAt = now2;
    this.partial = normalized2.slice(0, this.options.maxCharacters);
    return this.complete(normalized2.length >= this.options.maxCharacters ? "max_length" : "asr_final", confidence, now2, metadata);
  }
  speechEnded() {
    return this.complete("vad_pause");
  }
  poll() {
    if (!this.partial || this.lastUpdatedAt === null || this.startedAt === null) return null;
    const now2 = this.now();
    if (now2 - this.startedAt >= this.options.hardTimeoutMs) return this.complete("timeout", void 0, now2);
    if (now2 - this.lastUpdatedAt >= this.options.pauseCompletionMs) return this.complete("vad_pause", void 0, now2);
    return null;
  }
  complete(reason, confidence, completedAt = this.now(), metadata = {}) {
    const text = normalizeText(this.partial);
    const startedAt = this.startedAt ?? completedAt;
    this.reset();
    if (text.length < this.options.minimumCharacters) return null;
    const key = metadata.streamingSessionId && metadata.segmentId ? `${metadata.streamingSessionId}:${metadata.segmentId}` : duplicateKey(text);
    const duplicateWindowMs = 5e3;
    if (this.completedKeys.some((entry) => entry.key === key && completedAt - entry.completedAt <= duplicateWindowMs)) return null;
    this.completedKeys.push({ key, completedAt });
    if (this.completedKeys.length > 32) this.completedKeys.shift();
    return {
      id: metadata.streamingSessionId && metadata.segmentId ? `${metadata.streamingSessionId}:${metadata.segmentId}` : `utterance-${completedAt}-${++this.sequence}`,
      text,
      startedAt,
      completedAt,
      completionReason: reason,
      confidence,
      ...metadata
    };
  }
  reset() {
    this.partial = "";
    this.startedAt = null;
    this.lastUpdatedAt = null;
  }
};

// scripts/continuous-listening-repro/harness.ts
var now = Date.now();
var flush = () => new Promise((resolve) => setTimeout(resolve, 0));
var deferred = () => {
  let resolve;
  return { promise: new Promise((done) => {
    resolve = done;
  }), resolve };
};
var input = (id, source = "continuous_listening") => ({
  turnId: id,
  text: id,
  source,
  createdAt: now,
  streamingSessionId: source === "continuous_listening" ? "s1" : void 0
});
var completed = (turnId) => ({
  status: "completed",
  turnId,
  playbackCompleted: true,
  cleanupCompleted: true
});
var item = (id, priorityClass, score = 50) => ({
  id,
  text: id,
  createdAt: now++,
  expiresAt: now + 3e4,
  streamingSessionId: "s1",
  segmentId: id,
  directAddress: priorityClass === "P0" || priorityClass === "P1" || priorityClass === "P2",
  question: priorityClass === "P1",
  correctionHint: priorityClass === "P0",
  followUpHint: priorityClass === "P2",
  attentionScore: score,
  attentionMode: "streamer",
  capturedWhileShioBusy: true,
  capturedDuringPlayback: false,
  likelySelfEcho: false,
  priorityClass
});
var disabledLlm = { enabled: false, providerId: "", model: "", timeoutMs: 2e3, minimumConfidence: 0.72 };
var enabledLlm = { enabled: true, providerId: "groq", model: "cheap", timeoutMs: 2e3, minimumConfidence: 0.72 };
async function main() {
  const builder = new UtteranceChunkBuilder({ now: () => now });
  const first = builder.pushFinal("\u0428\u0438\u043E, \u0442\u044B \u0442\u0443\u0442?", 0.9, {
    streamingSessionId: "session",
    segmentId: "segment",
    capturedDuringPlayback: false
  });
  import_strict.default.equal(first?.id, "session:segment");
  import_strict.default.equal(builder.pushFinal("\u0428\u0438\u043E, \u0442\u044B \u0442\u0443\u0442?", 0.9, {
    streamingSessionId: "session",
    segmentId: "segment",
    capturedDuringPlayback: false
  }), null);
  const engine = new AttentionEngine();
  const gate = new RuleGate();
  const attention = engine.evaluate(first, {
    mode: "passive",
    isSpeaking: true,
    cooldownActive: false,
    recentConversation: false,
    followUpWindow: false,
    curiosityChance: 0
  });
  import_strict.default.equal(attention.shouldAttend, true);
  import_strict.default.equal(gate.decide(first, attention, {
    isSpeaking: true,
    conversationBusy: true,
    cooldownActive: false,
    alreadyHandled: false
  }).type, "backlog");
  const bounded = new UtteranceBacklog();
  import_strict.default.equal(bounded.enqueue(item("same", "P1")), true);
  import_strict.default.equal(bounded.enqueue(item("same", "P1")), false);
  import_strict.default.equal(bounded.enqueue({ ...item("echo", "P3"), likelySelfEcho: true }), false);
  for (let index = 0; index < 15; index += 1) bounded.enqueue(item(`weak-${index}`, "P4"));
  import_strict.default.ok(bounded.size() <= 10);
  import_strict.default.equal(bounded.has("same"), true);
  {
    let arbitrationCalls = 0;
    const backlog = new UtteranceBacklog();
    const selector = new BacklogSelector(async () => {
      arbitrationCalls += 1;
      throw new Error("must not run");
    });
    const starts = [];
    const coordinator = new ConversationAdmissionCoordinator(async (value) => {
      starts.push(value.source);
      return completed(value.turnId);
    }, backlog, selector);
    coordinator.configureSelector(enabledLlm);
    coordinator.setContinuousEnabled(false);
    await coordinator.admit(input("chat", "text_chat"));
    import_strict.default.deepEqual(starts, ["text_chat"]);
    import_strict.default.equal(arbitrationCalls, 0);
  }
  {
    const release = deferred();
    const starts = [];
    let active = 0;
    let maxActive = 0;
    const backlog = new UtteranceBacklog();
    const selector = new BacklogSelector();
    const coordinator = new ConversationAdmissionCoordinator(async (value) => {
      starts.push(value.text);
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (value.text === "initial") await release.promise;
      active -= 1;
      return completed(value.turnId);
    }, backlog, selector);
    coordinator.configureSelector(disabledLlm);
    coordinator.setContinuousEnabled(true);
    const running = coordinator.admit(input("initial"));
    await flush();
    await coordinator.admit(input("background"), item("background", "P3"));
    await coordinator.admit(input("question"), item("question", "P1", 80));
    await coordinator.admit(input("correction"), item("correction", "P0", 90));
    release.resolve();
    await running;
    import_strict.default.deepEqual(starts, ["initial", "correction"]);
    import_strict.default.equal(maxActive, 1);
  }
  {
    const result = deferred();
    const backlog = new UtteranceBacklog();
    backlog.enqueue(item("a", "P3", 50));
    backlog.enqueue(item("b", "P3", 50));
    const version = backlog.getVersion();
    const selector = new BacklogSelector(() => result.promise);
    const pending = selector.select(backlog, { continuousEnabled: true, llm: enabledLlm });
    backlog.enqueue(item("c", "P2", 90));
    result.resolve({ action: "select", selectedIds: ["a"], text: "a", reason: "late", confidence: 1, backlogVersion: version });
    const selection = await pending;
    import_strict.default.notEqual(selection.reason, "late");
    import_strict.default.equal(selection.backlogVersion, backlog.getVersion());
  }
  {
    const backlog = new UtteranceBacklog();
    backlog.enqueue(item("x", "P3", 50));
    backlog.enqueue(item("y", "P3", 55));
    const selector = new BacklogSelector(async () => {
      throw new Error("429");
    });
    const selection = await selector.select(backlog, { continuousEnabled: true, llm: enabledLlm });
    import_strict.default.equal(selection.text, "y");
    import_strict.default.equal(selection.reason, "llm_error_fallback");
  }
  {
    const backlog = new UtteranceBacklog();
    backlog.enqueue(item("timeout-a", "P3", 50));
    backlog.enqueue(item("timeout-b", "P3", 50));
    let calls = 0;
    const selector = new BacklogSelector(() => {
      calls += 1;
      if (calls === 1) return new Promise(() => void 0);
      return Promise.resolve({
        action: "select",
        selectedIds: ["timeout-a"],
        text: "selected",
        reason: "second_arbitration",
        confidence: 1,
        backlogVersion: backlog.getVersion()
      });
    });
    const shortTimeout = { ...enabledLlm, timeoutMs: 5 };
    import_strict.default.equal((await selector.select(backlog, { continuousEnabled: true, llm: shortTimeout })).reason, "llm_error_fallback");
    import_strict.default.equal((await selector.select(backlog, { continuousEnabled: true, llm: shortTimeout })).reason, "second_arbitration");
    import_strict.default.equal(calls, 2);
    const throwingSelector = new BacklogSelector(() => {
      throw new Error("sync");
    });
    import_strict.default.equal((await throwingSelector.select(backlog, { continuousEnabled: true, llm: enabledLlm })).reason, "llm_error_fallback");
    import_strict.default.equal((await throwingSelector.select(backlog, { continuousEnabled: true, llm: enabledLlm })).reason, "llm_error_fallback");
  }
  {
    const backlog = new UtteranceBacklog();
    backlog.enqueue(item("valid-a", "P3", 50));
    backlog.enqueue(item("valid-b", "P3", 50));
    const invalidResults = [
      { action: "select", selectedIds: ["missing"], text: "bad" },
      { action: "select", selectedIds: ["valid-a", "valid-b"], text: "bad" },
      { action: "merge", selectedIds: ["valid-a"], text: "bad" },
      { action: "discard_all", selectedIds: ["valid-a"] }
    ];
    for (const invalid of invalidResults) {
      const selector = new BacklogSelector(async (_items, version) => ({
        ...invalid,
        reason: "invalid",
        confidence: 1,
        backlogVersion: version
      }));
      import_strict.default.equal(
        (await selector.select(backlog, { continuousEnabled: true, llm: enabledLlm })).reason,
        "low_confidence_or_schema_fallback"
      );
    }
  }
  {
    const release = deferred();
    const starts = [];
    const backlog = new UtteranceBacklog();
    const coordinator = new ConversationAdmissionCoordinator(async (value) => {
      starts.push(value.text);
      await release.promise;
      return completed(value.turnId);
    }, backlog, new BacklogSelector());
    coordinator.setContinuousEnabled(true);
    const running = coordinator.admit(input("initial"));
    await flush();
    await coordinator.admit(input("queued"), item("queued", "P0"));
    coordinator.setContinuousEnabled(false);
    release.resolve();
    await running;
    import_strict.default.deepEqual(starts, ["initial"]);
    import_strict.default.equal(backlog.size(), 0);
  }
  {
    class FakeSource {
      buffer;
      onended = null;
      connect() {
      }
      disconnect() {
      }
      start() {
      }
      stop() {
      }
    }
    class FakeAudioContext {
      state = "running";
      currentTime = 0;
      source = null;
      destination = {};
      createAnalyser() {
        return { fftSize: 0, connect: () => void 0 };
      }
      createBufferSource() {
        return this.source = new FakeSource();
      }
      async decodeAudioData() {
        return { duration: 1 };
      }
      async resume() {
      }
    }
    const context = new FakeAudioContext();
    globalThis.AudioContext = class {
      constructor() {
        return context;
      }
    };
    globalThis.window = { setInterval: () => 1, clearInterval: () => void 0 };
    const player = new AudioPlayer();
    const playback = player.play(new ArrayBuffer(8), { turnId: "turn-a", onReady: () => void 0 });
    await flush();
    await import_strict.default.rejects(
      player.play(new ArrayBuffer(8), { turnId: "turn-b", onReady: () => void 0 }),
      /activeTurnId=turn-a requestedTurnId=turn-b/
    );
    context.source?.onended?.();
    await playback;
    import_strict.default.equal(player.isBusy(), false);
  }
  console.log("Continuous listening repro: PASS");
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
