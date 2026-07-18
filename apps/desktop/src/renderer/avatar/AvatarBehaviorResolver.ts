import type { OverlayViewMode } from '../three/avatarTuning'
import {
  type AnimationCooldownState,
  AvatarAnimationCooldownManager,
} from './AvatarAnimationCooldownManager'
import type { AvatarStateEffect } from './AvatarStateMachine'
import {
  type AnimationId,
  getAnimation,
  getAnimationsByBehaviorTagForState,
  isAnimationCameraCompatible,
  isAutomaticSelectionEnabled,
  isConversationSpeechAnimation,
} from './animationManifest'

export type AvatarBehaviorId =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'neutral'
  | 'happy'
  | 'laugh'
  | 'warm'
  | 'calm'
  | 'sad'
  | 'crying'
  | 'angry'
  | 'fear'
  | 'surprised'
  | 'gasp'
  | 'sigh'
  | 'groan'
  | 'whisper'
  | 'greeting'

export interface AvatarBehaviorCandidate {
  animationId: AnimationId
  weight: number
  cooldownMs: number
  cooldownRemainingMs: number
  excludedByCooldown: boolean
  excludedByUsage: boolean
  excludedByCamera: boolean
  excludedByAutomaticSelection: boolean
  lastPlayedAt: number | null
  /** True for the candidate that was actually selected this resolution. */
  selected: boolean
  /** Probability share within the eligible pool (0..1); 0 if not eligible. */
  selectionShare: number
}

export interface AvatarBehaviorResolution {
  behaviorId: AvatarBehaviorId
  candidates: AvatarBehaviorCandidate[]
  animationId: AnimationId
  loop: boolean
  fallbackAnimationId: AnimationId
  activeCooldowns: AnimationCooldownState[]
  /** Human-readable explanation of how the animation was chosen. */
  selectionReason: string
}

const FALLBACK_ANIMATION_ID: AnimationId = 'neutral_idle'
const SPEAKING_FALLBACK_ANIMATION_ID: AnimationId = 'neutral2'

export class AvatarBehaviorResolver {
  private cooldowns = new AvatarAnimationCooldownManager()
  private cameraMode: OverlayViewMode | undefined

  setCameraMode(cameraMode: OverlayViewMode | undefined): void {
    this.cameraMode = cameraMode
  }

  resolve(
    effect: AvatarStateEffect,
    excludedAnimationIds: readonly string[] = [],
  ): AvatarBehaviorResolution {
    const now = Date.now()
    const behaviorId = this.normalizeBehavior(effect.behaviorId)
    const manifestState = this.toManifestState(effect.mode)
    const candidates = this.getCandidates(behaviorId, manifestState, now)
    const excludedIds = new Set(excludedAnimationIds)
    const selection = this.selectAnimation(candidates, excludedIds, manifestState)
    this.annotateCandidates(candidates, selection.animationId, excludedIds)
    this.cooldowns.markPlayed(selection.animationId, now)

    return {
      behaviorId,
      candidates,
      animationId: selection.animationId,
      loop: effect.loop,
      fallbackAnimationId: this.getFallbackAnimationId(manifestState, excludedIds),
      activeCooldowns: this.cooldowns.getActiveCooldowns(now),
      selectionReason: `${behaviorId}: ${selection.reason}`,
    }
  }

  resolveBehaviorTag(
    effect: AvatarStateEffect,
    tag: string,
    behaviorId: AvatarBehaviorId,
    excludedAnimationIds: readonly string[] = [],
  ): AvatarBehaviorResolution {
    const now = Date.now()
    const manifestState = this.toManifestState(effect.mode)
    const candidates = this.getCandidatesForTag(tag, manifestState, now)
    const excludedIds = new Set(excludedAnimationIds)
    const selection = this.selectAnimation(candidates, excludedIds, manifestState)
    this.annotateCandidates(candidates, selection.animationId, excludedIds)
    this.cooldowns.markPlayed(selection.animationId, now)
    const entry = getAnimation(selection.animationId)

    return {
      behaviorId,
      candidates,
      animationId: selection.animationId,
      loop: entry?.loop ?? effect.loop,
      fallbackAnimationId: this.getFallbackAnimationId(manifestState, excludedIds),
      activeCooldowns: this.cooldowns.getActiveCooldowns(now),
      selectionReason: `${tag}: ${selection.reason}`,
    }
  }

