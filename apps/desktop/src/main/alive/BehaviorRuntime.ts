import { randomUUID } from 'node:crypto'

import type {
  AutonomySettings,
  BehaviorCommand,
  ExperienceAppraisal,
  MoodState,
  WorldContextSnapshot,
} from '../../shared/alive'
import type { CharacterEmbodimentIntent } from '../../shared/character-response'

const BASE_NONVERBAL_COOLDOWN_MS = 90_000
const GAME_NONVERBAL_COOLDOWN_MS = 5_000
const BASE_CONVERSATION_CANDIDATE_COOLDOWN_MS = 5 * 60_000
const GAME_CONVERSATION_CANDIDATE_COOLDOWN_MS = 30_000
const GAME_CONVERSATION_WINDOW_MS = 60_000
const GAME_MAX_CONVERSATION_CANDIDATES_PER_WINDOW = 2
const IMPORTANT_INITIATIVE_PRIORITY = 0.75

export type ConversationCandidateDisposition =
  | 'not-requested'
  | 'selected'
  | 'suppressed-policy'
  | 'suppressed-threshold'
  | 'suppressed-busy'
  | 'suppressed-cooldown'
  | 'suppressed-budget'

export interface BehaviorDecision {
  command: BehaviorCommand
  conversationCandidate: ConversationCandidateDisposition
}

interface BehaviorDecisionInput {
  appraisal: ExperienceAppraisal
  mood: MoodState
  settings: AutonomySettings
  world: WorldContextSnapshot
  at: number
  conversationAllowed?: boolean
}

interface MoodBehaviorProfile {
  conversationThreshold: number
  initiativeChance: number
  conversationCooldownMs: number
  nonverbalThreshold: number
  nonverbalChance: number
  nonverbalCooldownMs: number
  banterAllowed: boolean
}

export class BehaviorRuntime {
  private lastNonverbalAt: number | null = null
  private lastConversationCandidateAt: number | null = null
  private gameConversationCandidateAt: number[] = []

  decide(input: BehaviorDecisionInput): BehaviorCommand {
    return this.decideWithDiagnostics(input).command
  }

  assessConversationCandidate(input: BehaviorDecisionInput): ConversationCandidateDisposition {
    const { appraisal, mood, settings, at } = input
    const conversationalImpulse = appraisal.conversationalImpulse
    if (!conversationalImpulse) return 'not-requested'
    if (
      settings.globallySuspended ||
      settings.privacyMode ||
      settings.mode === 'off' ||
      insideQuietHours(settings, at) ||
      input.conversationAllowed === false
    ) {
      return 'suppressed-policy'
    }
    const profile = moodBehaviorProfile(appraisal, mood)
    if (
      conversationalImpulse.priority < profile.conversationThreshold ||
      !allowsInitiative(appraisal, profile)
    ) {
      return 'suppressed-threshold'
    }
    const gate = this.conversationGate(appraisal, at, appraisal.origin === 'browser-game', profile)
    if (gate === 'budget') return 'suppressed-budget'
    return gate === 'cooldown' ? 'suppressed-cooldown' : 'selected'
  }

