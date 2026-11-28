import type { ComputerUseNotableObservation } from '../browser-computer-use'
import type { CharacterEmbodimentIntent } from '../character-response'
import type { EmotionKey } from '../emotion'
import type { WatchReaction } from '../watchTogether'

export type AutonomyMode = 'off' | 'suggest' | 'confirm' | 'full'

export interface AutonomySettings {
  mode: AutonomyMode
  globallySuspended: boolean
  privacyMode: boolean
}

export interface WorldContextSnapshot {
  capturedAt: number
  appFocused: boolean
  globalUserIdleMs: number
  conversationActive: boolean
  audioActive: boolean
  privacyMode: boolean
  lastUserActivityAt: number
  foregroundApplication?: {
    processName: string
    displayName?: string
    windowTitle?: string
  }
  activeBrowser?: {
    sessionActive: boolean
    url?: string
    title?: string
  }
  activeProject?: {
    name?: string
    branch?: string
  }
  media?: {
    playing: boolean
    title?: string
    application?: string
  }
  systemAdapter: 'available' | 'degraded' | 'unavailable'
  freshness: {
    rendererMs: number | null
    /** Maximum age among the available System Context source observations. */
    systemMs: number | null
    systemSources?: {
      globalIdleMs: number | null
      foregroundApplicationMs: number | null
    }
  }
}

export interface RunningApplication {
  processName: string
  displayName?: string
}

export type RunningApplicationsDiagnostic =
  | { status: 'available'; applications: readonly RunningApplication[] }
  | { status: 'private' | 'unavailable' }

export interface AliveAuditEntry {
  id: number
  at: number
  category: 'scheduler' | 'autonomy' | 'experience' | 'behavior' | 'habit' | 'goal'
  event: string
  entityId?: string
  outcome: string
  detail?: string
}

export interface AliveRuntimeHealth {
  operational: boolean
  databaseVersion: number
  lastErrorCode?: string
}

export interface AliveSnapshot {
  settings: AutonomySettings
  mood: MoodState
  lastExperience?: ExperienceAppraisal
  world: WorldContextSnapshot
  health: AliveRuntimeHealth
}

export interface RendererWorldContextInput {
  appFocused: boolean
  userIdleMs: number
  conversationActive: boolean
  audioActive: boolean
  observedAt: number
}

export type ExperienceEvent =
  | { type: 'conversation-completed'; at: number; turnId: string; eventId?: string }
  | { type: 'conversation-interrupted'; at: number; turnId: string; eventId?: string }
  | { type: 'silence-threshold'; at: number; silenceMs: number; eventId?: string }
  | { type: 'action-verified'; at: number; actionId: string; eventId?: string; novelty?: number }
  | { type: 'action-failed'; at: number; actionId: string; eventId?: string; code?: string }
  | { type: 'permission-denied'; at: number; actionId: string; eventId?: string }
  | { type: 'browser-blocked'; at: number; eventId?: string; reason?: string }
  | { type: 'browser-recovered'; at: number; eventId?: string }
  | { type: 'runtime-recovered'; at: number; runtime: string; eventId?: string }
  | { type: 'user-returned'; at: number; idleMs: number; eventId?: string }
  | {
      type: 'watch-screen-moment'
      at: number
      sessionId: string
      reaction: WatchReaction
      expiresAt: number
      eventId?: string
    }
  | {
      type: 'browser-computer-use-event'
      at: number
      sessionId: string
      phase:
        | 'started'
        | 'progress'
        | 'notable-observation'
        | 'blocked'
        | 'completed'
        | 'failed'
        | 'stopped'
      observation?: ComputerUseNotableObservation
      errorCode?: string
      eventId?: string
    }
  | {
      type: 'meaningful-world-context-changed'
      at: number
      change: 'foreground-application' | 'browser' | 'project' | 'media'
      eventId?: string
    }

export interface ExperienceAppraisal {
  eventId: string
  origin?: 'browser-computer-use'
  embodimentPresence?: BehaviorEmbodimentPresence
  salience: number
  valence: number
  arousal: number
  novelty: number
  socialRelevance: number
  emotionHint?: EmotionKey
  embodimentHint?: CharacterEmbodimentIntent
  conversationalImpulse?: { topic: string; priority: number }
  memoryCandidate?: { kind: 'episodic' | 'decision' | 'relationship'; summary: string }
  silence: boolean
}

export interface MoodState {
  valence: number
  arousal: number
  confidence: number
  playfulness: number
  curiosity: number
  frustration: number
  updatedAt: number
}

export interface AmbientPresenceIntent {
  attention: 'user' | 'screen' | 'foreground-change' | 'relaxed'
  energy: 'low' | 'normal' | 'engaged'
  curiosity: number
  embodiment?: CharacterEmbodimentIntent
}

export type BehaviorIntent =
  | { kind: 'none' }
  | { kind: 'embodiment'; intent: CharacterEmbodimentIntent }
  | { kind: 'conversation-candidate'; topic: string; priority: number }

export interface BehaviorEmbodimentPresence {
  source: 'browser-computer-use'
  sessionId: string
  screenGazeActive: boolean
}

export interface BehaviorCommand {
  id: string
  at: number
  sourceEventId?: string
  /** Main-owned Gate decision; absence never grants conversation admission. */
  initiativeDisposition?: 'admit' | 'preview'
  embodimentPresence?: BehaviorEmbodimentPresence
  /** Main-selected idle activity; the renderer only executes it. */
  idleActivityId?: string
  watchReaction?: { sessionId: string; expiresAt: number }
  /** Transient idle presentation: the renderer releases the intent after this hold. */
  holdMs?: number
  intent: BehaviorIntent
}

export interface AttentionCandidate {
  id: string
  source: 'speech' | 'world' | 'experience' | 'behavior'
  summary: string
  salience: number
  novelty: number
  urgency: number
  socialRelevance: number
  interruptibility: 'never' | 'when-idle' | 'normal' | 'urgent'
  createdAt: number
  expiresAt?: number
}

export type AttentionDisposition = 'ignore' | 'observe' | 'admit'

export interface AttentionDecision {
  disposition: AttentionDisposition
  candidateId?: string
  confidence: number
  source: 'deterministic'
  reason: string
  latencyMs: number
}

export interface SpeechAttentionInput {
  utteranceId: string
  directAddress: boolean
  question: boolean
  recentConversation: boolean
  speaking: boolean
  cooldownActive: boolean
}

export interface SpeechAttentionDecision {
  shouldAttend: boolean
  confidence: number
  source: 'deterministic'
  reason: string
  latencyMs: number
}
