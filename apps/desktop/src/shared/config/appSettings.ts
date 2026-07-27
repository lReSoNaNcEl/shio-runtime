import type { LlmPublicConfig } from '../llm/providers'
import type { UiLocale } from '../localization/locale'
import type { ProjectAwarenessPublicConfig } from '../project-awareness'

export const DEFAULT_SPEECH_URL = 'http://localhost:8000'

export interface SetupLifecycleConfig {
  completed: boolean
  completedAt?: string
}

export interface AppSettings {
  configSchemaVersion: number
  setup: SetupLifecycleConfig
  llm: LlmPublicConfig
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
  developerOverlayAnimationHudEnabled: string
  developerModeEnabled: string
  lookAtEnabled: string
  continuousListeningReplyCooldownMs: string
  continuousListeningFollowUpWindowMs: string
  continuousListeningCuriosityChance: string
}
