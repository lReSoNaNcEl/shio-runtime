import type { VRM } from '@pixiv/three-vrm'
import { Box3, PerspectiveCamera, Vector3 } from 'three'

import { type OverlayViewMode, resolveOverlayCameraView } from '../../tuning/cameraTuning'

export interface ConversationViewConfig {
  overlayViewMode?: string
  overlayWidth?: string
  overlayHeight?: string
  overlayScale?: string
}
export interface ConversationView {
  mode: OverlayViewMode
  width: number
  height: number
  scale: number
}
export function resolveConversationView(
  config: ConversationViewConfig,
  previous?: ConversationView | null,
): ConversationView {
  const number = (value: string | undefined, fallback: number, min: number, max: number) => {
    const parsed = Number(value)
    return value !== undefined && Number.isFinite(parsed)
      ? Math.max(min, Math.min(max, parsed))
      : fallback
  }
  return {
    mode:
      config.overlayViewMode === 'face' ||
      config.overlayViewMode === 'portrait' ||
      config.overlayViewMode === 'bust'
        ? config.overlayViewMode
        : (previous?.mode ?? 'bust'),
    width: number(config.overlayWidth, previous?.width ?? 360, 100, 4096),
    height: number(config.overlayHeight, previous?.height ?? 560, 100, 4096),
    scale: number(config.overlayScale, previous?.scale ?? 1, 0.5, 3),
  }
}

/** Read-only virtual projection from the same rig metrics and preset as Overlay. */
export function conversationCamera(vrm: VRM, view: ConversationView): PerspectiveCamera | null {
  const bounds = new Box3().setFromObject(vrm.scene)
  if (bounds.isEmpty()) return null
  const head = vrm.humanoid.getNormalizedBoneNode('head')
  const pose = resolveOverlayCameraView(
    view.mode,
    {
      height: Math.max(0.2, bounds.max.y - bounds.min.y),
      base: bounds.min.y,
      headY: head?.getWorldPosition(new Vector3()).y ?? null,
      frontSign: vrm.meta.metaVersion === '0' ? -1 : 1,
    },
    view.scale,
  )
  const camera = new PerspectiveCamera(pose.fov, view.width / view.height, 0.01, 100)
  camera.position.set(pose.position.x, pose.position.y, pose.position.z)
  camera.lookAt(pose.target.x, pose.target.y, pose.target.z)
  camera.updateMatrixWorld()
  return camera
}

export function gestureRegionsVisible(camera: PerspectiveCamera, regions: Vector3[][]): boolean {
  return (
    regions.length > 0 &&
    regions.every((points) => {
      const visible = points.map((point) => {
        const projected = point.clone().project(camera)
        return (
          Math.abs(projected.x) < 0.92 &&
          Math.abs(projected.y) < 0.92 &&
          projected.z > -1 &&
          projected.z < 1
        )
      })
      return visible[0] && visible[1] && visible.filter(Boolean).length >= points.length * 0.6
    })
  )
}
