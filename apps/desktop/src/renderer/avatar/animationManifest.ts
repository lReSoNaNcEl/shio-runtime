/**
 * Animation Manifest — the single source of truth for the curated VRMA library.
 *
 * This is the ONLY place in the codebase that knows about animation ids,
 * physical `.vrma` filenames, and animation categories. Every other system
 * (semantic behaviour mapping, state machine, gesture scheduler, debug UI)
 * must reference animations through this manifest, never through hardcoded
 * filename tables.
 *
 * The manifest is intentionally data-only. It describes what animations exist
 * and their static metadata; it does not decide when an animation plays. That
 * decision belongs to the Avatar Runtime behaviour layers.
 *
 * Extensibility: the {@link AnimationManifestEntry} shape is designed so future
 * behaviour systems can attach richer metadata without touching consumers.
 * Reserved-for-future fields (not implemented yet, deliberately absent):
 *   - priority               relative importance when several animations compete
 *   - interruptibility       whether an active playback may be cut short
 *   - transitionPreferences  preferred blend/transition behaviour
 */

/** Curated animation groups. Order here defines display/iteration order. */
export const ANIMATION_CATEGORIES = [
  { id: 'idle', label: 'Idle' },
  { id: 'idlePresence', label: 'Idle Presence' },
  { id: 'greeting', label: 'Greeting' },
  { id: 'positive', label: 'Positive' },
  { id: 'thinking', label: 'Thinking' },
  { id: 'negative', label: 'Negative' },
  { id: 'embarrassed', label: 'Embarrassed' },
  { id: 'sitting', label: 'Sitting' },
  { id: 'interaction', label: 'Interaction' },
  { id: 'optional', label: 'Optional' },
] as const

export type AnimationCategory = (typeof ANIMATION_CATEGORIES)[number]['id']
export type RootMotionPolicy = 'allow' | 'lockY' | 'lockXZ' | 'lockAll'

export interface AnimationUsage {
  speaking: boolean
  reaction: boolean
  idle: boolean
  extendedIdle: boolean
}

const CONVERSATION_SPEECH_USAGE = {
  speaking: true,
  reaction: false,
  idle: false,
  extendedIdle: false,
} as const satisfies AnimationUsage

const REACTION_USAGE = {
  speaking: false,
  reaction: true,
  idle: false,
  extendedIdle: false,
} as const satisfies AnimationUsage

const IDLE_USAGE = {
  speaking: false,
  reaction: false,
  idle: true,
  extendedIdle: false,
} as const satisfies AnimationUsage

const IDLE_AND_SPEECH_USAGE = {
  speaking: true,
  reaction: false,
  idle: true,
  extendedIdle: false,
} as const satisfies AnimationUsage

const EXTENDED_IDLE_USAGE = {
  speaking: false,
  reaction: false,
  idle: false,
  extendedIdle: true,
} as const satisfies AnimationUsage

/** Default replay cooldown used when an animation has no manifest override. */
export const DEFAULT_ANIMATION_COOLDOWN_MS = 4500

export interface AnimationManifestEntry {
  /** Stable semantic identifier of the animation (matches the file stem). */
  id: string
  /** Physical `.vrma` filename under `src/renderer/assets/vrma`. */
  file: string
  /** Curated group this animation belongs to. */
  category: AnimationCategory
  /** Short, human-readable name for presentation surfaces. */
  displayName?: string
  /** Whether the clip is meant to loop when played on its own. */
  loop: boolean
  /** Baseline selection weight for future weighted behaviour systems. */
  defaultWeight: number
  /** Optional minimum time before the animation may be selected again. */
  cooldownMs?: number
  /** Manifest-owned selection tags for behavior systems. */
  behaviorTags?: readonly string[]
  /** Runtime states in which this animation may be selected. */
  compatibleStates?: readonly string[]
  /** Camera presets where automatic selection may use this clip. */
  compatibleCameraModes?: readonly AvatarPreviewCameraMode[]
  /** Explicit semantic usage gates; categories do not imply runtime safety. */
  usage?: AnimationUsage
  /** Whether behaviour resolution may select this animation automatically. */
  automaticSelection?: boolean
  /** Whether a higher-priority request may interrupt playback. */
  interruptible?: boolean
  /** How Avatar Runtime should treat root/hips translation tracks. */
  rootMotionPolicy?: RootMotionPolicy
  /** Short human-readable description of the motion. */
  description: string
}

