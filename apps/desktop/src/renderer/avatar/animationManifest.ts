import { MOTION_PROFILES, type MotionProfile, type MotionProfileId } from '../../shared/motion'
import type { AvatarBodyMotionLayer } from './embodiment/motion/AvatarMotionLayer'
import type { OverlayViewMode } from './tuning/cameraTuning'

export type AnimationId = MotionProfileId
type AvatarPreviewCameraMode = OverlayViewMode | 'full'

export const DEFAULT_ANIMATION_COOLDOWN_MS = 4500

/** Selection metadata projected from the canonical generated-motion catalog. */
export interface AnimationManifestEntry {
  id: string
  kind: MotionProfile['kind']
  loop: boolean
  defaultWeight: number
  cooldownMs: number
  behaviorTags: readonly string[]
  compatibleStates: readonly string[]
  compatibleCameraModes: readonly AvatarPreviewCameraMode[]
  usage: { speaking: boolean; reaction: boolean; idle: boolean; extendedIdle: boolean }
  automaticSelection: boolean
  interruptible: boolean
}

const entries: readonly AnimationManifestEntry[] = MOTION_PROFILES.map((profile) => ({
  id: profile.id,
  kind: profile.kind,
  loop: profile.kind === 'presence',
  defaultWeight: profile.defaultWeight,
  cooldownMs: profile.variationPolicy.cooldownFamilyMs,
  behaviorTags: profile.behaviorTags,
  compatibleStates: ['idle', 'listening', 'thinking', 'speaking'],
  compatibleCameraModes: profile.cameraPolicy,
  usage: profile.usage,
  automaticSelection: profile.automaticSelection,
  interruptible: profile.kind === 'presence',
}))
const entryById = new Map(entries.map((entry) => [entry.id, entry]))

export function getAnimation(id: string): AnimationManifestEntry | undefined {
  return entryById.get(id)
}

/** Usage constrains selection; only the selected catalog kind grants body authority. */
export function resolveAnimationMotionLayer(
  id: string,
  usage: 'speaking' | 'reaction' = 'speaking',
): AvatarBodyMotionLayer {
  return getAnimation(id)?.kind === 'gesture'
    ? usage === 'reaction'
      ? 'reaction'
      : 'gesture'
    : 'base'
}

export function getAnimationsByBehaviorTagForState(
  tag: string,
  state: string,
): AnimationManifestEntry[] {
  return entries.filter(
    (entry) => entry.behaviorTags.includes(tag) && entry.compatibleStates.includes(state),
  )
}

export function isConversationSpeechAnimation(entry: AnimationManifestEntry): boolean {
  return entry.usage.speaking
}

export function isAutomaticSelectionEnabled(entry: AnimationManifestEntry): boolean {
  return entry.automaticSelection
}

export function isAnimationCameraCompatible(
  entry: AnimationManifestEntry,
  cameraMode?: AvatarPreviewCameraMode,
): boolean {
  return !cameraMode || entry.compatibleCameraModes.includes(cameraMode)
}
