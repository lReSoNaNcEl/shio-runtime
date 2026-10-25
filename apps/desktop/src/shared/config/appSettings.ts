import type { DesktopAuthorityMode } from '../actions'
import type { LlmPublicConfig } from '../llm/providers'
import type { UiLocale } from '../localization/locale'

export type UiTheme = 'dark' | 'light'

export function normalizeUiTheme(value: unknown): UiTheme {
  return value === 'dark' ? 'dark' : 'light'
}

export interface SetupLifecycleConfig {
  completed: boolean
  completedAt?: string
}

export interface AppSettings {
  configSchemaVersion: number
  setup: SetupLifecycleConfig
  llm: LlmPublicConfig
  uiLocale: UiLocale
  uiTheme: UiTheme
  desktopAuthorityMode: DesktopAuthorityMode
  ttsLanguage: string
  ttsEngine: string
  avatarAssetId: string
  avatarAssetName: string
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
