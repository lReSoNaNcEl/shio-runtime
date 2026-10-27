import { type BrowserWindow, dialog, ipcMain } from 'electron'

import { translate } from '../../shared/localization'
import { vrmAssetRegistry } from '../assets/VrmAssetRegistry'
import { getConfig, getRendererConfig, saveConfig } from '../config'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'
import { vrmAssetHandleSchema } from './payloadSchemas'

export function registerAvatarIpc(window: BrowserWindow, authorization: IpcAuthorization): void {
  ipcMain.handle(
    'vrm:pick',
    authorization.handle('vrm:pick', async () => {
      const result = await dialog.showOpenDialog(window, {
        title: translate(getConfig().uiLocale, 'main.dialog.vrm.title'),
        filters: [
          { name: translate(getConfig().uiLocale, 'main.dialog.vrm.filter'), extensions: ['vrm'] },
        ],
        properties: ['openFile'],
      })
      if (result.canceled || result.filePaths.length === 0) return { ok: false }
      const vrmPath = result.filePaths[0]
      const asset = vrmAssetRegistry.registerSelectedAsset(vrmPath)
      saveConfig({ vrmPath })
      window.webContents.send('config:updated', getRendererConfig())
      return { ok: true, ...asset }
    }),
  )
  ipcMain.handle(
    'vrm:read',
    authorization.handlePayload('vrm:read', IPC_ONE_PAYLOAD, (_event, payload: unknown) => {
      const assetHandle = vrmAssetHandleSchema.parse(payload)
      return { ok: true, buffer: vrmAssetRegistry.readAsset(assetHandle) }
    }),
  )
}
