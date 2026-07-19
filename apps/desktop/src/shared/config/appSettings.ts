import type { LlmConfig } from '../llm/providers'
import type { UiLocale } from '../localization/locale'
import type { ProjectAwarenessPublicConfig } from '../project-awareness'

export const DEFAULT_SPEECH_URL = 'http://localhost:8000'

export interface AppSettings {
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
  developerOverlayAnimationHudEnabled: string
  developerModeEnabled: string
  passiveCompanionEnabled?: string
  lookAtEnabled: string
  continuousListeningEnabled: string
  continuousListeningMode: string
  continuousListeningReplyCooldownMs: string
  continuousListeningFollowUpWindowMs: string
  continuousListeningCuriosityChance: string
}
