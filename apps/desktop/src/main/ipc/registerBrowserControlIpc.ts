import { ipcMain } from 'electron'

import type { BrowserComputerUseControlAction } from '../../shared/browser-computer-use'
import { type BrowserControlStatus, browserControlStatusSchema } from '../../shared/browser-control'
import type { ActionRuntime } from '../action'
import type { BrowserControlPlugin } from '../browser-control'
import type { IpcAuthorization } from './IpcAuthorization'

export function registerBrowserControlIpc(
  plugin: () => BrowserControlPlugin,
  actions: ActionRuntime,
  authorization: IpcAuthorization,
): void {
  const status = (): BrowserControlStatus => browserControlStatusSchema.parse(plugin().getStatus())
  const control = async (
    operation: BrowserComputerUseControlAction['operation'],
  ): Promise<BrowserControlStatus> => {
    const result = await actions.execute<BrowserComputerUseControlAction, unknown>({
      name: 'browser.use-control',
      payload: { operation },
    })
    if (result.status !== 'success') {
      throw new Error(result.errorCode ?? 'BROWSER_COMPUTER_USE_CONTROL_FAILED')
    }
    return status()
  }

  ipcMain.handle(
    'browser-control:get-status',
    authorization.handle('browser-control:get-status', status),
  )
  ipcMain.handle(
    'browser-control:pause',
    authorization.handle('browser-control:pause', () => control('pause')),
  )
  ipcMain.handle(
    'browser-control:resume',
    authorization.handle('browser-control:resume', () => control('resume')),
  )
  ipcMain.handle(
    'browser-control:stop',
    authorization.handle('browser-control:stop', () => control('stop')),
  )
}