  resolveAnimationTags(
    effect: AvatarStateEffect,
    tags: readonly string[],
    behaviorId: AvatarBehaviorId,
    usage: 'speaking' | 'reaction',
    excludedAnimationIds: readonly string[] = [],
  ): AvatarBehaviorResolution | null {
    const now = Date.now()
    const manifestState = this.toManifestState(effect.mode)
    const animationIds = [
      ...new Set(
        tags.flatMap((tag) =>
          getAnimationsByBehaviorTagForState(tag, manifestState)
            .filter((entry) => entry.usage?.[usage])
            .map((entry) => entry.id as AnimationId),
        ),
      ),
    ]
    if (animationIds.length === 0) return null
    const candidates = this.buildCandidates(animationIds, now)
    const excludedIds = new Set(excludedAnimationIds)
    const selection = this.selectAnimation(candidates, excludedIds, manifestState, usage)
    this.annotateCandidates(candidates, selection.animationId, excludedIds)
    this.cooldowns.markPlayed(selection.animationId, now)
    const entry = getAnimation(selection.animationId)
    return {
      behaviorId,
      candidates,
      animationId: selection.animationId,
      loop: entry?.loop ?? effect.loop,
      fallbackAnimationId: this.getFallbackAnimationId(manifestState, excludedIds),
      activeCooldowns: this.cooldowns.getActiveCooldowns(now),
      selectionReason: `${tags.join('|')}: ${selection.reason}`,
    }
  }

  clearCooldowns(): void {
    this.cooldowns.clear()
  }

  getActiveCooldowns(): AnimationCooldownState[] {
    return this.cooldowns.getActiveCooldowns()
  }

  private normalizeBehavior(behaviorId: string): AvatarBehaviorId {
    if (behaviorId === 'chuckle') return 'laugh'
    if (this.isKnownBehavior(behaviorId)) return behaviorId
    return 'neutral'
  }

  private getCandidates(
    behaviorId: AvatarBehaviorId,
    mode: string,
    now: number,
  ): AvatarBehaviorCandidate[] {
    const animationIds = getAnimationsByBehaviorTagForState(`behavior:${behaviorId}`, mode).map(
      (entry) => entry.id as AnimationId,
    )

    return this.buildCandidates(animationIds, now)
  }

  private getCandidatesForTag(tag: string, mode: string, now: number): AvatarBehaviorCandidate[] {
    const animationIds = getAnimationsByBehaviorTagForState(tag, mode).map(
      (entry) => entry.id as AnimationId,
    )

    return this.buildCandidates(animationIds, now)
  }

  private buildCandidates(animationIds: AnimationId[], now: number): AvatarBehaviorCandidate[] {
    return animationIds
      .map((animationId) => {
        const entry = getAnimation(animationId)
        if (!entry) return null

        const cooldown = this.cooldowns.getState(animationId, now)
        return {
          animationId,
          weight: entry.defaultWeight,
          cooldownMs: cooldown.cooldownMs,
          cooldownRemainingMs: cooldown.remainingMs,
          excludedByCooldown: cooldown.remainingMs > 0,
          excludedByUsage: false,
          excludedByCamera: !isAnimationCameraCompatible(entry, this.cameraMode),
          excludedByAutomaticSelection: !isAutomaticSelectionEnabled(entry),
          lastPlayedAt: cooldown.lastPlayedAt,
          selected: false,
          selectionShare: 0,
        }
      })
      .filter((candidate): candidate is AvatarBehaviorCandidate => candidate !== null)
  }

  private isKnownBehavior(behaviorId: string): behaviorId is AvatarBehaviorId {
    return [
      'idle',
      'listening',
      'thinking',
      'neutral',
      'happy',
      'laugh',
      'warm',
      'calm',
      'sad',
      'crying',
      'angry',
      'fear',
      'surprised',
      'gasp',
      'sigh',
      'groan',
      'whisper',
      'greeting',
    ].includes(behaviorId)
  }

  private toManifestState(mode: string): string {
    return mode === 'awaitingSpeech' ? 'thinking' : mode
  }

