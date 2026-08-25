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

export type GoalStatus = 'active' | 'paused' | 'completed' | 'cancelled'

export interface PersistentGoal {
  id: string
  title: string
  description: string
  status: GoalStatus
  progress: number
  createdAt: number
  updatedAt: number
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
  userIdleMs: number
  conversationActive: boolean
  audioActive: boolean
  privacyMode: boolean
  lastUserActivityAt: number
  freshness: {
    rendererMs: number | null
    schedulerMs: number | null
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
  tasks: readonly ScheduledTask[]
  habitSuggestions: readonly HabitSuggestion[]
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
  | { type: 'conversation-completed'; at: number; turnId: string }
  | { type: 'conversation-interrupted'; at: number; turnId: string }
  | { type: 'task-completed'; at: number; taskId: string }
  | { type: 'silence-threshold'; at: number; silenceMs: number }

export type BehaviorCommand =
  | { type: 'orient'; id: string; at: number; direction: 'user' | 'screen' }
  | { type: 'idle-reaction'; id: string; at: number; intensity: 'subtle' }
  | { type: 'initiative'; id: string; at: number; taskId: string; title: string }

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
}

export interface UpdateGoalInput {
  id: string
  title?: string
  description?: string
  status?: GoalStatus
}

export type PersistentGoalProvider = () => readonly PersistentGoal[]

export interface CreateScheduledTaskInput {
  title: string
  kind: ScheduledTaskKind
  dueAt: number
  intervalMs?: number
  goalId?: string
}
