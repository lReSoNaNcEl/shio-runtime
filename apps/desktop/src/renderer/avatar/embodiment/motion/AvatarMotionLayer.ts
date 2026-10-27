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
 * Generated gestures reduce only their body channels. ARDY excludes head/neck;
 * directed gaze retains authority over those independent contributions.
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
  const gazeWeight = input.screenGaze ? 0.04 : input.directedGaze ? 0.32 : 1
  return {
    proceduralUpperBodyWeight: upperBodyByLayer[input.bodyLayer],
    proceduralHeadWeight: gazeWeight,
  }
}
