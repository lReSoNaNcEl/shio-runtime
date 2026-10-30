import { facialTuning } from './facialTuning'
import { headMotionTuning, postureShiftTuning } from './motionTuning'

const armRange = (shoulder: number, upper: number, lower: number) => ({ shoulder, upper, lower })

/** Every artistic (not physical) ceiling on visible expressiveness, in one place.
 * Body contacts, joint hinges, torso calibration and joint speeds are physical
 * constraints and stay with their safety owners. Values are radians from the
 * calibrated standing pose unless stated otherwise. */
export const expressivenessProfile = {
  standingArmRange: {
    /** Quiet presence: arms stay near the calibrated rest. */
    quiet: armRange(0.08, 0.12, 0.25),
    /** Consumed speech: admits the forearm-forward conversational base and its beats. */
    conversational: armRange(0.14, 0.95, 1.6),
  },
  /** A conversational rest raised during speech settles back after it. */
  restAfterSpeech: {
    maximum: armRange(0.04, 0.08, 0.18),
    /** Share of the raised rest retained (0..1). */
    retainedFraction: 0.15,
  },
  /** Rest target after a completed act: a small variation of standing, never identical arms. */
  restAfterAct: {
    speaking: { maximum: armRange(0.04, 0.35, 0.9), retainedFraction: 0.6 },
    quiet: { maximum: armRange(0.04, 0.08, 0.18), retainedFraction: 0.15 },
  },
  /** Per-viseme mouth ceilings (0..1). */
  lipSyncClamps: facialTuning.lipSync.clamps,
  /** Total procedural head orientation ceilings. */
  head: {
    yawLimit: headMotionTuning.yawLimit,
    pitchLimit: headMotionTuning.pitchLimit,
    rollLimit: headMotionTuning.rollLimit,
  },
  /** Pelvis weight shift amplitudes and engagement lean. */
  posture: {
    engagementLean: postureShiftTuning.engagementLean,
    weightShift: postureShiftTuning.weightShift,
  },
} as const

export type ArmRange = ReturnType<typeof armRange>

/** Selects the arm-range key of a humanoid arm bone. */
export function armRangeKey(name: string): keyof ArmRange {
  return name.includes('LowerArm') ? 'lower' : name.includes('UpperArm') ? 'upper' : 'shoulder'
}
