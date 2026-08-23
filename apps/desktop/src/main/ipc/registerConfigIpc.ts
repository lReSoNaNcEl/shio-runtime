import { ipcMain } from 'electron'

import type { AppSettings } from '../../shared/config'
import type { ActionRuntime } from '../action/ActionRuntime'
import { getRendererConfig } from '../config'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'
import { configSaveSchema } from './payloadSchemas'

export function registerConfigIpc(actions: ActionRuntime, authorization: IpcAuthorization): void {
  ipcMain.handle(
    'config:get',
    authorization.handle('config:get', () => getRendererConfig()),
  )
  ipcMain.handle(
    'config:save',
    authorization.handlePayload('config:save', IPC_ONE_PAYLOAD, (_event, payload: unknown) => {
      const partial = configSaveSchema.parse(payload) as Partial<AppSettings>
      return actions
        .execute<Partial<AppSettings>, { ok: boolean }>({ name: 'config.save', payload: partial })
        .then((action) =>
          action.status === 'success' ? action.result : { ok: false, error: action.error },
        )
    }),
  )
}
