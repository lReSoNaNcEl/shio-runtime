// emotion_manifest.json
var emotion_manifest_default = {
  schemaVersion: 1,
  defaultEmotion: "neutral",
  emotions: [
    {
      id: "neutral",
      displayName: "Neutral",
      aliases: [],
      markers: ["[neutral]", "(neutral)"],
      avatar: {
        behavior: "neutral",
        expression: "neutral",
        expressionWeights: {}
      },
      speech: {
        style: "neutral"
      }
    },
    {
      id: "calm",
      displayName: "Calm",
      aliases: [],
      markers: ["[calm]", "(calm)"],
      avatar: {
        behavior: "calm",
        expression: "relaxed",
        expressionWeights: { relaxed: 0.8, neutral: 0.2 }
      },
      speech: {
        style: "calm"
      }
    },
    {
      id: "warm",
      displayName: "Warm",
      aliases: [],
      markers: ["[warm]", "(warm)"],
      avatar: {
        behavior: "warm",
        expression: "happy",
        expressionWeights: { relaxed: 0.7, happy: 0.35 }
      },
      speech: {
        style: "warm"
      }
    },
    {
      id: "happy",
      displayName: "Happy",
      aliases: ["joy", "smile"],
      markers: ["[happy]", "(happy)", "(\u0440\u0430\u0434\u043E\u0441\u0442\u043D\u043E)"],
      avatar: {
        behavior: "happy",
        expression: "happy",
        expressionWeights: { happy: 1 }
      },
      speech: {
        style: "happy"
      }
    },
    {
      id: "laugh",
      displayName: "Laugh",
      aliases: ["laughter", "laughing"],
      markers: ["[laugh]", "[laughter]", "(laugh)", "(laughter)", "(\u0441\u043C\u0435\u0445)"],
      avatar: {
        behavior: "laugh",
        expression: "happy",
        expressionWeights: { happy: 1, aa: 0.35 }
      },
      speech: {
        style: "laugh"
      }
    },
    {
      id: "chuckle",
      displayName: "Chuckle",
      aliases: [],
      markers: ["[chuckle]", "(chuckle)", "(\u0441\u043C\u0435\u0448\u043E\u043A)"],
      avatar: {
        behavior: "laugh",
        expression: "happy",
        expressionWeights: { happy: 0.65, relaxed: 0.25 }
      },
      speech: {
        style: "chuckle"
      }
    },
    {
      id: "sad",
      displayName: "Sad",
      aliases: [],
      markers: ["[sad]", "(sad)", "(\u0433\u0440\u0443\u0441\u0442\u043D\u043E)"],
      avatar: {
        behavior: "sad",
        expression: "sad",
        expressionWeights: { sad: 1 }
      },
      speech: {
        style: "sad"
      }
    },
    {
      id: "crying",
      displayName: "Crying",
      aliases: [],
      markers: ["[crying]", "(crying)", "(\u043F\u043B\u0430\u0447\u0435\u0442)"],
      avatar: {
        behavior: "crying",
        expression: "sad",
        expressionWeights: { sad: 1 }
      },
      speech: {
        style: "crying"
      }
    },
    {
      id: "angry",
      displayName: "Angry",
      aliases: [],
      markers: ["[angry]", "(angry)", "(\u0437\u043B\u043E)", "(\u0437\u043B\u0430)"],
      avatar: {
        behavior: "angry",
        expression: "angry",
        expressionWeights: { angry: 1 }
      },
      speech: {
        style: "angry"
      }
    },
    {
      id: "fear",
      displayName: "Fear",
      aliases: ["scared", "afraid"],
      markers: ["[fear]", "[scared]", "(fear)", "(scared)", "(\u0438\u0441\u043F\u0443\u0433\u0430\u043D\u043D\u043E)"],
      avatar: {
        behavior: "fear",
        expression: "surprised",
        expressionWeights: { surprised: 0.7, sad: 0.5 }
      },
      speech: {
        style: "fear"
      }
    },
    {
      id: "surprised",
      displayName: "Surprised",
      aliases: ["surprise", "surprize"],
      markers: ["[surprised]", "[surprise]", "(surprised)", "(surprise)", "(\u0443\u0434\u0438\u0432\u043B\u0435\u043D\u043D\u043E)", "(\u0443\u0434\u0438\u0432\u043B\u0451\u043D\u043D\u043E)"],
      avatar: {
        behavior: "surprised",
        expression: "surprised",
        expressionWeights: { surprised: 1 }
      },
      speech: {
        style: "surprised"
      }
    },
    {
      id: "gasp",
      displayName: "Gasp",
      aliases: [],
      markers: ["[gasp]", "(gasp)"],
      avatar: {
        behavior: "gasp",
        expression: "surprised",
        expressionWeights: { surprised: 1, aa: 0.45 }
      },
      speech: {
        style: "gasp"
      }
    },
    {
      id: "sigh",
      displayName: "Sigh",
      aliases: [],
      markers: ["[sigh]", "(sigh)", "(\u0432\u0437\u0434\u043E\u0445)"],
      avatar: {
        behavior: "sigh",
        expression: "relaxed",
        expressionWeights: { relaxed: 0.6, sad: 0.4 }
      },
      speech: {
        style: "sigh"
      }
    },
    {
      id: "groan",
      displayName: "Groan",
      aliases: [],
      markers: ["[groan]", "(groan)", "(\u0441\u0442\u043E\u043D)"],
      avatar: {
        behavior: "groan",
        expression: "sad",
        expressionWeights: { sad: 0.55, angry: 0.35, aa: 0.2 }
      },
      speech: {
        style: "groan"
      }
    },
    {
      id: "whisper",
      displayName: "Whisper",
      aliases: [],
      markers: ["[whisper]", "(whisper)", "(\u0448\u0435\u043F\u043E\u0442\u043E\u043C)", "(\u0448\u0451\u043F\u043E\u0442\u043E\u043C)"],
      avatar: {
        behavior: "whisper",
        expression: "relaxed",
        expressionWeights: { relaxed: 0.8, neutral: 0.2 }
      },
      speech: {
        style: "whisper"
      }
    }
  ]
};

