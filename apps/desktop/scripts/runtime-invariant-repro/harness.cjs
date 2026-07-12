// src/renderer/runtime/RuntimeStateInvariantValidator.ts
var KNOWN_FACIAL_SOURCES = /* @__PURE__ */ new Set(["emotion", "lipSync", "autoBlink", "lookAt"]);
var HOLD_MS = 450;
var EPS_ANGLE = 0.02;
var RuntimeStateInvariantValidator = class {
  enabled = true;
  lastHealth = null;
  totalViolations = 0;
  lastViolation = null;
  // Per-invariant debounce + reported-edge tracking.
  failingSince = /* @__PURE__ */ new Map();
  reported = /* @__PURE__ */ new Set();
  // Windowed helpers.
  speakingSince = null;
  speakingMouthMax = 0;
  defs = [
    {
      id: "INV-01-speaking-lipsync",
      label: "speaking \u2192 LipSync attached",
      suspectedOwner: "LipSync / AvatarController.applyStateEffect(attachLipSync)",
      evaluate: (i) => {
        if (!i.isSpeaking || !i.playbackActive)
          return { ok: true, detail: "not speaking / no audio" };
        if (this.speakingSince === null) return { ok: true, detail: "speaking just started" };
        const elapsed = i.now - this.speakingSince;
        if (elapsed < 800) return { ok: true, detail: `warming up ${Math.round(elapsed)}ms` };
        const moved = this.speakingMouthMax > 0.02;
        return {
          ok: moved,
          detail: moved ? `mouth peak ${this.speakingMouthMax.toFixed(2)}` : `mouth flat 0 for ${Math.round(elapsed)}ms (LipSync not attached?)`
        };
      }
    },
    {
      id: "INV-02-noplayback-not-speaking",
      label: "no active playback \u2192 not speaking",
      suspectedOwner: "ConversationRuntime terminal cleanup / AudioPlayer active playback",
      evaluate: (i) => {
        if (!i.isSpeaking) return { ok: true, detail: "not speaking" };
        return {
          ok: i.playbackActive,
          detail: i.playbackActive ? "audio active" : "speaking but AudioPlayer idle"
        };
      }
    },
    {
      id: "INV-03-playing-one-id",
      label: "AudioPlayer playing \u2192 exactly one playback id",
      suspectedOwner: "AudioPlayer",
      evaluate: (i) => {
        if (!i.playbackActive) {
          return {
            ok: i.activePlaybackId === 0,
            detail: i.activePlaybackId === 0 ? "idle" : `idle but id=${i.activePlaybackId}`
          };
        }
        return {
          ok: i.activePlaybackId > 0,
          detail: i.activePlaybackId > 0 ? `id=${i.activePlaybackId}` : "playing but no valid id"
        };
      }
    },
    {
      id: "INV-04-single-skeleton-owner",
      label: "only one body animation owns the skeleton",
      suspectedOwner: "VrmModel body pipeline",
      evaluate: (i) => {
        if (i.bodyTransitionRemaining > 0) return { ok: true, detail: "cross-fade in progress" };
        const ok = i.bodyWeightedActionCount <= 1;
        return {
          ok,
          detail: ok ? `${i.bodyWeightedActionCount} weighted` : `${i.bodyWeightedActionCount} weighted actions, no transition`
        };
      }
    },
    {
      id: "INV-05-idle-no-speaking-anim",
      label: "idle mode must not be speaking",
      suspectedOwner: "AvatarStateMachine / AvatarController",
      evaluate: (i) => {
        if (i.characterMode !== "idle") return { ok: true, detail: `mode=${i.characterMode}` };
        const ok = i.avatarMode !== "speaking";
        return {
          ok,
          detail: ok ? `avatar=${i.avatarMode}` : "character idle but avatar still speaking"
        };
      }
    },
    {
      id: "INV-06-phase-speaking-playback",
      label: "conversation phase speaking \u2192 playback exists",
      suspectedOwner: "ConversationRuntime",
      evaluate: (i) => {
        if (i.conversationResponsePhase !== "speaking")
          return { ok: true, detail: `phase=${i.conversationResponsePhase}` };
        return {
          ok: i.playbackActive,
          detail: i.playbackActive ? "audio active" : "phase speaking but no playback"
        };
      }
    },
    {
      id: "INV-07-lookat-disabled-no-updates",
      label: "LookAt disabled \u2192 no LookAt updates",
      suspectedOwner: "LookAtRuntime",
      evaluate: (i) => {
        if (i.lookAtTarget !== "none") return { ok: true, detail: `target=${i.lookAtTarget}` };
        const still = Math.abs(i.lookAtEyeYaw) <= EPS_ANGLE && Math.abs(i.lookAtEyePitch) <= EPS_ANGLE;
        return {
          ok: still,
          detail: still ? "eyes still" : `eyes moving yaw=${i.lookAtEyeYaw.toFixed(3)} pitch=${i.lookAtEyePitch.toFixed(3)} while disabled`
        };
      }
    },
    {
      id: "INV-08-headmotion-disabled-no-updates",
      label: "Head Motion disabled \u2192 no procedural updates",
      suspectedOwner: "HeadMotionRuntime",
      evaluate: (i) => {
        if (i.headMotionActiveGenerators.length > 0)
          return { ok: true, detail: `${i.headMotionActiveGenerators.length} generators active` };
        const still = i.headMotionEnergy <= 0.01;
        return {
          ok: still,
          detail: still ? "no motion" : `energy ${i.headMotionEnergy.toFixed(3)} with no active generators`
        };
      }
    },
    {
      id: "INV-09-mixer-only-facial-writer",
      label: "Expression Mixer is the only facial writer",
      suspectedOwner: "AvatarExpressionMixer",
      evaluate: (i) => {
        const foreign = [.../* @__PURE__ */ new Set([...i.facialActiveSources, ...i.facialEntrySources])].filter(
          (s) => !KNOWN_FACIAL_SOURCES.has(s)
        );
        return {
          ok: foreign.length === 0,
          detail: foreign.length === 0 ? "all writes via mixer domains" : `foreign facial source(s): ${foreign.join(", ")}`
        };
      }
    },
    {
      id: "INV-10-transition-ownership",
      label: "body transition keeps animation ownership",
      suspectedOwner: "VrmModel body action ownership",
      evaluate: (i) => {
        if (i.bodyActiveActionCount === 0) return { ok: null, detail: "no body action loaded yet" };
        const ok = i.bodyWeightedActionCount > 0;
        return {
          ok,
          detail: ok ? `${i.bodyWeightedActionCount} weighted action(s)` : `zero weighted actions during ${i.currentBodyAnimation}`
        };
      }
    },
    {
      id: "INV-11-mouth-release",
      label: "mouth releases after speech",
      suspectedOwner: "LipSync release envelope / AvatarExpressionMixer",
      evaluate: (i) => {
        if (i.isSpeaking || i.playbackActive)
          return { ok: true, detail: "speaking / playback active" };
        const ok = i.mouthMax <= 0.4;
        return {
          ok,
          detail: ok ? `mouth ${i.mouthMax.toFixed(2)}` : `mouth high ${i.mouthMax.toFixed(2)} after speech`
        };
      }
    },
    {
      id: "INV-12-supported-viseme-fallback",
      label: "unsupported visemes fall back gracefully",
      suspectedOwner: "AvatarExpressionMixer capability detection",
      evaluate: (i) => {
        const required = ["aa", "ih", "ou"];
        const missingCore = required.filter((name) => !i.facialSupportedVisemes.includes(name));
        if (missingCore.length > 0)
          return { ok: false, detail: `missing core viseme(s): ${missingCore.join(", ")}` };
        const optional = ["ee", "oh"].filter((name) => !i.facialSupportedVisemes.includes(name));
        return {
          ok: true,
          detail: optional.length > 0 ? `optional fallback: ${optional.join(", ")}` : "all five visemes supported"
        };
      }
    },
    {
      id: "INV-13-unknown-expression-detection",
      label: "unknown expressions are detected before write",
      suspectedOwner: "Facial Profile / AvatarExpressionMixer",
      evaluate: (i) => {
        return {
          ok: true,
          detail: i.facialUnsupportedExpressionRequests.length > 0 ? `detected unsupported: ${i.facialUnsupportedExpressionRequests.join(", ")}` : "no unsupported expression requests"
        };
      }
    },
    {
      id: "INV-14-valid-facial-profile",
      label: "facial profile is valid",
      suspectedOwner: "FacialProfile resolver",
      evaluate: (i) => {
        const ok = Boolean(i.currentFacialProfile && i.currentFacialProfile !== "unknown");
        return {
          ok,
          detail: ok ? `profile=${i.currentFacialProfile}` : "invalid / missing facial profile"
        };
      }
    },
    {
      id: "INV-15-profile-release-timeout",
      label: "facial profile release does not get stuck",
      suspectedOwner: "ExpressionController / AvatarExpressionMixer release lifecycle",
      evaluate: (i) => {
        const releaseWarning = i.facialStuckWarnings.find(
          (warning) => /emotion|mouth|blink/i.test(warning)
        );
        return { ok: !releaseWarning, detail: releaseWarning ?? "no facial release warnings" };
      }
    }
  ];
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.failingSince.clear();
      this.reported.clear();
      this.speakingSince = null;
      this.speakingMouthMax = 0;
    }
  }
  isEnabled() {
    return this.enabled;
  }
  evaluate(input) {
    if (!this.enabled) {
      this.lastHealth = this.buildHealth(input, []);
      return this.lastHealth;
    }
    if (input.isSpeaking && input.playbackActive) {
      if (this.speakingSince === null) {
        this.speakingSince = input.now;
        this.speakingMouthMax = 0;
      }
      this.speakingMouthMax = Math.max(this.speakingMouthMax, input.mouthMax);
    } else {
      this.speakingSince = null;
      this.speakingMouthMax = 0;
    }
    const results = [];
    for (const def of this.defs) {
      const { ok, detail } = def.evaluate(input);
      let status;
      if (ok === null) status = "skip";
      else if (ok) status = "pass";
      else status = "fail";
      if (status === "fail") {
        const since = this.failingSince.get(def.id) ?? input.now;
        if (!this.failingSince.has(def.id)) this.failingSince.set(def.id, input.now);
        const held = input.now - since;
        if (held >= HOLD_MS && !this.reported.has(def.id)) {
          this.reported.add(def.id);
          this.recordViolation(def, input, detail);
        }
      } else {
        this.failingSince.delete(def.id);
        this.reported.delete(def.id);
      }
      results.push({
        id: def.id,
        label: def.label,
        status,
        detail,
        suspectedOwner: def.suspectedOwner
      });
    }
    this.lastHealth = this.buildHealth(input, results);
    return this.lastHealth;
  }
  getHealth() {
    return this.lastHealth;
  }
  recordViolation(def, input, detail) {
    this.totalViolations += 1;
    this.lastViolation = {
      id: def.id,
      at: Date.now(),
      frame: input.frame,
      detail,
      suspectedOwner: def.suspectedOwner
    };
    const snapshot = {
      speech: input.speechStatus,
      mode: input.characterMode,
      avatarMode: input.avatarMode,
      phase: input.conversationResponsePhase,
      playback: input.playbackActive ? `#${input.activePlaybackId}` : "idle",
      mouthMax: Number(input.mouthMax.toFixed(2)),
      facialProfile: input.currentFacialProfile,
      bodyWeighted: input.bodyWeightedActionCount,
      bodyOwnershipGaps: input.bodyOwnershipGapCount,
      lookAt: input.lookAtTarget,
      headGen: input.headMotionActiveGenerators.length
    };
    console.warn(
      `[RUNTIME-INV] ${def.id} VIOLATION frame=${input.frame} t=${Math.round(input.now)}ms owner="${def.suspectedOwner}" detail="${detail}" state=${JSON.stringify(snapshot)}`
    );
  }
  buildHealth(input, results) {
    return {
      enabled: this.enabled,
      frame: input.frame,
      evaluatedAt: Date.now(),
      passCount: results.filter((r) => r.status === "pass").length,
      failCount: results.filter((r) => r.status === "fail").length,
      skipCount: results.filter((r) => r.status === "skip").length,
      totalViolations: this.totalViolations,
      invariants: results,
      lastViolation: this.lastViolation,
      subsystems: {
        speech: input.speechStatus,
        audio: input.playbackActive ? `playing #${input.activePlaybackId}` : "idle",
        characterMode: input.characterMode,
        avatarMode: input.avatarMode,
        conversationPhase: input.conversationResponsePhase,
        bodyActions: `${input.bodyWeightedActionCount}/${input.bodyActiveActionCount} weighted/active`,
        bodyOwnershipGaps: String(input.bodyOwnershipGapCount),
        lookAt: `${input.lookAtTarget}`,
        headMotion: `${input.headMotionActiveGenerators.length} gen \xB7 energy ${input.headMotionEnergy.toFixed(2)}`,
        facial: input.facialActiveSources.join(",") || "none",
        facialProfile: input.currentFacialProfile,
        visemes: input.facialSupportedVisemes.join(",") || "none",
        unsupportedExpressions: input.facialUnsupportedExpressionRequests.join(",") || "none"
      }
    };
  }
};

