import { randomUUID } from 'node:crypto'

import { type BrowserWindow, ipcMain } from 'electron'

import {
  actionAcknowledgementSchema,
  actionConfirmationResponseSchema,
  actionRuntimeSnapshotSchema,
  authorityChangeRequestSchema,
  authorityChangeResponseSchema,
  authorityModeChangeResultSchema,
  desktopAuthorityModeSchema,
} from '../../shared/actions'
import type { ActionConfirmationBroker, ActionRuntime } from '../action'
import type { CapabilityCatalog } from '../capabilities'
import { getConfig, getRendererConfig, saveConfig } from '../config'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'

interface RegisterActionIpcOptions {
  actions: ActionRuntime
  confirmations: ActionConfirmationBroker
  window: BrowserWindow
  capabilityCatalog: CapabilityCatalog
  authorization: IpcAuthorization
}

export function registerActionIpc({
  actions,
  confirmations,
  window,
  capabilityCatalog,
  authorization,
}: RegisterActionIpcOptions): void {
  ipcMain.handle(
    'actions:respond-confirmation',
    authorization.handlePayload(
      'actions:respond-confirmation',
      IPC_ONE_PAYLOAD,
      (_event, payload: unknown) => {
        const response = actionConfirmationResponseSchema.parse(payload)
        if (!confirmations.respondToAction(response)) {
          throw new Error('Action confirmation is no longer pending')
        }
        return actionAcknowledgementSchema.parse({ ok: true })
      },
    ),
  )
  ipcMain.handle(
    'actions:request-authority-mode',
    authorization.handlePayload(
      'actions:request-authority-mode',
      IPC_ONE_PAYLOAD,
      async (_event, payload: unknown) => {
        const mode = desktopAuthorityModeSchema.parse(payload)
        if (mode === getConfig().desktopAuthorityMode) {
          return authorityModeChangeResultSchema.parse({ ok: true, mode })
        }
        if (mode === 'full') {
          const requestId = `authority-${Date.now()}-${randomUUID()}`
          const decision = await confirmations.requestAuthority(
            authorityChangeRequestSchema.parse({ requestId, requestedMode: 'full' }),
          )
          if (decision === 'cancel') {
            return authorityModeChangeResultSchema.parse({
              ok: false,
              mode: getConfig().desktopAuthorityMode,
            })
          }
        }
        saveConfig({ desktopAuthorityMode: mode })
        actions.notifyAuthorityModeChanged()
        capabilityCatalog.invalidate()
        if (!window.isDestroyed()) window.webContents.send('config:updated', getRendererConfig())
        return authorityModeChangeResultSchema.parse({ ok: true, mode })
      },
    ),
  )
  ipcMain.handle(
    'actions:respond-authority-change',
    authorization.handlePayload(
      'actions:respond-authority-change',
      IPC_ONE_PAYLOAD,
      (_event, payload: unknown) => {
        const response = authorityChangeResponseSchema.parse(payload)
        if (!confirmations.respondToAuthority(response)) {
          throw new Error('Authority confirmation is no longer pending')
        }
        return actionAcknowledgementSchema.parse({ ok: true })
      },
    ),
  )
  ipcMain.handle(
    'actions:emergency-stop',
    authorization.handle('actions:emergency-stop', async () => {
      await actions.emergencyStop()
      return actionAcknowledgementSchema.parse({ ok: true })
    }),
  )
  ipcMain.handle(
    'actions:snapshot',
    authorization.handle('actions:snapshot', () =>
      actionRuntimeSnapshotSchema.parse({
        ...actions.snapshot(),
        pendingAuthorityChange: confirmations.pendingAuthority(),
      }),
    ),
  )
}
