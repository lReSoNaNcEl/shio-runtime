import type { GameSemanticEvent } from '../browser-game'
import type { CharacterEmbodimentIntent } from '../character-response'
import type { EmotionKey } from '../emotion'
import type { LlmProviderId } from '../llm'

export type AutonomyMode = 'off' | 'suggest' | 'confirm' | 'full'

export interface AutonomySettings {
  mode: AutonomyMode
  globallySuspended: boolean
  privacyMode: boolean
  quietHours: { enabled: boolean; startHour: number; endHour: number }
  cooldownMs: number
  maxDailyInitiatives: number
  fastBrain: {
    enabled: boolean
    timeoutMs: number
    maxTokens: number
    providerId?: LlmProviderId
    model?: string
  }
}

export type GoalStatus =
  | 'active'
  | 'waiting_user'
  | 'waiting_external'
  | 'paused'
  | 'completed'
  | 'cancelled'

export type GoalOwner = 'user' | 'shio' | 'shared'

export interface PersistentGoal {
  id: string
  title: string
  description: string
  nextStep: string
  lastNote: string
  owner: GoalOwner
  status: GoalStatus
  progress: number
  measurable: boolean
  createdAt: number
  updatedAt: number
}

export type GoalExecutionPhase =
  | 'idle'
  | 'planning'
  | 'running'
  | 'waiting-user'
  | 'waiting-event'
  | 'verifying'
  | 'paused'
  | 'completed'
  | 'failed'

export interface GoalExecutionBudget {
  maxSteps: number
  maxToolCalls: number
  maxElapsedMs: number
  maxFailures: number
}

export interface GoalExecutionState {
  goalId: string
  phase: GoalExecutionPhase
  currentStep?: string
  plannedSteps: readonly string[]
  completedSteps: readonly string[]
  attempts: number
  toolCalls: number
  failures: number
  startedAt?: number
  lastProgressAt?: number
  actionBudget: GoalExecutionBudget
  updatedAt: number
}

export type GoalWorldEventType =
  | 'user-returned'
  | 'foreground-changed'
  | 'network-restored'
  | 'media-ended'

export type GoalWakeCondition =
  | { kind: 'time'; at: number }
  | { kind: 'action-terminal'; actionId: string }
  | { kind: 'process-exit'; processId: number }
  | {
      kind: 'browser-url'
      sessionId: string
      predicate: { operator: 'equals' | 'prefix' | 'origin'; value: string }
    }
  | {
      kind: 'world-event'
      eventType: GoalWorldEventType
    }

export type GoalWakeEvent =
  | { kind: 'time'; at: number }
  | { kind: 'action-terminal'; actionId: string; verified: boolean; at: number }
  | { kind: 'process-exit'; processId: number; at: number }
  | { kind: 'browser-url'; sessionId: string; url: string; at: number }
  | { kind: 'world-event'; eventType: GoalWorldEventType; at: number }

export interface GoalEventWatch {
  id: string
  goalId: string
  condition: GoalWakeCondition
  status: 'active' | 'satisfied' | 'cancelled'
  createdAt: number
  satisfiedAt?: number
}

export type AutonomyRiskClass = 'read-only' | 'mutating' | 'destructive' | 'unknown'

export interface AutonomyScope {
  id: string
  goalId?: string
  allowedApplications?: readonly string[]
  allowedFilesystemRoots?: readonly string[]
  allowedOrigins?: readonly string[]
  maxActions?: number
  actionsUsed: number
  expiresAt?: number
  allowedRiskClasses?: readonly AutonomyRiskClass[]
  approvedAt: number
}

export type ScheduledTaskKind = 'reminder' | 'check_in'
export type ScheduledTaskStatus = 'scheduled' | 'waiting_confirmation' | 'completed' | 'paused'

export interface ScheduledTask {
  id: string
  title: string
  kind: ScheduledTaskKind
  dueAt: number
  intervalMs?: number
  status: ScheduledTaskStatus
  goalId?: string
  lastRunAt?: number
  nextRunAt: number
  createdAt: number
  updatedAt: number
}

export interface HabitSuggestion {
  id: string
  key: string
  title: string
  evidenceCount: number
  status: 'pending' | 'approved' | 'rejected'
  createdAt: number
  updatedAt: number
}