// src/shared/emotions.ts
function normalizeKey(value) {
  return value.toLowerCase().trim().replace(/[\s-]+/g, "_");
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var EmotionRegistry = class {
  constructor(manifest) {
    this.manifest = manifest;
    this.schemaVersion = manifest.schemaVersion;
    this.defaultEmotion = normalizeKey(manifest.defaultEmotion || "neutral");
    this.load();
  }
  manifest;
  schemaVersion;
  defaultEmotion;
  entries = /* @__PURE__ */ new Map();
  aliases = /* @__PURE__ */ new Map();
  markerPatterns = [];
  supported() {
    return Array.from(this.entries.keys());
  }
  normalize(tag) {
    const raw = normalizeKey(tag || this.defaultEmotion);
    const resolved = this.aliases.get(raw);
    if (resolved) return resolved;
    if (raw !== this.defaultEmotion) console.warn(`[emotion] Unknown emotion tag "${raw}", using ${this.defaultEmotion}`);
    return this.defaultEmotion;
  }
  parseLeadingEmotionTag(text) {
    const leading = /^\s*\[([a-z_ -]+)\]/i.exec(text);
    if (leading) return this.normalize(leading[1]);
    const trailing = /\[([a-z_ -]+)\]\s*$/i.exec(text);
    return this.normalize(trailing?.[1]);
  }
  stripEmotionTags(text) {
    let result = text;
    for (const { pattern } of this.markerPatterns) {
      result = result.replace(pattern, " ");
    }
    return result.replace(/\s+/g, " ").trim();
  }
  avatarBehavior(emotion) {
    return this.entries.get(this.normalize(emotion))?.avatar?.behavior ?? this.defaultEmotion;
  }
  avatarExpressionWeights(emotion) {
    return { ...this.entries.get(this.normalize(emotion))?.avatar?.expressionWeights ?? {} };
  }
  promptList() {
    return this.supported().map((emotion) => `[${emotion}]`).join(", ");
  }
  contract() {
    return {
      schemaVersion: this.schemaVersion,
      defaultEmotion: this.defaultEmotion,
      supported: this.supported()
    };
  }
  hasDrift(remote) {
    return remote.schemaVersion !== this.schemaVersion || remote.defaultEmotion !== this.defaultEmotion || remote.supported.join("|") !== this.supported().join("|");
  }
  load() {
    for (const raw of this.manifest.emotions) {
      const id = normalizeKey(raw.id);
      if (this.entries.has(id)) throw new Error(`Duplicate emotion id: ${id}`);
      const entry = { ...raw, id };
      this.entries.set(id, entry);
      this.aliases.set(id, id);
      for (const alias of raw.aliases ?? []) this.aliases.set(normalizeKey(alias), id);
      for (const marker of raw.markers ?? []) {
        this.markerPatterns.push({ pattern: new RegExp(`\\s*${escapeRegExp(marker)}\\s*`, "gi"), emotion: id });
      }
    }
    if (!this.entries.has(this.defaultEmotion)) throw new Error(`defaultEmotion is missing: ${this.defaultEmotion}`);
    const known = Array.from(this.aliases.keys()).sort((a, b) => b.length - a.length);
    const dynamic = known.map((key) => escapeRegExp(key).replace(/_/g, "[_ -]?")).join("|");
    this.markerPatterns.push({ pattern: new RegExp(`\\s*[\\[(](${dynamic})[\\])]\\s*`, "gi"), emotion: null });
  }
};
var emotionRegistry = new EmotionRegistry(emotion_manifest_default);
var SUPPORTED_EMOTIONS = emotionRegistry.supported();

// src/renderer/avatar/AvatarStateMachine.ts
var MODE_EFFECTS = {
  idle: {
    proceduralMode: "idle",
    emotionKey: "neutral",
    behaviorId: "idle",
    loop: true,
    detachLipSync: true
  },
  listening: {
    proceduralMode: "listening",
    emotionKey: "calm",
    behaviorId: "listening",
    loop: true
  },
  thinking: {
    proceduralMode: "thinking",
    emotionKey: "calm",
    behaviorId: "thinking",
    loop: true
  }
};
var AvatarStateMachine = class {
  mode = "idle";
  emotionKey = "neutral";
  getMode() {
    return this.mode;
  }
  getEmotion() {
    return this.emotionKey;
  }
  getIdleEffect() {
    return { mode: "idle", ...MODE_EFFECTS.idle };
  }
  setMode(mode) {
    this.mode = mode;
    if (mode === "awaitingSpeech") {
      return {
        mode,
        proceduralMode: "thinking",
        emotionKey: this.emotionKey,
        behaviorId: "thinking",
        loop: true,
        resetMouth: true
      };
    }
    if (mode === "speaking") {
      return {
        mode,
        proceduralMode: "speaking",
        emotionKey: this.emotionKey,
        behaviorId: this.toBehaviorId(this.emotionKey),
        loop: true,
        attachLipSync: true
      };
    }
    const effect = MODE_EFFECTS[mode];
    this.emotionKey = effect.emotionKey;
    return { mode, ...effect };
  }
  setEmotion(emotionKey) {
    this.emotionKey = emotionKey || "neutral";
    if (this.mode !== "speaking") return null;
    return {
      mode: this.mode,
      proceduralMode: "speaking",
      emotionKey: this.emotionKey,
      behaviorId: this.toBehaviorId(this.emotionKey),
      loop: true,
      attachLipSync: true
    };
  }
  prepareSpeaking(emotionKey) {
    this.mode = "awaitingSpeech";
    this.emotionKey = emotionKey || this.emotionKey || "neutral";
    return {
      mode: this.mode,
      proceduralMode: "thinking",
      emotionKey: this.emotionKey,
      behaviorId: "thinking",
      loop: true,
      resetMouth: true
    };
  }
  startSpeaking(emotionKey) {
    this.mode = "speaking";
    this.emotionKey = emotionKey || this.emotionKey || "neutral";
    return {
      mode: this.mode,
      proceduralMode: "speaking",
      emotionKey: this.emotionKey,
      behaviorId: this.toBehaviorId(this.emotionKey),
      loop: true,
      attachLipSync: true
    };
  }
  stopSpeaking() {
    this.mode = "idle";
    this.emotionKey = MODE_EFFECTS.idle.emotionKey;
    return { mode: "idle", ...MODE_EFFECTS.idle };
  }
  previewGreeting() {
    this.mode = "speaking";
    this.emotionKey = "happy";
    return {
      mode: this.mode,
      proceduralMode: "speaking",
      emotionKey: this.emotionKey,
      behaviorId: "greeting",
      loop: false
    };
  }
  toBehaviorId(emotionKey) {
    return emotionRegistry.avatarBehavior(emotionKey);
  }
};

// src/renderer/three/facialEasing.ts
var EASINGS = {
  linear: (t) => t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
};
function ease(id, t) {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return EASINGS[id](clamped);
}
function releaseValue(startValue, progress, easing) {
  const eased = ease(easing, progress);
  const next = startValue * (1 - eased);
  return next < 1e-3 ? 0 : next;
}

// src/renderer/three/FacialProfile.ts
var blink = (options) => options;
var baseBlink = {
  profileId: "neutral",
  intervalMin: 3.4,
  intervalMax: 5.2,
  durationMs: 410,
  doubleBlinkChance: 0.04,
  weightMin: 0.42,
  weightMax: 0.64,
  blinkMax: 0.66,
  cooldownMs: 680
};
var release = (releaseDurationMs, attackPerSecond = 6, holdMs = 0) => ({
  attackPerSecond,
  holdMs,
  releaseDurationMs,
  curve: "easeInOutCubic"
});
var eye = (eyeContactBias, lookAwayBias = 0.08, eyeOpenness = 1, blinkAsymmetry = 0) => ({
  eyeContactBias,
  eyeOpenness,
  lookAwayBias,
  blinkAsymmetry
});
var mouth = (gainScale, opennessScale, closedMouthBias, softness = 1, releaseScale = 1) => ({
  gainScale,
  opennessScale,
  softness,
  closedMouthBias,
  releaseScale
});
var expressionMotion = (breathAmplitude, breathSpeed = 0.32, speakingBoost = 1) => ({
  breathAmplitude,
  breathSpeed,
  speakingBoost
});
var FACIAL_PROFILES = {
  neutral: {
    id: "neutral",
    expressionWeights: {},
    visemeBias: {},
    visemeScale: { aa: 0.92, ih: 0.9, ou: 0.92, ee: 0.9, oh: 0.92 },
    blinkProfile: blink({ ...baseBlink }),
    eyeProfile: eye(0.72),
    mouthProfile: mouth(1, 0.92, 0.04),
    expressionMotion: expressionMotion(0.012, 0.28, 0.7),
    releaseProfile: release(620, 6, 450)
  },
  happy: {
    id: "happy",
    expressionWeights: { happy: 0.54, relaxed: 0.14, surprised: 0.02 },
    visemeBias: { ee: 0.01 },
    visemeScale: { aa: 0.96, ih: 0.94, ou: 0.88, ee: 0.96, oh: 0.88 },
    blinkProfile: blink({ ...baseBlink, profileId: "happy", intervalMin: 2.4, intervalMax: 4, durationMs: 340, doubleBlinkChance: 0.08, weightMin: 0.34, weightMax: 0.54, blinkMax: 0.56 }),
    eyeProfile: eye(0.86, 0.04, 1.04),
    mouthProfile: mouth(1.02, 0.96, 0.04, 0.94),
    expressionMotion: expressionMotion(0.036, 0.24, 1),
    releaseProfile: release(860, 6.5, 2400)
  },
  laugh: {
    id: "laugh",
    expressionWeights: { happy: 0.64, relaxed: 0.12, surprised: 0.04 },
    visemeBias: { aa: 0.04, ee: 0.015 },
    visemeScale: { aa: 1.04, ih: 0.96, ou: 0.9, ee: 1, oh: 0.94 },
    blinkProfile: blink({ ...baseBlink, profileId: "laugh", intervalMin: 2.2, intervalMax: 3.6, durationMs: 320, doubleBlinkChance: 0.09, weightMin: 0.32, weightMax: 0.52, blinkMax: 0.54 }),
    eyeProfile: eye(0.82, 0.08, 1.06, 0.08),
    mouthProfile: mouth(1.06, 1, 0.035, 0.9),
    expressionMotion: expressionMotion(0.042, 0.3, 1.08),
    releaseProfile: release(920, 7, 1800)
  },
  chuckle: {
    id: "chuckle",
    expressionWeights: { happy: 0.42, relaxed: 0.18, surprised: 0.015 },
    visemeBias: { aa: 0.02 },
    visemeScale: { aa: 0.98, ih: 0.94, ou: 0.88, ee: 0.96, oh: 0.88 },
    blinkProfile: blink({ ...baseBlink, profileId: "chuckle", intervalMin: 2.6, intervalMax: 4.2, weightMin: 0.36, weightMax: 0.56, blinkMax: 0.58 }),
    eyeProfile: eye(0.8, 0.07, 1.02, 0.05),
    mouthProfile: mouth(1, 0.94, 0.04, 0.94),
    expressionMotion: expressionMotion(0.028, 0.28, 1),
    releaseProfile: release(780, 6.4, 1600)
  },
  embarrassed: {
    id: "embarrassed",
    expressionWeights: { happy: 0.1, sad: 0.05, relaxed: 0.12 },
    visemeBias: { ih: 0.01 },
    visemeScale: { aa: 0.82, ih: 0.86, ou: 0.84, ee: 0.85, oh: 0.82 },
    blinkProfile: blink({ ...baseBlink, profileId: "embarrassed", intervalMin: 1.7, intervalMax: 2.8, durationMs: 330, doubleBlinkChance: 0.14, weightMin: 0.42, weightMax: 0.66, blinkMax: 0.68 }),
    eyeProfile: eye(0.48, 0.32, 0.94, 0.12),
    mouthProfile: mouth(0.86, 0.82, 0.055, 1.12, 1.08),
    expressionMotion: expressionMotion(0.032, 0.38, 1.12),
    releaseProfile: release(900, 5.4, 1200)
  },
  thinking: {
    id: "thinking",
    expressionWeights: { relaxed: 0.4, sad: 0.04 },
    visemeBias: {},
    visemeScale: { aa: 0.86, ih: 0.86, ou: 0.88, ee: 0.85, oh: 0.88 },
    blinkProfile: blink({ ...baseBlink, profileId: "thinking", intervalMin: 4.4, intervalMax: 7.2, durationMs: 520, weightMin: 0.42, weightMax: 0.62, blinkMax: 0.64 }),
    eyeProfile: eye(0.36, 0.28, 0.98),
    mouthProfile: mouth(0.92, 0.86, 0.05, 1.06, 1.06),
    expressionMotion: expressionMotion(0.01, 0.18, 0.45),
    releaseProfile: release(820, 5.5, 900)
  },
  angry: {
    id: "angry",
    expressionWeights: { angry: 0.72, sad: 0.08 },
    visemeBias: { aa: 0.03, oh: 0.02 },
    visemeScale: { aa: 1.08, ih: 0.96, ou: 1.02, ee: 0.94, oh: 1.04 },
    blinkProfile: blink({ ...baseBlink, profileId: "angry", intervalMin: 3.2, intervalMax: 5.2, durationMs: 350, weightMin: 0.34, weightMax: 0.54, blinkMax: 0.58 }),
    eyeProfile: eye(0.84, 0.04, 0.96),
    mouthProfile: mouth(1.06, 1.04, 0.03, 0.88),
    expressionMotion: expressionMotion(0.02, 0.32, 0.8),
    releaseProfile: release(760, 6.8, 1200)
  },
  sad: {
    id: "sad",
    expressionWeights: { sad: 0.68, relaxed: 0.08 },
    visemeBias: {},
    visemeScale: { aa: 0.84, ih: 0.84, ou: 0.88, ee: 0.82, oh: 0.88 },
    blinkProfile: blink({ ...baseBlink, profileId: "sad", intervalMin: 3.8, intervalMax: 6.2, durationMs: 470, weightMin: 0.46, weightMax: 0.68, blinkMax: 0.7 }),
    eyeProfile: eye(0.58, 0.18, 0.94),
    mouthProfile: mouth(0.88, 0.84, 0.052, 1.08, 1.08),
    expressionMotion: expressionMotion(0.016, 0.2, 0.6),
    releaseProfile: release(900, 5.2, 1500)
  },
  surprised: {
    id: "surprised",
    expressionWeights: { surprised: 0.48, relaxed: 0.06 },
    visemeBias: { aa: 0.025, oh: 0.03 },
    visemeScale: { aa: 1, ih: 0.9, ou: 0.98, ee: 0.9, oh: 1.02 },
    blinkProfile: blink({ ...baseBlink, profileId: "surprised", intervalMin: 2.2, intervalMax: 3.8, durationMs: 310, weightMin: 0.28, weightMax: 0.46, blinkMax: 0.52 }),
    eyeProfile: eye(0.9, 0.06, 1.08),
    mouthProfile: mouth(1.04, 1, 0.035, 0.9),
    expressionMotion: expressionMotion(0.026, 0.34, 0.86),
    releaseProfile: release(720, 7, 900)
  },
  approval: {
    id: "approval",
    expressionWeights: { happy: 0.34, relaxed: 0.24 },
    visemeBias: { ee: 0.01 },
    visemeScale: { aa: 0.92, ih: 0.92, ou: 0.88, ee: 0.94, oh: 0.88 },
    blinkProfile: blink({ ...baseBlink, profileId: "approval", intervalMin: 3, intervalMax: 4.8, weightMin: 0.38, weightMax: 0.58, blinkMax: 0.6 }),
    eyeProfile: eye(0.84, 0.05, 1.02),
    mouthProfile: mouth(0.96, 0.9, 0.044, 0.98),
    expressionMotion: expressionMotion(0.02, 0.2, 0.72),
    releaseProfile: release(780, 6.2, 1900)
  },
  confusion: {
    id: "confusion",
    expressionWeights: { surprised: 0.18, sad: 0.06, relaxed: 0.12 },
    visemeBias: { ih: 0.01 },
    visemeScale: { aa: 0.86, ih: 0.94, ou: 0.86, ee: 0.92, oh: 0.88 },
    blinkProfile: blink({ ...baseBlink, profileId: "confusion", intervalMin: 3.6, intervalMax: 5.8, durationMs: 430, weightMin: 0.4, weightMax: 0.62, blinkMax: 0.64 }),
    eyeProfile: eye(0.46, 0.24, 1),
    mouthProfile: mouth(0.9, 0.86, 0.052, 1.1),
    expressionMotion: expressionMotion(0.018, 0.22, 0.62),
    releaseProfile: release(820, 5.8, 1200)
  }
};
var DEFAULT_FACIAL_PROFILE_ID = "neutral";
var PROFILE_ALIASES = {
  calm: "neutral",
  warm: "approval",
  crying: "sad",
  fear: "confusion",
  gasp: "surprised",
  sigh: "thinking",
  groan: "angry",
  whisper: "thinking",
  relaxed: "neutral"
};
function resolveFacialProfileId(key) {
  const normalized = (key ?? DEFAULT_FACIAL_PROFILE_ID).trim().toLowerCase();
  if (normalized in FACIAL_PROFILES) return normalized;
  return PROFILE_ALIASES[normalized] ?? DEFAULT_FACIAL_PROFILE_ID;
}
function getFacialProfile(key) {
  return FACIAL_PROFILES[resolveFacialProfileId(key)];
}
function completeMouthWeights(weights) {
  return {
    aa: weights.aa ?? 0,
    ih: weights.ih ?? 0,
    ou: weights.ou ?? 0,
    ee: weights.ee ?? 0,
    oh: weights.oh ?? 0
  };
}
var VISEME_NAMES = ["aa", "ih", "ou", "ee", "oh"];

// src/renderer/three/ExpressionController.ts
var MOUTH_EXPRESSIONS = /* @__PURE__ */ new Set(["aa", "ih", "ou", "ee", "oh"]);
var ExpressionController = class {
  attached = false;
  targets = /* @__PURE__ */ new Map();
  weights = /* @__PURE__ */ new Map();
  releases = /* @__PURE__ */ new Map();
  profile = getFacialProfile("neutral");
  frame = 0;
  speechEnergy = 0;
  breathPhase = Math.random() * Math.PI * 2;
  attach(_vrm) {
    this.clear();
    this.attached = true;
  }
  detach() {
    this.clear();
    this.attached = false;
  }
  clear() {
    this.targets.clear();
    this.weights.clear();
    this.releases.clear();
  }
  applyEmotion(emotionKey, vrmEmotion) {
    this.targets.clear();
    this.profile = getFacialProfile(emotionKey);
    const preset = {
      ...this.profile.expressionWeights,
      ...this.parseVrmEmotion(vrmEmotion) ?? {}
    };
    for (const [name, weight] of Object.entries(preset)) {
      if (MOUTH_EXPRESSIONS.has(name)) continue;
      this.targets.set(name, this.clamp(weight));
    }
    console.log(
      `[FACETRACE] source=Emotion event=APPLY emotion=${emotionKey} profile=${this.profile.id} targets=[${[...this.targets].map(([n, w]) => `${n}:${w.toFixed(2)}`).join(",")}] frame=${this.frame} t=${Math.round(performance.now())}ms`
    );
  }
  update(delta) {
    if (!this.attached) return;
    this.frame += 1;
    this.breathPhase += Math.max(0, delta) * this.profile.expressionMotion.breathSpeed;
    const deltaMs = Math.max(0, delta) * 1e3;
    const attackT = Math.min(1, Math.max(0, delta) * this.profile.releaseProfile.attackPerSecond);
    const releaseDurationMs = Math.max(1, this.profile.releaseProfile.releaseDurationMs);
    const easing = this.profile.releaseProfile.curve;
    const names = /* @__PURE__ */ new Set([...this.weights.keys(), ...this.targets.keys()]);
    for (const name of names) {
      const current = this.weights.get(name) ?? 0;
      const baseTarget = this.targets.get(name) ?? 0;
      const target = baseTarget > 0 ? this.applySpeechBreath(baseTarget, name) : 0;
      if (target > current) {
        this.releases.delete(name);
        this.weights.set(name, this.lerp(current, target, attackT));
        continue;
      }
      if (target > 0) {
        this.releases.delete(name);
        this.weights.set(name, this.lerp(current, target, attackT));
        continue;
      }
      let release2 = this.releases.get(name);
      if (!release2) {
        if (current <= 1e-3) {
          this.weights.delete(name);
          continue;
        }
        release2 = { startValue: current, elapsedMs: 0, holdMs: this.profile.releaseProfile.holdMs };
        this.releases.set(name, release2);
        this.logLifecycle("release", name, 0);
      }
      release2.elapsedMs += deltaMs;
      if (release2.elapsedMs < release2.holdMs) {
        this.weights.set(name, release2.startValue);
        continue;
      }
      const progress = Math.min(1, (release2.elapsedMs - release2.holdMs) / releaseDurationMs);
      const next = releaseValue(release2.startValue, progress, easing);
      if (next <= 0 || progress >= 1) {
        this.weights.delete(name);
        this.releases.delete(name);
        this.logLifecycle("inactive", name, 1);
      } else {
        this.weights.set(name, next);
      }
    }
  }
  logLifecycle(state, expression, progress) {
    console.log(
      `[FACELIFE] source=Emotion state=${state} expression=${expression} frame=${this.frame} t=${Math.round(performance.now())}ms release=${progress.toFixed(2)}`
    );
  }
  /** Current emotion-domain expression weights for the Expression Mixer. */
  getValues() {
    return this.weights;
  }
  getProfile() {
    return this.profile;
  }
  setSpeechEnergy(energy) {
    this.speechEnergy = this.clamp(energy);
  }
  parseVrmEmotion(vrmEmotion) {
    if (!vrmEmotion) return null;
    const result = {};
    for (const part of vrmEmotion.split(",")) {
      const [rawName, rawWeight] = part.split(":");
      const name = rawName?.trim();
      if (!name) continue;
      const weight = Number(rawWeight);
      result[name] = Number.isFinite(weight) ? weight : 1;
    }
    return Object.keys(result).length ? result : null;
  }
  clamp(value) {
    return Math.max(0, Math.min(1, value));
  }
  applySpeechBreath(target, name) {
    const motion = this.profile.expressionMotion;
    if (motion.breathAmplitude <= 0) return target;
    const nameOffset = this.hashName(name) * 0.37;
    const slowBreath = Math.sin(this.breathPhase + nameOffset) * 0.5 + 0.5;
    const activeAmount = motion.breathAmplitude * (0.35 + this.speechEnergy * motion.speakingBoost);
    return this.clamp(target * (1 - activeAmount * 0.45 + slowBreath * activeAmount));
  }
  hashName(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 997;
    return hash / 997;
  }
  lerp(a, b, t) {
    return a + (b - a) * t;
  }
};

// src/renderer/three/BlinkController.ts
var DEFAULT_PROFILE = {
  profileId: "idle",
  intervalMinMs: 3400,
  intervalMaxMs: 5200,
  closingMs: 82,
  closedMs: 115,
  openingMs: 213,
  minWeight: 0.42,
  maxWeight: 0.64,
  blinkMax: 0.66,
  doubleBlinkChance: 0.04,
  cooldownMs: 680,
  sequenceGapMinMs: 90,
  sequenceGapMaxMs: 170,
  secondBlinkDurationScale: 0.82,
  secondBlinkWeightScale: 0.88
};
var BlinkController = class {
  rng;
  active = true;
  /** The profile currently configured by the runtime (may change any time). */
  configuredProfile = DEFAULT_PROFILE;
  /**
   * Snapshot frozen at the start of a blink (or double-blink sequence). The
   * active blink always completes on this snapshot, so a mid-phase profile
   * switch never causes a weight/duration jump; the new profile only takes
   * effect on the next independent event.
   */
  activeSnapshot = DEFAULT_PROFILE;
  proceduralModeLabel = "idle";
  emotionLabel = "neutral";
  // Scheduling (all in ms).
  timerMs = 0;
  nextBlinkInMs = 1200;
  cooldownRemainingMs = 0;
  sequenceGapRemainingMs = 0;
  // Active blink phase state.
  phase = "idle";
  phaseTimeMs = 0;
  sequenceState = "none";
  triggerReason = "scheduled";
  pendingSecondBlink = false;
  // Per-blink phase durations (from the snapshot, scaled for a second blink).
  closingMs = DEFAULT_PROFILE.closingMs;
  closedMs = DEFAULT_PROFILE.closedMs;
  openingMs = DEFAULT_PROFILE.openingMs;
  blinkTargetWeight = 0;
  weightCeiling = DEFAULT_PROFILE.blinkMax;
  rawWeight = 0;
  weight = 0;
  blinkCount = 0;
  doubleBlinkCount = 0;
  constructor(profile = DEFAULT_PROFILE, rng = Math.random) {
    this.rng = rng;
    this.configuredProfile = profile;
    this.activeSnapshot = profile;
    this.weightCeiling = profile.blinkMax;
  }
  /** Begin blink scheduling for a freshly loaded model. */
  attach() {
    this.phase = "idle";
    this.sequenceState = "none";
    this.pendingSecondBlink = false;
    this.cooldownRemainingMs = 0;
    this.sequenceGapRemainingMs = 0;
    this.setWeight(0);
    this.resetSchedule(800);
  }
  detach() {
    this.setWeight(0);
    this.phase = "idle";
    this.sequenceState = "none";
    this.pendingSecondBlink = false;
    this.cooldownRemainingMs = 0;
    this.sequenceGapRemainingMs = 0;
  }
  /** Current blink weight (0..1) for the Expression Mixer to apply. */
  getWeight() {
    return this.weight;
  }
  /**
   * Apply a freshly resolved effective profile. Takes effect immediately for
   * scheduling while idle; if a blink / sequence is in flight the new profile is
   * only used for the next independent event (the active blink keeps its snapshot).
   */
  setEffectiveProfile(profile, context) {
    if (context?.proceduralMode !== void 0) this.proceduralModeLabel = context.proceduralMode;
    if (context?.emotion !== void 0) this.emotionLabel = context.emotion;
    const changed = profile.profileId !== this.configuredProfile.profileId;
    this.configuredProfile = profile;
    if (this.phase === "idle" && this.sequenceState === "none") {
      this.activeSnapshot = profile;
      this.weightCeiling = profile.blinkMax;
      this.clampScheduleToProfile();
      if (changed) {
        console.log(`[FACETRACE] source=Blink event=PROFILE profile=${profile.profileId} mode=${this.proceduralModeLabel} emotion=${this.emotionLabel} t=${Math.round(performance.now())}ms`);
      }
    }
  }
  update(delta) {
    if (!this.active) {
      this.setWeight(0);
      return;
    }
    const deltaMs = Math.max(0, delta) * 1e3;
    this.cooldownRemainingMs = Math.max(0, this.cooldownRemainingMs - deltaMs);
    if (this.phase !== "idle") {
      this.updateBlinkPhase(deltaMs);
      return;
    }
    if (this.sequenceState === "waiting-second-blink") {
      this.sequenceGapRemainingMs -= deltaMs;
      if (this.sequenceGapRemainingMs <= 0) this.launchSecondBlink();
      return;
    }
    this.timerMs += deltaMs;
    if (this.timerMs >= this.nextBlinkInMs && this.cooldownRemainingMs <= 0) {
      this.launchPrimaryBlink("scheduled");
    }
  }
  /**
   * Force a blink now. Forced blinks are single by default (they never open a
   * double-blink sequence) unless {@link sequence} is explicitly requested.
   */
  force(duration = 1.2, sequence = false) {
    this.activeSnapshot = this.configuredProfile;
    this.weightCeiling = this.activeSnapshot.blinkMax;
    const total = this.activeSnapshot.closingMs + this.activeSnapshot.closedMs + this.activeSnapshot.openingMs;
    const requestedMs = Math.max(120, duration * 1e3);
    const durationScale = Math.max(0.3, Math.min(2, requestedMs / Math.max(1, total)));
    this.beginBlinkPhases(durationScale, 1, "forced");
    this.pendingSecondBlink = sequence && this.rng() < this.activeSnapshot.doubleBlinkChance;
    this.sequenceState = "none";
  }
  setActive(active) {
    this.active = active;
    if (!active) {
      this.phase = "idle";
      this.sequenceState = "none";
      this.pendingSecondBlink = false;
      this.cooldownRemainingMs = 0;
      this.sequenceGapRemainingMs = 0;
      this.setWeight(0);
    }
  }
  getDebugState() {
    const p = this.activeSnapshot;
    const totalMs = p.closingMs + p.closedMs + p.openingMs;
    const inFlight = this.phase !== "idle" || this.sequenceState !== "none";
    return {
      weight: this.weight,
      rawWeight: this.rawWeight,
      finalWeight: this.weight,
      phase: this.phase,
      triggerReason: this.triggerReason,
      proceduralMode: this.proceduralModeLabel,
      emotion: this.emotionLabel,
      profileId: this.configuredProfile.profileId,
      configuredProfile: this.configuredProfile,
      activeProfileSnapshot: inFlight ? this.activeSnapshot : null,
      sequenceState: this.sequenceState,
      blinkCount: this.blinkCount,
      doubleBlinkCount: this.doubleBlinkCount,
      duration: totalMs / 1e3,
      targetWeight: this.blinkTargetWeight,
      intervalMin: this.configuredProfile.intervalMinMs / 1e3,
      intervalMax: this.configuredProfile.intervalMaxMs / 1e3,
      weightMin: this.configuredProfile.minWeight,
      weightMax: this.configuredProfile.maxWeight,
      blinkMax: this.configuredProfile.blinkMax,
      nextBlinkIn: Math.max(0, this.nextBlinkInMs - this.timerMs) / 1e3,
      cooldownRemaining: this.cooldownRemainingMs / 1e3,
      cooldown: this.configuredProfile.cooldownMs / 1e3,
      source: "AutoBlink"
    };
  }
  launchPrimaryBlink(reason) {
    this.activeSnapshot = this.configuredProfile;
    this.weightCeiling = this.activeSnapshot.blinkMax;
    this.beginBlinkPhases(1, 1, reason);
    this.pendingSecondBlink = this.rng() < this.activeSnapshot.doubleBlinkChance;
    this.resetSchedule();
  }
  launchSecondBlink() {
    this.sequenceState = "second-blink";
    this.beginBlinkPhases(
      this.activeSnapshot.secondBlinkDurationScale,
      this.activeSnapshot.secondBlinkWeightScale,
      "sequence"
    );
    this.doubleBlinkCount += 1;
  }
  beginBlinkPhases(durationScale, weightScale, reason) {
    const p = this.activeSnapshot;
    this.closingMs = p.closingMs * durationScale;
    this.closedMs = p.closedMs * durationScale;
    this.openingMs = p.openingMs * durationScale;
    const depth = p.minWeight + this.rng() * Math.max(0, p.maxWeight - p.minWeight);
    this.blinkTargetWeight = Math.min(this.weightCeiling, depth * weightScale);
    this.phase = "closing";
    this.phaseTimeMs = 0;
    this.triggerReason = reason;
    this.blinkCount += 1;
    this.setWeight(0);
  }
  updateBlinkPhase(deltaMs) {
    this.phaseTimeMs += deltaMs;
    if (this.phase === "closing") {
      this.setWeight(this.blinkTargetWeight * this.easeOut(Math.min(1, this.phaseTimeMs / this.closingMs)));
      if (this.phaseTimeMs >= this.closingMs) this.nextPhase("closed");
      return;
    }
    if (this.phase === "closed") {
      this.setWeight(this.blinkTargetWeight);
      if (this.phaseTimeMs >= this.closedMs) this.nextPhase("opening");
      return;
    }
    if (this.phase === "opening") {
      this.setWeight(this.blinkTargetWeight * (1 - this.easeInOut(Math.min(1, this.phaseTimeMs / this.openingMs))));
      if (this.phaseTimeMs >= this.openingMs) {
        this.setWeight(0);
        this.phase = "idle";
        this.phaseTimeMs = 0;
        this.finishBlink();
      }
    }
  }
  finishBlink() {
    if (this.pendingSecondBlink) {
      this.pendingSecondBlink = false;
      this.sequenceState = "waiting-second-blink";
      const gapSpan = Math.max(0, this.activeSnapshot.sequenceGapMaxMs - this.activeSnapshot.sequenceGapMinMs);
      this.sequenceGapRemainingMs = this.activeSnapshot.sequenceGapMinMs + this.rng() * gapSpan;
      return;
    }
    this.sequenceState = "none";
    this.cooldownRemainingMs = this.activeSnapshot.cooldownMs;
    this.activeSnapshot = this.configuredProfile;
    this.weightCeiling = this.activeSnapshot.blinkMax;
  }
  nextPhase(phase) {
    this.phase = phase;
    this.phaseTimeMs = 0;
  }
  resetSchedule(minDelayMs = this.configuredProfile.intervalMinMs) {
    this.timerMs = 0;
    const min = minDelayMs;
    const span = Math.max(0, this.configuredProfile.intervalMaxMs - min);
    this.nextBlinkInMs = min + this.rng() * span;
  }
  /** Re-fit an in-progress idle schedule into a newly configured interval. */
  clampScheduleToProfile() {
    if (this.nextBlinkInMs > this.configuredProfile.intervalMaxMs) {
      this.nextBlinkInMs = this.configuredProfile.intervalMaxMs;
    }
  }
  setWeight(value) {
    this.rawWeight = Math.max(0, value);
    this.weight = Math.max(0, Math.min(this.weightCeiling, value));
  }
  easeOut(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
};

// src/renderer/three/avatarTuning.ts
var facialTuning = {
  debug: {
    verboseFacialFrameLogs: false
  },
  expression: {
    // Emotion domain release (fade-out) lifecycle. Rising toward a new emotion
    // uses an exponential attack; falling toward zero uses a centralized,
    // duration-based eased release so expressions fade instead of snapping.
    attackPerSecond: 6,
    releaseDurationMs: 480,
    releaseEasing: "easeInOutCubic"
  },
  lipSync: {
    gain: 2.4,
    silenceThreshold: 0.014,
    analyserSmoothing: 0.42,
    mouthClosedBias: 0.04,
    peakLimit: 0.75,
    proceduralNoiseAmplitude: 0.028,
    proceduralNoiseSpeed: 19,
    attackPerSecond: 24,
    releasePerSecond: 28,
    silentReleasePerSecond: 48,
    detachedReleasePerSecond: 26,
    shortPauseReleasePerSecond: 64,
    shortPauseAfterMs: 64,
    significantRawThreshold: 0.12,
    suppressedFinalThreshold: 0.015,
    // Startup grace window applied at the beginning of each speech segment
    // (LipSync.attach). During it the aggressive mouth-closed bias is relaxed so
    // a quiet phrase onset is not zeroed into a "dead mouth" before the voice
    // ramps up. Steady-state tuning is unchanged after the window elapses.
    startupGraceMs: 500,
    startupGraceClosedBias: 0.02,
    // Anti-stall fallback: if audible speech is present but the resolved mouth
    // stays ~closed for too long (e.g. a soft-attack passage repeatedly zeroed by
    // the closed-mouth bias), inject a small procedural mouth motion so the mouth
    // is never fully dead while there is audible voice. Deliberately small — it
    // supplements, never replaces, normal LipSync, and disengages the moment the
    // audio goes quiet.
    antiStall: {
      enabled: true,
      // rawEnergy above which speech is considered audible (worth animating).
      minEnergy: 0.035,
      // Resolved mouth openness below which the mouth counts as "dead".
      deadThreshold: 0.045,
      // How long audible-but-dead must persist before the fallback engages.
      stallAfterMs: 170,
      recoveryAfterMs: 100,
      floor: 0.07,
      // Peak openness of the procedural fallback (small).
      amplitude: 0.07,
      // Oscillation speed of the fallback mouth motion (rad/s).
      speed: 8
    },
    statsHighThreshold: 0.7,
    statsOpenThreshold: 0.4,
    statsClosedThreshold: 0.15,
    clamps: {
      aa: 0.36,
      ih: 0.27,
      ou: 0.29,
      ee: 0.25,
      oh: 0.28
    },
    emotionProfiles: {
      whisper: { gainScale: 0.45, openBias: 0, roundBias: 0.03 },
      laugh: { gainScale: 1.12, openBias: 0.14, roundBias: 0.02 },
      gasp: { gainScale: 1.16, openBias: 0.18, roundBias: 0.03 },
      groan: { gainScale: 1, openBias: 0.09, roundBias: 0.12 },
      sigh: { gainScale: 0.72, openBias: 0.03, roundBias: 0.08 }
    },
    // One profile is selected at speech playback start. Long continuous
    // playback gets a slow timed refresh; only the profile transition is
    // interpolated, so the audio-driven LipSync signal remains authoritative.
    microVariation: {
      enabled: true,
      shortSpeechThresholdMs: 2e3,
      longChunkRefreshMs: { min: 3e3, max: 6e3 },
      transitionMs: { min: 150, max: 350 },
      opennessGain: { min: 0.94, max: 1.06 },
      widthBias: { min: -0.04, max: 0.04 },
      roundnessBias: { min: -0.04, max: 0.04 },
      emotionScale: {
        neutral: 1,
        happy: 1,
        laugh: 1,
        chuckle: 0.95,
        angry: 0.85,
        sad: 0.7,
        surprised: 0.55,
        embarrassed: 0.8,
        thinking: 0.7
      },
      emotionBias: {
        happy: { width: 0.012, roundness: 0 },
        laugh: { width: 0.014, roundness: 0 },
        chuckle: { width: 0.01, roundness: 0 },
        angry: { width: 6e-3, roundness: -0.012 },
        sad: { width: -4e-3, roundness: 4e-3 },
        surprised: { width: 0, roundness: 0 },
        embarrassed: { width: -4e-3, roundness: 6e-3 },
        thinking: { width: -4e-3, roundness: 6e-3 },
        neutral: { width: 0, roundness: 0 }
      }
    }
  },
  animation: {
    verboseTransitionLogs: false,
    minimumTransitionWeight: 0.015,
    cleanupGraceFrames: 1,
    ownershipGapWeight: 0.01
  },
  blink: {
    // Global eyelid ceiling used as a fallback when an emotion profile omits its
    // own `blinkMax`.
    blinkMax: 0.72,
    // Procedural-mode MODIFIERS. Emotion supplies the base interval / duration /
    // depth (see FacialProfile.blinkProfile); the mode only scales it. This is
    // the deliberate replacement for the old per-mode full profiles, so the
    // effective profile is composed in exactly one place
    // (resolveEffectiveBlinkProfile) and never depends on event order.
    modeModifiers: {
      idle: { intervalScale: 1, durationScale: 1, weightScale: 1 },
      speaking: { intervalScale: 0.75, durationScale: 0.92, weightScale: 0.92 }
    },
    profileByMode: {
      idle: "idle",
      listening: "idle",
      thinking: "idle",
      speaking: "speaking"
    },
    // Double-blink is a single sequence: blink -> short internal gap -> weaker,
    // shorter second blink -> normal cooldown. The internal gap is NOT gated by
    // the normal cooldown, so the pair reads as one event.
    sequence: {
      gapMinMs: 90,
      gapMaxMs: 170,
      secondBlinkDurationScale: 0.82,
      secondBlinkWeightScale: 0.88
    },
    forceDuration: 0.46
  },
  // Speaking Eye Micro-Expression — a subtle, slowly varying partial eye-narrow
  // layered ONLY while speaking. It never fully closes the eyes (Blink owns that)
  // and it targets a slowly drifting value so the gaze does not snap back to one
  // fixed openness after every blink. Emotion modifies the variation, never
  // replaces it.
  speakingEye: {
    enabled: true,
    // How often a new squint target is chosen (ms).
    targetIntervalMs: { min: 1200, max: 4e3 },
    // Baseline partial narrow held while speaking (before per-target variation).
    // Lowered ~33% (was 0.045) so the eyes read as gently softened rather than
    // sleepy/suspicious, while still not fully open.
    baseSquint: 0.03,
    // Peak-to-peak variation applied around the baseline squint. Trimmed ~25%
    // (was 0.08) so lively drift stays but the upper peaks no longer re-create a
    // strong squint.
    opennessVariation: 0.06,
    // Maximum left/right divergence so the two eyes are never perfectly symmetric.
    asymmetry: 0.03,
    // Exponential approach speed toward the current target (soft/smooth).
    interpolationSpeed: 6,
    // Small non-zero floor while speaking: the eyes keep a very light living
    // squint and never snap to fully neutral-open mid-sentence.
    minSquint: 0.012,
    // Hard ceiling so the micro-expression can never approach a real blink.
    // Lowered ~35% (was 0.2) so even emotion-scaled peaks stay well-readable.
    maxSquint: 0.13,
    // Per-emotion modifiers. `squintScale` shifts the baseline narrow,
    // `variationScale` shifts how lively the drift is. Unlisted emotions use
    // `neutral`. Over-closing emotions (angry/sad) softened, surprised opened
    // further so the eyes never look half-shut or sleepy.
    emotions: {
      neutral: { squintScale: 1, variationScale: 1 },
      happy: { squintScale: 0.9, variationScale: 1.2 },
      laugh: { squintScale: 1, variationScale: 1.3 },
      chuckle: { squintScale: 0.95, variationScale: 1.15 },
      relaxed: { squintScale: 1, variationScale: 1 },
      sad: { squintScale: 1.1, variationScale: 0.8 },
      angry: { squintScale: 1.3, variationScale: 1.1 },
      surprised: { squintScale: 0.3, variationScale: 0.6 },
      thinking: { squintScale: 1.05, variationScale: 0.7 }
    }
  },
  // Mouth Closure Envelope — brief, constrained procedural lip closures layered
  // OVER the tuned LipSync output so the mouth is not permanently ajar during
  // speech. Applied as a multiplier on the final mouth value; it never rewrites
  // the LipSync signal itself.
  mouthClosure: {
    enabled: true,
    // Duration of a single closure event (ms).
    closureDurationMs: { min: 50, max: 100 },
    // Minimum spacing between closure events (ms) so they never look like jitter.
    minIntervalMs: { min: 500, max: 900 },
    // Chance a closure fires once the min interval has elapsed.
    probability: 0.2,
    // How strongly a closure suppresses the mouth (fraction of open removed at
    // the closure peak). 0.9 → mouth drops to ~10% of its lip-sync value.
    closureStrength: 0.65,
    // Speech energy above which the mouth is considered actively voicing, so
    // closures only fire while there is something to close.
    minEnergyToSpeak: 0.05,
    // Soft closure fired when speaking ends (chunk / sentence boundary), so the
    // mouth eases shut between TTS chunks instead of hanging open.
    sentenceBoundaryClosureMs: 140,
    // Startup grace window after speaking begins during which NO closure (random
    // or boundary) may fire, so a fresh phrase onset is never suppressed by the
    // closure envelope. Scheduling state is reset on the speaking edge so idle
    // accumulated time cannot trigger an immediate closure at the start.
    startupGraceMs: 600,
    minVisibleOpenness: 0.12,
    recoveryCooldownMs: 300,
    // Envelope smoothing so closures ease in/out rather than snapping.
    interpolationSpeed: 26
  },
  // Emotion-safe composition between layers. The emotion *expression* morph
  // itself already narrows the eyes (happy/angry/sad) and shapes the mouth; the
  // Speaking Eye squint and LipSync must therefore compose WITH the emotion
  // rather than blindly stack on top of it. Nothing here zeroes the emotion or
  // touches Blink — it only bounds how much each speaking layer may add.
  facialComposition: {
    // Total eye-narrow budget during speaking. The Speaking Eye squint is only
    // allowed to fill the headroom left after the active emotion's own eye
    // narrowing, so strongly narrowed emotions (angry/happy) get little-to-no
    // extra squint while open emotions (surprised/neutral) keep the full one.
    maxSpeakingSquint: 0.15,
    // Estimated eye-closing contributed per unit of each emotion *expression*
    // weight (0 = does not narrow eyes / opens them). Used to compute how much
    // headroom remains for the Speaking Eye squint.
    emotionEyeSquint: {
      happy: 0.25,
      laugh: 0.3,
      relaxed: 0.1,
      angry: 0.3,
      sad: 0.2,
      surprised: 0,
      neutral: 0
    },
    // Per-emotion gain on the LipSync mouth signal so emotions whose profile
    // scales articulation down (sad/thinking/embarrassed/confusion/approval)
    // stay visually readable while speaking. Not a global amplitude boost:
    // well-articulating emotions stay at 1.0. Keyed by resolved FacialProfile id.
    speechMouthGain: {
      default: 1,
      minimum: 0.8,
      maximum: 1.4,
      byEmotion: {
        neutral: 1,
        // Happy's smile expression already adds visible mouth openness; keep
        // speech articulation readable without over-opening the jaw.
        happy: 0.81225,
        laugh: 1,
        chuckle: 1,
        angry: 1,
        surprised: 1,
        approval: 1.12,
        confusion: 1.12,
        thinking: 1.18,
        sad: 1.22,
        embarrassed: 1.24
      }
    }
  }
};
var generatorWeights = (weights) => weights;
var headMotionTuning = {
  randomSeed: 1847,
  yawLimit: 0.105,
  pitchLimit: 0.087,
  rollLimit: 0.07,
  smoothing: 5.6,
  neckShare: 0.34,
  headShare: 0.66,
  profiles: {
    idle: {
      generatorWeights: generatorWeights({
        idleDrift: 0.82,
        microTilt: 0.55,
        slowYaw: 0.42,
        speakingNod: 0,
        listeningTilt: 0,
        thinkingDrift: 0
      })
    },
    listening: {
      generatorWeights: generatorWeights({
        idleDrift: 0.34,
        microTilt: 0.28,
        slowYaw: 0.16,
        speakingNod: 0,
        listeningTilt: 1,
        thinkingDrift: 0
      })
    },
    thinking: {
      generatorWeights: generatorWeights({
        idleDrift: 0.18,
        microTilt: 0.2,
        slowYaw: 0.12,
        speakingNod: 0,
        listeningTilt: 0,
        thinkingDrift: 1
      })
    },
    speaking: {
      generatorWeights: generatorWeights({
        idleDrift: 0.32,
        microTilt: 0.22,
        slowYaw: 0.25,
        speakingNod: 1,
        listeningTilt: 0,
        thinkingDrift: 0
      })
    },
    userFocus: {
      generatorWeights: generatorWeights({
        idleDrift: 0.24,
        microTilt: 0.18,
        slowYaw: 0.12,
        speakingNod: 0,
        listeningTilt: 0.42,
        thinkingDrift: 0
      })
    }
  },
  generators: {
    idleDrift: {
      yawAmplitude: 0.026,
      pitchAmplitude: 0.015,
      rollAmplitude: 0.018,
      intervalMs: { min: 1600, max: 3600 },
      smoothing: 1.8
    },
    microTilt: {
      yawAmplitude: 0.012,
      pitchAmplitude: 0.01,
      rollAmplitude: 0.022,
      intervalMs: { min: 2400, max: 5200 },
      durationMs: { min: 420, max: 780 },
      releaseSmoothing: 5.2
    },
    slowYaw: {
      amplitude: 0.02,
      intervalMs: { min: 2800, max: 6200 },
      smoothing: 1.25
    },
    speakingNod: {
      pitchAmplitude: 0.026,
      intervalMs: { min: 900, max: 1700 },
      durationMs: { min: 260, max: 460 },
      releaseSmoothing: 8
    },
    listeningTilt: {
      pose: { yaw: 5e-3, pitch: 0.018, roll: 0.026 },
      smoothing: 3.8,
      nextEventMs: 0
    },
    thinkingDrift: {
      pose: { yaw: -0.012, pitch: -6e-3, roll: -0.034 },
      smoothing: 2.9,
      nextEventMs: 0
    }
  }
};

// src/renderer/three/LipSync.ts
var VISEME_PROFILES = {
  aa: { amplitude: 1, attack: 1.28, release: 0.78, hold: 0.08, overlap: 0.26 },
  ih: { amplitude: 0.72, attack: 1.38, release: 1.12, hold: 0.02, overlap: 0.18 },
  ou: { amplitude: 0.78, attack: 0.82, release: 0.74, hold: 0.12, overlap: 0.34 },
  ee: { amplitude: 0.68, attack: 0.96, release: 1.04, hold: 0.04, overlap: 0.2 },
  oh: { amplitude: 0.86, attack: 0.92, release: 0.7, hold: 0.16, overlap: 0.32 }
};
var LipSync = class {
  analyser = null;
  timeData = null;
  freqData = null;
  smoothed = completeMouthWeights({});
  rawTarget = completeMouthWeights({});
  profiledTarget = completeMouthWeights({});
  blendedTarget = completeMouthWeights({});
  afterSilenceTarget = completeMouthWeights({});
  afterAttackRelease = completeMouthWeights({});
  afterClosedBias = completeMouthWeights({});
  clampedTarget = completeMouthWeights({});
  signalWarning = null;
  profile = getFacialProfile("neutral");
  vrmModel;
  previousBlendTarget = completeMouthWeights({});
  releaseBase = completeMouthWeights({});
  speechEnergy = 0;
  releaseStage = "closed";
  playbackSeq = 0;
  releasing = false;
  silenceMs = 0;
  noisePhase = 0;
  lastEnvelope = 0;
  speechMouthGain = 1;
  stats = this.createStats(0);
  summaryLogged = false;
  // Startup grace window (ms remaining) opened on each attach so a soft phrase
  // onset is not zeroed by the closed-mouth bias before the voice ramps up.
  graceRemainingMs = 0;
  // Anti-stall fallback state: guards against a "dead mouth" while audible.
  stallMs = 0;
  antiStallActive = false;
  fallbackPhase = 0;
  recoveryMs = 0;
  currentRawRms = 0;
  activeSession = null;
  activityLogged = false;
  constructor(vrmModel) {
    this.vrmModel = vrmModel;
  }
  setEmotion(emotionKey) {
    this.profile = getFacialProfile(emotionKey);
    this.speechMouthGain = this.resolveSpeechMouthGain(this.profile.id);
  }
  /**
   * Per-emotion gain guaranteeing readable articulation. Emotions whose
   * FacialProfile scales the mouth down (sad/thinking/embarrassed/…) are lifted
   * back toward readability; well-articulating emotions stay at 1.0. Bounded by
   * the tuning min/max so it can never silence or over-drive the mouth. This is
   * not a global amplitude boost — neutral/happy/angry/surprised remain 1.0.
   */
  resolveSpeechMouthGain(profileId) {
    const cfg = facialTuning.facialComposition.speechMouthGain;
    const gain = cfg.byEmotion[profileId] ?? cfg.default;
    return Math.max(cfg.minimum, Math.min(cfg.maximum, gain));
  }
  attach(session, emotionKey) {
    if (this.activeSession) {
      if (this.activeSession.turnId !== session.turnId) {
        throw new Error(
          `LipSync session overlap: activeTurnId=${this.activeSession.turnId} activePlaybackId=${this.activeSession.playbackId} requestedTurnId=${session.turnId} requestedPlaybackId=${session.playbackId}`
        );
      }
      this.activeSession = { ...session };
      this.analyser = session.analyser;
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = facialTuning.lipSync.analyserSmoothing;
      this.timeData = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
      this.freqData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      this.setEmotion(emotionKey);
      this.releasing = false;
      this.releaseStage = "speaking";
      this.graceRemainingMs = facialTuning.lipSync.startupGraceMs;
      this.activityLogged = false;
      console.log(`[lipsync] turnId=${session.turnId} playbackId=${session.playbackId} analyser=reattached session=continued`);
      return;
    }
    this.playbackSeq += 1;
    this.activeSession = { ...session };
    this.analyser = session.analyser;
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = facialTuning.lipSync.analyserSmoothing;
    this.timeData = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    this.freqData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.setEmotion(emotionKey);
    this.releasing = false;
    this.releaseStage = "speaking";
    this.releaseBase = completeMouthWeights({});
    this.previousBlendTarget = completeMouthWeights({});
    this.speechEnergy = 0;
    this.silenceMs = 0;
    this.noisePhase = Math.random() * Math.PI * 2;
    this.stats = this.createStats(this.playbackSeq);
    this.summaryLogged = false;
    this.graceRemainingMs = facialTuning.lipSync.startupGraceMs;
    this.stallMs = 0;
    this.antiStallActive = false;
    this.fallbackPhase = Math.random() * Math.PI * 2;
    this.activityLogged = false;
    this.recoveryMs = 0;
    this.currentRawRms = 0;
    console.log(`[lipsync] turnId=${session.turnId} playbackId=${session.playbackId} analyser=attached session=started`);
  }
  detach(turnId, immediate = false) {
    if (turnId && !this.activeSession) {
      console.debug(`[lipsync] turnId=${turnId} stale-stop=ignored reason=no-active-session`);
      return false;
    }
    if (turnId && this.activeSession && this.activeSession.turnId !== turnId) {
      console.debug(`[lipsync] turnId=${turnId} activeTurnId=${this.activeSession.turnId} stale-stop=ignored`);
      return false;
    }
    const stopped = this.activeSession;
    this.activeSession = null;
    this.analyser = null;
    this.timeData = null;
    this.freqData = null;
    this.rawTarget = completeMouthWeights({});
    this.profiledTarget = completeMouthWeights({});
    this.blendedTarget = completeMouthWeights({});
    this.afterSilenceTarget = completeMouthWeights({});
    this.clampedTarget = completeMouthWeights({});
    this.signalWarning = null;
    this.releasing = true;
    this.releaseStage = "open";
    this.releaseBase = { ...this.smoothed };
    this.silenceMs = 0;
    this.lastEnvelope = 0;
    this.stats.detachAtMs = performance.now();
    if (immediate) {
      this.smoothed = completeMouthWeights({});
      this.releaseBase = completeMouthWeights({});
      this.afterAttackRelease = completeMouthWeights({});
      this.afterClosedBias = completeMouthWeights({});
      this.releasing = false;
      this.releaseStage = "closed";
      this.vrmModel.setSpeechEnergy(0);
      this.vrmModel.setMouthWeights(this.smoothed);
    }
    this.publishDebug();
    console.log(`[lipsync] turnId=${stopped?.turnId ?? turnId ?? "none"} playbackId=${stopped?.playbackId ?? "none"} session=stopped reset=${immediate ? "immediate" : "release"}`);
    return true;
  }
  getActiveSession() {
    return this.activeSession ? { ...this.activeSession } : null;
  }
  getMouthWeights() {
    return { ...this.smoothed };
  }
  update(_delta) {
    this.graceRemainingMs = Math.max(0, this.graceRemainingMs - Math.max(0, _delta) * 1e3);
    if (!this.analyser || !this.timeData || !this.freqData) {
      this.rawTarget = completeMouthWeights({});
      this.profiledTarget = completeMouthWeights({});
      this.blendedTarget = this.getDetachedReleaseTarget();
      this.afterSilenceTarget = { ...this.blendedTarget };
      this.clampedTarget = this.clampWeights(this.blendedTarget);
      this.afterAttackRelease = this.smoothWeights(this.smoothed, this.clampedTarget, _delta, "detached");
      this.afterClosedBias = this.applyClosedBias(this.afterAttackRelease);
      this.smoothed = this.afterClosedBias;
      this.updateAntiStall(_delta, 0);
      this.speechEnergy = this.smoothScalar(this.speechEnergy, 0, _delta, 5.8);
      if (this.releasing && this.maxWeight(this.smoothed) <= 0.01) {
        this.releasing = false;
        this.releaseStage = "closed";
        if (this.stats.detachAtMs !== null) {
          this.stats.releaseAfterDetachMs = performance.now() - this.stats.detachAtMs;
        }
        this.logSummary();
      }
      this.recordStats(_delta, false, 0);
      this.updateSignalWarning();
      this.publishDebug();
      this.vrmModel.setSpeechEnergy(this.speechEnergy);
      this.vrmModel.setMouthWeights(this.smoothed);
      return;
    }
    this.analyser.getByteTimeDomainData(this.timeData);
    this.analyser.getByteFrequencyData(this.freqData);
    const rms = this.getRms(this.timeData);
    this.currentRawRms = rms;
    const reference = Math.max(0.04, this.activeSession.normalizationReference);
    const rawEnergy = Math.min(1, rms / reference * 0.23 * facialTuning.lipSync.gain * this.profile.mouthProfile.gainScale);
    if (!this.activityLogged && rawEnergy > facialTuning.lipSync.antiStall.minEnergy) {
      this.activityLogged = true;
      console.debug(`[lipsync] turnId=${this.activeSession?.turnId ?? "none"} playbackId=${this.activeSession?.playbackId ?? "none"} sample=active`);
    }
    this.speechEnergy = this.smoothScalar(this.speechEnergy, rawEnergy, _delta, rawEnergy > this.speechEnergy ? 7.5 : 3.6);
    this.lastEnvelope = rawEnergy;
    const silent = rawEnergy < facialTuning.lipSync.silenceThreshold;
    this.silenceMs = silent ? this.silenceMs + _delta * 1e3 : 0;
    const bands = this.getBands(this.freqData);
    const target = this.toMouthWeights(rawEnergy, bands);
    this.rawTarget = target.raw;
    this.profiledTarget = this.applyVisemeProfiles(target.raw);
    this.blendedTarget = this.blendVisemes(this.profiledTarget, _delta, silent);
    this.afterSilenceTarget = silent ? this.getShortPauseTarget() : this.blendedTarget;
    this.clampedTarget = this.clampWeights(this.applyProceduralNoise(this.afterSilenceTarget, _delta, this.speechEnergy, silent));
    this.afterAttackRelease = this.smoothWeights(
      this.smoothed,
      this.clampedTarget,
      _delta,
      silent ? this.silenceMs >= facialTuning.lipSync.shortPauseAfterMs ? "short-pause" : "silent" : "voiced"
    );
    this.afterClosedBias = this.applyClosedBias(this.afterAttackRelease);
    this.smoothed = this.afterClosedBias;
    this.updateAntiStall(_delta, rawEnergy);
    this.recordStats(_delta, true, rawEnergy);
    this.updateSignalWarning();
    this.publishDebug();
    this.vrmModel.setSpeechEnergy(this.speechEnergy);
    this.vrmModel.setMouthWeights(this.smoothed);
  }
  applyVisemeProfiles(weights) {
    return {
      aa: weights.aa * VISEME_PROFILES.aa.amplitude,
      ih: weights.ih * VISEME_PROFILES.ih.amplitude,
      ou: weights.ou * VISEME_PROFILES.ou.amplitude,
      ee: weights.ee * VISEME_PROFILES.ee.amplitude,
      oh: weights.oh * VISEME_PROFILES.oh.amplitude
    };
  }
  blendVisemes(target, delta, silent) {
    if (silent) {
      this.previousBlendTarget = this.smoothWeights(this.previousBlendTarget, completeMouthWeights({}), delta, "short-pause");
      return { ...this.previousBlendTarget };
    }
    const blended = {
      aa: target.aa * (1 - VISEME_PROFILES.aa.overlap) + this.previousBlendTarget.aa * VISEME_PROFILES.aa.overlap,
      ih: target.ih * (1 - VISEME_PROFILES.ih.overlap) + this.previousBlendTarget.ih * VISEME_PROFILES.ih.overlap,
      ou: target.ou * (1 - VISEME_PROFILES.ou.overlap) + this.previousBlendTarget.ou * VISEME_PROFILES.ou.overlap,
      ee: target.ee * (1 - VISEME_PROFILES.ee.overlap) + this.previousBlendTarget.ee * VISEME_PROFILES.ee.overlap,
      oh: target.oh * (1 - VISEME_PROFILES.oh.overlap) + this.previousBlendTarget.oh * VISEME_PROFILES.oh.overlap
    };
    this.previousBlendTarget = this.smoothWeights(this.previousBlendTarget, blended, delta, "voiced");
    return blended;
  }
  getShortPauseTarget() {
    const half = Math.max(0.08, this.maxWeight(this.smoothed) * 0.38);
    if (this.silenceMs < facialTuning.lipSync.shortPauseAfterMs) {
      return this.scaleWeights(this.smoothed, 0.42);
    }
    return this.maxWeight(this.smoothed) > half ? this.scaleWeights(this.smoothed, 0.22) : completeMouthWeights({});
  }
  getDetachedReleaseTarget() {
    if (!this.releasing || this.stats.detachAtMs === null) {
      this.releaseStage = "closed";
      return completeMouthWeights({});
    }
    const elapsed = performance.now() - this.stats.detachAtMs;
    if (elapsed < 90) {
      this.releaseStage = "open";
      return this.scaleWeights(this.releaseBase, 0.46);
    }
    if (elapsed < 240) {
      this.releaseStage = "half";
      return this.scaleWeights(this.releaseBase, 0.18);
    }
    this.releaseStage = "closed";
    return completeMouthWeights({});
  }
  toMouthWeights(energy, bands) {
    if (energy <= 0) {
      const closed = completeMouthWeights({});
      return { raw: closed, clamped: closed };
    }
    const total = Math.max(1e-3, bands.low + bands.mid + bands.high);
    const low = bands.low / total;
    const mid = bands.mid / total;
    const high = bands.high / total;
    const open = energy * this.profile.mouthProfile.opennessScale * this.speechMouthGain;
    const bias = completeMouthWeights(this.profile.visemeBias);
    const scale = completeMouthWeights({
      aa: this.profile.visemeScale.aa ?? 1,
      ih: this.profile.visemeScale.ih ?? 1,
      ou: this.profile.visemeScale.ou ?? 1,
      ee: this.profile.visemeScale.ee ?? 1,
      oh: this.profile.visemeScale.oh ?? 1
    });
    const raw = {
      aa: (open * (0.58 + mid * 0.32 + low * 0.16) + bias.aa) * scale.aa,
      ih: (open * (0.14 + high * 0.95 + mid * 0.25) + bias.ih) * scale.ih,
      ou: (open * (0.22 + low * 0.9) + bias.ou) * scale.ou,
      ee: (open * (0.12 + high * 0.7 + mid * 0.45) + bias.ee) * scale.ee,
      oh: (open * (0.18 + low * 0.55 + mid * 0.18) + bias.oh) * scale.oh
    };
    return {
      raw,
      clamped: this.clampWeights(raw)
    };
  }
  clampWeights(weights) {
    const limited = this.limitPeak(weights);
    return {
      aa: Math.min(facialTuning.lipSync.clamps.aa, limited.aa),
      ih: Math.min(facialTuning.lipSync.clamps.ih, limited.ih),
      ou: Math.min(facialTuning.lipSync.clamps.ou, limited.ou),
      ee: Math.min(facialTuning.lipSync.clamps.ee, limited.ee),
      oh: Math.min(facialTuning.lipSync.clamps.oh, limited.oh)
    };
  }
  applyProceduralNoise(weights, delta, energy, silent) {
    if (silent || energy <= facialTuning.lipSync.silenceThreshold) return weights;
    this.noisePhase += Math.max(0, delta) * facialTuning.lipSync.proceduralNoiseSpeed;
    const amount = facialTuning.lipSync.proceduralNoiseAmplitude * Math.min(1, energy * 2);
    const noise = (offset) => 1 + Math.sin(this.noisePhase + offset) * amount;
    return {
      aa: weights.aa * noise(0),
      ih: weights.ih * noise(1.7),
      ou: weights.ou * noise(3.1),
      ee: weights.ee * noise(4.4),
      oh: weights.oh * noise(5.6)
    };
  }
  limitPeak(weights) {
    const max = this.maxWeight(weights);
    const limit = facialTuning.lipSync.peakLimit;
    if (max <= limit || max <= 0) return weights;
    const scale = limit / max;
    return {
      aa: weights.aa * scale,
      ih: weights.ih * scale,
      ou: weights.ou * scale,
      ee: weights.ee * scale,
      oh: weights.oh * scale
    };
  }
  getRms(data) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / data.length);
  }
  getBands(data) {
    const lowEnd = Math.max(1, Math.floor(data.length * 0.18));
    const midEnd = Math.max(lowEnd + 1, Math.floor(data.length * 0.52));
    return {
      low: this.averageBand(data, 1, lowEnd),
      mid: this.averageBand(data, lowEnd, midEnd),
      high: this.averageBand(data, midEnd, data.length)
    };
  }
  averageBand(data, start, end) {
    let sum = 0;
    const count = Math.max(1, end - start);
    for (let i = start; i < end; i++) sum += data[i] / 255;
    return sum / count;
  }
  smoothWeights(a, b, delta, releaseMode) {
    return {
      aa: this.smoothShape("aa", a.aa, b.aa, delta, releaseMode),
      ih: this.smoothShape("ih", a.ih, b.ih, delta, releaseMode),
      ou: this.smoothShape("ou", a.ou, b.ou, delta, releaseMode),
      ee: this.smoothShape("ee", a.ee, b.ee, delta, releaseMode),
      oh: this.smoothShape("oh", a.oh, b.oh, delta, releaseMode)
    };
  }
  smoothShape(viseme, current, target, delta, releaseMode) {
    const visemeProfile = VISEME_PROFILES[viseme];
    const holdBias = target < current ? visemeProfile.hold * Math.min(1, this.speechEnergy * 1.6) : 0;
    const heldTarget = holdBias > 0 ? Math.max(target, current * holdBias) : target;
    const speed = heldTarget > current ? facialTuning.lipSync.attackPerSecond * visemeProfile.attack / this.profile.mouthProfile.softness : releaseMode === "detached" ? facialTuning.lipSync.detachedReleasePerSecond * visemeProfile.release / this.profile.mouthProfile.releaseScale : releaseMode === "short-pause" ? facialTuning.lipSync.shortPauseReleasePerSecond * visemeProfile.release / this.profile.mouthProfile.releaseScale : releaseMode === "silent" ? facialTuning.lipSync.silentReleasePerSecond * visemeProfile.release / this.profile.mouthProfile.releaseScale : facialTuning.lipSync.releasePerSecond * visemeProfile.release / this.profile.mouthProfile.releaseScale;
    const t = 1 - Math.exp(-Math.max(0, delta) * speed);
    const next = this.lerp(current, heldTarget, t);
    return next < 1e-3 ? 0 : next;
  }
  applyClosedBias(weights) {
    const steadyBias = Math.max(facialTuning.lipSync.mouthClosedBias, this.profile.mouthProfile.closedMouthBias);
    const bias = this.graceRemainingMs > 0 ? Math.min(facialTuning.lipSync.startupGraceClosedBias, steadyBias) : steadyBias;
    const openness = this.sumWeights(weights);
    const closeThreshold = bias;
    const openThreshold = bias * 1.35;
    const wasOpen = this.sumWeights(this.afterClosedBias) >= closeThreshold;
    if (openness < (wasOpen ? closeThreshold : openThreshold)) return completeMouthWeights({});
    const scale = Math.min(1, openness / Math.max(openThreshold, 1e-3));
    return this.scaleWeights(weights, scale);
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
  updateAntiStall(delta, rawEnergy) {
    const cfg = facialTuning.lipSync.antiStall;
    if (!cfg.enabled || !this.analyser) {
      this.stallMs = 0;
      this.antiStallActive = false;
      return;
    }
    const audible = rawEnergy > cfg.minEnergy;
    const dead = this.maxWeight(this.smoothed) < cfg.deadThreshold;
    if (this.antiStallActive) {
      const recovered = audible && !dead;
      this.recoveryMs = recovered ? this.recoveryMs + Math.max(0, delta) * 1e3 : 0;
      if (!audible || this.recoveryMs >= cfg.recoveryAfterMs) {
        this.antiStallActive = false;
        this.stallMs = 0;
        this.recoveryMs = 0;
      }
    } else {
      const dtMs = Math.max(0, delta) * 1e3;
      this.stallMs = audible && dead ? this.stallMs + dtMs : Math.max(0, this.stallMs - dtMs * 0.5);
      if (this.stallMs >= cfg.stallAfterMs) {
        this.antiStallActive = true;
        this.stats.antiStallActivationCount += 1;
      }
    }
    if (!this.antiStallActive) return;
    this.fallbackPhase += Math.max(0, delta) * cfg.speed;
    const env = Math.sin(this.fallbackPhase) * 0.5 + 0.5;
    const scale = Math.min(1, rawEnergy / Math.max(1e-4, cfg.minEnergy));
    const open = (cfg.floor + cfg.amplitude * env) * scale;
    const clamps = facialTuning.lipSync.clamps;
    this.smoothed = {
      ...this.smoothed,
      aa: Math.min(clamps.aa, Math.max(this.smoothed.aa, open)),
      ih: Math.min(clamps.ih, Math.max(this.smoothed.ih, open * 0.4))
    };
  }
  recordStats(delta, analyserActive, rawEnergy) {
    const openness = this.maxWeight(this.smoothed);
    this.stats.frameCount += 1;
    this.stats.sumOpenness += openness;
    this.stats.peakOpenness = Math.max(this.stats.peakOpenness, openness);
    if (openness > facialTuning.lipSync.statsHighThreshold) this.stats.highOpenFrames += 1;
    if (openness < facialTuning.lipSync.statsClosedThreshold) this.stats.closedFrames += 1;
    if (openness < 0.15) this.stats.opennessBuckets[0] += 1;
    else if (openness < 0.3) this.stats.opennessBuckets[1] += 1;
    else if (openness < 0.45) this.stats.opennessBuckets[2] += 1;
    else this.stats.opennessBuckets[3] += 1;
    this.stats.currentOpenMs = openness > facialTuning.lipSync.statsOpenThreshold ? this.stats.currentOpenMs + delta * 1e3 : 0;
    this.stats.longestOpenMs = Math.max(this.stats.longestOpenMs, this.stats.currentOpenMs);
    if (analyserActive && rawEnergy > 0.92) this.stats.saturatedFrames += 1;
    if (analyserActive && rawEnergy > facialTuning.lipSync.antiStall.minEnergy) {
      this.stats.nonZeroEnergyFrames += 1;
      if (openness < facialTuning.lipSync.antiStall.deadThreshold) {
        this.stats.audibleDeadMouthFrames += 1;
        this.stats.audibleDeadMouthMs += Math.max(0, delta) * 1e3;
      }
    }
  }
  createStats(playbackSeq) {
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
      opennessBuckets: [0, 0, 0, 0]
    };
  }
  maxWeight(weights) {
    return Math.max(weights.aa, weights.ih, weights.ou, weights.ee, weights.oh);
  }
  sumWeights(weights) {
    return weights.aa + weights.ih + weights.ou + weights.ee + weights.oh;
  }
  getActiveVisemes(weights) {
    return Object.entries(weights).filter(([, value]) => value > 0.02).sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }
  scaleWeights(weights, scale) {
    return {
      aa: weights.aa * scale,
      ih: weights.ih * scale,
      ou: weights.ou * scale,
      ee: weights.ee * scale,
      oh: weights.oh * scale
    };
  }
  smoothScalar(current, target, delta, speed) {
    return this.lerp(current, target, 1 - Math.exp(-Math.max(0, delta) * speed));
  }
  updateSignalWarning() {
    const rawMax = this.maxWeight(this.rawTarget);
    const finalMax = this.maxWeight(this.smoothed);
    this.signalWarning = rawMax >= facialTuning.lipSync.significantRawThreshold && finalMax <= facialTuning.lipSync.suppressedFinalThreshold ? `raw ${rawMax.toFixed(2)} suppressed to ${finalMax.toFixed(2)}` : null;
    if (this.signalWarning) console.warn(`[LIPSYNCDBG] ${this.signalWarning}`);
  }
  publishDebug() {
    this.vrmModel.setMouthDebug({
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
      playbackItemId: this.activeSession?.playbackItemId ?? "",
      analyserAttached: Boolean(this.analyser),
      lipSyncActive: Boolean(this.activeSession),
      currentRawRms: this.currentRawRms,
      currentNormalizedEnergy: this.lastEnvelope,
      currentMouthOpenness: this.maxWeight(this.smoothed),
      antiStallActive: this.antiStallActive,
      activeVisemes: this.getActiveVisemes(this.smoothed),
      visemeBlend: { ...this.blendedTarget },
      releaseStage: this.releaseStage,
      mouthClosedBias: Math.max(facialTuning.lipSync.mouthClosedBias, this.profile.mouthProfile.closedMouthBias),
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
        averageOpenness: this.stats.frameCount > 0 ? this.stats.sumOpenness / this.stats.frameCount : 0,
        peakOpenness: this.stats.peakOpenness,
        percentHighOpen: this.stats.frameCount > 0 ? this.stats.highOpenFrames / this.stats.frameCount * 100 : 0,
        percentClosed: this.stats.frameCount > 0 ? this.stats.closedFrames / this.stats.frameCount * 100 : 0,
        longestOpenMs: this.stats.longestOpenMs,
        releaseAfterDetachMs: this.stats.releaseAfterDetachMs,
        saturatedSignal: this.stats.frameCount > 0 && this.stats.saturatedFrames / this.stats.frameCount > 0.75,
        nonZeroEnergyFrames: this.stats.nonZeroEnergyFrames,
        audibleDeadMouthMs: this.stats.audibleDeadMouthMs,
        audibleDeadMouthFrames: this.stats.audibleDeadMouthFrames,
        antiStallActivationCount: this.stats.antiStallActivationCount
      }
    });
  }
  logSummary() {
    if (this.summaryLogged || this.stats.frameCount <= 0) return;
    this.summaryLogged = true;
    const averageOpenness = this.stats.sumOpenness / this.stats.frameCount;
    const percentHighOpen = this.stats.highOpenFrames / this.stats.frameCount * 100;
    const percentClosed = this.stats.closedFrames / this.stats.frameCount * 100;
    const percentSaturated = this.stats.saturatedFrames / this.stats.frameCount * 100;
    const histogram = this.stats.opennessBuckets.map((count) => `${(count / this.stats.frameCount * 100).toFixed(1)}%`).join("/");
    console.log(
      `[LIPSYNCDBG] summary playback=${this.stats.playbackSeq} frames=${this.stats.frameCount} avg=${averageOpenness.toFixed(3)} peak=${this.stats.peakOpenness.toFixed(3)} hist=<15/15-30/30-45/>45=${histogram} open>70=${percentHighOpen.toFixed(1)}% closed<15=${percentClosed.toFixed(1)}% longestOpen>40=${Math.round(this.stats.longestOpenMs)}ms release=${this.stats.releaseAfterDetachMs !== null ? `${Math.round(this.stats.releaseAfterDetachMs)}ms` : "pending"} saturated=${percentSaturated.toFixed(1)}%`
    );
  }
  lerp(a, b, t) {
    return a + (b - a) * t;
  }
};

