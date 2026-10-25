/**
 * Animation Manifest — the single source of truth for the native S22 gestures.
 *
 * This is the ONLY place in the codebase that knows about animation ids,
 * native gesture identifiers, and animation categories. Every other system
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

export interface AnimationUsage {
  speaking: boolean
  reaction: boolean
  idle: boolean
  extendedIdle: boolean
}

/** Default replay cooldown used when an animation has no manifest override. */
export const DEFAULT_ANIMATION_COOLDOWN_MS = 4500

export interface AnimationManifestEntry {
  /** Stable semantic identifier of the animation (matches the file stem). */
  id: string
  /** Bundled S22 gesture identifier. */
  file: string
  /** Curated group this animation belongs to. */
  category: AnimationCategory
  /** Short, human-readable name for presentation surfaces. */
  displayName?: string
  displayNameRu?: string
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
  {
    id: 'neutral_idle',
    file: 'S22:idle',
    category: 'idle',
    displayName: 'S22 idle',
    loop: true,
    defaultWeight: 1,
    behaviorTags: [
      'behavior:idle',
      'behavior:listening',
      'behavior:thinking',
      'behavior:neutral',
      'behavior:calm',
      'behavior:happy',
      'behavior:warm',
      'behavior:laugh',
      'behavior:sad',
      'behavior:crying',
      'behavior:angry',
      'behavior:fear',
      'behavior:surprised',
      'behavior:gasp',
      'behavior:sigh',
      'behavior:groan',
      'behavior:whisper',
    ],
    compatibleStates: ['idle', 'listening'],
    usage: {
      speaking: false,
      reaction: false,
      idle: true,
      extendedIdle: false,
    },
    description: 'S22 native idle',
  },
  {
    id: 'neutral2',
    file: 'S22:speaking',
    category: 'idle',
    displayName: 'S22 speaking',
    loop: true,
    defaultWeight: 1,
    behaviorTags: ['behavior:neutral'],
    compatibleStates: ['speaking'],
    usage: {
      speaking: true,
      reaction: false,
      idle: false,
      extendedIdle: false,
    },
    description: 'S22 native speaking',
  },
  {
    id: 'thinking',
    file: 'S22:thinking',
    category: 'idle',
    displayName: 'S22 thinking',
    loop: true,
    defaultWeight: 1,
    behaviorTags: [
      'behavior:idle',
      'behavior:listening',
      'behavior:thinking',
      'behavior:neutral',
      'behavior:calm',
      'behavior:happy',
      'behavior:warm',
      'behavior:laugh',
      'behavior:sad',
      'behavior:crying',
      'behavior:angry',
      'behavior:fear',
      'behavior:surprised',
      'behavior:gasp',
      'behavior:sigh',
      'behavior:groan',
      'behavior:whisper',
    ],
    compatibleStates: ['thinking'],
    usage: {
      speaking: false,
      reaction: false,
      idle: false,
      extendedIdle: false,
    },
    description: 'S22 native thinking',
  },
  {
    id: 'nod',
    file: 'S22:nod',
    category: 'interaction',
    displayName: 'Nod',
    displayNameRu: 'Кивок',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: [
      'gesture:nod',
      'reaction:nod',
      'reaction:direct-address',
      'gesture:greeting',
      'gesture:agree',
      'gesture:explain',
      'behavior:neutral',
      'behavior:warm',
      'behavior:calm',
      'behavior:greeting',
    ],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: true,
      reaction: true,
      idle: false,
      extendedIdle: false,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
  {
    id: 'tilt',
    file: 'S22:tilt',
    category: 'interaction',
    displayName: 'Tilt',
    displayNameRu: 'Наклон',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: [
      'gesture:tilt',
      'reaction:tilt',
      'reaction:question',
      'gesture:thinking',
      'gesture:think',
      'behavior:neutral',
      'behavior:calm',
      'behavior:sad',
      'behavior:whisper',
    ],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: true,
      reaction: true,
      idle: false,
      extendedIdle: false,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
  {
    id: 'shake',
    file: 'S22:shake',
    category: 'interaction',
    displayName: 'Shake head',
    displayNameRu: 'Отрицание',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: [
      'gesture:shake',
      'reaction:shake',
      'gesture:disagree',
      'behavior:angry',
      'behavior:groan',
    ],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: true,
      reaction: true,
      idle: false,
      extendedIdle: false,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
  {
    id: 'wink',
    file: 'S22:wink',
    category: 'interaction',
    displayName: 'Wink',
    displayNameRu: 'Подмигивание',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: [
      'gesture:wink',
      'reaction:wink',
      'gesture:tease',
      'behavior:happy',
      'behavior:laugh',
      'behavior:warm',
    ],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: true,
      reaction: true,
      idle: false,
      extendedIdle: false,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
  {
    id: 'ears',
    file: 'S22:ears',
    category: 'interaction',
    displayName: 'Ear movement',
    displayNameRu: 'Движение ушей',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: [
      'gesture:ears',
      'reaction:ears',
      'reaction:surprise',
      'gesture:surprise',
      'behavior:surprised',
      'behavior:gasp',
      'behavior:fear',
    ],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: true,
      reaction: true,
      idle: false,
      extendedIdle: false,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
  {
    id: 'earLeft',
    file: 'S22:earLeft',
    category: 'interaction',
    displayName: 'Left ear',
    displayNameRu: 'Левое ухо',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: ['gesture:earLeft', 'reaction:earLeft'],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: false,
      reaction: true,
      idle: false,
      extendedIdle: false,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
  {
    id: 'earRight',
    file: 'S22:earRight',
    category: 'interaction',
    displayName: 'Right ear',
    displayNameRu: 'Правое ухо',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: ['gesture:earRight', 'reaction:earRight'],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: false,
      reaction: true,
      idle: false,
      extendedIdle: false,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
  {
    id: 'tail',
    file: 'S22:tail',
    category: 'interaction',
    displayName: 'Tail wave',
    displayNameRu: 'Взмах хвоста',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: [
      'gesture:tail',
      'reaction:tail',
      'gesture:celebrate',
      'behavior:happy',
      'behavior:laugh',
    ],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: true,
      reaction: true,
      idle: false,
      extendedIdle: false,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
  {
    id: 'sway',
    file: 'S22:sway',
    category: 'interaction',
    displayName: 'Weight shift',
    displayNameRu: 'Перенос веса',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: ['gesture:sway', 'reaction:sway', 'idle-presence'],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: false,
      reaction: true,
      idle: true,
      extendedIdle: true,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
  {
    id: 'step',
    file: 'S22:step',
    category: 'interaction',
    displayName: 'Light step',
    displayNameRu: 'Лёгкий шаг',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: ['gesture:step', 'reaction:step'],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: false,
      reaction: true,
      idle: false,
      extendedIdle: false,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
  {
    id: 'curtsy',
    file: 'S22:curtsy',
    category: 'interaction',
    displayName: 'Curtsy',
    displayNameRu: 'Реверанс',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: ['gesture:curtsy', 'reaction:curtsy'],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: false,
      reaction: true,
      idle: false,
      extendedIdle: false,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
  {
    id: 'breeze',
    file: 'S22:breeze',
    category: 'interaction',
    displayName: 'Breeze',
    displayNameRu: 'Ветер',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: ['gesture:breeze', 'reaction:breeze'],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: false,
      reaction: true,
      idle: false,
      extendedIdle: false,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
  {
    id: 'lookaround',
    file: 'S22:lookaround',
    category: 'interaction',
    displayName: 'Look around',
    displayNameRu: 'Осмотреться',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: ['gesture:lookaround', 'reaction:lookaround', 'idle-presence'],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: false,
      reaction: true,
      idle: true,
      extendedIdle: true,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
  {
    id: 'tailcurl',
    file: 'S22:tailcurl',
    category: 'interaction',
    displayName: 'Curl tail',
    displayNameRu: 'Свернуть хвост',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: [
      'gesture:tailcurl',
      'reaction:tailcurl',
      'behavior:sad',
      'behavior:crying',
      'behavior:fear',
      'behavior:whisper',
    ],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: true,
      reaction: true,
      idle: false,
      extendedIdle: false,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
  {
    id: 'turnbody',
    file: 'S22:turnbody',
    category: 'interaction',
    displayName: 'Turn torso',
    displayNameRu: 'Поворот корпуса',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: ['gesture:turnbody', 'reaction:turnbody'],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: false,
      reaction: true,
      idle: false,
      extendedIdle: false,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
  {
    id: 'balance',
    file: 'S22:balance',
    category: 'interaction',
    displayName: 'Change support',
    displayNameRu: 'Смена опоры',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: ['gesture:balance', 'reaction:balance'],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: false,
      reaction: true,
      idle: false,
      extendedIdle: false,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
  {
    id: 'breathe',
    file: 'S22:breathe',
    category: 'interaction',
    displayName: 'Deep breath',
    displayNameRu: 'Глубокий вдох',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: [
      'gesture:breathe',
      'reaction:breathe',
      'idle-presence',
      'behavior:calm',
      'behavior:sigh',
    ],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: true,
      reaction: true,
      idle: true,
      extendedIdle: true,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
  {
    id: 'orbit',
    file: 'S22:orbit',
    category: 'interaction',
    displayName: 'Body flow',
    displayNameRu: 'Пластика тела',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: ['gesture:orbit', 'reaction:orbit'],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: false,
      reaction: true,
      idle: false,
      extendedIdle: false,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
  {
    id: 'legflow',
    file: 'S22:legflow',
    category: 'interaction',
    displayName: 'Leg flow',
    displayNameRu: 'Пластика ног',
    loop: false,
    defaultWeight: 1,
    cooldownMs: 8000,
    behaviorTags: ['gesture:legflow', 'reaction:legflow'],
    compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
    usage: {
      speaking: false,
      reaction: true,
      idle: false,
      extendedIdle: false,
    },
    description: 'S22 procedural gesture',
    interruptible: true,
  },
] as const satisfies readonly AnimationManifestEntry[]
export type AnimationId = (typeof ANIMATION_MANIFEST)[number]['id']
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
  const source = entry.id || entry.file
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
