import type { Dispatch, SetStateAction } from 'react'

import type {
  BacklogSelectorRoleConfig,
  LlmProviderId,
  LlmProviderPublicSettings,
  ModelInfo,
  ProviderProfile,
} from '../../../../shared/llm'
import type { UiLocale } from '../../../../shared/localization'
import type { OverlayViewMode } from '../../../avatar/tuning/cameraTuning'
import type { ControllerState } from '../../../Controller'

export type SettingsSection = 'general' | 'speech' | 'llm' | 'avatar' | 'advanced'

export interface SettingsDialogProps {
  isOpen: boolean
  initialSection?: SettingsSection
  vrmLoaded: boolean
  faceTrackingEnabled: boolean
  onToggleFaceTracking: () => void
  overlayVisible: boolean
  overlayViewModeProjection: OverlayViewMode
  llmHealth: ControllerState['llmHealth']
  voiceWarmup: ControllerState['voiceWarmup']
  continuousListeningState: ControllerState['continuousListeningState']
  onToggleContinuousListening: () => void
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
  | 'missing-key'
  | 'auth-error'
  | 'network-error'

export interface GeneralSettingsState {
  uiLocale: UiLocale
}

export interface GeneralSettingsActions {
  setUiLocale: (locale: UiLocale) => void
}

export interface SpeechSettingsState {
  speechUrl: string
  language: string
  microphones: Array<{ deviceId: string; label: string }>
  microphoneId: string
  voiceWarmup: ControllerState['voiceWarmup']
  continuousListeningState: ControllerState['continuousListeningState']
  microphoneTestState:
    | 'idle'
    | 'recording'
    | 'ready'
    | 'playing'
    | 'capture-error'
    | 'playback-error'
  microphoneLevel: number
}

export interface SpeechSettingsActions {
  setSpeechUrl: (url: string) => void
  setLanguage: (language: string) => void
  setMicrophoneId: (id: string) => void
  recordMicrophoneTest: () => Promise<void>
  playMicrophoneTest: () => Promise<void>
  toggleContinuousListening: () => void
}

export interface LlmSettingsState {
  providers: ProviderProfile[]
  activeProvider: LlmProviderId
  providerSettings: Record<LlmProviderId, LlmProviderPublicSettings>
  models: ModelInfo[]
  modelsState: ModelsState
  editingKey: boolean
  keyInput: string
  backlogRole: BacklogSelectorRoleConfig
  backlogModels: ModelInfo[]
  selectedModel: string
  health: ControllerState['llmHealth']
}

export interface LlmSettingsActions {
  setActiveProvider: (provider: LlmProviderId) => void
  updateProviderSettings: (id: LlmProviderId, model: string) => void
  setEditingKey: (editing: boolean) => void
  setKeyInput: (key: string) => void
  saveCredential: () => Promise<void>
  forgetCredential: () => Promise<void>
  loadModels: (providerId: LlmProviderId) => Promise<void>
  setBacklogRole: Dispatch<SetStateAction<BacklogSelectorRoleConfig>>
}

export interface AvatarSettingsState {
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
  speechUrl: string
  backlogRole: BacklogSelectorRoleConfig
  providers: ProviderProfile[]
  providerSettings: Record<LlmProviderId, LlmProviderPublicSettings>
  backlogModels: ModelInfo[]
}

export interface AdvancedSettingsActions {
  setDeveloperModeEnabled: (enabled: boolean) => Promise<void>
  setDeveloperOverlayAnimationHudEnabled: (enabled: boolean) => Promise<void>
  setSpeechUrl: (url: string) => void
  setBacklogRole: Dispatch<SetStateAction<BacklogSelectorRoleConfig>>
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