  decideWithDiagnostics(input: BehaviorDecisionInput): BehaviorDecision {
    const { appraisal, mood, settings, at } = input
    const gameEvent = appraisal.origin === 'browser-game'
    const conversationCandidate = this.assessConversationCandidate(input)
    if (
      settings.globallySuspended ||
      settings.privacyMode ||
      settings.mode === 'off' ||
      insideQuietHours(settings, at)
    ) {
      return decision(
        command(at, appraisal.eventId, { kind: 'none' }, appraisal.embodimentPresence),
        conversationCandidate,
      )
    }
    const profile = moodBehaviorProfile(appraisal, mood)
    const conversationalImpulse = appraisal.conversationalImpulse
    if (conversationalImpulse && conversationCandidate === 'selected') {
      this.lastConversationCandidateAt = at
      if (gameEvent) {
        this.gameConversationCandidateAt = this.recentGameConversationCandidates(at)
        this.gameConversationCandidateAt.push(at)
      }
      return decision(
        command(
          at,
          appraisal.eventId,
          {
            kind: 'conversation-candidate',
            topic: conversationalImpulse.topic.slice(0, 300),
            priority: boundedUnit(
              conversationalImpulse.priority + (profile.banterAllowed ? 0.03 : 0),
            ),
          },
          appraisal.embodimentPresence,
        ),
        conversationCandidate,
      )
    }
    const embodimentHint = moodModulatedEmbodiment(appraisal, mood)
    const nonverbalCooldownMs = gameEvent
      ? Math.round(
          GAME_NONVERBAL_COOLDOWN_MS *
            bounded(profile.nonverbalCooldownMs / BASE_NONVERBAL_COOLDOWN_MS, 0.6, 1.25),
        )
      : profile.nonverbalCooldownMs
    if (
      embodimentHint &&
      appraisal.salience >= profile.nonverbalThreshold &&
      (appraisal.salience >= 0.75 ||
        deterministicSample(`${appraisal.eventId}:nonverbal`) <= profile.nonverbalChance) &&
      (this.lastNonverbalAt === null || at - this.lastNonverbalAt >= nonverbalCooldownMs)
    ) {
      this.lastNonverbalAt = at
      return decision(
        command(
          at,
          appraisal.eventId,
          { kind: 'embodiment', intent: embodimentHint },
          appraisal.embodimentPresence,
        ),
        conversationCandidate,
      )
    }
    return decision(
      command(at, appraisal.eventId, { kind: 'none' }, appraisal.embodimentPresence),
      conversationCandidate,
    )
  }

  scheduledInitiative(taskId: string, title: string, at: number): BehaviorCommand {
    return this.proactiveInitiative(`scheduled-event-due:${taskId}:${at}`, title, 0.75, at)
  }

  proactiveInitiative(
    sourceEventId: string,
    topic: string,
    priority: number,
    at: number,
  ): BehaviorCommand {
    return {
      id: randomUUID(),
      at,
      sourceEventId: sourceEventId.slice(0, 160),
      intent: {
        kind: 'conversation-candidate',
        topic: topic.slice(0, 300),
        priority: boundedUnit(priority),
      },
    }
  }

  private conversationGate(
    appraisal: ExperienceAppraisal,
    at: number,
    gameEvent: boolean,
    profile: MoodBehaviorProfile,
  ): 'allow' | 'cooldown' | 'budget' {
    if (!gameEvent) {
      return this.lastConversationCandidateAt === null ||
        at - this.lastConversationCandidateAt >= profile.conversationCooldownMs
        ? 'allow'
        : 'cooldown'
    }
    if ((appraisal.conversationalImpulse?.priority ?? 0) >= 0.98) return 'allow'
    if (
      this.recentGameConversationCandidates(at).length >=
      GAME_MAX_CONVERSATION_CANDIDATES_PER_WINDOW
    ) {
      return 'budget'
    }
    if ((appraisal.conversationalImpulse?.priority ?? 0) >= 0.9) return 'allow'
    const gameCooldownMs = Math.round(
      GAME_CONVERSATION_CANDIDATE_COOLDOWN_MS *
        bounded(
          profile.conversationCooldownMs / BASE_CONVERSATION_CANDIDATE_COOLDOWN_MS,
          0.65,
          1.35,
        ),
    )
    return this.lastConversationCandidateAt === null ||
      at - this.lastConversationCandidateAt >= gameCooldownMs
      ? 'allow'
      : 'cooldown'
  }

  private recentGameConversationCandidates(at: number): number[] {
    return this.gameConversationCandidateAt.filter(
      (candidateAt) => at - candidateAt < GAME_CONVERSATION_WINDOW_MS,
    )
  }
}

function decision(
  command: BehaviorCommand,
  conversationCandidate: ConversationCandidateDisposition,
): BehaviorDecision {
  return { command, conversationCandidate }
}

