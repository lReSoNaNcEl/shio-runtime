import type { BacklogSelectorRoleConfig } from '../../../../shared/llm'
import type { OverlayViewMode } from '../../../avatar/tuning/cameraTuning'

export const overlayViewModes: readonly OverlayViewMode[] = ['front', 'bust', 'face', 'portrait']

export const overlayDefaults = {
  width: 360,
  height: 560,
  margin: 24,
  opacityPercent: 100,
  transparentBackground: true,
  clickThrough: true,
  corner: 'bottom-right',
  scalePercent: 100,
  viewMode: 'front' as OverlayViewMode,
}

export const defaultBacklogSelectorRole: BacklogSelectorRoleConfig = {
  enabled: false,
  providerId: '',
  model: '',
  timeoutMs: 2_000,
  minimumConfidence: 0.72,
}

export const defaultSettingsForm = {
  ttsLanguage: 'ru',
  ttsVoice: 'animevox_makima',
  microphoneId: 'default',
  projectEnabled: true,
  projectBranch: 'main',
}
