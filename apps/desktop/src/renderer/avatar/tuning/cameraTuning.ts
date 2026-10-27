export type OverlayViewMode = 'bust' | 'face' | 'portrait'

export interface OverlayCameraMetrics {
  height: number
  base: number
  headY: number | null
  frontSign: -1 | 1
}

/** Shared preset calculation; querying it never moves a presentation camera. */
export function resolveOverlayCameraView(
  mode: OverlayViewMode,
  metrics: OverlayCameraMetrics,
  scale = 1,
) {
  const preset = overlayCameraPresets[mode] ?? overlayCameraPresets.bust
  const clampedScale = Math.max(preset.scaleMin, Math.min(preset.scaleMax, scale))
  const ratio = metrics.height / 1.65
  const target = {
    x: preset.target.x * ratio,
    y:
      metrics.headY === null
        ? metrics.base + preset.target.y * ratio
        : metrics.headY + (preset.target.y - 1.5) * ratio,
    z: preset.target.z * ratio,
  }
  return {
    target,
    fov: preset.fov,
    position: {
      x: target.x + ((preset.position.x - preset.target.x) * ratio) / clampedScale,
      y: target.y + ((preset.position.y - preset.target.y) * ratio) / clampedScale,
      z:
        target.z +
        ((preset.position.z - preset.target.z) * ratio * -metrics.frontSign) / clampedScale,
    },
  }
}

export const overlayCameraPresets = {
  bust: {
    label: 'Bust',
    position: { x: 0, y: 1.5, z: -1.9 },
    target: { x: 0, y: 1.28, z: 0 },
    fov: 30,
    scaleMin: 0.75,
    scaleMax: 2,
  },
  face: {
    label: 'Face',
    position: { x: 0, y: 1.58, z: -1.25 },
    target: { x: 0, y: 1.43, z: 0 },
    fov: 28,
    scaleMin: 0.75,
    scaleMax: 2.2,
  },
  portrait: {
    label: 'Portrait',
    position: { x: 0, y: 1.62, z: -0.95 },
    target: { x: 0, y: 1.5, z: 0 },
    fov: 26,
    scaleMin: 0.8,
    scaleMax: 2.4,
  },
} satisfies Record<
  OverlayViewMode,
  {
    label: string
    position: { x: number; y: number; z: number }
    target: { x: number; y: number; z: number }
    fov: number
    scaleMin: number
    scaleMax: number
  }
>
