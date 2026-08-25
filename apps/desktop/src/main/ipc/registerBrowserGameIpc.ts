import { ipcMain } from 'electron'

import {
  type BrowserGameControlAction,
  type BrowserGameDiagnostics,
  browserGameDiagnosticsSchema,
} from '../../shared/browser-game'
import type { ActionRuntime } from '../action'
import type { BrowserGamePlugin } from '../browser-game'
import type { IpcAuthorization } from './IpcAuthorization'

export function registerBrowserGameIpc(
  plugin: () => BrowserGamePlugin,
  actions: ActionRuntime,
  authorization: IpcAuthorization,
): void {
  const diagnostics = (): BrowserGameDiagnostics =>
    browserGameDiagnosticsSchema.parse(plugin().getDiagnostics())

  const executeControl = async (
    operation: Extract<BrowserGameControlAction, { operation: 'pause' | 'stop' }>['operation'],
  ): Promise<BrowserGameDiagnostics> => {
    const result = await actions.execute<BrowserGameControlAction, unknown>({
      name: 'browser.game-control',
      payload: { operation },
    })
    if (result.status !== 'success') {
      throw new Error(result.errorCode ?? 'BROWSER_GAME_CONTROL_FAILED')
    }
    return diagnostics()
  }

  ipcMain.handle(
    'browser-game:get-status',
    authorization.handle('browser-game:get-status', diagnostics),
  )
  ipcMain.handle(
    'browser-game:pause',
    authorization.handle('browser-game:pause', () => executeControl('pause')),
  )
  ipcMain.handle(
    'browser-game:stop',
    authorization.handle('browser-game:stop', () => executeControl('stop')),
  )
}