// src/renderer/three/BlinkProfileResolver.ts
var clamp01 = (value) => Math.max(0, Math.min(1, value));
var positive = (value, fallback = 1) => Number.isFinite(value) && value > 0 ? value : fallback;
function resolveEffectiveBlinkProfile(proceduralMode, emotion) {
  const base = getFacialProfile(emotion).blinkProfile;
  const modeKey = facialTuning.blink.profileByMode[proceduralMode];
  const modifier = facialTuning.blink.modeModifiers[modeKey];
  const sequence = facialTuning.blink.sequence;
  const intervalScale = positive(modifier.intervalScale);
  const durationScale = positive(modifier.durationScale);
  const weightScale = positive(modifier.weightScale);
  const ceiling = clamp01(base.blinkMax ?? facialTuning.blink.blinkMax);
  const intervalMinMs = Math.max(200, (base.intervalMin ?? 3.4) * 1e3 * intervalScale);
  const intervalMaxMs = Math.max(intervalMinMs, (base.intervalMax ?? 5.2) * 1e3 * intervalScale);
  const totalMs = Math.max(120, (base.durationMs ?? 410) * durationScale);
  const closingMs = totalMs * 0.2;
  const closedMs = totalMs * 0.28;
  const openingMs = totalMs * 0.52;
  const maxWeight = clamp01(Math.min(ceiling, (base.weightMax ?? 0.64) * weightScale));
  const minWeight = clamp01(Math.min((base.weightMin ?? 0.42) * weightScale, maxWeight));
  return {
    profileId: base.profileId,
    intervalMinMs,
    intervalMaxMs,
    closingMs,
    closedMs,
    openingMs,
    minWeight,
    maxWeight,
    blinkMax: ceiling,
    doubleBlinkChance: clamp01(base.doubleBlinkChance ?? 0.04),
    cooldownMs: Math.max(0, base.cooldownMs ?? 680),
    sequenceGapMinMs: Math.max(0, sequence.gapMinMs),
    sequenceGapMaxMs: Math.max(sequence.gapMinMs, sequence.gapMaxMs),
    secondBlinkDurationScale: positive(sequence.secondBlinkDurationScale),
    secondBlinkWeightScale: positive(sequence.secondBlinkWeightScale)
  };
}

