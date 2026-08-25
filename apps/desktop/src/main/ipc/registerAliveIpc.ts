import { type BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'

import type { AliveRuntime } from '../alive'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'

const autonomySettingsSchema = z.object({
  mode: z.enum(['off', 'suggest', 'confirm', 'full']),
  globallySuspended: z.boolean(),
  privacyMode: z.boolean(),
  quietHours: z.object({
    enabled: z.boolean(),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(0).max(23),
  }),
  cooldownMs: z.number().int().min(10_000).max(86_400_000),
  maxDailyInitiatives: z.number().int().min(0).max(100),
  fastBrain: z.object({
    enabled: z.boolean(),
    timeoutMs: z.number().int().min(250).max(5_000),
    maxTokens: z.number().int().min(16).max(256),
    providerId: z.enum(['groq', 'cloudflare', 'openrouter', 'mistral']).optional(),
    model: z.string().trim().max(200).optional(),
  }),
})

const worldSchema = z.object({
  appFocused: z.boolean(),
  userIdleMs: z.number().int().nonnegative().max(604_800_000),
  conversationActive: z.boolean(),
  audioActive: z.boolean(),
  observedAt: z.number().int().positive(),
})

const eventId = z.string().trim().min(1).max(160).optional()
const eventAt = z.number().int().positive()

const experienceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('conversation-completed'),
    at: eventAt,
    turnId: z.string().max(100),
    eventId,
  }),
  z.object({
    type: z.literal('conversation-interrupted'),
    at: eventAt,
    turnId: z.string().max(100),
    eventId,
  }),
  z.object({
    type: z.literal('task-completed'),
    at: eventAt,
    taskId: z.string().uuid(),
    eventId,
    verified: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('silence-threshold'),
    at: eventAt,
    silenceMs: z.number().nonnegative(),
    eventId,
  }),
  z.object({
    type: z.literal('action-verified'),
    at: eventAt,
    actionId: z.string().trim().min(1).max(160),
    eventId,
    novelty: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal('action-failed'),
    at: eventAt,
    actionId: z.string().trim().min(1).max(160),
    eventId,
    code: z.string().trim().max(100).optional(),
  }),
  z.object({
    type: z.literal('permission-denied'),
    at: eventAt,
    actionId: z.string().trim().min(1).max(160),
    eventId,
  }),
  z.object({
    type: z.literal('browser-blocked'),
    at: eventAt,
    eventId,
    reason: z.string().trim().max(300).optional(),
  }),
  z.object({ type: z.literal('browser-recovered'), at: eventAt, eventId }),
  z.object({
    type: z.literal('goal-progressed'),
    at: eventAt,
    goalId: z.string().uuid(),
    eventId,
  }),
  z.object({
    type: z.literal('goal-completed'),
    at: eventAt,
    goalId: z.string().uuid(),
    eventId,
  }),
  z.object({
    type: z.literal('goal-failed'),
    at: eventAt,
    goalId: z.string().uuid(),
    eventId,
  }),
  z.object({
    type: z.literal('scheduled-event-due'),
    at: eventAt,
    taskId: z.string().uuid(),
    eventId,
  }),
  z.object({
    type: z.literal('runtime-recovered'),
    at: eventAt,
    runtime: z.string().trim().min(1).max(100),
    eventId,
  }),
  z.object({
    type: z.literal('user-returned'),
    at: eventAt,
    idleMs: z.number().int().nonnegative().max(604_800_000),
    eventId,
  }),
  z.object({
    type: z.literal('meaningful-world-context-changed'),
    at: eventAt,
    change: z.enum(['foreground-application', 'browser', 'project', 'media', 'system']),
    eventId,
  }),
])

