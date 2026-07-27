import { type BrowserWindow, ipcMain } from 'electron'

import type { ActionRuntime } from '../action/ActionRuntime'
import { getRendererConfig } from '../config'

export function registerAvatarIpc(actions: ActionRuntime, window: BrowserWindow): void {
  ipcMain.handle('vrm:pick', async () => {
    const action = await actions.execute<void, { ok: boolean; vrmPath?: string }>({
      name: 'vrm.pick',
      payload: undefined,
    })
    if (action.status !== 'success' || !action.result) {
      return { ok: false, error: action.error }
    }
    if (action.result.ok) window.webContents.send('config:updated', getRendererConfig())
    return action.result
  })
  ipcMain.handle('vrm:read', (_event, filePath: string) =>
    actions
      .execute<string, { ok: boolean; buffer?: ArrayBuffer; error?: string }>({
        name: 'vrm.read',
        payload: filePath,
      })
      .then((action) =>
        action.status === 'success' ? action.result : { ok: false, error: action.error },
      ),
  )
  ipcMain.handle('vrma:pick', async () => {
    const action = await actions.execute<
      void,
      { ok: boolean; animPath?: string; buffer?: ArrayBuffer }
    >({
      name: 'vrma.pick',
      payload: undefined,
    })
    return action.status === 'success' ? action.result : { ok: false, error: action.error }
  })
}