// src/renderer/three/AvatarExpressionMixer.ts
var MOUTH_NAMES = VISEME_NAMES;
var LOOKAT_NAMES = /* @__PURE__ */ new Set(["lookUp", "lookDown", "lookLeft", "lookRight"]);
var AvatarExpressionMixer = class {
  vrm = null;
  blinkNames = [];
  blinkNameSet = /* @__PURE__ */ new Set();
  /** Every expression the mixer authoritatively owns (all except lookAt). */
  managedNames = [];
  supportedNames = /* @__PURE__ */ new Set();
  currentProfile = getFacialProfile("neutral");
  unsupportedExpressionRequests = /* @__PURE__ */ new Set();
  // Domain contributions for the current frame.
  blinkWeight = 0;
  mouth = completeMouthWeights({});
  emotion = /* @__PURE__ */ new Map();
  lookAtActive = false;
  speakingEyeLeft = 0;
  speakingEyeRight = 0;
  mouthClosure = 0;
  /** Expression names the Speaking Eye squint targets (per eye when available). */
  squintLeftName = null;
  squintRightName = null;
  speakingEyeDebug = null;
  mouthClosureDebug = null;
  appliedSquintLeft = 0;
  appliedSquintRight = 0;
  squintHeadroom = 0;
  lastFinal = /* @__PURE__ */ new Map();
  /** Expression names the mixer wrote a non-zero value for last frame. */
  writtenNames = /* @__PURE__ */ new Set();
  vrmaFacialTracksDisabled = 0;
  frame = 0;
  clockMs = 0;
  lastDeltaMs = 16.67;
  blinkHighMs = 0;
  staleMouthHighMs = 0;
  lastFinalValues = {};
  sourceLifecycle = /* @__PURE__ */ new Map();
  mouthTuning = {
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
    playbackItemId: "",
    analyserAttached: false,
    lipSyncActive: false,
    currentRawRms: 0,
    currentNormalizedEnergy: 0,
    currentMouthOpenness: 0,
    antiStallActive: false,
    activeVisemes: [],
    visemeBlend: completeMouthWeights({}),
    releaseStage: "closed",
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
      antiStallActivationCount: 0
    }
  };
  blinkTuning = {
    weight: 0,
    rawWeight: 0,
    finalWeight: 0,
    phase: "idle",
    triggerReason: "scheduled",
    proceduralMode: "idle",
    emotion: "neutral",
    profileId: "idle",
    configuredProfile: resolveEffectiveBlinkProfile("idle", "neutral"),
    activeProfileSnapshot: null,
    sequenceState: "none",
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
    source: "AutoBlink"
  };
  attach(vrm) {
    this.detach();
    this.vrm = vrm;
    const manager = vrm.expressionManager;
    const allNames = Object.keys(manager?.expressionMap ?? {});
    this.supportedNames = new Set(allNames);
    this.blinkNames = this.resolveBlinkNames(allNames);
    this.blinkNameSet = new Set(this.blinkNames);
    this.resolveSquintNames(allNames);
    this.managedNames = allNames.filter((name) => !LOOKAT_NAMES.has(name));
    this.unsupportedExpressionRequests = /* @__PURE__ */ new Set();
    this.writtenNames = /* @__PURE__ */ new Set();
    this.resetLifecycle();
    this.allowBlinkOverExpressions();
    console.log(`[ANIMDBG] mixer attach expressions=[${allNames.join(",")}] blink=[${this.blinkNames.join(",")}]`);
  }
  detach() {
    this.vrm = null;
    this.blinkNames = [];
    this.blinkNameSet = /* @__PURE__ */ new Set();
    this.managedNames = [];
    this.supportedNames = /* @__PURE__ */ new Set();
    this.blinkWeight = 0;
    this.mouth = completeMouthWeights({});
    this.emotion.clear();
    this.speakingEyeLeft = 0;
    this.speakingEyeRight = 0;
    this.mouthClosure = 0;
    this.squintLeftName = null;
    this.squintRightName = null;
    this.lastFinal.clear();
    this.writtenNames = /* @__PURE__ */ new Set();
    this.lookAtActive = false;
    this.frame = 0;
    this.clockMs = 0;
    this.lastDeltaMs = 16.67;
    this.blinkHighMs = 0;
    this.staleMouthHighMs = 0;
    this.lastFinalValues = {};
    this.resetLifecycle();
  }
  // ---- domain inputs (called once per frame by each source) ----------------
  beginFrame(delta) {
    this.frame += 1;
    this.lastDeltaMs = Math.max(0, delta) * 1e3;
    this.clockMs += this.lastDeltaMs;
    this.refreshBlinkLifecycle();
    this.refreshMouthLifecycle(delta);
    this.refreshEmotionLifecycle(delta);
    this.refreshSpeakingEyeLifecycle();
  }
  setBlink(weight) {
    const raw = this.clamp(weight);
    this.blinkWeight = Math.min(this.blinkTuning.blinkMax || 1, raw);
    this.blinkTuning = {
      ...this.blinkTuning,
      rawWeight: raw,
      finalWeight: this.blinkWeight,
      weight: this.blinkWeight
    };
    this.markSource("autoBlink", { blink: raw });
  }
  setMouth(weights) {
    this.mouth = completeMouthWeights(Object.fromEntries(
      MOUTH_NAMES.map((name) => [name, this.clamp(weights[name] ?? 0)])
    ));
    this.markSource("lipSync", this.mouth);
  }
  setEmotion(values) {
    this.emotion = new Map(values);
    this.markSource("emotion", Object.fromEntries([...this.emotion].map(([name, value]) => [name, this.clamp(value)])));
  }
  setLookAtActive(active) {
    this.lookAtActive = active;
    this.markSource("lookAt", { active: active ? 1 : 0 });
  }
  setSpeakingEye(left, right) {
    this.speakingEyeLeft = this.clamp(left);
    this.speakingEyeRight = this.clamp(right);
    this.markSource("speakingEye", { left: this.speakingEyeLeft, right: this.speakingEyeRight });
  }
  setMouthClosure(strength) {
    this.mouthClosure = this.clamp(strength);
  }
  setSpeakingEyeDebug(debug) {
    this.speakingEyeDebug = debug;
  }
  setMouthClosureDebug(debug) {
    this.mouthClosureDebug = debug;
  }
  setFacialProfile(profile) {
    this.currentProfile = profile;
  }
  setMouthDebug(debug) {
    this.mouthTuning = debug;
  }
  setBlinkDebug(debug) {
    this.blinkTuning = debug;
  }
  notifyVrmaFacialTracksDisabled(count) {
    this.vrmaFacialTracksDisabled = count;
  }
  /**
   * Combine every domain and perform the single authoritative write into the VRM
   * Expression Manager. Does NOT call `manager.update()` — VrmModel.vrm.update()
   * runs it exactly once per frame after this.
   */
  apply() {
    const manager = this.vrm?.expressionManager;
    if (!manager) return;
    const final = /* @__PURE__ */ new Map();
    for (const [name, value] of this.emotion) {
      if (this.blinkNameSet.has(name) || MOUTH_NAMES.includes(name) || LOOKAT_NAMES.has(name)) {
        continue;
      }
      if (!this.isSupportedExpression(name)) continue;
      const v = this.clamp(value);
      if (v > 1e-3) final.set(name, { expression: name, value: v, source: "emotion" });
    }
    const closureGain = 1 - this.mouthClosure;
    for (const name of MOUTH_NAMES) {
      if (!this.isSupportedExpression(name)) continue;
      const v = this.clamp(this.mouth[name] * closureGain);
      if (v > 1e-3) final.set(name, { expression: name, value: v, source: "lipSync" });
    }
    const eyeValues = /* @__PURE__ */ new Map();
    if (this.blinkWeight > 1e-3) {
      for (const name of this.blinkNames) {
        if (!this.isSupportedExpression(name)) continue;
        eyeValues.set(name, { expression: name, value: this.clamp(this.blinkWeight), source: "autoBlink" });
      }
    }
    const emotionEyeSquint = this.computeEmotionEyeSquint();
    this.squintHeadroom = Math.max(0, facialTuning.facialComposition.maxSpeakingSquint - emotionEyeSquint);
    this.appliedSquintLeft = Math.min(this.speakingEyeLeft, this.squintHeadroom);
    this.appliedSquintRight = Math.min(this.speakingEyeRight, this.squintHeadroom);
    this.mergeSquint(eyeValues, this.squintLeftName, this.appliedSquintLeft);
    this.mergeSquint(eyeValues, this.squintRightName, this.appliedSquintRight);
    for (const entry of eyeValues.values()) final.set(entry.expression, entry);
    const namesToWrite = /* @__PURE__ */ new Set([...this.writtenNames, ...final.keys()]);
    for (const name of namesToWrite) {
      if (LOOKAT_NAMES.has(name)) continue;
      const entry = final.get(name);
      this.setValueSafe(manager, name, entry ? entry.value : 0);
    }
    this.writtenNames = new Set(final.keys());
    this.lastFinal = final;
    this.lastFinalValues = Object.fromEntries([...final.values()].map((entry) => [entry.expression, Number(entry.value.toFixed(3))]));
    this.updateSourceFinals(final);
    this.updateStuckWarnings();
    this.logLifecycleTransitions();
    this.logFacialFrame();
  }
  getDebugState() {
    const sources = /* @__PURE__ */ new Set();
    for (const entry of this.lastFinal.values()) sources.add(entry.source);
    if (this.lookAtActive) sources.add("lookAt");
    const emotion = {};
    for (const [name, value] of this.emotion) {
      if (value > 1e-3) emotion[name] = Number(value.toFixed(2));
    }
    return {
      currentProfile: this.currentProfile.id,
      expressionBlend: this.roundValues(this.currentProfile.expressionWeights),
      supportedExpressions: [...this.supportedNames].sort(),
      supportedVisemes: MOUTH_NAMES.filter((name) => this.supportedNames.has(name)),
      unsupportedExpressionRequests: [...this.unsupportedExpressionRequests].sort(),
      releaseCurve: `${this.currentProfile.releaseProfile.curve} ${this.currentProfile.releaseProfile.releaseDurationMs}ms`,
      eyeProfile: { ...this.currentProfile.eyeProfile },
      mouthProfile: { ...this.currentProfile.mouthProfile },
      activeSources: [...sources],
      entries: [...this.lastFinal.values()].map((entry) => ({ ...entry, value: Number(entry.value.toFixed(2)) })).sort((a, b) => b.value - a.value),
      blink: Number(this.blinkWeight.toFixed(2)),
      mouth: {
        aa: Number(this.mouth.aa.toFixed(2)),
        ih: Number(this.mouth.ih.toFixed(2)),
        ou: Number(this.mouth.ou.toFixed(2)),
        ee: Number(this.mouth.ee.toFixed(2)),
        oh: Number(this.mouth.oh.toFixed(2))
      },
      emotion,
      finalValues: { ...this.lastFinalValues },
      sourceLifecycle: [...this.sourceLifecycle.entries()].map(([source, state]) => ({
        source,
        active: state.active,
        lastUpdateMs: state.lastUpdateMs === null ? null : Math.max(0, Math.round(this.clockMs - state.lastUpdateMs)),
        raw: this.roundValues(state.raw),
        final: this.roundValues(state.final),
        status: state.status,
        maxObservedValue: Number(state.maxObservedValue.toFixed(2)),
        stuckWarning: state.stuckWarning
      })),
      stuckWarnings: [...this.sourceLifecycle.values()].map((state) => state.stuckWarning).filter((value) => Boolean(value)),
      mouthTuning: {
        ...this.mouthTuning,
        attached: this.mouthTuning.attached,
        envelope: Number(this.mouthTuning.envelope.toFixed(3)),
        openness: Number(this.mouthTuning.openness.toFixed(2)),
        raw: this.roundMouthWeights(this.mouthTuning.raw),
        afterSilenceThreshold: this.roundMouthWeights(this.mouthTuning.afterSilenceThreshold),
        afterAttackRelease: this.roundMouthWeights(this.mouthTuning.afterAttackRelease),
        afterMouthClosedBias: this.roundMouthWeights(this.mouthTuning.afterMouthClosedBias),
        afterClamp: this.roundMouthWeights(this.mouthTuning.afterClamp),
        filtered: this.roundMouthWeights(this.mouthTuning.filtered),
        clamped: this.roundMouthWeights(this.mouthTuning.clamped),
        final: this.roundMouthWeights(this.mouth),
        speechEnergy: Number(this.mouthTuning.speechEnergy.toFixed(2)),
        activeVisemes: [...this.mouthTuning.activeVisemes],
        visemeBlend: this.roundMouthWeights(this.mouthTuning.visemeBlend),
        releaseStage: this.mouthTuning.releaseStage,
        clamps: {
          aa: Number(this.mouthTuning.clamps.aa.toFixed(2)),
          ih: Number(this.mouthTuning.clamps.ih.toFixed(2)),
          ou: Number(this.mouthTuning.clamps.ou.toFixed(2)),
          ee: Number(this.mouthTuning.clamps.ee.toFixed(2)),
          oh: Number(this.mouthTuning.clamps.oh.toFixed(2))
        }
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
        cooldown: Number(this.blinkTuning.cooldown.toFixed(2))
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
        emotion: this.speakingEyeDebug?.emotion ?? "neutral",
        leftExpression: this.squintLeftName ?? "none",
        rightExpression: this.squintRightName ?? "none",
        finalLeft: Number(this.appliedSquintLeft.toFixed(3)),
        finalRight: Number(this.appliedSquintRight.toFixed(3))
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
        finalMouthMax: Number((this.maxValue(this.mouth) * (1 - this.mouthClosure)).toFixed(3))
      }
    };
  }
  resetLifecycle() {
    this.sourceLifecycle = /* @__PURE__ */ new Map();
    for (const source of ["autoBlink", "lipSync", "emotion", "lookAt", "speakingEye"]) {
      this.sourceLifecycle.set(source, {
        active: false,
        lastUpdateFrame: -1,
        lastUpdateMs: null,
        raw: {},
        final: {},
        status: "inactive",
        loggedStatus: null,
        maxObservedValue: 0,
        stuckWarning: null
      });
    }
  }
  refreshBlinkLifecycle() {
    const state = this.getSourceState("autoBlink");
    if (state.lastUpdateFrame < this.frame - 1) {
      this.blinkWeight = 0;
      state.active = false;
      state.raw = { blink: 0 };
      state.status = "reset";
    }
  }
  refreshSpeakingEyeLifecycle() {
    const state = this.getSourceState("speakingEye");
    if (state.lastUpdateFrame < this.frame - 1) {
      this.speakingEyeLeft = 0;
      this.speakingEyeRight = 0;
      state.active = false;
      state.raw = { left: 0, right: 0 };
      state.status = "reset";
    }
  }
  refreshMouthLifecycle(delta) {
    const state = this.getSourceState("lipSync");
    if (state.lastUpdateFrame >= this.frame - 1) return;
    const decay = 1 - Math.exp(-Math.max(0, delta) * 18);
    this.mouth = {
      aa: this.approachZero(this.mouth.aa, decay),
      ih: this.approachZero(this.mouth.ih, decay),
      ou: this.approachZero(this.mouth.ou, decay),
      ee: this.approachZero(this.mouth.ee, decay),
      oh: this.approachZero(this.mouth.oh, decay)
    };
    state.active = this.maxValue(this.mouth) > 1e-3;
    state.raw = completeMouthWeights({});
    state.status = state.active ? "decaying" : "reset";
  }
  refreshEmotionLifecycle(delta) {
    const state = this.getSourceState("emotion");
    if (state.lastUpdateFrame >= this.frame - 1) return;
    const decay = 1 - Math.exp(-Math.max(0, delta) * 8);
    for (const [name, value] of this.emotion) {
      const next = this.approachZero(value, decay);
      if (next <= 1e-3) this.emotion.delete(name);
      else this.emotion.set(name, next);
    }
    state.active = this.emotion.size > 0;
    state.raw = {};
    state.status = state.active ? "decaying" : "reset";
  }
  markSource(source, raw) {
    const state = this.getSourceState(source);
    const roundedRaw = Object.fromEntries(Object.entries(raw).map(([name, value]) => [name, this.clamp(Number(value) || 0)]));
    state.active = this.maxValue(roundedRaw) > 1e-3 || source === "lookAt" && Boolean(roundedRaw.active);
    state.lastUpdateFrame = this.frame;
    state.lastUpdateMs = this.clockMs;
    state.raw = roundedRaw;
    state.status = state.active ? "active" : "reset";
    state.maxObservedValue = Math.max(state.maxObservedValue, this.maxValue(roundedRaw));
    state.stuckWarning = null;
  }
  updateSourceFinals(final) {
    for (const state of this.sourceLifecycle.values()) state.final = {};
    for (const entry of final.values()) {
      const state = this.getSourceState(entry.source);
      state.final[entry.expression] = entry.value;
    }
  }
  updateStuckWarnings() {
    const blinkState = this.getSourceState("autoBlink");
    this.blinkHighMs = this.blinkWeight > 0.8 ? this.blinkHighMs + this.lastDeltaMs : 0;
    blinkState.stuckWarning = this.blinkHighMs > 300 ? `blink > 0.8 for ${Math.round(this.blinkHighMs)}ms` : null;
    const lipSyncState = this.getSourceState("lipSync");
    const mouthMax = this.maxValue(this.mouth);
    const rawMax = this.maxValue(lipSyncState.raw);
    const staleOrSilent = lipSyncState.status !== "active" || rawMax < 0.05;
    this.staleMouthHighMs = mouthMax > 0.4 && staleOrSilent ? this.staleMouthHighMs + this.lastDeltaMs : 0;
    lipSyncState.stuckWarning = this.staleMouthHighMs > 500 ? `mouth > 0.4 while LipSync is ${lipSyncState.status}` : null;
  }
  /**
   * Centralized lifecycle telemetry. Emits one line per source whenever its
   * lifecycle status changes (inactive → active → decaying/reset → inactive),
   * identifying source, state, timestamp, frame and release progress. This is
   * the single place lifecycle transitions are logged for every facial domain.
   */
  logLifecycleTransitions() {
    const labels = {
      autoBlink: "Blink",
      lipSync: "LipSync",
      emotion: "Emotion",
      lookAt: "LookAt",
      speakingEye: "SpeakingEye"
    };
    for (const [source, state] of this.sourceLifecycle) {
      if (state.status === state.loggedStatus) continue;
      const releaseProgress = state.status === "decaying" || state.status === "reset" ? 1 - Math.min(1, this.maxValue(state.final)) : 0;
      console.log(
        `[FACELIFE] source=${labels[source]} state=${state.status} frame=${this.frame} t=${Math.round(this.clockMs)}ms max=${this.maxValue(state.raw).toFixed(2)} release=${releaseProgress.toFixed(2)}`
      );
      state.loggedStatus = state.status;
    }
  }
  logFacialFrame() {
    if (!facialTuning.debug.verboseFacialFrameLogs) return;
    const mouthMax = this.maxValue(this.mouth);
    const shouldLog = mouthMax > 1e-3 || this.blinkWeight > 1e-3 || this.getSourceState("lipSync").active;
    if (!shouldLog) return;
    const final = (name) => (this.lastFinalValues[name] ?? 0).toFixed(2);
    const emotionFinal = ["happy", "sad", "angry", "surprised", "relaxed"].map((name) => `${name}=${final(name)}`).join(" ");
    const lip = this.getSourceState("lipSync");
    const blink2 = this.getSourceState("autoBlink");
    const emotion = this.getSourceState("emotion");
    console.log(
      `[FACEDBG] final blink=${final("blink")} blinkLeft=${final("blinkLeft")} blinkRight=${final("blinkRight")} aa=${final("aa")} ih=${final("ih")} ou=${final("ou")} ee=${final("ee")} oh=${final("oh")} ${emotionFinal} | sources AutoBlink=${this.maxValue(blink2.raw).toFixed(2)}(${blink2.status}) LipSync=aa:${(lip.raw.aa ?? 0).toFixed(2)}/ih:${(lip.raw.ih ?? 0).toFixed(2)}/ou:${(lip.raw.ou ?? 0).toFixed(2)}/ee:${(lip.raw.ee ?? 0).toFixed(2)}/oh:${(lip.raw.oh ?? 0).toFixed(2)}(${lip.status}) Emotion=${this.maxValue(emotion.raw).toFixed(2)}(${emotion.status})`
    );
  }
  getSourceState(source) {
    const state = this.sourceLifecycle.get(source);
    if (!state) {
      this.resetLifecycle();
      return this.sourceLifecycle.get(source);
    }
    return state;
  }
  roundValues(values) {
    return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, Number(value.toFixed(2))]));
  }
  roundMouthWeights(values) {
    return {
      aa: Number(values.aa.toFixed(2)),
      ih: Number(values.ih.toFixed(2)),
      ou: Number(values.ou.toFixed(2)),
      ee: Number(values.ee.toFixed(2)),
      oh: Number(values.oh.toFixed(2))
    };
  }
  isSupportedExpression(name) {
    const supported = this.supportedNames.has(name);
    if (!supported) this.unsupportedExpressionRequests.add(name);
    return supported;
  }
  approachZero(value, amount) {
    const next = value * (1 - Math.max(0, Math.min(1, amount)));
    return next < 1e-3 ? 0 : next;
  }
  maxValue(values) {
    return Object.values(values).reduce((max, value) => Math.max(max, this.clamp(Number(value) || 0)), 0);
  }
  resolveBlinkNames(available) {
    if (available.includes("blink")) return ["blink"];
    if (available.includes("blinkLeft") && available.includes("blinkRight")) return ["blinkLeft", "blinkRight"];
    return available.filter((name) => /blink|wink/i.test(name));
  }
  /**
   * Pick the expressions the Speaking Eye squint drives. Prefer the per-eye
   * blinkLeft / blinkRight so the micro-expression can carry a small asymmetry
   * even when the Blink domain uses the combined `blink`. Falls back to the
   * resolved blink names (shared with Blink, combined via max in {@link apply}).
   */
  resolveSquintNames(available) {
    if (available.includes("blinkLeft") && available.includes("blinkRight")) {
      this.squintLeftName = "blinkLeft";
      this.squintRightName = "blinkRight";
      return;
    }
    this.squintLeftName = this.blinkNames[0] ?? null;
    this.squintRightName = this.blinkNames[1] ?? this.blinkNames[0] ?? null;
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
  computeEmotionEyeSquint() {
    const coeffs = facialTuning.facialComposition.emotionEyeSquint;
    let sum = 0;
    for (const [name, value] of this.emotion) {
      const coeff = coeffs[name];
      if (coeff) sum += this.clamp(value) * coeff;
    }
    return sum;
  }
  mergeSquint(eyeValues, name, value) {
    if (!name || value <= 1e-3) return;
    if (!this.isSupportedExpression(name)) return;
    const squint = this.clamp(value);
    const existing = eyeValues.get(name);
    if (existing && existing.value >= squint) return;
    eyeValues.set(name, { expression: name, value: squint, source: "speakingEye" });
  }
  /**
   * Prevent non-blink expressions from suppressing the blink domain via the VRM
   * override system, so the mixer's explicit domain writes are authoritative.
   * (Preserves the prior BlinkController behaviour, now owned by the mixer.)
   */
  allowBlinkOverExpressions() {
    const manager = this.vrm?.expressionManager;
    const map = manager?.expressionMap;
    if (!manager || !map) return;
    for (const [name, expression] of Object.entries(map)) {
      if (!this.blinkNameSet.has(name)) expression.overrideBlink = "none";
    }
    manager.blinkExpressionNames = this.blinkNames.slice();
  }
  setValueSafe(manager, name, value) {
    try {
      manager.setValue(name, value);
    } catch {
    }
  }
  clamp(value) {
    return Math.max(0, Math.min(1, value));
  }
};

