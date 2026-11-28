/** Finite pose handoff: zero blend velocity and acceleration at both ends.
 * Uses the existing source cursor and duration, never a second motion clock.
 */
export function motionTransitionWeight(progress: number): number {
  const t = Math.max(0, Math.min(1, progress))
  return t * t * t * (10 + t * (-15 + 6 * t))
}