/**
 * The curated animation library.
 *
 * `loop` reflects the intended nature of each clip: continuous state / expressive
 * animations loop; discrete one-shot actions (greetings, interactions, optional
 * flourishes) play once. Runtime callers may still override loop per playback —
 * this value is the animation's own default and drives standalone preview.
 */
export const ANIMATION_MANIFEST = [
  // --- Idle ----------------------------------------------------------------
  // `neutral_idle` is the primary standing idle; the other clips here are
  // lower-weighted idle *variety* so the resting pose never feels static.
  {
    id: 'neutral_idle',
    file: 'neutral_idle.vrma',
    category: 'idle',
    displayName: 'Neutral Idle',
    loop: true,
    defaultWeight: 6,
    cooldownMs: 12000,
    behaviorTags: ['behavior:idle', 'behavior:neutral', 'idle-orchestration'],
    compatibleStates: ['idle'],
    usage: IDLE_USAGE,
    description: 'Calm neutral standing idle (idle variety).',
  },
  {
    id: 'neutral2',
    file: 'neutral2.vrma',
    category: 'idle',
    displayName: 'Neutral 2',
    loop: true,
    defaultWeight: 2,
    cooldownMs: 13000,
    behaviorTags: [
      'behavior:idle',
      'behavior:neutral',
      'behavior:calm',
      'behavior:whisper',
      'idle-orchestration',
    ],
    compatibleStates: ['idle', 'speaking'],
    usage: IDLE_AND_SPEECH_USAGE,
    description: 'Neutral body motion, subtle presence (idle and speaking variety).',
  },
  {
    id: 'neutral4',
    file: 'neutral4.vrma',
    category: 'idle',
    displayName: 'Neutral 4',
    loop: true,
    defaultWeight: 1,
    cooldownMs: 13000,
    behaviorTags: [
      'behavior:idle',
      'behavior:neutral',
      'behavior:thinking',
      'behavior:calm',
      'behavior:whisper',
      'idle-orchestration',
    ],
    compatibleStates: ['idle', 'thinking', 'speaking'],
    compatibleCameraModes: ['full', 'bust'],
    usage: IDLE_AND_SPEECH_USAGE,
    description: 'Neutral body motion, quiet idle and speaking variant.',
  },
  {
    id: 'breathing_idle',
    file: 'breathing_idle.vrma',
    category: 'idle',
    displayName: 'Breathing Idle',
    loop: true,
    defaultWeight: 5,
    cooldownMs: 9000,
    behaviorTags: ['behavior:idle', 'idle-orchestration'],
    compatibleStates: ['idle'],
    compatibleCameraModes: ['full', 'bust', 'face'],
    usage: IDLE_USAGE,
    interruptible: true,
    description:
      'Calm breathing loop for the character’s baseline idle presence; excluded from Portrait camera.',
  },

  // --- Idle Presence -------------------------------------------------------
  // Long-idle motions used only by the Idle Orchestrator after sustained inactivity.
  // They are intentionally not tagged as `behavior:idle`, so normal idle selection
  // never picks them as everyday conversational poses.
  {
    id: 'idle_presence_sway_01',
    file: 'afk_sway_01.vrma',
    category: 'idlePresence',
    displayName: 'Idle Presence Sway 1',
    loop: true,
    defaultWeight: 3,
    cooldownMs: 45000,
    behaviorTags: ['idle-presence'],
    compatibleStates: ['idle'],
    compatibleCameraModes: ['full', 'bust'],
    usage: EXTENDED_IDLE_USAGE,
    rootMotionPolicy: 'lockAll',
    description: 'Extended idle sway for long quiet moments.',
  },
  {
    id: 'idle_presence_sway_02',
    file: 'afk_sway_02.vrma',
    category: 'idlePresence',
    loop: true,
    defaultWeight: 2,
    cooldownMs: 50000,
    behaviorTags: ['idle-presence'],
    compatibleStates: ['idle'],
    compatibleCameraModes: ['full', 'bust'],
    usage: EXTENDED_IDLE_USAGE,
    rootMotionPolicy: 'lockAll',
    description: 'Alternate extended idle sway for long quiet moments.',
  },
  {
    id: 'idle_presence_swing_01',
    file: 'afk_swing_01.vrma',
    category: 'idlePresence',
    loop: true,
    defaultWeight: 2,
    cooldownMs: 52000,
    behaviorTags: ['idle-presence'],
    compatibleStates: ['idle'],
    compatibleCameraModes: ['full', 'bust'],
    usage: EXTENDED_IDLE_USAGE,
    rootMotionPolicy: 'lockAll',
    description: 'Extended idle swing motion for sustained inactivity.',
  },
  {
    id: 'afk_swing_02',
    file: 'afk_swing_02.vrma',
    category: 'idlePresence',
    loop: true,
    defaultWeight: 2,
    cooldownMs: 48000,
    behaviorTags: ['idle-presence'],
    compatibleStates: ['idle'],
    compatibleCameraModes: ['full', 'bust'],
    usage: EXTENDED_IDLE_USAGE,
    rootMotionPolicy: 'lockAll',
    description: 'Compact extended idle swing motion for sustained inactivity.',
  },
  {
    id: 'idle_presence_dance_01',
    file: 'afk_dance_01.vrma',
    category: 'idlePresence',
    loop: true,
    defaultWeight: 1,
    cooldownMs: 60000,
    behaviorTags: ['idle-presence'],
    compatibleStates: ['idle'],
    compatibleCameraModes: ['full', 'bust'],
    usage: EXTENDED_IDLE_USAGE,
    rootMotionPolicy: 'lockAll',
    description: 'Playful long-idle dance motion for rare quiet stretches.',
  },
  {
    id: 'happy_idle',
    file: 'happy_idle.vrma',
    category: 'idlePresence',
    displayName: 'Happy Idle',
    loop: true,
    defaultWeight: 1,
    cooldownMs: 60000,
    behaviorTags: ['idle-presence'],
    compatibleStates: ['idle'],
    compatibleCameraModes: ['full', 'bust'],
    usage: EXTENDED_IDLE_USAGE,
    interruptible: true,
    rootMotionPolicy: 'lockAll',
    description: 'Warm, positive idle-presence loop for rare extended quiet moments.',
  },
  {
    id: 'yawn',
    file: 'yawn.vrma',
    category: 'idlePresence',
    displayName: 'Yawn',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 90000,
    behaviorTags: ['idle-presence'],
    compatibleStates: ['idle'],
    compatibleCameraModes: ['full', 'bust'],
    usage: EXTENDED_IDLE_USAGE,
    interruptible: true,
    rootMotionPolicy: 'lockAll',
    description: 'Rare sleepy yawn one-shot for a sustained AFK period; returns to normal idle.',
  },

  // --- Greeting ------------------------------------------------------------
  {
    id: 'action_greeting',
    file: 'action_greeting.vrma',
    category: 'greeting',
    loop: false,
    defaultWeight: 2,
    behaviorTags: ['behavior:greeting', 'gesture:agree', 'intensity:subtle'],
    compatibleStates: ['speaking'],
    usage: CONVERSATION_SPEECH_USAGE,
    description: 'Greeting gesture.',
  },
  {
    id: 'action_greeting1',
    file: 'action_greeting1.vrma',
    category: 'greeting',
    loop: false,
    defaultWeight: 1,
    behaviorTags: ['behavior:greeting', 'gesture:agree', 'intensity:normal'],
    compatibleStates: ['speaking'],
    usage: CONVERSATION_SPEECH_USAGE,
    description: 'Alternate greeting gesture.',
  },

  // --- Positive ------------------------------------------------------------
  {
    id: 'approval',
    file: 'approval.vrma',
    category: 'positive',
    loop: true,
    defaultWeight: 2,
    behaviorTags: ['behavior:happy', 'behavior:warm'],
    compatibleStates: ['speaking'],
    usage: REACTION_USAGE,
    description:
      'Approving, agreeable reaction motion. Not safe for ordinary speaking because the clip keys the jaw bone.',
  },
  {
    id: 'admiration',
    file: 'admiration.vrma',
    category: 'positive',
    loop: true,
    defaultWeight: 1,
    behaviorTags: ['behavior:happy'],
    compatibleStates: ['speaking'],
    usage: REACTION_USAGE,
    description:
      'Admiring, impressed reaction motion. Not safe for ordinary conversational speech.',
  },
  {
    id: 'thankful',
    file: 'thankful.vrma',
    category: 'positive',
    loop: false,
    defaultWeight: 1,
    behaviorTags: ['behavior:happy', 'behavior:warm'],
    compatibleStates: ['speaking'],
    usage: REACTION_USAGE,
    description:
      'A short thankful or appreciative gesture expressing gratitude, warm acknowledgment, or gentle appreciation.',
  },
  {
    id: 'caring',
    file: 'caring.vrma',
    category: 'positive',
    loop: true,
    defaultWeight: 2,
    behaviorTags: ['behavior:happy', 'behavior:warm'],
    compatibleStates: ['speaking'],
    usage: REACTION_USAGE,
    description: 'Warm, caring reaction motion. Not safe for ordinary conversational speech.',
  },
  {
    id: 'amusement',
    file: 'amusement.vrma',
    category: 'positive',
    loop: true,
    defaultWeight: 1,
    behaviorTags: ['behavior:laugh', 'gesture:tease', 'intensity:subtle', 'intensity:normal'],
    compatibleStates: ['speaking'],
    usage: CONVERSATION_SPEECH_USAGE,
    description: 'Amused, light-hearted motion.',
  },

  // --- Thinking ------------------------------------------------------------
  {
    id: 'thoughtful_head_nod',
    file: 'thoughtful_head_nod.vrma',
    category: 'thinking',
    displayName: 'Thoughtful Head Nod',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 30000,
    behaviorTags: ['behavior:thinking', 'reaction:question'],
    compatibleStates: ['idle', 'listening', 'thinking', 'awaitingSpeech'],
    usage: REACTION_USAGE,
    interruptible: true,
    description: 'Measured contemplative nod for thinking or the transition into speech.',
  },
  {
    id: 'curiosity',
    file: 'curiosity.vrma',
    category: 'thinking',
    loop: true,
    defaultWeight: 2,
    behaviorTags: ['behavior:listening', 'behavior:thinking'],
    compatibleStates: ['idle', 'listening', 'thinking'],
    description: 'Curious, attentive thinking/listening motion.',
  },
  {
    id: 'confusion',
    file: 'confusion.vrma',
    category: 'thinking',
    loop: true,
    defaultWeight: 1,
    behaviorTags: ['behavior:listening', 'behavior:fear', 'behavior:surprised', 'behavior:gasp'],
    compatibleStates: ['listening', 'speaking'],
    usage: REACTION_USAGE,
    description: 'Puzzled, uncertain reaction motion. Not safe for ordinary conversational speech.',
  },
  {
    id: 'confusion2',
    file: 'confusion2.vrma',
    category: 'thinking',
    loop: true,
    defaultWeight: 1,
    behaviorTags: [
      'behavior:thinking',
      'behavior:fear',
      'gesture:explain',
      'gesture:think',
      'intensity:subtle',
      'intensity:normal',
    ],
    compatibleStates: ['thinking', 'speaking'],
    usage: CONVERSATION_SPEECH_USAGE,
    description: 'Puzzled thinking/speaking motion.',
  },

  // --- Negative ------------------------------------------------------------
  {
    id: 'annoyance',
    file: 'annoyance.vrma',
    category: 'negative',
    loop: true,
    defaultWeight: 2,
    behaviorTags: [
      'behavior:angry',
      'behavior:sigh',
      'behavior:groan',
      'gesture:disagree',
      'intensity:normal',
      'intensity:strong',
    ],
    compatibleStates: ['speaking'],
    usage: CONVERSATION_SPEECH_USAGE,
    description: 'Annoyed, irritated motion.',
  },
  {
    id: 'anger2',
    file: 'anger2.vrma',
    category: 'negative',
    loop: true,
    defaultWeight: 1,
    behaviorTags: ['behavior:angry'],
    compatibleStates: ['speaking'],
    usage: CONVERSATION_SPEECH_USAGE,
    description: 'Alternate angry motion.',
  },
  {
    id: 'disapproval',
    file: 'disapproval.vrma',
    category: 'negative',
    loop: true,
    defaultWeight: 1,
    behaviorTags: ['behavior:sad', 'behavior:crying', 'behavior:sigh', 'behavior:groan'],
    compatibleStates: ['speaking'],
    usage: CONVERSATION_SPEECH_USAGE,
    description: 'Disapproving, dejected motion.',
  },
  {
    id: 'disgust',
    file: 'disgust.vrma',
    category: 'negative',
    loop: true,
    defaultWeight: 1,
    behaviorTags: ['behavior:angry'],
    compatibleStates: ['speaking'],
    usage: CONVERSATION_SPEECH_USAGE,
    description: 'Disgusted, recoiling motion.',
  },

  // --- Embarrassed ---------------------------------------------------------
  {
    id: 'embarrassment',
    file: 'embarrassment.vrma',
    category: 'embarrassed',
    loop: true,
    defaultWeight: 1,
    behaviorTags: ['behavior:sad', 'behavior:crying'],
    compatibleStates: ['speaking'],
    usage: CONVERSATION_SPEECH_USAGE,
    description: 'Embarrassed, flustered motion.',
  },

  {
    id: 'arm_stretching',
    file: 'arm_stretching.vrma',
    category: 'idlePresence',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 60000,
    behaviorTags: ['idle-presence'],
    compatibleStates: ['idle'],
    compatibleCameraModes: ['full', 'bust'],
    usage: EXTENDED_IDLE_USAGE,
    rootMotionPolicy: 'lockAll',
    description:
      'A gentle arm-stretching extended-idle motion with self-embracing arm movement and subtle side-to-side head turns.',
  },
  {
    id: 'bored_restless',
    file: 'bored_restless.vrma',
    category: 'idlePresence',
    loop: true,
    defaultWeight: 1,
    cooldownMs: 60000,
    behaviorTags: ['idle-presence'],
    compatibleStates: ['idle'],
    compatibleCameraModes: ['full', 'bust'],
    usage: EXTENDED_IDLE_USAGE,
    rootMotionPolicy: 'lockAll',
    description: 'Rare restless idle variation for extended quiet moments.',
  },

  // --- Sitting -------------------------------------------------------------
  {
    id: 'sit_idle2',
    file: 'sit_idle2.vrma',
    category: 'sitting',
    loop: true,
    defaultWeight: 1,
    description: 'Seated idle.',
  },
  {
    id: 'sit_idle3',
    file: 'sit_idle3.vrma',
    category: 'sitting',
    loop: true,
    defaultWeight: 1,
    description: 'Alternate seated idle.',
  },

  // --- Interaction ---------------------------------------------------------
  {
    id: 'acknowledge',
    file: 'acknowledge.vrma',
    category: 'interaction',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 15000,
    behaviorTags: ['reaction:direct-address'],
    compatibleStates: ['idle', 'listening'],
    usage: REACTION_USAGE,
    interruptible: true,
    description:
      'Brief acknowledgment nod for manual preview until a structured acknowledgment trigger exists.',
  },
  {
    id: 'blow_kiss',
    file: 'blow_kiss.vrma',
    category: 'interaction',
    displayName: 'Blow Kiss',
    loop: false,
    defaultWeight: 0,
    cooldownMs: 120000,
    behaviorTags: ['behavior:flirty'],
    compatibleStates: ['idle', 'awaitingSpeech'],
    compatibleCameraModes: ['full', 'bust'],
    automaticSelection: false,
    interruptible: true,
    description:
      'Warm, playful air-kiss gesture. Manual preview only until a structured affectionate trigger exists.',
  },
  {
    id: 'finger_gun',
    file: 'finger_gun.vrma',
    category: 'interaction',
    displayName: 'Finger Gun',
    loop: false,
    defaultWeight: 0,
    cooldownMs: 60000,
    behaviorTags: ['behavior:playful'],
    compatibleStates: ['idle', 'awaitingSpeech'],
    automaticSelection: false,
    interruptible: true,
    description:
      'Cheeky finger-gun reaction. Manual preview only until a structured playful trigger exists.',
  },
  {
    id: 'victory_fingers',
    file: 'victory_fingers.vrma',
    category: 'interaction',
    displayName: 'Victory Fingers',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 60000,
    behaviorTags: [
      'behavior:celebration',
      'gesture:celebrate',
      'intensity:normal',
      'intensity:strong',
    ],
    compatibleStates: ['speaking'],
    usage: CONVERSATION_SPEECH_USAGE,
    automaticSelection: true,
    interruptible: true,
    description:
      'Celebratory victory-fingers reaction. Manual preview only until a structured success trigger exists.',
  },

  // --- Optional ------------------------------------------------------------
  {
    id: 'salute',
    file: 'salute.vrma',
    category: 'optional',
    loop: false,
    defaultWeight: 0,
    automaticSelection: false,
    description:
      'A short salute gesture where the character raises one hand to her head and returns to neutral.',
  },
  {
    id: 'celebratory_dance',
    file: 'celebratory_dance.vrma',
    category: 'optional',
    loop: false,
    defaultWeight: 0,
    automaticSelection: false,
    description:
      'A short energetic celebratory dance with active head and arm movement and several small jumps.',
  },
  {
    id: 'dance_pushback',
    file: 'dance_pushback.vrma',
    category: 'optional',
    loop: false,
    defaultWeight: 0,
    automaticSelection: false,
    description: 'Playful dance / pushback flourish.',
  },
  {
    id: 'tiptoe_peek',
    file: 'tiptoe_peek.vrma',
    category: 'interaction',
    loop: false,
    defaultWeight: 0,
    automaticSelection: false,
    description:
      'A curious tiptoe motion where the character rises slightly, lifts her head and hands, and appears to peek over something.',
  },
] as const satisfies readonly AnimationManifestEntry[]

