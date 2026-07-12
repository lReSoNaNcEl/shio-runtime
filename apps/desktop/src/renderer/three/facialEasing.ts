/**
 * facialEasing — centralized easing + release curves for the Facial Runtime.
 *
 * All facial sources that need an interpolated *release* (fade toward zero) share
 * these helpers so there is exactly one place that decides how a facial value
 * decays. This avoids the historical situation where each source implemented its
 * own ad-hoc lerp/decay and produced inconsistent, sometimes snap-like releases.
 */

export type FacialEasingId = 'linear' | 'easeOutCubic' | 'easeInOutCubic' | 'easeOutQuad'

const EASINGS: Record<FacialEasingId, (t: number) => number> = {
  linear: (t) => t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
}

export function ease(id: FacialEasingId, t: number): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t
  return EASINGS[id](clamped)
}

/**
 * A duration-based, eased release of a single value toward zero.
 *
 * Given the value it started releasing from, how far through the release we are
 * (0..1) and an easing curve, return the current value. Progress is advanced by
 * the caller from real frame delta, so the release always takes the configured
 * wall-clock duration regardless of frame rate.
 */
export function releaseValue(startValue: number, progress: number, easing: FacialEasingId): number {
  const eased = ease(easing, progress)
  const next = startValue * (1 - eased)
  return next < 0.001 ? 0 : next
}
