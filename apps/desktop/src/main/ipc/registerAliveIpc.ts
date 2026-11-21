import { type BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'

import type { AliveRuntime } from '../alive'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'

const autonomySettingsSchema = z.object({
  mode: z.enum(['off', 'suggest', 'confirm', 'full']),
  globallySuspended: z.boolean(),
  privacyMode: z.boolean(),
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
    change: z.enum(['foreground-application', 'browser', 'project', 'media']),
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
    'diagnostics:get-alive-audit',
    authorization.handle('diagnostics:get-alive-audit', () => runtime.recentAudit()),
  )
  ipcMain.handle(
    'diagnostics:get-running-applications',
    authorization.handle('diagnostics:get-running-applications', () =>
      runtime.getRunningApplications(),
    ),
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
    ipcMain.removeHandler('diagnostics:get-alive-audit')
    ipcMain.removeHandler('diagnostics:get-running-applications')
    unsubscribeChanged()
    unsubscribeBehavior()
  }
}