/** Fail fast when curated data violates selection invariants. */
function assertManifestIntegrity(entries: readonly AnimationManifestEntry[]): void {
  const ids = new Set<string>()
  const files = new Set<string>()
  const categoryIds = new Set(ANIMATION_CATEGORIES.map((category) => category.id))
  for (const entry of entries) {
    if (ids.has(entry.id) || files.has(entry.file))
      throw new Error(`Duplicate animation manifest entry: ${entry.id}`)
    if (
      !categoryIds.has(entry.category) ||
      !entry.description.trim() ||
      (entry.displayName !== undefined && !entry.displayName.trim())
    )
      throw new Error(`Invalid animation manifest entry: ${entry.id}`)
    if (entry.automaticSelection === false && entry.defaultWeight !== 0)
      throw new Error(`Manual-only animation must have zero weight: ${entry.id}`)
    if (entry.usage?.extendedIdle && entry.category !== 'idlePresence')
      throw new Error(`Extended idle animation must use Idle Presence: ${entry.id}`)
    if (
      entry.category === 'idlePresence' &&
      (entry.compatibleCameraModes?.length !== 2 ||
        !entry.compatibleCameraModes.includes('full') ||
        !entry.compatibleCameraModes.includes('bust'))
    )
      throw new Error(`Idle Presence animation must be Front/Bust-only: ${entry.id}`)
    ids.add(entry.id)
    files.add(entry.file)
  }
  for (const category of categoryIds) {
    if (!entries.some((entry) => entry.category === category))
      throw new Error(`Empty animation category: ${category}`)
  }
}

