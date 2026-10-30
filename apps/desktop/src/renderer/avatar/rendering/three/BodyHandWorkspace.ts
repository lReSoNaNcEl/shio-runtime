import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'

import { MOTION_CATALOG, type MotionPhaseId, type MotionProfile } from '../../../../shared/motion'
import type { Limb, Torso } from './BodyLimbGeometry'

/** Catalog hand workspace of one arm measured on the current torso.
 * Moved verbatim from GeneratedBodySafety; the owner keeps all state. */
export type HandTarget = MotionProfile['handScore']['phases'][MotionPhaseId]['left']
export type HandGoal = {
  center: THREE.Vector3
  axes: THREE.Vector3[]
  length: number
  extents: number[]
  palm: THREE.Vector3 | null
  fingers: THREE.Vector3 | null
}

export function handWorkspaceGoal(
  vrm: VRM | null,
  torso: Torso | null,
  arm: Limb,
  target: HandTarget | undefined,
  generatedSource: boolean,
): HandGoal | null {
  if (!target || target.workspace === 'relaxed' || !torso || !vrm) return null
  const workspace = MOTION_CATALOG.handWorkspaces[target.workspace]
  const anchor = vrm.humanoid.getNormalizedBoneNode(workspace.anchor)
  if (!anchor) return null
  const shoulder = arm.upper.getWorldPosition(new THREE.Vector3())
  const elbow = arm.lower.getWorldPosition(new THREE.Vector3())
  const wrist = arm.end.getWorldPosition(new THREE.Vector3())
  const length = shoulder.distanceTo(elbow) + elbow.distanceTo(wrist)
  const axes = [torso.x, torso.y, torso.front]
  const center = anchor.getWorldPosition(new THREE.Vector3())
  for (const [index, axis] of axes.entries())
    center.addScaledVector(
      axis,
      (workspace.center[index] + (target.workspaceOffset?.[index] ?? 0)) *
        length *
        (index === 0 ? arm.side : 1),
    )
  if (generatedSource && target.workspace === 'face') {
    // The old centre below the chin required maximum wrist deviation on the
    // loaded rig. Only one box corner could satisfy palm/finger orientation,
    // erasing the neural stroke. Move the same-sized region toward its own
    // measured shoulder; hinge, wrist, reach, contact and sweep stay intact.
    const origin = anchor.getWorldPosition(new THREE.Vector3())
    const lateral = center.clone().sub(origin).dot(torso.x) * arm.side
    const shoulderLateral = shoulder.clone().sub(origin).dot(torso.x) * arm.side
    center.addScaledVector(torso.x, arm.side * Math.max(0, shoulderLateral - lateral))
  }
  // The catalog's anatomical chest anchor lies inside the garment. Hover
  // regions must start outside the measured surface, including limb thickness.
  if (workspace.anchor === 'chest' || workspace.anchor === 'hips') {
    let surface = torso.radii.z + arm.radius * 2 + 0.015
    if (workspace.anchor === 'hips') {
      const radii = torso.radii.clone().addScalar(arm.radius + 0.015)
      const offset = center.clone().sub(torso.center)
      const lateral = Math.max(0, Math.abs(offset.dot(torso.x)) - workspace.halfExtents[0] * length)
      const vertical = Math.max(
        0,
        Math.abs(offset.dot(torso.y)) - workspace.halfExtents[1] * length,
      )
      surface =
        radii.z * Math.sqrt(Math.max(0, 1 - (lateral / radii.x) ** 2 - (vertical / radii.y) ** 2))
    }
    const minimum = surface + workspace.halfExtents[2] * length
    const depth = center.clone().sub(torso.center).dot(torso.front)
    if (depth < minimum) center.addScaledVector(torso.front, minimum - depth)
  }
  const palm =
    target.palmFacing === 'free'
      ? null
      : target.palmFacing === 'up'
        ? torso.y.clone()
        : torso.front.clone().multiplyScalar(target.palmFacing === 'inward' ? -1 : 1)
  const fingers =
    target.fingerDirection === 'free'
      ? null
      : target.fingerDirection === 'up'
        ? torso.y.clone()
        : torso.front.clone()
  return {
    center,
    axes,
    length,
    extents: workspace.halfExtents.map(
      (value) => value * length * (target.workspaceExtentScale ?? 1),
    ),
    palm,
    fingers,
  }
}
