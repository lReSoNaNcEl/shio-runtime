import { contextBridge, ipcRenderer } from 'electron'

import type { OverlayPresentationApi, OverlayPresentationConfig } from '../shared/ipc'

const api = {
  config: {
    get: () => ipcRenderer.invoke('overlay-presentation:config:get'),
    onUpdated: (callback: (config: OverlayPresentationConfig) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        config: OverlayPresentationConfig,
      ): void => callback(config)
      ipcRenderer.on('overlay-settings:updated', listener)
      return () => ipcRenderer.removeListener('overlay-settings:updated', listener)
    },
  },
  vrm: {
    read: (assetHandle: string) => ipcRenderer.invoke('vrm:read', assetHandle),
  },
  avatarState: {
    get: () => ipcRenderer.invoke('avatar-state:get'),
    onUpdated: (callback: (state: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown): void => callback(state)
      ipcRenderer.on('avatar-state:updated', listener)
      return () => ipcRenderer.removeListener('avatar-state:updated', listener)
    },
  },
  avatarMouth: {
    get: () => ipcRenderer.invoke('avatar-mouth:get'),
    onUpdated: (callback: (weights: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, weights: unknown): void =>
        callback(weights)
      ipcRenderer.on('avatar-mouth:updated', listener)
      return () => ipcRenderer.removeListener('avatar-mouth:updated', listener)
    },
  },
} satisfies OverlayPresentationApi

contextBridge.exposeInMainWorld('overlayApi', api)
