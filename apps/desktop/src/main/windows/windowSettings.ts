import type { Display } from 'electron'

import { DEFAULT_OVERLAY_HEIGHT, DEFAULT_OVERLAY_WIDTH } from '../../shared/config'
import type { AppConfig } from '../config'

export function numericWindowSetting(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export function resolveOverlayBounds(
  config: AppConfig,
  display: Display,
): { width: number; height: number; x: number; y: number } {
  const width = numericWindowSetting(config.overlayWidth, DEFAULT_OVERLAY_WIDTH, 160, 1200)
  const height = numericWindowSetting(config.overlayHeight, DEFAULT_OVERLAY_HEIGHT, 220, 1200)
  const margin = numericWindowSetting(config.overlayMargin, 24, 0, 200)
  const corner = config.overlayCorner ?? 'bottom-right'
  const x = corner.endsWith('left')
    ? Math.round(display.workArea.x + margin)
    : Math.round(display.workArea.x + display.workArea.width - width - margin)
  const y = corner.startsWith('top')
    ? Math.round(display.workArea.y + margin)
    : Math.round(display.workArea.y + display.workArea.height - height - margin)
  return { width, height, x, y }
}