assertManifestIntegrity(ANIMATION_MANIFEST)

/** Union of every valid animation id, derived from the manifest. */
export type AnimationId = (typeof ANIMATION_MANIFEST)[number]['id']

// --- Resolution -----------------------------------------------------------

const animationUrls = import.meta.glob<string>('../assets/vrma/*.vrma', {
  eager: true,
  import: 'default',
  query: '?url',
})

const urlByFile = new Map<string, string>(
  Object.entries(animationUrls).map(([path, url]) => [path.split('/').pop() ?? path, url]),
)

for (const entry of ANIMATION_MANIFEST) {
  if (!urlByFile.has(entry.file)) throw new Error(`Missing VRMA asset: ${entry.file}`)
}

// Widened view of the manifest: `ANIMATION_MANIFEST` is `as const`, so its member
// type is a heterogeneous union where optional fields (behaviorTags, etc.) only
// exist on some entries. Iterating through this typed view lets helpers read the
// optional fields uniformly.
const MANIFEST_ENTRIES: readonly AnimationManifestEntry[] = ANIMATION_MANIFEST

const entryById = new Map<string, AnimationManifestEntry>(
  MANIFEST_ENTRIES.map((entry) => [entry.id, entry]),
)

/** Every animation id in manifest order. */
export const ANIMATION_IDS: readonly AnimationId[] = ANIMATION_MANIFEST.map((entry) => entry.id)

