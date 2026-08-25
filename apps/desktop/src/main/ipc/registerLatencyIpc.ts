import { type BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'

import { LATENCY_MILESTONES } from '../../shared/latency'
import { latencyTelemetry } from '../diagnostics/latencyTelemetry'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'

const milestoneSchema = z.object({
  name: z.enum(LATENCY_MILESTONES),
  at: z.number().int().positive(),
  correlation: z.object({
    turnId: z.string().min(1).max(100),
    requestId: z.string().min(1).max(120),
    llmRound: z.number().int().nonnegative(),
    toolCallId: z.string().max(120).optional(),
    ttsSegmentId: z.string().max(120).optional(),
    goalId: z.string().max(120).optional(),
  }),
  status: z.enum(['started', 'success', 'failure', 'cancelled', 'timeout']).optional(),
  provider: z.string().max(100).optional(),
  model: z.string().max(500).optional(),
})

export function registerLatencyIpc(
  window: BrowserWindow,
  authorization: IpcAuthorization,
): () => void {
  ipcMain.handle(
    'latency:snapshot',
    authorization.handle('latency:snapshot', () => latencyTelemetry.snapshot()),
  )
  ipcMain.handle(
    'latency:record',
    authorization.handlePayload('latency:record', IPC_ONE_PAYLOAD, (_event, input) => {
      latencyTelemetry.record(milestoneSchema.parse(input))
      return { ok: true }
    }),
  )
  const unsubscribe = latencyTelemetry.subscribe((snapshot) => {
    if (!window.isDestroyed()) window.webContents.send('latency:changed', snapshot)
  })
  return unsubscribe
}