export interface WorldContextSnapshot {
  capturedAt: number
  appFocused: boolean
  globalUserIdleMs: number
  /** @deprecated Renderer-local compatibility projection. */
  userIdleMs: number
  conversationActive: boolean
  audioActive: boolean
  privacyMode: boolean
  lastUserActivityAt: number
  foregroundApplication?: {
    processName: string
    displayName?: string
    windowTitle?: string
  }
  runningApplications?: readonly {
    processName: string
    displayName?: string
  }[]
  activeBrowser?: {
    sessionActive: boolean
    url?: string
    title?: string
  }
  activeProject?: {
    name?: string
    branch?: string
  }
  activeGoal?: {
    id: string
    title: string
    state: string
  }
  media?: {
    playing: boolean
    title?: string
    application?: string
  }
  system?: {
    cpuLoad?: number
    memoryLoad?: number
    gpuLoad?: number
  }
  systemAdapter: 'available' | 'degraded' | 'unavailable'
  freshness: {
    rendererMs: number | null
    schedulerMs: number | null
    /** Maximum age among the available System Context source observations. */
    systemMs: number | null
    systemSources?: {
      globalIdleMs: number | null
      foregroundApplicationMs: number | null
      runningApplicationsMs: number | null
      systemLoadMs: number | null
    }
  }
}

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
  schedulerRunning: boolean
  databaseVersion: number
  lastTickAt: number | null
  pendingConfirmations: number
  activeGoals: number
  scheduledTasks: number
  pendingHabitSuggestions: number
  lastErrorCode?: string
}

export interface AliveSnapshot {
  settings: AutonomySettings
  goals: readonly PersistentGoal[]
  goalExecutions: readonly GoalExecutionState[]
  goalWatches: readonly GoalEventWatch[]
  tasks: readonly ScheduledTask[]
  habitSuggestions: readonly HabitSuggestion[]
  mood: MoodState
  lastExperience?: ExperienceAppraisal
  world: WorldContextSnapshot
  audit: readonly AliveAuditEntry[]
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
  | { type: 'task-completed'; at: number; taskId: string; eventId?: string; verified?: boolean }
  | { type: 'silence-threshold'; at: number; silenceMs: number; eventId?: string }
  | { type: 'action-verified'; at: number; actionId: string; eventId?: string; novelty?: number }
  | { type: 'action-failed'; at: number; actionId: string; eventId?: string; code?: string }
  | { type: 'permission-denied'; at: number; actionId: string; eventId?: string }
  | { type: 'browser-blocked'; at: number; eventId?: string; reason?: string }
  | { type: 'browser-recovered'; at: number; eventId?: string }
  | { type: 'goal-progressed'; at: number; goalId: string; eventId?: string }
  | { type: 'goal-completed'; at: number; goalId: string; eventId?: string }
  | { type: 'goal-failed'; at: number; goalId: string; eventId?: string }
  | { type: 'scheduled-event-due'; at: number; taskId: string; eventId?: string }
  | { type: 'runtime-recovered'; at: number; runtime: string; eventId?: string }
  | { type: 'user-returned'; at: number; idleMs: number; eventId?: string }
  | { type: 'game-event'; at: number; gameEvent: GameSemanticEvent; eventId?: string }
  | {
      type: 'meaningful-world-context-changed'
      at: number
      change: 'foreground-application' | 'browser' | 'project' | 'media' | 'system'
      eventId?: string
    }

export interface ExperienceAppraisal {
  eventId: string
  origin?: 'browser-game'
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

export type BehaviorIntent =
  | { kind: 'none' }
  | { kind: 'embodiment'; intent: CharacterEmbodimentIntent }
  | { kind: 'conversation-candidate'; topic: string; priority: number }
  | { kind: 'goal-suggestion'; objective: string; reason: string }

export interface BehaviorEmbodimentPresence {
  source: 'browser-game'
  sessionId: string
  screenGazeActive: boolean
}

export interface BehaviorCommand {
  id: string
  at: number
  sourceEventId?: string
  embodimentPresence?: BehaviorEmbodimentPresence
  intent: BehaviorIntent
}

export interface AttentionCandidate {
  id: string
  source: 'speech' | 'world' | 'experience' | 'scheduler' | 'goal' | 'behavior'
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
  source: 'deterministic' | 'model' | 'fallback'
  reason: string
  latencyMs: number
}

export interface FastBrainAttentionInput {
  utteranceId: string
  directAddress: boolean
  question: boolean
  recentConversation: boolean
  speaking: boolean
  cooldownActive: boolean
}

export interface FastBrainAttentionDecision {
  shouldAttend: boolean
  confidence: number
  source: 'disabled' | 'deterministic' | 'model' | 'fallback'
  reason: string
  latencyMs: number
}

export interface CreateGoalInput {
  title: string
  description?: string
  nextStep?: string
  owner?: GoalOwner
  measurable?: boolean
}

export interface UpdateGoalInput {
  id: string
  title?: string
  description?: string
  nextStep?: string
  lastNote?: string
  owner?: GoalOwner
  status?: GoalStatus
  measurable?: boolean
}

export type PersistentGoalProvider = () => readonly PersistentGoal[]

export type CreatePersistentGoal = (input: CreateGoalInput) => PersistentGoal

export type ReviseGoalInput = UpdateGoalInput & { progressPercent?: number }

export type RevisePersistentGoal = (input: ReviseGoalInput) => PersistentGoal

export interface CreateScheduledTaskInput {
  title: string
  kind: ScheduledTaskKind
  dueAt: number
  intervalMs?: number
  goalId?: string
}