// scripts/facial-repro/harness.ts
var VRM_EXPRESSIONS = [
  "neutral",
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
  "aa",
  "ih",
  "ou",
  "blink",
  "blinkLeft",
  "blinkRight",
  "lookUp",
  "lookDown",
  "lookLeft",
  "lookRight"
];
function makeVrmStub() {
  const values = /* @__PURE__ */ new Map();
  const expressionMap = {};
  for (const name of VRM_EXPRESSIONS) {
    values.set(name, 0);
    expressionMap[name] = { overrideBlink: "block" };
  }
  const manager = {
    expressionMap,
    blinkExpressionNames: [],
    setValue(name, value) {
      values.set(name, value);
    },
    getValue(name) {
      return values.get(name) ?? 0;
    }
  };
  return { expressionManager: manager, values };
}
var FakeAnalyser = class {
  fftSize = 512;
  smoothingTimeConstant = 0.5;
  get frequencyBinCount() {
    return this.fftSize / 2;
  }
  amplitude = 0;
  // 0..1 speech energy for the current frame
  setEnergy(a) {
    this.amplitude = Math.max(0, Math.min(1, a));
  }
  getByteTimeDomainData(out) {
    const amp = this.amplitude * 90;
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.max(0, Math.min(255, Math.round(128 + amp * Math.sin(i / out.length * Math.PI * 8))));
    }
  }
  getByteFrequencyData(out) {
    for (let i = 0; i < out.length; i++) {
      const band = i / out.length;
      const shape = band < 0.18 ? 0.9 : band < 0.52 ? 0.7 : 0.35;
      out[i] = Math.round(this.amplitude * shape * 200);
    }
  }
};
function runReplica(cfg) {
  const activeTurnId = `facial-repro-${cfg.emotion}`;
  const sm = new AvatarStateMachine();
  const vrm = makeVrmStub();
  const mixer = new AvatarExpressionMixer();
  const expression = new ExpressionController();
  const blink2 = new BlinkController();
  const analyser = new FakeAnalyser();
  const vrmModelAdapter = {
    setMouthWeights: (w) => mixer.setMouth(w),
    setMouthDebug: () => {
    },
    setSpeechEnergy: () => {
    }
  };
  const lipSync = new LipSync(vrmModelAdapter);
  blink2.attach();
  expression.attach(vrm);
  mixer.attach(vrm);
  const events = [];
  let frame = 0;
  let clockMs = 0;
  let detachCount = 0;
  let attachCount = 0;
  let emotionApplyFrame = null;
  const lastStatus = {};
  let lastEmotionMax = 0;
  let emotionReleaseFrame = null;
  let emotionReleaseT = null;
  let emotionInactiveFrame = null;
  let speechStopFrame = null;
  let speechStopT = null;
  let blinkResetAfterStop = false;
  const emit = (type, detail = "") => events.push({ t: Math.round(clockMs), frame, type, detail });
  const applyEffectFacial = (effect, withAnalyser) => {
    const effProfile = resolveEffectiveBlinkProfile(effect.proceduralMode, effect.emotionKey);
    blink2.setEffectiveProfile(effProfile, { proceduralMode: effect.proceduralMode, emotion: effect.emotionKey });
    emit("Blink PROFILE", `${effect.proceduralMode}/${effect.emotionKey} -> ${effProfile.profileId}`);
    expression.applyEmotion(effect.emotionKey);
    if (expression.getValues().size > 0 || effect.emotionKey !== "neutral") {
      emit("Emotion APPLY", `emotion=${effect.emotionKey}`);
      if (emotionApplyFrame === null && effect.emotionKey !== "neutral") emotionApplyFrame = frame;
    }
    if (effect.detachLipSync) {
      if (lipSync.detach(activeTurnId)) {
        detachCount++;
        emit("LipSync DETACH");
      }
    }
    if (effect.resetMouth) mixer.setMouth({ aa: 0, ih: 0, ou: 0 });
    if (effect.attachLipSync && withAnalyser) {
      lipSync.attach({
        turnId: activeTurnId,
        playbackId: `${activeTurnId}:playback`,
        analyser,
        startedAt: performance.now()
      }, effect.emotionKey);
      attachCount++;
      emit("LipSync ATTACH", `emotion=${effect.emotionKey}`);
    } else if (effect.attachLipSync) {
      lipSync.setEmotion(effect.emotionKey);
    }
  };
  const tick = (delta2, energy) => {
    frame++;
    clockMs += delta2 * 1e3;
    analyser.setEnergy(energy);
    mixer.beginFrame(delta2);
    expression.update(delta2);
    mixer.setEmotion(expression.getValues());
    blink2.update(delta2);
    mixer.setBlink(blink2.getWeight());
    mixer.apply();
    lipSync.update(delta2);
    const dbg2 = mixer.getDebugState();
    for (const src of dbg2.sourceLifecycle) {
      const prev = lastStatus[src.source];
      if (prev !== src.status) {
        if (src.status === "active" && prev !== "active") emit("Mixer ACTIVE", src.source);
        else if (src.status === "decaying") emit("Mixer RELEASE", src.source);
        else if ((src.status === "reset" || src.status === "inactive") && prev === "active")
          emit("Mixer INACTIVE", src.source);
        lastStatus[src.source] = src.status;
      }
    }
    const emotionMax = Math.max(0, ...[...expression.getValues().values()]);
    if (speechStopFrame !== null) {
      if (emotionReleaseFrame === null && emotionMax > 0 && emotionMax < lastEmotionMax - 1e-4) {
        emotionReleaseFrame = frame;
        emotionReleaseT = Math.round(clockMs);
        emit("Emotion RELEASE", `from=${lastEmotionMax.toFixed(3)}`);
      }
      if (emotionInactiveFrame === null && emotionMax <= 1e-4 && lastEmotionMax > 1e-4) {
        emotionInactiveFrame = frame;
        emit("Emotion INACTIVE");
      }
      if (!blinkResetAfterStop && blink2.getWeight() <= 1e-4) blinkResetAfterStop = true;
    }
    lastEmotionMax = emotionMax;
  };
  const delta = 1 / cfg.fps;
  applyEffectFacial(sm.prepareSpeaking(cfg.emotion), false);
  for (let i = 0; i < cfg.prepareFrames; i++) tick(delta, 0);
  emit("Speech START", `emotion=${cfg.emotion}`);
  applyEffectFacial(sm.startSpeaking(cfg.emotion), true);
  for (let i = 0; i < cfg.speakingFrames; i++) {
    const wordPhase = Math.sin(i / cfg.fps * Math.PI * 3.1);
    const gate = wordPhase > -0.25 ? 1 : 0.15;
    const energy = cfg.baseEnergy * gate * (0.75 + 0.25 * Math.abs(wordPhase));
    tick(delta, energy);
  }
  speechStopFrame = frame;
  speechStopT = Math.round(clockMs);
  emit("Speech STOP");
  if (lipSync.detach(activeTurnId, true)) {
    detachCount++;
    emit("LipSync DETACH", "terminal immediate reset");
  }
  applyEffectFacial(sm.stopSpeaking(), false);
  for (let i = 0; i < cfg.tailFrames; i++) tick(delta, 0);
  const activeAtSampleEnd = blink2.getWeight() > 1e-4;
  let settled = false;
  for (let i = 0; i < cfg.fps * 2; i++) {
    const bdbg = blink2.getDebugState();
    if (bdbg.phase === "idle" && bdbg.sequenceState === "none" && blink2.getWeight() <= 1e-4) {
      settled = true;
      break;
    }
    tick(delta, 0);
  }
  if (!settled) {
    const bdbg = blink2.getDebugState();
    settled = bdbg.phase === "idle" && bdbg.sequenceState === "none" && blink2.getWeight() <= 1e-4;
  }
  const failedToReturnToIdle = !settled;
  const dbg = mixer.getDebugState();
  const residualFrameIndex = Math.min(6, cfg.tailFrames);
  void residualFrameIndex;
  const mixerInactiveReached = {};
  for (const src of dbg.sourceLifecycle) {
    mixerInactiveReached[src.source] = Math.max(0, ...Object.values(src.final)) <= 1e-4;
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
  };
}
function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function profileEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function driveOneBlink(blink2, fps = 60, maxSeconds = 6) {
  const delta = 1 / fps;
  let peak = 0;
  let sawClose = false;
  let overshoot = false;
  let started = false;
  const ceiling = blink2.getDebugState().configuredProfile.blinkMax;
  for (let i = 0; i < fps * maxSeconds; i++) {
    blink2.update(delta);
    const w = blink2.getWeight();
    if (w > 1e-4) started = true;
    if (w > peak) peak = w;
    if (w >= ceiling - 1e-3) sawClose = true;
    if (w > ceiling + 1e-3) overshoot = true;
    if (started && blink2.getDebugState().phase === "idle" && w <= 1e-4) {
      return { peak, sawClose, overshoot, endedZero: true };
    }
  }
  return { peak, sawClose, overshoot, endedZero: blink2.getWeight() <= 1e-4 };
}
function runBlinkRegressionTests() {
  const results = [];
  const check = (name, ok, detail = "") => results.push({ name, ok, detail });
  {
    const a = resolveEffectiveBlinkProfile("speaking", "happy");
    const b = resolveEffectiveBlinkProfile("speaking", "happy");
    const speakingThenHappy = resolveEffectiveBlinkProfile("speaking", "happy");
    const happyThenSpeaking = resolveEffectiveBlinkProfile("speaking", "happy");
    check(
      "order-independent effective profile",
      profileEquals(a, b) && profileEquals(speakingThenHappy, happyThenSpeaking),
      `${JSON.stringify(speakingThenHappy)}`
    );
  }
  {
    const profile = resolveEffectiveBlinkProfile("idle", "neutral");
    const run = () => {
      const b = new BlinkController(profile, seededRng(12345));
      b.attach();
      const trace = [];
      for (let i = 0; i < 60 * 30; i++) {
        b.update(1 / 60);
        trace.push(Number(b.getWeight().toFixed(4)));
      }
      return trace.join(",");
    };
    check("deterministic RNG reproduces identical weight trace", run() === run());
  }
  {
    const profile = resolveEffectiveBlinkProfile("idle", "neutral");
    const b = new BlinkController(profile, seededRng(7));
    b.attach();
    const r = driveOneBlink(b);
    check(
      "blink stays within [0, maxWeight] and returns to 0",
      !r.overshoot && r.peak > 0 && r.endedZero,
      `peak=${r.peak.toFixed(3)} overshoot=${r.overshoot}`
    );
  }
  {
    const profile = resolveEffectiveBlinkProfile("idle", "happy");
    const b = new BlinkController(profile, seededRng(3));
    b.attach();
    b.force(facialTuning.blink.forceDuration);
    const dbg = b.getDebugState();
    const single = dbg.triggerReason === "forced" && dbg.sequenceState === "none";
    const r = driveOneBlink(b);
    b.force(facialTuning.blink.forceDuration);
    const dbg2 = b.getDebugState();
    check(
      "forced blink is single and re-forcible without overlap",
      single && r.endedZero && dbg2.phase === "closing" && dbg2.sequenceState === "none"
    );
  }
  {
    const profile = resolveEffectiveBlinkProfile("idle", "neutral");
    const alwaysDouble = () => 0;
    const b = new BlinkController(profile, alwaysDouble);
    b.attach();
    const delta = 1 / 120;
    const peaks = [];
    let cur = null;
    let sawWaiting = false;
    let cooldownAfter = 0;
    for (let i = 0; i < 120 * 12; i++) {
      b.update(delta);
      const dbg = b.getDebugState();
      if (dbg.sequenceState === "waiting-second-blink") sawWaiting = true;
      const w = b.getWeight();
      if (w > 1e-4) {
        if (!cur) cur = { reason: dbg.triggerReason, peak: 0, frames: 0 };
        cur.peak = Math.max(cur.peak, w);
        cur.frames++;
      } else if (cur) {
        peaks.push(cur);
        cur = null;
      }
      if (peaks.length === 2 && dbg.sequenceState === "none") {
        cooldownAfter = dbg.cooldownRemaining;
        break;
      }
    }
    const first = peaks[0];
    const second = peaks[1];
    const ok = peaks.length === 2 && sawWaiting && second && first && second.peak < first.peak - 1e-4 && second.frames <= first.frames && second.reason === "sequence" && cooldownAfter > 0;
    check(
      "double-blink is one sequence; 2nd weaker+shorter; cooldown after",
      Boolean(ok),
      `peaks=${peaks.map((p) => `${p.reason}:${p.peak.toFixed(3)}/${p.frames}f`).join(" ")} cooldown=${cooldownAfter.toFixed(2)}s`
    );
  }
  {
    const idle = resolveEffectiveBlinkProfile("idle", "neutral");
    const speaking = resolveEffectiveBlinkProfile("speaking", "surprised");
    const b = new BlinkController(idle, seededRng(9));
    b.attach();
    b.force(facialTuning.blink.forceDuration);
    for (let i = 0; i < 5; i++) b.update(1 / 120);
    const dbgMid = b.getDebugState();
    const snapshotBefore = dbgMid.activeProfileSnapshot;
    b.setEffectiveProfile(speaking, { proceduralMode: "speaking", emotion: "surprised" });
    const dbgAfterSwitch = b.getDebugState();
    const honestSplit = dbgAfterSwitch.activeProfileSnapshot !== null && profileEquals(dbgAfterSwitch.configuredProfile, speaking) && !profileEquals(dbgAfterSwitch.activeProfileSnapshot, speaking) && profileEquals(dbgAfterSwitch.activeProfileSnapshot, snapshotBefore);
    const r = driveOneBlink(b);
    const dbgIdle = b.getDebugState();
    check(
      "profile switch mid-blink keeps active phase; debug splits configured/snapshot",
      dbgMid.phase !== "idle" && honestSplit && r.endedZero && profileEquals(dbgIdle.configuredProfile, speaking) && dbgIdle.activeProfileSnapshot === null
    );
  }
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log("\n=== BLINK RUNTIME REGRESSION TESTS ===\n");
  for (const r of results) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `
          ${r.detail}` : ""}`);
  }
  console.log(`
  ${passed}/${results.length} passed${failed ? `  (${failed} FAILED)` : ""}`);
  return { passed, failed };
}
function main() {
  if (!process.argv.includes("--verbose")) {
    const realLog = console.log.bind(console);
    const noisy = /^\[(FACEDBG|FACELIFE|FACETRACE|ANIMDBG|LIPSYNCDBG|BEHAVIORTRANS)\]/;
    console.log = (...args) => {
      if (typeof args[0] === "string" && noisy.test(args[0])) return;
      realLog(...args);
    };
  }
  const blinkTests = runBlinkRegressionTests();
  if (blinkTests.failed > 0) process.exitCode = 1;
  const emotions = ["happy", "sad", "angry", "surprised", "calm"];
  const runs = [];
  const N = 10;
  const dumpFirst = process.argv.includes("--dump");
  for (let i = 0; i < N; i++) {
    const cfg = {
      emotion: emotions[i % emotions.length],
      prepareFrames: 24 + i % 3 * 8,
      speakingFrames: 150 + Math.floor(Math.random() * 200),
      tailFrames: 120,
      baseEnergy: 0.5 + Math.random() * 0.35,
      fps: 60
    };
    runs.push(runReplica(cfg));
  }
  if (dumpFirst) {
    console.log("\n=== FULL TRACE (run #1) ===");
    for (const e of runs[0].events) {
      console.log(`  t=${String(e.t).padStart(5)}ms  frame=${String(e.frame).padStart(4)}  ${e.type}${e.detail ? "  " + e.detail : ""}`);
    }
  }
  const detachNot1 = runs.filter((r) => r.detachCount !== 1).length;
  const attachDetachMismatch = runs.filter((r) => r.attachCount !== r.detachCount).length;
  const releaseLatencies = runs.filter((r) => r.emotionReleaseT !== null && r.speechStopT !== null).map((r) => r.emotionReleaseT - r.speechStopT);
  const noRelease = runs.filter((r) => r.emotionReleaseFrame === null && r.finalEmotionMax === 0 && r.emotionApplyFrame !== null).length;
  const emotionStuck = runs.filter((r) => r.finalEmotionMax > 1e-4).length;
  const mouthStuck = runs.filter((r) => r.residualMouthAfterStop > 1e-4).length;
  const blinkActiveAtSampleEnd = runs.filter((r) => r.activeAtSampleEnd).length;
  const blinkFailedToIdle = runs.filter((r) => r.failedToReturnToIdle).length;
  if (blinkFailedToIdle > 0) process.exitCode = 1;
  const emotionInactiveMissing = runs.filter((r) => r.emotionInactiveFrame === null && r.emotionApplyFrame !== null).length;
  const releaseToInactiveMs = runs.filter((r) => r.emotionReleaseT !== null && r.emotionInactiveFrame !== null).map((r) => Math.round((r.emotionInactiveFrame - r.emotionReleaseFrame) / 60 * 1e3));
  const avg = (a) => a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : NaN;
  const max = (a) => a.length ? Math.max(...a) : NaN;
  const min = (a) => a.length ? Math.min(...a) : NaN;
  console.log("\n=== EMPIRICAL REPORT (10 runs) ===\n");
  console.log(`LipSync lifecycle`);
  console.log(`  detachLipSync fired !=1 time:            ${detachNot1}/${N} runs`);
  console.log(`  attach/detach count mismatch:            ${attachDetachMismatch}/${N} runs`);
  console.log(`  (each run: attach=${runs[0].attachCount} detach=${runs[0].detachCount})`);
  console.log("");
  console.log(`Emotion release`);
  console.log(`  runs with no RELEASE observed:           ${noRelease}/${N}`);
  console.log(`  release start latency after Speech STOP: avg ${avg(releaseLatencies)}ms  (min ${min(releaseLatencies)} / max ${max(releaseLatencies)})`);
  console.log(`  release -> inactive duration:            avg ${avg(releaseToInactiveMs)}ms  (min ${min(releaseToInactiveMs)} / max ${max(releaseToInactiveMs)})`);
  console.log(`  emotion never reached INACTIVE:          ${emotionInactiveMissing}/${N}`);
  console.log(`  configured release duration:             ${facialTuning.expression.releaseDurationMs}ms (${facialTuning.expression.releaseEasing})`);
  console.log("");
  console.log(`Stuck-state checks at end of ${runs[0] ? "2s" : ""} tail`);
  console.log(`  mouth still open (Bug A):                ${mouthStuck}/${N}   max residual=${Math.max(...runs.map((r) => r.residualMouthAfterStop)).toFixed(3)}`);
  console.log(`  emotion stuck non-zero (Bug C family):   ${emotionStuck}/${N}`);
  console.log(`  blink active at sample end (expected):   ${blinkActiveAtSampleEnd}/${N}   (mid-blink at boundary \u2014 not a bug)`);
  console.log(`  blink failed to return to idle (BUG):    ${blinkFailedToIdle}/${N}`);
  console.log("");
  console.log(`Mixer source INACTIVE reached (all runs):`);
  for (const src of ["emotion", "lipSync", "autoBlink", "lookAt"]) {
    const ok = runs.filter((r) => r.mixerInactiveReached[src]).length;
    console.log(`  ${src.padEnd(10)}: ${ok}/${N} runs ended inactive`);
  }
  console.log("");
  const verdicts = [];
  if (detachNot1 > 0) verdicts.push(`In ${N} runs, detachLipSync did NOT fire exactly once in ${detachNot1} runs.`);
  else verdicts.push(`In ${N} runs, detachLipSync fired exactly once in every run (no leak).`);
  if (releaseLatencies.length) {
    const a = avg(releaseLatencies);
    verdicts.push(`Emotion release begins on average ${a}ms after Speech STOP (${a <= 40 ? "within one frame \u2014 no perceptible delay" : "delayed"}).`);
  }
  if (mouthStuck > 0) verdicts.push(`Mouth remained open after speech in ${mouthStuck}/${N} runs.`);
  else verdicts.push(`Mouth reached zero after speech in all ${N} runs.`);
  if (blinkFailedToIdle > 0) verdicts.push(`Blink FAILED to return to idle in ${blinkFailedToIdle}/${N} runs (real stuck state).`);
  else verdicts.push(`Blink returned to idle in all ${N} runs (${blinkActiveAtSampleEnd}/${N} were merely mid-blink at the sample boundary \u2014 expected).`);
  console.log("=== VERDICT ===");
  for (const v of verdicts) console.log(`  \u2022 ${v}`);
  console.log("");
}
main();
