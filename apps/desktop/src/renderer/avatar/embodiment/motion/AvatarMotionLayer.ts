/**
 * Internal Avatar Runtime composition domains. These values describe model
 * application ownership only; they never cross the semantic embodiment
 * boundary or become Character State.
 */
export const AVATAR_MOTION_LAYERS = [
  'base',
  'gesture',
  'reaction',
  'procedural',
  'gaze',
  'facial',
  'secondary',
] as const

export type AvatarMotionLayer = (typeof AVATAR_MOTION_LAYERS)[number]
export type AvatarBodyMotionLayer = Extract<AvatarMotionLayer, 'base' | 'gesture' | 'reaction'>

export interface AvatarMotionAuthority {
  proceduralUpperBodyWeight: number
  proceduralHeadWeight: number
}

/**
 * Procedural motion is deliberately the lowest-authority body contribution.
 * Explicit gesture/reaction clips and directed gaze reduce it without changing
 * the currently selected semantic behavior.
 */
export function resolveAvatarMotionAuthority(input: {
  bodyLayer: AvatarBodyMotionLayer
  directedGaze: boolean
  screenGaze: boolean
}): AvatarMotionAuthority {
  const upperBodyByLayer: Record<AvatarBodyMotionLayer, number> = {
    base: 1,
    gesture: 0.24,
    reaction: 0.08,
  }
  const headByLayer: Record<AvatarBodyMotionLayer, number> = {
    base: 1,
    gesture: 0.42,
    reaction: 0.18,
  }

  const gazeWeight = input.screenGaze ? 0.04 : input.directedGaze ? 0.32 : 1
  return {
    proceduralUpperBodyWeight: upperBodyByLayer[input.bodyLayer],
    proceduralHeadWeight: Math.min(headByLayer[input.bodyLayer], gazeWeight),
  }
}
