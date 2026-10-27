import { ipcMain } from 'electron'
import { z } from 'zod'

import {
  motionNextSchema,
  motionStartSchema,
  motionStopSchema,
  motionVariationSchema,
} from '../../shared/motion'
import type { ArdyMotionService } from '../motion/ArdyMotionService'
import type { IpcAuthorization } from './IpcAuthorization'

export function registerMotionIpc(
  service: ArdyMotionService,
  authorization: IpcAuthorization,
): void {
  ipcMain.handle(
    'motion:status',
    authorization.handle('motion:status', () => service.status()),
  )
  ipcMain.handle(
    'motion:start',
    authorization.handlePayload(
      'motion:start',
      z.tuple([motionStartSchema]),
      async (event, input) => {
        try {
          return {
            ok: true,
            lease: await service.start(event.sender.id, input.avatarGeneration, input.seed),
          }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : 'ARDY_UNAVAILABLE' }
        }
      },
    ),
  )
  ipcMain.handle(
    'motion:next',
    authorization.handlePayload(
      'motion:next',
      z.tuple([motionNextSchema]),
      async (event, input) => {
        try {
          return {
            ok: true,
            chunk: await service.next(
              event.sender.id,
              input.lease,
              input.profileId,
              input.fromFrame,
              input.plan,
            ),
          }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : 'ARDY_UNAVAILABLE' }
        }
      },
    ),
  )
  ipcMain.handle(
    'motion:stop',
    authorization.handlePayload(
      'motion:stop',
      z.tuple([motionStopSchema]),
      async (event, lease) => ({ ok: await service.stop(event.sender.id, lease) }),
    ),
  )
  ipcMain.handle(
    'motion:reroll',
    authorization.handlePayload(
      'motion:reroll',
      z.tuple([motionVariationSchema]),
      async (event, input) => {
        try {
          return { ok: true, lease: await service.reroll(event.sender.id, input.lease, input.seed) }
        } catch {
          return { ok: false, error: 'ARDY_STALE_SESSION' }
        }
      },
    ),
  )
}
