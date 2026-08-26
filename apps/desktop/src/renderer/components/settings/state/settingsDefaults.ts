import type { BacklogSelectorRoleConfig, ComputerUseVisionRoleConfig } from '../../../../shared/llm'
import type { OverlayViewMode } from '../../../avatar/tuning/cameraTuning'

export const overlayViewModes: readonly OverlayViewMode[] = ['bust', 'face', 'portrait']

export const overlayDefaults = {
  width: 360,
  height: 560,
  margin: 24,
  opacityPercent: 100,
  transparentBackground: true,
  clickThrough: true,
  corner: 'bottom-right',
  scalePercent: 100,
  viewMode: 'bust' as OverlayViewMode,
}

export const defaultBacklogSelectorRole: BacklogSelectorRoleConfig = {
  enabled: false,
  providerId: '',
  model: '',
  timeoutMs: 2_000,
  minimumConfidence: 0.72,
}

export const defaultComputerUseVisionRole: ComputerUseVisionRoleConfig = {
  providerId: '',
  model: '',
  timeoutMs: 15_000,
  maxSteps: 30,
}

export const defaultSettingsForm = {
  ttsLanguage: 'ru',
  microphoneId: 'default',
}
