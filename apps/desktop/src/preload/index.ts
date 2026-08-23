import { contextBridge, ipcRenderer } from 'electron'

import type { AppSettings } from '../shared/config'
import type { ShioRuntimeApi } from '../shared/ipc'
import type { LlmProviderId } from '../shared/llm'
import type { AvatarRuntimeHealth, RuntimeEventInput } from '../shared/runtime'
import type {
  ScreenContextCaptureRequest,
  ScreenContextImportRequest,
  ScreenContextRecaptureRequest,
} from '../shared/screen-context'

const api = {
  system: {
    getReleaseInfo: () => ipcRenderer.invoke('system:get-release-info'),
    openLogsFolder: () => ipcRenderer.invoke('system:open-logs-folder'),
    reportRendererFailure: () => ipcRenderer.invoke('system:report-renderer-failure'),
    getRuntimeSupportBundle: () => ipcRenderer.invoke('system:get-runtime-support-bundle'),
  },
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
    getReadiness: () => ipcRenderer.invoke('llm:get-readiness'),
    fetchModels: (provider: LlmProviderId) => ipcRenderer.invoke('llm:fetch-models', provider),
    validateCredential: (provider: LlmProviderId, apiKey: string) =>
      ipcRenderer.invoke('llm:validate-credential', { provider, apiKey }),
    saveCredential: (provider: LlmProviderId, apiKey: string) =>
      ipcRenderer.invoke('llm:save-credential', { provider, apiKey }),
    forgetCredential: (provider: LlmProviderId) =>
      ipcRenderer.invoke('llm:forget-credential', provider),
    getCredentialStatus: (provider: LlmProviderId) =>
      ipcRenderer.invoke('llm:get-credential-status', provider),
  },
  screenContext: {
    listSources: () => ipcRenderer.invoke('screen-context:list-sources'),
    capture: (request: ScreenContextCaptureRequest) =>
      ipcRenderer.invoke('screen-context:capture', request),
    importImage: (request: ScreenContextImportRequest) =>
      ipcRenderer.invoke('screen-context:import-image', request),
    recapture: (request: ScreenContextRecaptureRequest) =>
      ipcRenderer.invoke('screen-context:recapture', request),
    cancelOperation: (operationId: string) =>
      ipcRenderer.invoke('screen-context:cancel-operation', operationId),
    release: (captureId: string) => ipcRenderer.invoke('screen-context:release', captureId),
  },
  tts: {
    warmup: (input: { language: string }) => ipcRenderer.invoke('tts:warmup', input),
    synthesizeReply: (turnId: string, replyText: string, emotionKey: string) =>
      ipcRenderer.invoke('tts:synthesize-reply', turnId, replyText, emotionKey),
    cancelSynthesis: (turnId: string) => ipcRenderer.invoke('tts:cancel-synthesis', turnId),
  },
  memory: {
    clear: () => ipcRenderer.invoke('memory:clear'),
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    get: (id) => ipcRenderer.invoke('plugins:get', id),
    enable: (id) => ipcRenderer.invoke('plugins:enable', id),
    disable: (id) => ipcRenderer.invoke('plugins:disable', id),
  },
  projectAwareness: {
    getConfig: () => ipcRenderer.invoke('project-awareness:get-config'),
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
    save: (partial: Partial<AppSettings>) => ipcRenderer.invoke('config:save', partial),
    onUpdated: (cb: (cfg: AppSettings) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, cfg: AppSettings): void => cb(cfg)
      ipcRenderer.on('config:updated', listener)
      return () => ipcRenderer.removeListener('config:updated', listener)
    },
  },
  vrm: {
    pick: () => ipcRenderer.invoke('vrm:pick'),
    read: (assetHandle: string) => ipcRenderer.invoke('vrm:read', assetHandle),
  },
  vrma: {
    pick: () => ipcRenderer.invoke('vrma:pick'),
  },
  overlay: {
    toggle: () => ipcRenderer.invoke('overlay:toggle'),
    isVisible: () => ipcRenderer.invoke('overlay:is-visible'),
    applySettings: () => ipcRenderer.invoke('overlay:apply-settings'),
    reloadAvatar: () => ipcRenderer.invoke('overlay:reload-avatar'),
  },
  avatarState: {
    publish: (state: unknown) => ipcRenderer.invoke('avatar-state:publish', state),
  },
  avatarMouth: {
    publish: (weights: unknown) => ipcRenderer.invoke('avatar-mouth:publish', weights),
  },
  avatarRuntime: {
    publishHealth: (health: AvatarRuntimeHealth) =>
      ipcRenderer.invoke('avatar-runtime:publish-health', health),
  },
  actionEvents: {
    onPublished: (cb: (event: RuntimeEventInput) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, event: RuntimeEventInput): void => cb(event)
      ipcRenderer.on('action-runtime:event', listener)
      return () => ipcRenderer.off('action-runtime:event', listener)
    },
  },
  debug: {
    writeTransitionRecording: (payload: unknown) =>
      ipcRenderer.invoke('debug:write-transition-recording', payload),
  },
} satisfies ShioRuntimeApi

contextBridge.exposeInMainWorld('api', api)
