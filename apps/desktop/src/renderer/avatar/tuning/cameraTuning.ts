export type OverlayViewMode = 'bust' | 'face' | 'portrait'

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