export function getAnimation(id: string): AnimationManifestEntry | undefined {
  return entryById.get(id)
}

export function hasAnimation(id: string): boolean {
  return entryById.has(id)
}

/** Resolve the bundled URL for an animation id, if the asset is present. */
export function getAnimationUrl(id: string): string | undefined {
  const entry = entryById.get(id)
  if (!entry) return undefined
  return urlByFile.get(entry.file)
}

export function getRootMotionPolicy(entry: AnimationManifestEntry): RootMotionPolicy {
  if (entry.rootMotionPolicy) return entry.rootMotionPolicy

  const standingRuntimeStates = ['idle', 'listening', 'thinking', 'speaking']
  const isStandingRuntimeMotion =
    entry.compatibleStates?.some((state) => standingRuntimeStates.includes(state)) ?? false
  if (entry.loop && isStandingRuntimeMotion && entry.category !== 'sitting') return 'lockAll'
  return 'allow'
}

/** All animations belonging to a category, in manifest order. */
export function getAnimationsByCategory(category: AnimationCategory): AnimationManifestEntry[] {
  return MANIFEST_ENTRIES.filter((entry) => entry.category === category)
}

/** Manifest-owned query hook for behavior systems. */
export function getAnimationsByBehaviorTag(tag: string): AnimationManifestEntry[] {
  return MANIFEST_ENTRIES.filter((entry) => entry.behaviorTags?.includes(tag))
}

