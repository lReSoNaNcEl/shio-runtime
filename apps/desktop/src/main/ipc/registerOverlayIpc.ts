import { ipcMain } from 'electron'

export interface OverlayIpcDependencies {
  toggle: () => { visible: boolean }
  isVisible: () => boolean
  applySettings: () => { ok: boolean; visible: boolean }
  reloadAvatar: () => { ok: boolean; visible: boolean }
  getAvatarState: () => unknown
  publishAvatarState: (state: unknown) => void
  getAvatarMouth: () => unknown
  publishAvatarMouth: (weights: unknown) => void
}

export function registerOverlayIpc(dependencies: OverlayIpcDependencies): void {
  ipcMain.handle('overlay:toggle', dependencies.toggle)
  ipcMain.handle('overlay:is-visible', () => ({ visible: dependencies.isVisible() }))
  ipcMain.handle('overlay:apply-settings', dependencies.applySettings)
  ipcMain.handle('overlay:reload-avatar', dependencies.reloadAvatar)
  ipcMain.handle('avatar-state:get', dependencies.getAvatarState)
  ipcMain.handle('avatar-state:publish', (_event, state: unknown) => {
    dependencies.publishAvatarState(state)
    return { ok: true }
  })
  ipcMain.handle('avatar-mouth:get', dependencies.getAvatarMouth)
  ipcMain.handle('avatar-mouth:publish', (_event, weights: unknown) => {
    dependencies.publishAvatarMouth(weights)
    return { ok: true }
  })
}
