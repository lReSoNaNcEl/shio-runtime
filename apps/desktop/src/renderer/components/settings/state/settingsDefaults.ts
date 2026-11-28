import { DEFAULT_OVERLAY_HEIGHT, DEFAULT_OVERLAY_WIDTH } from '../../../../shared/config'
import type { ComputerUseVisionRoleConfig } from '../../../../shared/llm'
import type { OverlayViewMode } from '../../../avatar/tuning/cameraTuning'

export const overlayViewModes: readonly OverlayViewMode[] = ['bust', 'face', 'portrait']

export const overlayDefaults = {
  width: DEFAULT_OVERLAY_WIDTH,
  height: DEFAULT_OVERLAY_HEIGHT,
  margin: 24,
  opacityPercent: 100,
  transparentBackground: true,
  clickThrough: true,
  corner: 'bottom-right',
  scalePercent: 100,
  viewMode: 'bust' as OverlayViewMode,
}

export const defaultComputerUseVisionRole: ComputerUseVisionRoleConfig = {
  providerId: '',
  model: '',
  timeoutMs: 15_000,
  maxSteps: 30,
}

export const defaultSettingsForm = {
  microphoneId: 'default',
}
