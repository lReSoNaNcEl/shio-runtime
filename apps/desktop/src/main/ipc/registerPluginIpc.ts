import { ipcMain } from 'electron'
import { z } from 'zod'

import { PROJECT_AWARENESS_PLUGIN_ID } from '../../shared/plugins'
import type { PluginRuntime } from '../plugins'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'

const pluginIdSchema = z.literal(PROJECT_AWARENESS_PLUGIN_ID)

export function registerPluginIpc(
  runtime: () => PluginRuntime,
  authorization: IpcAuthorization,
): void {
  ipcMain.handle(
    'plugins:list',
    authorization.handle('plugins:list', () => runtime().list()),
  )
  ipcMain.handle(
    'plugins:get',
    authorization.handlePayload('plugins:get', IPC_ONE_PAYLOAD, (_event, id: unknown) =>
      runtime().get(pluginIdSchema.parse(id)),
    ),
  )
  ipcMain.handle(
    'plugins:enable',
    authorization.handlePayload('plugins:enable', IPC_ONE_PAYLOAD, (_event, id: unknown) =>
      runtime().enable(pluginIdSchema.parse(id)),
    ),
  )
  ipcMain.handle(
    'plugins:disable',
    authorization.handlePayload('plugins:disable', IPC_ONE_PAYLOAD, (_event, id: unknown) =>
      runtime().disable(pluginIdSchema.parse(id)),
    ),
  )
}
