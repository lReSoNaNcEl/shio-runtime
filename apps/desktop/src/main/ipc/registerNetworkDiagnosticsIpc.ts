import { ipcMain } from 'electron'
import { z } from 'zod'

import { networkRequestDiagnostics } from '../diagnostics/NetworkRequestDiagnostics'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'

const networkRequestIdSchema = z
  .string()
  .regex(/^network-\d+-\d+$/)
  .max(80)

export function registerNetworkDiagnosticsIpc(authorization: IpcAuthorization): void {
  ipcMain.handle(
    'diagnostics:get-network-requests',
    authorization.handle('diagnostics:get-network-requests', () =>
      networkRequestDiagnostics.snapshot(),
    ),
  )
  ipcMain.handle(
    'diagnostics:get-network-request-details',
    authorization.handlePayload(
      'diagnostics:get-network-request-details',
      IPC_ONE_PAYLOAD,
      (_event, payload: unknown) =>
        networkRequestDiagnostics.details(networkRequestIdSchema.parse(payload)),
    ),
  )
}