export function registerAliveIpc(
  runtime: AliveRuntime,
  window: BrowserWindow,
  authorization: IpcAuthorization,
): () => void {
  ipcMain.handle(
    'alive:snapshot',
    authorization.handle('alive:snapshot', () => runtime.snapshot()),
  )
  ipcMain.handle(
    'alive:update-settings',
    authorization.handlePayload('alive:update-settings', IPC_ONE_PAYLOAD, (_event, input) =>
      runtime.updateSettings(autonomySettingsSchema.parse(input)),
    ),
  )
  ipcMain.handle(
    'alive:update-world',
    authorization.handlePayload('alive:update-world', IPC_ONE_PAYLOAD, (_event, input) => {
      runtime.updateWorld(worldSchema.parse(input))
      return { ok: true }
    }),
  )
  ipcMain.handle(
    'alive:report-experience',
    authorization.handlePayload('alive:report-experience', IPC_ONE_PAYLOAD, (_event, input) => {
      runtime.reportExperience(experienceSchema.parse(input))
      return { ok: true }
    }),
  )
  ipcMain.handle(
    'alive:create-goal',
    authorization.handlePayload('alive:create-goal', IPC_ONE_PAYLOAD, (_event, input) =>
      runtime.createGoal(
        z
          .object({
            title: z.string().trim().min(1).max(160),
            description: z.string().trim().max(2_000).optional(),
            nextStep: z.string().trim().max(1_000).optional(),
            owner: z.enum(['user', 'shio', 'shared']).optional(),
            measurable: z.boolean().optional(),
          })
          .parse(input),
      ),
    ),
  )
  ipcMain.handle(
    'alive:update-goal',
    authorization.handlePayload('alive:update-goal', IPC_ONE_PAYLOAD, (_event, input) =>
      runtime.updateGoal(
        z
          .object({
            id: z.string().uuid(),
            title: z.string().trim().min(1).max(160).optional(),
            description: z.string().trim().max(2_000).optional(),
            nextStep: z.string().trim().max(1_000).optional(),
            lastNote: z.string().trim().max(1_000).optional(),
            owner: z.enum(['user', 'shio', 'shared']).optional(),
            status: z
              .enum([
                'active',
                'waiting_user',
                'waiting_external',
                'paused',
                'completed',
                'cancelled',
              ])
              .optional(),
            measurable: z.boolean().optional(),
          })
          .parse(input),
      ),
    ),
  )
  ipcMain.handle(
    'alive:create-task',
    authorization.handlePayload('alive:create-task', IPC_ONE_PAYLOAD, (_event, input) =>
      runtime.createTask(
        z
          .object({
            title: z.string().trim().min(1).max(160),
            kind: z.enum(['reminder', 'check_in']),
            dueAt: z.number().int().positive(),
            intervalMs: z.number().int().min(60_000).max(31_536_000_000).optional(),
            goalId: z.string().uuid().optional(),
          })
          .parse(input),
      ),
    ),
  )
  ipcMain.handle(
    'alive:set-task-status',
    authorization.handlePayload('alive:set-task-status', IPC_ONE_PAYLOAD, (_event, input) => {
      const parsed = z
        .object({
          id: z.string().uuid(),
          status: z.enum(['scheduled', 'waiting_confirmation', 'completed', 'paused']),
        })
        .parse(input)
      return runtime.setTaskStatus(parsed.id, parsed.status)
    }),
  )
  ipcMain.handle(
    'alive:approve-task',
    authorization.handlePayload('alive:approve-task', IPC_ONE_PAYLOAD, (_event, input) =>
      runtime.approveTaskRun(z.string().uuid().parse(input)),
    ),
  )
  ipcMain.handle(
    'alive:decide-habit',
    authorization.handlePayload('alive:decide-habit', IPC_ONE_PAYLOAD, (_event, input) => {
      const parsed = z
        .object({ id: z.string().uuid(), status: z.enum(['approved', 'rejected']) })
        .parse(input)
      return runtime.decideHabit(parsed.id, parsed.status)
    }),
  )
  ipcMain.handle(
    'alive:evaluate-attention',
    authorization.handlePayload('alive:evaluate-attention', IPC_ONE_PAYLOAD, (_event, input) =>
      runtime.evaluateAttention(
        z
          .object({
            utteranceId: z.string().min(1).max(100),
            directAddress: z.boolean(),
            question: z.boolean(),
            recentConversation: z.boolean(),
            speaking: z.boolean(),
            cooldownActive: z.boolean(),
          })
          .parse(input),
      ),
    ),
  )

  const unsubscribeChanged = runtime.onChanged((snapshot) => {
    if (!window.isDestroyed()) window.webContents.send('alive:changed', snapshot)
  })
  const unsubscribeBehavior = runtime.onBehavior((command) => {
    if (!window.isDestroyed()) window.webContents.send('alive:behavior', command)
  })
  return () => {
    unsubscribeChanged()
    unsubscribeBehavior()
  }
}
