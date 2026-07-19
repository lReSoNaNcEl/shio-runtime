import type { Dispatch, SetStateAction } from 'react'

import type {
  BacklogSelectorRoleConfig,
  LlmProviderId,
  ModelInfo,
  ProviderCredentials,
  ProviderProfile,
} from '../../../../shared/llm'
import type { UiLocale } from '../../../../shared/localization'
import type { ProjectAwarenessStatus } from '../../../../shared/project-awareness'
import type { OverlayViewMode } from '../../../avatar/tuning/cameraTuning'
import type { ControllerState } from '../../../Controller'
import type { AttentionMode } from '../../../speech/continuous-listening/types'

export type SettingsSection =
  | 'general'
  | 'project'
  | 'speech'
  | 'listening'
  | 'llm'
  | 'avatar'
  | 'advanced'

export interface SettingsDialogProps {
  isOpen: boolean
  initialSection?: SettingsSection
  continuousListeningMode: AttentionMode
  vrmLoaded: boolean
  faceTrackingEnabled: boolean
  passiveCompanionEnabled: boolean
  onToggleFaceTracking: () => void
  onPassiveCompanionChange: (enabled: boolean) => void
  overlayVisible: boolean
  overlayViewModeProjection: OverlayViewMode
  llmHealth: ControllerState['llmHealth']
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

export interface ProjectSettingsState {
  enabled: boolean
  repository: string
  branch: string
  status: ProjectAwarenessStatus | null
  applyState: 'idle' | 'applying' | 'applied' | 'error'
  applyError: string
  credentialInput: string
  actionBusy: boolean
  forgetConfirmation: boolean
  settingsValid: boolean
  targetApplied: boolean
  connected: boolean
  runtimeBusy: boolean
  hasIndex: boolean
}

export interface ProjectSettingsActions {
  setEnabled: (enabled: boolean) => void
  setRepository: (repository: string) => void
  setBranch: (branch: string) => void
  setApplyState: (state: ProjectSettingsState['applyState']) => void
  setApplyError: (error: string) => void
  setCredentialInput: (credential: string) => void
  setForgetConfirmation: (confirming: boolean) => void
  apply: () => Promise<void>
  saveCredential: () => Promise<void>
  forgetCredential: () => Promise<void>
  openTokenSettings: () => Promise<void>
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  sync: () => Promise<void>
  rebuild: () => Promise<void>
}

export interface SpeechSettingsState {
  speechUrl: string
  language: string
  currentTtsVoice: string
  microphones: Array<{ deviceId: string; label: string }>
  microphoneId: string
}

export interface SpeechSettingsActions {
  setSpeechUrl: (url: string) => void
  setLanguage: (language: string) => void
  setCurrentTtsVoice: (voice: string) => void
  setMicrophoneId: (id: string) => void
}

export interface ListeningSettingsState {
  replyCooldownMs: number
  followUpWindowMs: number
  curiosityChancePercent: number
  curiosityEnabled: boolean
  mode: AttentionMode
}

export interface ListeningSettingsActions {
  setMode: (mode: AttentionMode) => Promise<void>
  setReplyCooldownMs: (value: number) => void
  setFollowUpWindowMs: (value: number) => void
  setCuriosityChancePercent: (value: number) => void
}

export interface LlmSettingsState {
  providers: ProviderProfile[]
  activeProvider: LlmProviderId
  providerCredentials: Record<string, ProviderCredentials>
  models: ModelInfo[]
  modelsState: ModelsState
  editingKey: boolean
  keyInput: string
  copied: boolean
  backlogRole: BacklogSelectorRoleConfig
  backlogModels: ModelInfo[]
  savedKey: string
  selectedModel: string
  health: ControllerState['llmHealth']
}

export interface LlmSettingsActions {
  setActiveProvider: (provider: LlmProviderId) => void
  setProviderCredentials: Dispatch<SetStateAction<Record<string, ProviderCredentials>>>
  updateCredential: (id: string, patch: Partial<ProviderCredentials>) => void
  setEditingKey: (editing: boolean) => void
  setKeyInput: (key: string) => void
  copyKey: () => Promise<void>
  loadModels: (providerId: string, apiKey: string) => Promise<void>
  setBacklogRole: Dispatch<SetStateAction<BacklogSelectorRoleConfig>>
}

export interface AvatarSettingsState {
  vrmName: string
  passiveCompanionEnabled: boolean
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
  setPassiveCompanionEnabled: (enabled: boolean) => void
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
  project: { state: ProjectSettingsState; actions: ProjectSettingsActions }
  speech: { state: SpeechSettingsState; actions: SpeechSettingsActions }
  listening: { state: ListeningSettingsState; actions: ListeningSettingsActions }
  llm: { state: LlmSettingsState; actions: LlmSettingsActions }
  avatar: { state: AvatarSettingsState; actions: AvatarSettingsActions }
  advanced: { state: AdvancedSettingsState; actions: AdvancedSettingsActions }
}
