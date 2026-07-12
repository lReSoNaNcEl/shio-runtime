import { contextBridge, ipcRenderer } from 'electron'

const api = {
  health: {
    check: () => ipcRenderer.invoke('health:check')
  },
  asr: {
    recognize: (wavBuffer: ArrayBuffer) => ipcRenderer.invoke('asr:recognize', wavBuffer)
  },
  llm: {
    reply: (turnId: string, userText: string) => ipcRenderer.invoke('llm:reply', turnId, userText),
    cancelReply: (turnId: string) => ipcRenderer.invoke('llm:cancel-reply', turnId),
    arbitrateBacklog: (payload: unknown) => ipcRenderer.invoke('llm:arbitrate-backlog', payload),
    providers: () => ipcRenderer.invoke('llm:providers'),
    fetchModels: (provider: string, apiKey: string) => ipcRenderer.invoke('llm:fetch-models', provider, apiKey)
  },
  tts: {
    synthesizeReply: (turnId: string, replyText: string, emotionKey: string) =>
      ipcRenderer.invoke('tts:synthesize-reply', turnId, replyText, emotionKey),
    cancelSynthesis: (turnId: string) => ipcRenderer.invoke('tts:cancel-synthesis', turnId)
  },
  memory: {
    clear: () => ipcRenderer.invoke('memory:clear')
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    save: (partial: Record<string, unknown>) => ipcRenderer.invoke('config:save', partial),
    onUpdated: (cb: (cfg: Record<string, string>) => void) => {
      ipcRenderer.on('config:updated', (_e, cfg) => cb(cfg))
    }
  },
  vrm: {
    pick: () => ipcRenderer.invoke('vrm:pick'),
    read: (filePath: string) => ipcRenderer.invoke('vrm:read', filePath)
  },
  vrma: {
    pick: () => ipcRenderer.invoke('vrma:pick')
  },
  overlay: {
    toggle: () => ipcRenderer.invoke('overlay:toggle'),
    isVisible: () => ipcRenderer.invoke('overlay:is-visible'),
    applySettings: () => ipcRenderer.invoke('overlay:apply-settings'),
    reloadAvatar: () => ipcRenderer.invoke('overlay:reload-avatar'),
    onSettingsUpdated: (cb: (cfg: Record<string, string>) => void) => {
      ipcRenderer.on('overlay-settings:updated', (_e, cfg) => cb(cfg))
    }
  },
  avatarState: {
    get: () => ipcRenderer.invoke('avatar-state:get'),
    publish: (state: unknown) => ipcRenderer.invoke('avatar-state:publish', state),
    onUpdated: (cb: (state: unknown) => void) => {
      ipcRenderer.on('avatar-state:updated', (_e, state) => cb(state))
    }
  },
  avatarMouth: {
    get: () => ipcRenderer.invoke('avatar-mouth:get'),
    publish: (weights: unknown) => ipcRenderer.invoke('avatar-mouth:publish', weights),
    onUpdated: (cb: (weights: unknown) => void) => {
      ipcRenderer.on('avatar-mouth:updated', (_e, weights) => cb(weights))
    }
  },
  actionEvents: {
    onPublished: (cb: (event: unknown) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, event: unknown): void => cb(event)
      ipcRenderer.on('action-runtime:event', listener)
      return () => ipcRenderer.off('action-runtime:event', listener)
    }
  },
  debug: {
    writeTransitionRecording: (payload: unknown) => ipcRenderer.invoke('debug:write-transition-recording', payload)
  }
}

contextBridge.exposeInMainWorld('api', api)
