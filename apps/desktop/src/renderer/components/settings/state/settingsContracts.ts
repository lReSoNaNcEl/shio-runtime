import type { Dispatch, SetStateAction } from 'react'

import type { UiTheme } from '../../../../shared/config'
import type {
  CodexReasoningEffort,
  LlmProviderId,
  LlmProviderPublicSettings,
  LlmRoleCandidate,
  ModelInfo,
  ProviderProfile,
} from '../../../../shared/llm'
import type { UiLocale } from '../../../../shared/localization'
import type { MicrophoneFailureReason } from '../../../audio/microphoneGateTypes'
import type { OverlayViewMode } from '../../../avatar/tuning/cameraTuning'
import type { ControllerState } from '../../../Controller'

export const settingsSections = ['general', 'llm', 'speech', 'avatar', 'advanced'] as const
export type SettingsSection = (typeof settingsSections)[number]

export interface SettingsDialogProps {
  isOpen: boolean
  initialSection?: SettingsSection
  uiTheme: UiTheme
  onThemeChange: (theme: UiTheme) => void
  flashMotionEnabled?: boolean
  vrmLoaded: boolean
  faceTrackingEnabled: boolean
  onToggleFaceTracking: () => void
  overlayVisible: boolean
  overlayViewModeProjection: OverlayViewMode
  llmHealth: ControllerState['llmHealth']
  voiceWarmup: ControllerState['voiceWarmup']
  continuousListening: ControllerState['continuousListening']
  onOverlayVisibleChange: (visible: boolean) => void
  onToggleOverlay: (visible: boolean) => void | Promise<void>
  onClose: () => void
}

export type SettingsSaveState = 'idle' | 'saving' | 'saved' | 'error'
export type ModelsState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'missing-account-id'
  | 'missing-key'
  | 'auth-error'
  | 'access-error'
  | 'network-error'

export interface GeneralSettingsState {
  uiLocale: UiLocale
}

export interface GeneralSettingsActions {
  setUiLocale: (locale: UiLocale) => void
}

export interface SpeechSettingsState {
  speechVolumePercent: number | null
  microphones: Array<{ deviceId: string; label: string }>
  microphoneId: string
  voiceWarmup: ControllerState['voiceWarmup']
  continuousListening: ControllerState['continuousListening']
  microphoneTestState:
    | 'idle'
    | 'recording'
    | 'ready'
    | 'playing'
    | 'capture-error'
    | 'playback-error'
  microphoneLevel: number
  microphoneTestFailure: MicrophoneFailureReason | null
}

export interface SpeechSettingsActions {
  setSpeechVolumePercent: (value: number) => void
  saveSpeechVolumePercent: (value: number) => void
  setMicrophoneId: (id: string) => void
  recordMicrophoneTest: () => Promise<void>
  playMicrophoneTest: () => Promise<void>
}

export interface LlmSettingsState {
  providers: ProviderProfile[]
  activeProvider: LlmProviderId
  providerSettings: Record<LlmProviderId, LlmProviderPublicSettings>
  models: ModelInfo[]
  modelsState: ModelsState
  editingKey: boolean
  keyInput: string
  selectedModel: string
  health: ControllerState['llmHealth']
  characterFallbacks: LlmRoleCandidate[]
  speculativeDirectReply: boolean
}

export interface LlmSettingsActions {
  setCodexReasoningEffort: (model: string, effort: CodexReasoningEffort | undefined) => void
  setActiveProvider: (provider: LlmProviderId) => void
  updateProviderSettings: (id: LlmProviderId, model: string) => void
  updateProviderAccountId: (id: LlmProviderId, accountId: string) => void
  setEditingKey: (editing: boolean) => void
  setKeyInput: (key: string) => void
  saveCredential: () => Promise<void>
  forgetCredential: () => Promise<void>
  loadModels: (providerId: LlmProviderId) => Promise<void>
  setCharacterFallbacks: Dispatch<SetStateAction<LlmRoleCandidate[]>>
  setSpeculativeDirectReply: (enabled: boolean) => void
}

export interface AvatarSettingsState {
  flashMotionEnabled: boolean
  vrmName: string
  overlayVisible: boolean
  overlayViewMode: OverlayViewMode
  overlayWidth: number
  overlayHeight: number
  overlayMargin: number
  overlayOpacityPercent: number
  overlayTransparentBackground: boolean
  overlayClickThrough: boolean
  overlayCorner: string
  overlayScalePercent: number
}

export interface AvatarSettingsActions {
  setFlashMotionEnabled: (enabled: boolean) => Promise<void>
  pickVrm: () => Promise<void>
  toggleOverlay: (visible: boolean) => Promise<void>
  setOverlayViewMode: (mode: OverlayViewMode) => void
  setOverlayWidth: (value: number) => void
  setOverlayHeight: (value: number) => void
  setOverlayMargin: (value: number) => void
  setOverlayOpacityPercent: (value: number) => void
  setOverlayTransparentBackground: (enabled: boolean) => void
  setOverlayClickThrough: (enabled: boolean) => void
  setOverlayCorner: (corner: string) => void
  setOverlayScalePercent: (value: number) => void
  resetOverlaySettings: () => void
}

export interface AdvancedSettingsState {
  developerModeEnabled: boolean
  developerOverlayAnimationHudEnabled: boolean
}

export interface AdvancedSettingsActions {
  setDeveloperModeEnabled: (enabled: boolean) => Promise<void>
  setDeveloperOverlayAnimationHudEnabled: (enabled: boolean) => Promise<void>
}

export interface SettingsDialogViewModel {
  activeSection: SettingsSection
  setActiveSection: (section: SettingsSection) => void
  saveState: SettingsSaveState
  general: { state: GeneralSettingsState; actions: GeneralSettingsActions }
  speech: { state: SpeechSettingsState; actions: SpeechSettingsActions }
  llm: { state: LlmSettingsState; actions: LlmSettingsActions }
  avatar: { state: AvatarSettingsState; actions: AvatarSettingsActions }
  advanced: { state: AdvancedSettingsState; actions: AdvancedSettingsActions }
}
