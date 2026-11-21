import type { DesktopAuthorityMode } from '../actions'
import type { LlmPublicConfig } from '../llm/providers'
import type { UiLocale } from '../localization/locale'

export const DEFAULT_OVERLAY_WIDTH = 432
export const DEFAULT_OVERLAY_HEIGHT = 672

export type UiTheme = 'dark' | 'light'

export const DEFAULT_SPEECH_VOLUME_PERCENT = 100

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
  speechVolumePercent: number
  ttsEngine: string
  vrmAssetHandle: string
  vrmAssetName: string
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
