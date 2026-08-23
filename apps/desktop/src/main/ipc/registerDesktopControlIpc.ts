import { ipcMain } from 'electron'

import { desktopControlStatusSchema } from '../../shared/desktop-control'
import type { DesktopControlPlugin } from '../desktop-control'
import type { IpcAuthorization } from './IpcAuthorization'

export function registerDesktopControlIpc(
  plugin: () => DesktopControlPlugin,
  authorization: IpcAuthorization,
): void {
  ipcMain.handle(
    'desktop-control:get-status',
    authorization.handle('desktop-control:get-status', async () =>
      desktopControlStatusSchema.parse(await plugin().getStatus()),
    ),
  )
  ipcMain.handle(
    'desktop-control:start-runtime',
    authorization.handle('desktop-control:start-runtime', async () =>
      desktopControlStatusSchema.parse(await plugin().startRuntime()),
    ),
  )
  ipcMain.handle(
    'desktop-control:stop-runtime',
    authorization.handle('desktop-control:stop-runtime', async () =>
      desktopControlStatusSchema.parse(await plugin().stopRuntime()),
    ),
  )
}