export function getAnimationsByBehaviorTagForState(
  tag: string,
  state: string,
): AnimationManifestEntry[] {
  return getAnimationsByBehaviorTag(tag).filter((entry) => {
    return !entry.compatibleStates || entry.compatibleStates.includes(state)
  })
}

export function isConversationSpeechAnimation(entry: AnimationManifestEntry): boolean {
  return entry.usage?.speaking ?? false
}

export function isAutomaticSelectionEnabled(entry: AnimationManifestEntry): boolean {
  if (entry.automaticSelection !== undefined) return entry.automaticSelection
  return Boolean(entry.behaviorTags?.length || entry.usage)
}

/**
 * Canonical answer to "can the runtime pick this clip on its own?", for
 * presentation surfaces (Avatar Preview Auto/Manual badge). It folds the
 * automatic-selection policy together with the weighted-selection requirement the
 * Behavior Resolver actually applies (`weight: defaultWeight`, and the manifest
 * invariant forcing weight 0 whenever `automaticSelection === false`). Consumers
 * must use this instead of re-composing the rule, so Preview and the Resolver can
 * never drift on what "Auto" means.
 */
export function isAnimationAutomaticallySelectable(entry: AnimationManifestEntry): boolean {
  return isAutomaticSelectionEnabled(entry) && entry.defaultWeight > 0
}

