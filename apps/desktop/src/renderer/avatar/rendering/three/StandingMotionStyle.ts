import type { VRMHumanBoneName } from '@pixiv/three-vrm'

import type { MotionPhaseId, MotionProfile } from '../../../../shared/motion'

const QUIET = { shoulder: 0.08, upper: 0.12, lower: 0.25 }
const CONVERSATIONAL = { shoulder: 0.14, upper: 0.95, lower: 1.6 }

/** Artistic range around calibrated rest; never an anatomical or contact limit.
 * `conversational` (0..1) is 1 during consumed speech, admitting the forearm-
 * forward conversational base and its beats, and fades after speech so quiet
 * presence regains its narrow standing range gradually. */
export function standingArmRange(
  profile: MotionProfile,
  phase: MotionPhaseId,
  name: VRMHumanBoneName,
  conversational = 0,
): number | null {
  const side = name.startsWith('left') ? 'left' : name.startsWith('right') ? 'right' : null
  if (!side || !/Arm|Shoulder/u.test(name)) return null
  const presence = profile.kind === 'presence'
  const support = profile.handScore.phases[phase][side].role === 'support'
  const weight = presence ? Math.max(0, Math.min(1, conversational)) : 0
  const range = (key: keyof typeof QUIET): number =>
    QUIET[key] + (CONVERSATIONAL[key] - QUIET[key]) * weight
  if (name.includes('Shoulder')) return presence || support ? range('shoulder') : 0.4
  if (!presence && !support && profile.accentHands !== 'relaxed') return null
  return name.includes('LowerArm') ? range('lower') : range('upper')
}