function moodBehaviorProfile(
  appraisal: ExperienceAppraisal,
  rawMood: MoodState,
): MoodBehaviorProfile {
  const mood = normalizedMood(rawMood)
  const playfulnessDelta = mood.playfulness - 0.5
  const curiosityDelta = mood.curiosity - 0.55
  const negative = appraisal.valence < 0
  const frustrationThresholdDelta = negative ? -mood.frustration * 0.05 : mood.frustration * 0.08
  const banterAllowed =
    appraisal.valence >= 0 && mood.playfulness >= 0.7 && mood.frustration <= 0.45
  return Object.freeze({
    conversationThreshold: bounded(
      0.65 -
        playfulnessDelta * 0.1 -
        curiosityDelta * 0.05 +
        frustrationThresholdDelta -
        (banterAllowed ? 0.03 : 0),
      0.5,
      0.82,
    ),
    initiativeChance: boundedUnit(
      0.82 +
        playfulnessDelta * 0.3 +
        curiosityDelta * 0.12 +
        (negative ? mood.frustration * 0.05 : -mood.frustration * 0.12),
    ),
    conversationCooldownMs: Math.round(
      BASE_CONVERSATION_CANDIDATE_COOLDOWN_MS *
        bounded(
          1 -
            playfulnessDelta * 0.3 -
            curiosityDelta * 0.1 +
            (negative ? -mood.frustration * 0.12 : mood.frustration * 0.25),
          0.65,
          1.35,
        ),
    ),
    nonverbalThreshold: bounded(0.18 - curiosityDelta * 0.18, 0.08, 0.3),
    nonverbalChance: boundedUnit(
      0.94 + curiosityDelta * 0.25 + (negative ? mood.frustration * 0.04 : 0),
    ),
    nonverbalCooldownMs: Math.round(
      BASE_NONVERBAL_COOLDOWN_MS *
        bounded(1 - curiosityDelta * 0.5 + (negative ? -mood.frustration * 0.1 : 0), 0.6, 1.25),
    ),
    banterAllowed,
  })
}

function allowsInitiative(appraisal: ExperienceAppraisal, profile: MoodBehaviorProfile): boolean {
  const priority = appraisal.conversationalImpulse?.priority ?? 0
  return (
    priority >= IMPORTANT_INITIATIVE_PRIORITY ||
    deterministicSample(`${appraisal.eventId}:initiative`) <= profile.initiativeChance
  )
}

function moodModulatedEmbodiment(
  appraisal: ExperienceAppraisal,
  rawMood: MoodState,
): CharacterEmbodimentIntent | undefined {
  const mood = normalizedMood(rawMood)
  const base =
    appraisal.embodimentHint ??
    (mood.curiosity >= 0.75 && appraisal.novelty >= 0.35
      ? ({ intensity: 'subtle', gestureHint: 'think', gazeHint: 'screen' } as const)
      : undefined)
  if (!base) return undefined
  const intensities = ['subtle', 'normal', 'strong'] as const
  const currentIndex = intensities.indexOf(base.intensity)
  const lowerPositiveCelebration =
    appraisal.valence > 0 && base.gestureHint === 'celebrate' && mood.frustration >= 0.45
  const sharpenNegativeReaction =
    appraisal.valence < 0 && mood.frustration >= 0.6 && mood.arousal >= 0.2
  const arousedSalientReaction = mood.arousal >= 0.7 && appraisal.salience >= 0.7
  const delta = lowerPositiveCelebration
    ? -1
    : sharpenNegativeReaction || arousedSalientReaction
      ? 1
      : 0
  const intensity = intensities[Math.max(0, Math.min(intensities.length - 1, currentIndex + delta))]
  return Object.freeze({ ...base, intensity })
}

function normalizedMood(mood: MoodState): MoodState {
  return {
    valence: bounded(mood.valence, -1, 1),
    arousal: bounded(mood.arousal, -1, 1),
    confidence: boundedUnit(mood.confidence),
    playfulness: boundedUnit(mood.playfulness),
    curiosity: boundedUnit(mood.curiosity),
    frustration: boundedUnit(mood.frustration),
    updatedAt: Math.max(0, mood.updatedAt),
  }
}

function deterministicSample(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) / 0x1_0000_0000
}

function command(
  at: number,
  sourceEventId: string,
  intent: BehaviorCommand['intent'],
  embodimentPresence?: BehaviorCommand['embodimentPresence'],
): BehaviorCommand {
  return { id: randomUUID(), at, sourceEventId, embodimentPresence, intent }
}

function boundedUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function bounded(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function insideQuietHours(settings: AutonomySettings, now: number): boolean {
  if (!settings.quietHours.enabled) return false
  const hour = new Date(now).getHours()
  const { startHour, endHour } = settings.quietHours
  return startHour === endHour
    ? true
    : startHour < endHour
      ? hour >= startHour && hour < endHour
      : hour >= startHour || hour < endHour
}