  private selectAnimation(
    candidates: AvatarBehaviorCandidate[],
    excludedAnimationIds = new Set<string>(),
    mode = 'idle',
    usage: 'speaking' | 'reaction' = 'speaking',
  ): { animationId: AnimationId; reason: string } {
    this.applyUsageFilter(candidates, mode, usage)
    const available = candidates.filter((candidate) => {
      return (
        candidate.weight > 0 &&
        !candidate.excludedByCooldown &&
        !candidate.excludedByUsage &&
        !candidate.excludedByCamera &&
        !candidate.excludedByAutomaticSelection &&
        !excludedAnimationIds.has(candidate.animationId)
      )
    })
    const excludedCount = candidates.filter((candidate) => candidate.excludedByCooldown).length
    const policyExcludedCount = candidates.filter((candidate) =>
      excludedAnimationIds.has(candidate.animationId),
    ).length
    const usageExcludedCount = candidates.filter((candidate) => candidate.excludedByUsage).length
    const cameraExcludedCount = candidates.filter((candidate) => candidate.excludedByCamera).length
    const automaticSelectionExcludedCount = candidates.filter(
      (candidate) => candidate.excludedByAutomaticSelection,
    ).length

    if (available.length > 0) {
      const animationId = this.selectWeighted(available)
      const suffixParts = [
        excludedCount > 0 ? `${excludedCount} on cooldown` : '',
        policyExcludedCount > 0 ? `${policyExcludedCount} excluded by repeat policy` : '',
        usageExcludedCount > 0 ? `${usageExcludedCount} excluded by conversation usage policy` : '',
        cameraExcludedCount > 0 ? `${cameraExcludedCount} excluded: incompatible camera mode` : '',
        automaticSelectionExcludedCount > 0
          ? `${automaticSelectionExcludedCount} excluded: automatic selection disabled`
          : '',
      ].filter(Boolean)
      const suffix = suffixParts.length > 0 ? `, ${suffixParts.join(', ')}` : ''
      return { animationId, reason: `weighted pick from ${available.length} eligible${suffix}` }
    }

    const weighted = candidates.filter((candidate) => {
      return (
        candidate.weight > 0 &&
        !candidate.excludedByUsage &&
        !candidate.excludedByCamera &&
        !candidate.excludedByAutomaticSelection &&
        !excludedAnimationIds.has(candidate.animationId)
      )
    })
    if (weighted.length === 0) {
      const fallback = this.getFallbackAnimationId(mode, excludedAnimationIds)
      return { animationId: fallback, reason: `no manifest candidates -> fallback ${fallback}` }
    }

    const leastRecent = weighted
      .slice()
      .sort((a, b) => (a.lastPlayedAt ?? 0) - (b.lastPlayedAt ?? 0))[0]
    return {
      animationId:
        leastRecent?.animationId ?? this.getFallbackAnimationId(mode, excludedAnimationIds),
      reason: `all ${weighted.length} on cooldown -> least-recently-played`,
    }
  }

  private annotateCandidates(
    candidates: AvatarBehaviorCandidate[],
    selectedId: AnimationId,
    excludedAnimationIds = new Set<string>(),
  ): void {
    const eligible = candidates.filter((candidate) => {
      return (
        candidate.weight > 0 &&
        !candidate.excludedByCooldown &&
        !candidate.excludedByUsage &&
        !candidate.excludedByCamera &&
        !candidate.excludedByAutomaticSelection &&
        !excludedAnimationIds.has(candidate.animationId)
      )
    })
    const totalWeight = eligible.reduce((sum, candidate) => sum + candidate.weight, 0)

    for (const candidate of candidates) {
      candidate.selected = candidate.animationId === selectedId
      const isEligible =
        candidate.weight > 0 &&
        !candidate.excludedByCooldown &&
        !candidate.excludedByUsage &&
        !candidate.excludedByCamera &&
        !candidate.excludedByAutomaticSelection &&
        !excludedAnimationIds.has(candidate.animationId)
      candidate.selectionShare = isEligible && totalWeight > 0 ? candidate.weight / totalWeight : 0
    }
  }

  private applyUsageFilter(
    candidates: AvatarBehaviorCandidate[],
    mode: string,
    usage: 'speaking' | 'reaction',
  ): void {
    for (const candidate of candidates) {
      if (usage === 'reaction') {
        const entry = getAnimation(candidate.animationId)
        candidate.excludedByUsage = !entry?.usage?.reaction
        continue
      }
      if (mode !== 'speaking') {
        candidate.excludedByUsage = false
        continue
      }
      const entry = getAnimation(candidate.animationId)
      candidate.excludedByUsage = !entry || !isConversationSpeechAnimation(entry)
    }
  }

  private getFallbackAnimationId(
    mode: string,
    excludedAnimationIds = new Set<string>(),
  ): AnimationId {
    const preferred = mode === 'speaking' ? SPEAKING_FALLBACK_ANIMATION_ID : FALLBACK_ANIMATION_ID
    const allowed = (id: AnimationId): boolean => {
      const entry = getAnimation(id)
      return (
        !excludedAnimationIds.has(id) &&
        Boolean(entry && isAnimationCameraCompatible(entry, this.cameraMode))
      )
    }
    if (allowed(preferred)) return preferred
    if (allowed(FALLBACK_ANIMATION_ID)) return FALLBACK_ANIMATION_ID
    if (allowed('neutral2')) return 'neutral2'
    return 'neutral_idle'
  }

  private selectWeighted(candidates: AvatarBehaviorCandidate[]): AnimationId {
    const selectable = candidates.filter((candidate) => candidate.weight > 0)
    if (selectable.length === 0) return FALLBACK_ANIMATION_ID

    const totalWeight = selectable.reduce((sum, candidate) => sum + candidate.weight, 0)
    let roll = Math.random() * totalWeight

    for (const candidate of selectable) {
      roll -= candidate.weight
      if (roll <= 0) return candidate.animationId
    }

    return selectable[selectable.length - 1]?.animationId ?? FALLBACK_ANIMATION_ID
  }
}
