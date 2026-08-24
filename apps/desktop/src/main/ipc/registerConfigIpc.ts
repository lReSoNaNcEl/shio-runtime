import { type BrowserWindow, ipcMain } from 'electron'

import type { AppSettings } from '../../shared/config'
import { getRendererConfig, saveConfig } from '../config'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'
import { configSaveSchema } from './payloadSchemas'

export function registerConfigIpc(window: BrowserWindow, authorization: IpcAuthorization): void {
  ipcMain.handle(
    'config:get',
    authorization.handle('config:get', () => getRendererConfig()),
  )
  ipcMain.handle(
    'config:save',
    authorization.handlePayload('config:save', IPC_ONE_PAYLOAD, (_event, payload: unknown) => {
      const partial = configSaveSchema.parse(payload) as Partial<AppSettings>
      saveConfig(partial)
      window.webContents.send('config:updated', getRendererConfig())
      return { ok: true }
    }),
  )
}
