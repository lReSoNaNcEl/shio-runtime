import { contextBridge, ipcRenderer } from 'electron'

const api = {
  health: {
    check: () => ipcRenderer.invoke('health:check'),
  },
  asr: {
    recognize: (wavBuffer: ArrayBuffer) => ipcRenderer.invoke('asr:recognize', wavBuffer),
  },
  llm: {
    reply: (turnId: string, userText: string, screenContextId?: string) =>
      ipcRenderer.invoke('llm:reply', { turnId, userText, screenContextId }),
    cancelReply: (turnId: string) => ipcRenderer.invoke('llm:cancel-reply', turnId),
    getActiveCapabilities: () => ipcRenderer.invoke('llm:get-active-capabilities'),
    arbitrateBacklog: (payload: unknown) => ipcRenderer.invoke('llm:arbitrate-backlog', payload),
    providers: () => ipcRenderer.invoke('llm:providers'),
    fetchModels: (provider: string, apiKey: string) =>
      ipcRenderer.invoke('llm:fetch-models', provider, apiKey),
  },
  screenContext: {
    listSources: () => ipcRenderer.invoke('screen-context:list-sources'),
    capture: (sourceId: string) => ipcRenderer.invoke('screen-context:capture', sourceId),
    release: (captureId: string) => ipcRenderer.invoke('screen-context:release', captureId),
  },
  tts: {
    synthesizeReply: (turnId: string, replyText: string, emotionKey: string) =>
      ipcRenderer.invoke('tts:synthesize-reply', turnId, replyText, emotionKey),
    cancelSynthesis: (turnId: string) => ipcRenderer.invoke('tts:cancel-synthesis', turnId),
  },
  memory: {
    clear: () => ipcRenderer.invoke('memory:clear'),
  },
  projectAwareness: {
    getStatus: () => ipcRenderer.invoke('project-awareness:get-status'),
    configure: (config: unknown) => ipcRenderer.invoke('project-awareness:configure', config),
    saveCredential: (token: string) =>
      ipcRenderer.invoke('project-awareness:save-credential', token),
    forgetCredential: () => ipcRenderer.invoke('project-awareness:forget-credential'),
    openTokenSettings: () => ipcRenderer.invoke('project-awareness:open-token-settings'),
    connect: () => ipcRenderer.invoke('project-awareness:connect'),
    disconnect: () => ipcRenderer.invoke('project-awareness:disconnect'),
    sync: () => ipcRenderer.invoke('project-awareness:sync'),
    rebuildIndex: () => ipcRenderer.invoke('project-awareness:rebuild-index'),
    getProjectMap: () => ipcRenderer.invoke('project-awareness:get-project-map'),
    search: (input: unknown) => ipcRenderer.invoke('project-awareness:search', input),
    readFile: (input: unknown) => ipcRenderer.invoke('project-awareness:read-file', input),
    readSymbol: (input: unknown) => ipcRenderer.invoke('project-awareness:read-symbol', input),
    getRecentChanges: (input: unknown) =>
      ipcRenderer.invoke('project-awareness:get-recent-changes', input),
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    save: (partial: Record<string, unknown>) => ipcRenderer.invoke('config:save', partial),
    onUpdated: (cb: (cfg: Record<string, string>) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, cfg: Record<string, string>): void =>
        cb(cfg)
      ipcRenderer.on('config:updated', listener)
      return () => ipcRenderer.removeListener('config:updated', listener)
    },
  },
  vrm: {
    pick: () => ipcRenderer.invoke('vrm:pick'),
    read: (filePath: string) => ipcRenderer.invoke('vrm:read', filePath),
  },
  vrma: {
    pick: () => ipcRenderer.invoke('vrma:pick'),
  },
  overlay: {
    toggle: () => ipcRenderer.invoke('overlay:toggle'),
    isVisible: () => ipcRenderer.invoke('overlay:is-visible'),
    applySettings: () => ipcRenderer.invoke('overlay:apply-settings'),
    reloadAvatar: () => ipcRenderer.invoke('overlay:reload-avatar'),
    onSettingsUpdated: (cb: (cfg: Record<string, string>) => void) => {
      ipcRenderer.on('overlay-settings:updated', (_e, cfg) => cb(cfg))
    },
  },
  avatarState: {
    get: () => ipcRenderer.invoke('avatar-state:get'),
    publish: (state: unknown) => ipcRenderer.invoke('avatar-state:publish', state),
    onUpdated: (cb: (state: unknown) => void) => {
      ipcRenderer.on('avatar-state:updated', (_e, state) => cb(state))
    },
  },
  avatarMouth: {
    get: () => ipcRenderer.invoke('avatar-mouth:get'),
    publish: (weights: unknown) => ipcRenderer.invoke('avatar-mouth:publish', weights),
    onUpdated: (cb: (weights: unknown) => void) => {
      ipcRenderer.on('avatar-mouth:updated', (_e, weights) => cb(weights))
    },
  },
  actionEvents: {
    onPublished: (cb: (event: unknown) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, event: unknown): void => cb(event)
      ipcRenderer.on('action-runtime:event', listener)
      return () => ipcRenderer.off('action-runtime:event', listener)
    },
  },
  debug: {
    writeTransitionRecording: (payload: unknown) =>
      ipcRenderer.invoke('debug:write-transition-recording', payload),
  },
}

contextBridge.exposeInMainWorld('api', api)
