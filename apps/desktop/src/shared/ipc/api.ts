import type { ShioActionsApi } from '../actions'
import type { ShioCapabilitiesApi } from '../capabilities'
import type { CharacterEmbodimentIntent } from '../character-response'
import type { AppSettings } from '../config/appSettings'
import type { BacklogSelectionResult, BufferedUtterance } from '../conversation/backlog'
import type { ReplyGrounding } from '../conversation/grounding'
import type { ConversationTurnFailure } from '../conversation/turnFailure'
import type { DesktopControlApi } from '../desktop-control'
import type { NetworkRequestDiagnostic, NetworkRequestDiagnosticDetails } from '../diagnostics'
import type { LlmCapabilities } from '../llm/capabilities'
import type {
  FetchModelsResult,
  LlmCredentialStatus,
  LlmProviderId,
  LlmReadiness,
  ProviderProfile,
} from '../llm/providers'
import type { MemoryManagementApi } from '../memory'
import type { PluginManagementApi } from '../plugins'
import type { ProjectAwarenessApi } from '../project-awareness'
import type { AvatarRuntimeHealth, RuntimeEventInput } from '../runtime'
import type {
  ScreenContextCaptureDescriptor,
  ScreenContextCaptureRequest,
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

export interface OverlayPresentationConfig {
  uiLocale: AppSettings['uiLocale']
  uiTheme: AppSettings['uiTheme']
  vrmAssetHandle: string
  overlayTransparentBackground: string
  overlayScale: string
  overlayViewMode: string
  developerModeEnabled: string
  developerOverlayAnimationHudEnabled: string
}

export interface OverlayPresentationApi {
  config: {
    get: () => Promise<OverlayPresentationConfig>
    onUpdated: (callback: (settings: OverlayPresentationConfig) => void) => () => void
  }
  vrm: {
    read: (assetHandle: string) => Promise<{ ok: boolean; buffer?: ArrayBuffer; error?: string }>
  }
  avatarState: {
    get: () => Promise<unknown>
    onUpdated: (callback: (state: unknown) => void) => () => void
  }
  avatarMouth: {
    get: () => Promise<unknown>
    onUpdated: (callback: (weights: unknown) => void) => () => void
  }
}

export interface ShioRuntimeApi {
  actions: ShioActionsApi
  capabilities: ShioCapabilitiesApi
  diagnostics: {
    getNetworkRequests: () => Promise<NetworkRequestDiagnostic[]>
    getNetworkRequestDetails: (requestId: string) => Promise<NetworkRequestDiagnosticDetails | null>
  }
  system: {
    getReleaseInfo: () => Promise<ReleaseInfo>
    openExternalLink: (url: string) => Promise<{ ok: true }>
    openLogsFolder: () => Promise<{ ok: boolean }>
    reportRendererFailure: () => Promise<{ ok: boolean }>
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
    getStreamingConnection: () => Promise<{ baseUrl: string }>
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
      embodimentIntent?: CharacterEmbodimentIntent
      grounding?: ReplyGrounding
      errorCode?: 'LLM_CREDENTIAL_MISSING' | 'LLM_MODEL_MISSING'
      failure?: ConversationTurnFailure
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
    fetchModels: (provider: LlmProviderId, accountId?: string) => Promise<FetchModelsResult>
    validateCredential: (
      provider: LlmProviderId,
      apiKey: string,
      accountId?: string,
    ) => Promise<FetchModelsResult>
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
    warmup: (input: { language: string }) => Promise<{
      state: 'warming' | 'ready' | 'failed'
      engine: string
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
  memory: MemoryManagementApi & { clear: () => Promise<unknown> }
  plugins: PluginManagementApi
  desktopControl: DesktopControlApi
  projectAwareness: ProjectAwarenessApi
  config: {
    get: () => Promise<AppSettings>
    save: (settings: Partial<AppSettings>) => Promise<{ ok: boolean; error?: string }>
    onUpdated: (callback: (settings: AppSettings) => void) => () => void
  }
  vrm: {
    pick: () => Promise<{
      ok: boolean
      assetHandle?: string
      displayName?: string
      error?: string
    }>
    read: (assetHandle: string) => Promise<{ ok: boolean; buffer?: ArrayBuffer; error?: string }>
  }
  vrma: {
    pick: () => Promise<{ ok: boolean; animPath?: string; buffer?: ArrayBuffer; error?: string }>
  }
  overlay: {
    toggle: () => Promise<{ visible: boolean }>
    isVisible: () => Promise<{ visible: boolean }>
    applySettings: () => Promise<{ ok: boolean; visible: boolean }>
    reloadAvatar: () => Promise<{ ok: boolean; visible: boolean }>
  }
  avatarState: {
    publish: (state: unknown) => Promise<{ ok: boolean }>
  }
  avatarMouth: {
    publish: (weights: unknown) => Promise<{ ok: boolean }>
  }
  avatarRuntime: {
    publishHealth: (health: AvatarRuntimeHealth) => Promise<{ ok: boolean }>
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
