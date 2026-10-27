import type { VRMHumanBoneName } from '@pixiv/three-vrm'

import type { MotionPhaseId, MotionProfile } from '../../../../shared/motion'

/** Artistic range around calibrated rest; never an anatomical or contact limit. */
export function standingArmRange(
  profile: MotionProfile,
  phase: MotionPhaseId,
  name: VRMHumanBoneName,
): number | null {
  const side = name.startsWith('left') ? 'left' : name.startsWith('right') ? 'right' : null
  if (!side || !/Arm|Shoulder/u.test(name)) return null
  const presence = profile.kind === 'presence'
  const support = profile.handScore.phases[phase][side].role === 'support'
  if (name.includes('Shoulder')) return presence || support ? 0.08 : 0.4
  if (!presence && !support && profile.accentHands !== 'relaxed') return null
  return name.includes('LowerArm') ? 0.25 : 0.12
}
