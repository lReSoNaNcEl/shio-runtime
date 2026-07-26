import type { AppSettings } from '../config/appSettings'
import type { BacklogSelectionResult, BufferedUtterance } from '../conversation/backlog'
import type { LlmCapabilities } from '../llm/capabilities'
import type {
  FetchModelsResult,
  LlmCredentialStatus,
  LlmProviderId,
  LlmReadiness,
  ProviderProfile,
} from '../llm/providers'
import type { ProjectAwarenessApi } from '../project-awareness'
import type { RuntimeEventInput } from '../runtime/events'
import type {
  ScreenContextCaptureDescriptor,
  ScreenContextCaptureRequest,
  ScreenContextErrorCode,
  ScreenContextImportRequest,
  ScreenContextRecaptureRequest,
  ScreenContextResult,
  ScreenContextSource,
} from '../screen-context/contracts'
import type { SpeechAudioBoundaryTelemetry, SpeechTextNormalizationTelemetry } from '../speech'
import type { SpeechServiceErrorCode } from '../speech/errors'
import type { ReleaseInfo, RuntimeSupportBundle } from '../system'

export interface SpeechHealthCapabilities {
  serviceReachable: boolean
  recognition: boolean
  synthesis: boolean
  streaming: boolean
}

export interface ShioRuntimeApi {
  system: {
    getReleaseInfo: () => Promise<ReleaseInfo>
    openLogsFolder: () => Promise<{ ok: boolean }>
    getRuntimeSupportBundle: () => Promise<RuntimeSupportBundle>
  }
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
      screenContextId?: string,
    ) => Promise<{
      ok: boolean
      replyText?: string
      emotionKey?: string
      error?: string
      errorCode?: ScreenContextErrorCode | 'LLM_CREDENTIAL_MISSING'
    }>
    cancelReply: (turnId: string) => Promise<{ ok: boolean }>
    getActiveCapabilities: () => Promise<LlmCapabilities>
    arbitrateBacklog: (payload: {
      items: readonly BufferedUtterance[]
      backlogVersion: number
      providerId: string
      model: string
    }) => Promise<{ ok: boolean; result?: BacklogSelectionResult; error?: string }>
    providers: () => Promise<ProviderProfile[]>
    getReadiness: () => Promise<LlmReadiness>
    fetchModels: (provider: LlmProviderId) => Promise<FetchModelsResult>
    validateCredential: (provider: LlmProviderId, apiKey: string) => Promise<FetchModelsResult>
    saveCredential: (provider: LlmProviderId, apiKey: string) => Promise<LlmCredentialStatus>
    forgetCredential: (provider: LlmProviderId) => Promise<LlmCredentialStatus>
    getCredentialStatus: (provider: LlmProviderId) => Promise<LlmCredentialStatus>
  }
  screenContext: {
    listSources: () => Promise<ScreenContextResult<ScreenContextSource[]>>
    capture: (
      request: ScreenContextCaptureRequest,
    ) => Promise<ScreenContextResult<ScreenContextCaptureDescriptor>>
    importImage: (
      request: ScreenContextImportRequest,
    ) => Promise<ScreenContextResult<ScreenContextCaptureDescriptor>>
    recapture: (
      request: ScreenContextRecaptureRequest,
    ) => Promise<ScreenContextResult<ScreenContextCaptureDescriptor>>
    cancelOperation: (operationId: string) => Promise<ScreenContextResult<boolean>>
    release: (captureId: string) => Promise<ScreenContextResult<boolean>>
  }
  tts: {
    warmup: (input: { engine: string; voiceId: string; language: string }) => Promise<{
      state: 'warming' | 'ready' | 'failed'
      engine: string
      voiceId: string
      language: string
      latencyMs?: number
      error?: string
    }>
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
      normalization?: SpeechTextNormalizationTelemetry
      audioBoundaries?: SpeechAudioBoundaryTelemetry
      error?: string
      errorCode?: SpeechServiceErrorCode
    }>
    cancelSynthesis: (turnId: string) => Promise<{ ok: boolean }>
  }
  memory: { clear: () => Promise<unknown> }
  projectAwareness: ProjectAwarenessApi
  config: {
    get: () => Promise<AppSettings>
    save: (settings: Partial<AppSettings>) => Promise<{ ok: boolean; error?: string }>
    onUpdated: (callback: (settings: AppSettings) => void) => () => void
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
    onSettingsUpdated: (callback: (settings: AppSettings) => void) => void
  }
  avatarState: {
    get: () => Promise<unknown>
    publish: (state: unknown) => Promise<{ ok: boolean }>
    onUpdated: (callback: (state: unknown) => void) => void
  }
  avatarMouth: {
    get: () => Promise<unknown>
    publish: (weights: unknown) => Promise<{ ok: boolean }>
    onUpdated: (callback: (weights: unknown) => void) => void
  }
  actionEvents: {
    onPublished: (callback: (event: RuntimeEventInput) => void) => () => void
  }
  debug: {
    writeTransitionRecording: (
      payload: unknown,
    ) => Promise<{ ok: boolean; filePath?: string; error?: string }>
  }
}
