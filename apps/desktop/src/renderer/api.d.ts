import type { FetchModelsResult, LlmConfig, ProviderProfile } from '../shared/llmProviders'
import type { UiLocale } from '../shared/localization/locale'
import type { ProjectAwarenessApi, ProjectAwarenessPublicConfig } from '../shared/projectAwareness'
import type { RuntimeEventInput } from '../shared/runtime/events'
import type { SpeechServiceErrorCode } from '../shared/speech/speechErrors'
import type { BacklogSelectionResult, BufferedUtterance } from './speech/continuous-listening/types'

export interface SpeechHealthCapabilities {
  serviceReachable: boolean
  recognition: boolean
  synthesis: boolean
  streaming: boolean
}

export interface PersistedSettings {
  llm: LlmConfig
  projectAwareness: ProjectAwarenessPublicConfig
  uiLocale: UiLocale
  pythonSpeechUrl: string
  ttsVoice: string
  ttsLanguage: string
  ttsEngine: string
  vrmPath: string
  micDeviceId: string
  overlayWidth: string
  overlayHeight: string
  overlayMargin: string
  overlayOpacity: string
  overlayTransparentBackground: string
  overlayClickThrough: string
  overlayCorner: string
  overlayScale: string
  overlayViewMode: string
  overlayShowCurrentAnimation: string
  developerModeEnabled: string
  // Persisted but not returned by config:get; kept optional so callers that
  // save it (Controller) type-check without forcing it into the get payload.
  passiveCompanionEnabled?: string
  lookAtEnabled: string
  continuousListeningEnabled: string
  continuousListeningMode: string
  continuousListeningReplyCooldownMs: string
  continuousListeningFollowUpWindowMs: string
  continuousListeningCuriosityChance: string
}

export interface VtuberApi {
  health: {
    check: () => Promise<{
      ok: boolean
      data?: unknown
      capabilities?: SpeechHealthCapabilities
      error?: string
      errorCode?: SpeechServiceErrorCode
    }>
  }
  asr: {
    recognize: (
      buf: ArrayBuffer,
    ) => Promise<{ ok: boolean; text?: string; error?: string; errorCode?: SpeechServiceErrorCode }>
  }
  llm: {
    reply: (
      turnId: string,
      text: string,
    ) => Promise<{ ok: boolean; replyText?: string; emotionKey?: string; error?: string }>
    cancelReply: (turnId: string) => Promise<{ ok: boolean }>
    arbitrateBacklog: (payload: {
      items: readonly BufferedUtterance[]
      backlogVersion: number
      providerId: string
      model: string
    }) => Promise<{ ok: boolean; result?: BacklogSelectionResult; error?: string }>
    providers: () => Promise<ProviderProfile[]>
    fetchModels: (provider: string, apiKey: string) => Promise<FetchModelsResult>
  }
  tts: {
    synthesizeReply: (
      turnId: string,
      replyText: string,
      emotionKey: string,
    ) => Promise<{
      ok: boolean
      audioBuffer?: ArrayBuffer
      emotionKey?: string
      requestedEmotion?: string
      textEmotion?: string
      vrmEmotion?: string
      latencyMs?: string
      generatedLatencyMs?: string
      cache?: string
      error?: string
      errorCode?: SpeechServiceErrorCode
    }>
    cancelSynthesis: (turnId: string) => Promise<{ ok: boolean }>
  }
  memory: { clear: () => Promise<unknown> }
  projectAwareness: ProjectAwarenessApi
  config: {
    get: () => Promise<PersistedSettings>
    save: (p: Partial<PersistedSettings>) => Promise<unknown>
    onUpdated: (cb: (cfg: PersistedSettings) => void) => void
  }
  vrm: {
    pick: () => Promise<{ ok: boolean; vrmPath?: string }>
    read: (filePath: string) => Promise<{ ok: boolean; buffer?: ArrayBuffer; error?: string }>
  }
  vrma: {
    pick: () => Promise<{ ok: boolean; animPath?: string; buffer?: ArrayBuffer; error?: string }>
  }
  overlay: {
    toggle: () => Promise<{ visible: boolean }>
    isVisible: () => Promise<{ visible: boolean }>
    applySettings: () => Promise<{ ok: boolean; visible: boolean }>
    reloadAvatar: () => Promise<{ ok: boolean; visible: boolean }>
    onSettingsUpdated: (cb: (cfg: Record<string, string>) => void) => void
  }
  avatarState: {
    get: () => Promise<unknown>
    publish: (state: unknown) => Promise<{ ok: boolean }>
    onUpdated: (cb: (state: unknown) => void) => void
  }
  avatarMouth: {
    get: () => Promise<unknown>
    publish: (weights: unknown) => Promise<{ ok: boolean }>
    onUpdated: (cb: (weights: unknown) => void) => void
  }
  actionEvents: {
    onPublished: (cb: (event: RuntimeEventInput) => void) => () => void
  }
  debug: {
    writeTransitionRecording: (
      payload: unknown,
    ) => Promise<{ ok: boolean; filePath?: string; error?: string }>
  }
}

declare global {
  interface Window {
    api: VtuberApi
  }
}
