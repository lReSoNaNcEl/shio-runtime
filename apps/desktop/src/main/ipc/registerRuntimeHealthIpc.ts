import { ipcMain } from 'electron'

import type { AvatarRuntimeHealth } from '../../shared/runtime'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'
import { avatarRuntimeHealthSchema } from './payloadSchemas'

export function registerRuntimeHealthIpc(
  publishAvatarRuntimeHealth: (health: AvatarRuntimeHealth) => void,
  authorization: IpcAuthorization,
): void {
  ipcMain.handle(
    'avatar-runtime:publish-health',
    authorization.handlePayload(
      'avatar-runtime:publish-health',
      IPC_ONE_PAYLOAD,
      (_event, payload: unknown) => {
        publishAvatarRuntimeHealth(avatarRuntimeHealthSchema.parse(payload))
        return { ok: true }
      },
    ),
  )
}