export function isAnimationInterruptible(entry: AnimationManifestEntry): boolean {
  return entry.interruptible ?? false
}

/** Camera compatibility is a selection constraint; direct debug preview may opt out. */
export function isAnimationCameraCompatible(
  entry: AnimationManifestEntry,
  cameraMode?: AvatarPreviewCameraMode,
): boolean {
  return (
    !cameraMode || !entry.compatibleCameraModes || entry.compatibleCameraModes.includes(cameraMode)
  )
}

/**
 * Human-readable display label for an animation, for presentation surfaces
 * (Avatar Preview animation picker). Never returns an empty string.
 * Priority: manifest description → id → filename without extension.
 */
export function getAnimationLabel(entry: AnimationManifestEntry): string {
  return getAnimationTitle(entry)
}

/**
 * Short human-readable title for the Avatar Preview picker primary line.
 * Unlike {@link getAnimationLabel} it never falls back to the long description —
 * the description belongs on the item's secondary line, not as the select value.
 * Priority: displayName → title-cased id → filename without extension.
 */
export function getAnimationTitle(entry: AnimationManifestEntry): string {
  if (entry.displayName) return entry.displayName
  const source = entry.id || entry.file.replace(/\.vrma$/i, '')
  return source
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** Categories paired with their animations, in display order. */
export function getGroupedAnimations(): Array<{
  category: AnimationCategory
  label: string
  animations: AnimationManifestEntry[]
}> {
  return ANIMATION_CATEGORIES.map((category) => ({
    category: category.id,
    label: category.label,
    animations: getAnimationsByCategory(category.id),
  }))
}

import type { OverlayViewMode } from './tuning/cameraTuning'

type AvatarPreviewCameraMode = OverlayViewMode | 'full'
