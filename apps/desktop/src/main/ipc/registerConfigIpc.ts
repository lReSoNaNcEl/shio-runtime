import { type BrowserWindow, ipcMain } from 'electron'

import { getRendererConfig, saveConfig } from '../config'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'
import { configSaveSchema } from './payloadSchemas'

export function registerConfigIpc(
  window: BrowserWindow,
  authorization: IpcAuthorization,
  onConfigChanged?: () => void,
  onFlashMotionChanged?: () => Promise<void>,
): void {
  ipcMain.handle(
    'config:get',
    authorization.handle('config:get', () => getRendererConfig()),
  )
  ipcMain.handle(
    'config:save',
    authorization.handlePayload(
      'config:save',
      IPC_ONE_PAYLOAD,
      async (_event, payload: unknown) => {
        const partial = configSaveSchema.parse(payload)
        saveConfig(partial)
        const keys = Object.keys(partial)
        const changedKey = keys.length === 1 ? keys[0] : undefined
        try {
          if (partial.flashMotionEnabled !== undefined) await onFlashMotionChanged?.()
        } finally {
          if (!window.isDestroyed())
            window.webContents.send('config:updated', getRendererConfig(), changedKey)
          if (changedKey !== 'speechVolumePercent') onConfigChanged?.()
        }
        return { ok: true }
      },
    ),
  )
}
