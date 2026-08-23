import { ipcMain } from 'electron'

import type { OverlayPresentationConfig } from '../../shared/ipc'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'
import { avatarMouthSchema, avatarStateSchema } from './payloadSchemas'

export interface OverlayIpcDependencies {
  toggle: () => { visible: boolean }
  isVisible: () => boolean
  applySettings: () => { ok: boolean; visible: boolean }
  reloadAvatar: () => { ok: boolean; visible: boolean }
  getPresentationConfig: () => OverlayPresentationConfig
  getAvatarState: () => unknown
  publishAvatarState: (state: unknown) => void
  getAvatarMouth: () => unknown
  publishAvatarMouth: (weights: unknown) => void
}

export function registerOverlayIpc(
  dependencies: OverlayIpcDependencies,
  authorization: IpcAuthorization,
): void {
  ipcMain.handle('overlay:toggle', authorization.handle('overlay:toggle', dependencies.toggle))
  ipcMain.handle(
    'overlay:is-visible',
    authorization.handle('overlay:is-visible', () => ({ visible: dependencies.isVisible() })),
  )
  ipcMain.handle(
    'overlay:apply-settings',
    authorization.handle('overlay:apply-settings', dependencies.applySettings),
  )
  ipcMain.handle(
    'overlay:reload-avatar',
    authorization.handle('overlay:reload-avatar', dependencies.reloadAvatar),
  )
  ipcMain.handle(
    'overlay-presentation:config:get',
    authorization.handle('overlay-presentation:config:get', dependencies.getPresentationConfig),
  )
  ipcMain.handle(
    'avatar-state:get',
    authorization.handle('avatar-state:get', dependencies.getAvatarState),
  )
  ipcMain.handle(
    'avatar-state:publish',
    authorization.handlePayload(
      'avatar-state:publish',
      IPC_ONE_PAYLOAD,
      (_event, payload: unknown) => {
        dependencies.publishAvatarState(avatarStateSchema.parse(payload))
        return { ok: true }
      },
    ),
  )
  ipcMain.handle(
    'avatar-mouth:get',
    authorization.handle('avatar-mouth:get', dependencies.getAvatarMouth),
  )
  ipcMain.handle(
    'avatar-mouth:publish',
    authorization.handlePayload(
      'avatar-mouth:publish',
      IPC_ONE_PAYLOAD,
      (_event, payload: unknown) => {
        dependencies.publishAvatarMouth(avatarMouthSchema.parse(payload))
        return { ok: true }
      },
    ),
  )
}
