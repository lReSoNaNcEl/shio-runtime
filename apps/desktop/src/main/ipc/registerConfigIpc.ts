import { ipcMain } from 'electron'

import type { AppSettings } from '../../shared/config'
import type { ActionRuntime } from '../action/ActionRuntime'
import { getRendererConfig } from '../config'

export function registerConfigIpc(actions: ActionRuntime): void {
  ipcMain.handle('config:get', () => getRendererConfig())
  ipcMain.handle('config:save', (_event, partial: Partial<AppSettings>) =>
    actions
      .execute<Partial<AppSettings>, { ok: boolean }>({ name: 'config.save', payload: partial })
      .then((action) =>
        action.status === 'success' ? action.result : { ok: false, error: action.error },
      ),
  )
}
