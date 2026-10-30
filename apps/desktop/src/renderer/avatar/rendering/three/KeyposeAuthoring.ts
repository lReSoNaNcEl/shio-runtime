import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import * as THREE from 'three'

import type { MotionKeypose } from '../../../../shared/motion'

export type KeyposeAnchor = MotionKeypose['anchor']
export type KeyposeSide = 'left' | 'right'

/** World positions of one arm and its anchor, plus the measured body basis. */
export interface KeyposeRigSample {
  side: KeyposeSide
  anchor: THREE.Vector3
  shoulder: THREE.Vector3
  elbow: THREE.Vector3
  wrist: THREE.Vector3
  /** Character left minus right shoulder; encodes VRM0/VRM1 handedness. */
  across: THREE.Vector3
  /** Hips toward chest. */
  up: THREE.Vector3
  /** Optional palm normal in world space. */
  palm?: THREE.Vector3
}

const OFFSET_LIMIT = 1.5
const round = (value: number) => Math.round(value * 1000) / 1000
const clampOffset = (value: number) => round(Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, value)))

function basis(sample: Pick<KeyposeRigSample, 'across' | 'up'>) {
  const across = sample.across.clone().normalize()
  const up = sample.up.clone().addScaledVector(across, -sample.up.dot(across)).normalize()
  const forward = across.clone().cross(up).normalize()
  return { across, up, forward }
}

const ANCHOR_BONES: Record<KeyposeAnchor, readonly VRMHumanBoneName[]> = {
  hips: ['hips'],
  chest: ['upperChest', 'chest'],
  neck: ['neck'],
  head: ['head'],
}

/** Samples the current composed pose of one arm from the normalized humanoid. */
export function sampleKeyposeRig(
  vrm: VRM,
  side: KeyposeSide,
  anchor: KeyposeAnchor,
): KeyposeRigSample | null {
  const world = (name: VRMHumanBoneName) =>
    vrm.humanoid.getNormalizedBoneNode(name)?.getWorldPosition(new THREE.Vector3()) ?? null
  const anchorPosition = ANCHOR_BONES[anchor].map(world).find(Boolean) ?? null
  const hips = world('hips')
  const chest = world('upperChest') ?? world('chest')
  const left = world('leftUpperArm')
  const right = world('rightUpperArm')
  const shoulder = world(`${side}UpperArm`)
  const elbow = world(`${side}LowerArm`)
  const wrist = world(`${side}Hand`)
  if (!anchorPosition || !hips || !chest || !left || !right || !shoulder || !elbow || !wrist)
    return null
  const index = world(`${side}IndexProximal`)
  const little = world(`${side}LittleProximal`)
  const palm =
    index && little
      ? index
          .clone()
          .sub(wrist)
          .cross(little.clone().sub(wrist))
          .multiplyScalar(side === 'left' ? 1 : -1)
      : undefined
  return {
    side,
    anchor: anchorPosition,
    shoulder,
    elbow,
    wrist,
    across: left.sub(right),
    up: chest.sub(hips),
    palm,
  }
}

/** Rig pose → keypose: wrist offset from the anchor in arm lengths, x lateral outward.
 * The same convention as the MotionBricks targets planner, so a keypose scales with
 * each rig. Pure: it reads the sample and writes nothing. */
export function keyposeFromRig(sample: KeyposeRigSample, anchor: KeyposeAnchor): MotionKeypose {
  const { across, up, forward } = basis(sample)
  const length = sample.shoulder.distanceTo(sample.elbow) + sample.elbow.distanceTo(sample.wrist)
  const scale = 1 / Math.max(1e-6, length)
  const outward = sample.side === 'left' ? 1 : -1
  const delta = sample.wrist.clone().sub(sample.anchor)
  const keypose: MotionKeypose = {
    anchor,
    offset: [
      clampOffset(delta.dot(across) * outward * scale),
      clampOffset(delta.dot(up) * scale),
      clampOffset(delta.dot(forward) * scale),
    ],
  }
  if (sample.palm && sample.palm.lengthSq() > 1e-10) {
    const palm = sample.palm.clone().normalize()
    const normal = new THREE.Vector3(palm.dot(across) * outward, palm.dot(up), palm.dot(forward))
    normal.normalize()
    keypose.palmNormal = [round(normal.x), round(normal.y), round(normal.z)]
  }
  return keypose
}

/** Keypose → world wrist target on a rig; the inverse used to verify authoring. */
export function wristTargetFromKeypose(
  keypose: MotionKeypose,
  rig: Pick<KeyposeRigSample, 'side' | 'anchor' | 'across' | 'up'> & { armLength: number },
): THREE.Vector3 {
  const { across, up, forward } = basis(rig)
  const length = rig.armLength
  const outward = rig.side === 'left' ? 1 : -1
  const [x, y, z] = keypose.offset
  return rig.anchor
    .clone()
    .addScaledVector(across, x * outward * length)
    .addScaledVector(up, y * length)
    .addScaledVector(forward, z * length)
}
