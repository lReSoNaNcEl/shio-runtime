import { getMotionProfile } from '../../shared/motion'
import { type AnimationId, DEFAULT_ANIMATION_COOLDOWN_MS, getAnimation } from './animationManifest'

export interface AnimationCooldownState {
  animationId: AnimationId
  cooldownMs: number
  lastPlayedAt: number | null
  remainingMs: number
}

export class AvatarAnimationCooldownManager {
  private lastPlayedAtById = new Map<AnimationId, number>()

  getCooldownMs(animationId: AnimationId): number {
    return getAnimation(animationId)?.cooldownMs ?? DEFAULT_ANIMATION_COOLDOWN_MS
  }

  getState(animationId: AnimationId, now = Date.now()): AnimationCooldownState {
    const cooldownMs = this.getCooldownMs(animationId)
    const family = getMotionProfile(animationId)?.family
    const times = [...this.lastPlayedAtById]
      .filter(([id]) => !family || getMotionProfile(id)?.family === family)
      .map(([, time]) => time)
    const lastPlayedAt = times.length ? Math.max(...times) : null
    const remainingMs = lastPlayedAt === null ? 0 : Math.max(0, lastPlayedAt + cooldownMs - now)

    return {
      animationId,
      cooldownMs,
      lastPlayedAt,
      remainingMs,
    }
  }

  markPlayed(animationId: AnimationId, at = Date.now()): void {
    this.lastPlayedAtById.set(animationId, at)
  }

  clear(): void {
    this.lastPlayedAtById.clear()
  }

  getActiveCooldowns(now = Date.now()): AnimationCooldownState[] {
    return Array.from(this.lastPlayedAtById.keys())
      .map((animationId) => this.getState(animationId, now))
      .filter((state) => state.remainingMs > 0)
      .sort((a, b) => b.remainingMs - a.remainingMs)
  }
}
