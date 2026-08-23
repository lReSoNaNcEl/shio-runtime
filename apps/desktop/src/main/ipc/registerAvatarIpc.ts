import { type BrowserWindow, ipcMain } from 'electron'

import type { ActionRuntime } from '../action/ActionRuntime'
import { getRendererConfig } from '../config'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'
import { vrmAssetHandleSchema } from './payloadSchemas'

export function registerAvatarIpc(
  actions: ActionRuntime,
  window: BrowserWindow,
  authorization: IpcAuthorization,
): void {
  ipcMain.handle(
    'vrm:pick',
    authorization.handle('vrm:pick', async () => {
      const action = await actions.execute<
        void,
        { ok: boolean; assetHandle?: string; displayName?: string }
      >({
        name: 'vrm.pick',
        payload: undefined,
      })
      if (action.status !== 'success' || !action.result) {
        return { ok: false, error: action.error }
      }
      if (action.result.ok) window.webContents.send('config:updated', getRendererConfig())
      return action.result
    }),
  )
  ipcMain.handle(
    'vrm:read',
    authorization.handlePayload('vrm:read', IPC_ONE_PAYLOAD, (_event, payload: unknown) => {
      const assetHandle = vrmAssetHandleSchema.parse(payload)
      return actions
        .execute<string, { ok: boolean; buffer?: ArrayBuffer; error?: string }>({
          name: 'vrm.read',
          payload: assetHandle,
        })
        .then((action) =>
          action.status === 'success' ? action.result : { ok: false, error: action.error },
        )
    }),
  )
  ipcMain.handle(
    'vrma:pick',
    authorization.handle('vrma:pick', async () => {
      const action = await actions.execute<
        void,
        { ok: boolean; animPath?: string; buffer?: ArrayBuffer }
      >({
        name: 'vrma.pick',
        payload: undefined,
      })
      return action.status === 'success' ? action.result : { ok: false, error: action.error }
    }),
  )
}