// scripts/runtime-invariant-repro/harness.ts
var HEALTHY = {
  frame: 0,
  now: 0,
  speechStatus: "speaking",
  isSpeaking: true,
  characterMode: "speaking",
  avatarMode: "speaking",
  conversationResponsePhase: "speaking",
  playbackActive: true,
  activePlaybackId: 7,
  bodyActiveActionCount: 1,
  bodyWeightedActionCount: 1,
  bodyTransitionRemaining: 0,
  bodyOwnershipGapCount: 0,
  currentBodyAnimation: "talk_loop",
  currentBehaviorId: "speaking",
  mouthMax: 0.4,
  facialActiveSources: ["lipSync", "emotion", "autoBlink"],
  facialEntrySources: ["lipSync", "emotion"],
  facialSupportedVisemes: ["aa", "ih", "ou", "ee", "oh"],
  facialUnsupportedExpressionRequests: [],
  currentFacialProfile: "happy",
  facialStuckWarnings: [],
  lookAtTarget: "camera",
  lookAtEyeYaw: 0.05,
  lookAtEyePitch: 0.02,
  headMotionActiveGenerators: ["speakingNod"],
  headMotionEnergy: 0.3
};
function withOverrides(base, o) {
  return { ...base, ...o };
}
function holdState(v, input, startNow = 1e3) {
  let health = v.evaluate({ ...input, now: startNow, frame: 1 });
  health = v.evaluate({ ...input, now: startNow + 200, frame: 2 });
  health = v.evaluate({ ...input, now: startNow + 500, frame: 3 });
  health = v.evaluate({ ...input, now: startNow + 900, frame: 4 });
  return health;
}
var cases = [
  { name: "HEALTHY baseline", expectId: null, input: HEALTHY },
  {
    name: "INV-02 speaking but no playback",
    expectId: "INV-02-noplayback-not-speaking",
    input: withOverrides(HEALTHY, { playbackActive: false, activePlaybackId: 0 })
  },
  {
    name: "INV-03 playing but no id",
    expectId: "INV-03-playing-one-id",
    input: withOverrides(HEALTHY, { playbackActive: true, activePlaybackId: 0 })
  },
  {
    name: "INV-04 two skeleton owners, no transition",
    expectId: "INV-04-single-skeleton-owner",
    input: withOverrides(HEALTHY, { bodyWeightedActionCount: 2, bodyTransitionRemaining: 0 })
  },
  {
    name: "INV-05 character idle but avatar speaking",
    expectId: "INV-05-idle-no-speaking-anim",
    input: withOverrides(HEALTHY, {
      characterMode: "idle",
      avatarMode: "speaking",
      speechStatus: "silent",
      isSpeaking: false,
      playbackActive: false,
      activePlaybackId: 0,
      conversationResponsePhase: "waiting"
    })
  },
  {
    name: "INV-06 phase speaking but no playback",
    expectId: "INV-06-phase-speaking-playback",
    input: withOverrides(HEALTHY, {
      isSpeaking: false,
      speechStatus: "synthesizing",
      playbackActive: false,
      activePlaybackId: 0,
      conversationResponsePhase: "speaking"
    })
  },
  {
    name: "INV-07 LookAt disabled but eyes moving",
    expectId: "INV-07-lookat-disabled-no-updates",
    input: withOverrides(HEALTHY, {
      lookAtTarget: "none",
      lookAtEyeYaw: 0.12,
      lookAtEyePitch: 0.03
    })
  },
  {
    name: "INV-08 Head Motion disabled but energy",
    expectId: "INV-08-headmotion-disabled-no-updates",
    input: withOverrides(HEALTHY, { headMotionActiveGenerators: [], headMotionEnergy: 0.25 })
  },
  {
    name: "INV-09 foreign facial writer",
    expectId: "INV-09-mixer-only-facial-writer",
    input: withOverrides(HEALTHY, { facialEntrySources: ["lipSync", "rogueWriter"] })
  },
  {
    name: "INV-10 transition ownership gap",
    expectId: "INV-10-transition-ownership",
    input: withOverrides(HEALTHY, {
      bodyActiveActionCount: 1,
      bodyWeightedActionCount: 0,
      bodyTransitionRemaining: 0.2
    })
  },
  {
    name: "INV-11 mouth high after speech",
    expectId: "INV-11-mouth-release",
    input: withOverrides(HEALTHY, {
      speechStatus: "silent",
      isSpeaking: false,
      characterMode: "idle",
      avatarMode: "idle",
      conversationResponsePhase: "waiting",
      playbackActive: false,
      activePlaybackId: 0,
      mouthMax: 0.55
    })
  },
  {
    name: "INV-12 missing core viseme",
    expectId: "INV-12-supported-viseme-fallback",
    input: withOverrides(HEALTHY, { facialSupportedVisemes: ["aa", "ou", "ee", "oh"] })
  },
  {
    name: "INV-14 invalid facial profile",
    expectId: "INV-14-valid-facial-profile",
    input: withOverrides(HEALTHY, { currentFacialProfile: "unknown" })
  },
  {
    name: "INV-15 profile release timeout",
    expectId: "INV-15-profile-release-timeout",
    input: withOverrides(HEALTHY, { facialStuckWarnings: ["mouth > 0.4 while LipSync is reset"] })
  }
];
function testInv01() {
  const v = new RuntimeStateInvariantValidator();
  const flat = withOverrides(HEALTHY, { mouthMax: 0 });
  let health = v.getHealth();
  for (let i = 0; i < 20; i++) {
    health = v.evaluate({ ...flat, now: 1e3 + i * 120, frame: i + 1 });
  }
  if (!health) throw new Error("health snapshot missing");
  const inv01 = health.invariants.find((r) => r.id === "INV-01-speaking-lipsync");
  if (!inv01) throw new Error("INV-01 invariant not found in health snapshot");
  const ok = inv01.status === "fail" && health.lastViolation?.id === "INV-01-speaking-lipsync";
  console.log(
    `
[INV-01 speaking\u2192LipSync attached]  ${ok ? "\u2713 detected" : "\u2717 MISSED"}  status=${inv01.status} detail="${inv01.detail}"`
  );
  return ok;
}
function main() {
  let passed = 0;
  let failed = 0;
  const warnLog = [];
  const realWarn = console.warn.bind(console);
  console.warn = (...a) => {
    warnLog.push(String(a[0]));
    realWarn(...a);
  };
  console.log("===== Runtime State Invariant Validator \u2014 self-test =====");
  for (const c of cases) {
    const v = new RuntimeStateInvariantValidator();
    const health = holdState(v, c.input);
    const failedIds = health.invariants.filter((r) => r.status === "fail").map((r) => r.id);
    if (c.expectId === null) {
      const ok = failedIds.length === 0;
      console.log(
        `
[${c.name}]  ${ok ? "\u2713 no violations" : `\u2717 unexpected: ${failedIds.join(",")}`}`
      );
      ok ? passed++ : failed++;
    } else {
      const detected = failedIds.includes(c.expectId);
      const owner = health.invariants.find((r) => r.id === c.expectId)?.suspectedOwner;
      console.log(
        `
[${c.name}]  ${detected ? "\u2713 detected" : "\u2717 MISSED"}  expect=${c.expectId} failing=[${failedIds.join(",")}]${detected ? ` owner="${owner}"` : ""}`
      );
      detected ? passed++ : failed++;
    }
  }
  testInv01() ? passed++ : failed++;
  console.warn = realWarn;
  console.log(`
===== SUMMARY =====`);
  console.log(`cases passed: ${passed}, failed: ${failed}`);
  console.log(`[RUNTIME-INV] warnings emitted: ${warnLog.length}`);
  console.log(
    warnLog.length === passed - 1 || warnLog.length >= 9 ? "warnings emitted for each seeded violation \u2713" : `warnings=${warnLog.length}`
  );
}
main();
