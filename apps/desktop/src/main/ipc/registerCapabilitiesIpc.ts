import { type BrowserWindow, ipcMain } from 'electron'

import { parseShioCapabilitySnapshot } from '../../shared/capabilities'
import type { CapabilityCatalog } from '../capabilities'
import type { IpcAuthorization } from './IpcAuthorization'

export function registerCapabilitiesIpc(
  catalog: CapabilityCatalog,
  window: BrowserWindow,
  authorization: IpcAuthorization,
): void {
  ipcMain.handle(
    'capabilities:snapshot',
    authorization.handle('capabilities:snapshot', async () =>
      parseShioCapabilitySnapshot(await catalog.snapshot()),
    ),
  )
  const unsubscribe = catalog.onChanged((snapshot) => {
    if (window.isDestroyed()) return
    window.webContents.send('capabilities:changed', parseShioCapabilitySnapshot(snapshot))
  })
  window.once('closed', unsubscribe)
}
