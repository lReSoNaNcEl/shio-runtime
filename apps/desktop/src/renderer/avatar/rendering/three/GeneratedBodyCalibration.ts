import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'

export interface BodyClearanceCalibration {
  halfWidth: number
  halfDepth: number
  forwardOffset: number
  scale: number
  armRadius: { left: number; right: number }
  forearmRadius?: Partial<Record<'left' | 'right', number>>
}

/** Bounded bind-skin measurement; no mesh, weights, expression or spring writes. */
export function calibrateBodyClearance(vrm: VRM): BodyClearanceCalibration {
  const get = (name: Parameters<VRM['humanoid']['getNormalizedBoneNode']>[0]) =>
    vrm.humanoid.getNormalizedBoneNode(name)?.getWorldPosition(new THREE.Vector3())
  const hips = get('hips') ?? new THREE.Vector3()
  const left = get('leftUpperArm') ?? hips.clone().add(new THREE.Vector3(-0.2, 0.4, 0))
  const right = get('rightUpperArm') ?? hips.clone().add(new THREE.Vector3(0.2, 0.4, 0))
  const top = get('neck') ?? left.clone().add(right).multiplyScalar(0.5)
  const up = top.clone().sub(hips).normalize()
  const x = left.clone().sub(right).normalize()
  x.addScaledVector(up, -x.dot(up)).normalize()
  const front = x.clone().cross(up).normalize()
  const height = Math.max(0.1, top.distanceTo(hips))
  const width = left.distanceTo(right)
  const center = hips.clone().lerp(top, 0.5)
  const raw = (name: Parameters<VRM['humanoid']['getRawBoneNode']>[0]) =>
    vrm.humanoid.getRawBoneNode?.(name)
  const torso = new Set(
    (['hips', 'spine', 'chest', 'upperChest'] as const).map((name) => raw(name)).filter(Boolean),
  )
  const subtree = (root: THREE.Object3D | null | undefined): Set<THREE.Object3D> => {
    const result = new Set<THREE.Object3D>()
    root?.traverse((node) => {
      result.add(node)
    })
    return result
  }
  const armSets = {
    left: subtree(raw('leftShoulder') ?? raw('leftUpperArm')),
    right: subtree(raw('rightShoulder') ?? raw('rightUpperArm')),
  }
  const forearms = { left: raw('leftLowerArm'), right: raw('rightLowerArm') }
  const forearmSets = { left: subtree(forearms.left), right: subtree(forearms.right) }
  let halfWidth = Math.max(width * 0.45, height * 0.32)
  let near = -height * 0.25
  let far = height * 0.28
  let measuredHalfWidth = 0,
    measuredNear = Infinity,
    measuredFar = -Infinity,
    torsoSamples = 0
  let samples = 0
  const armRadius = { left: height * 0.055, right: height * 0.055 }
  const forearmRadius: Partial<Record<'left' | 'right', number>> = {}
  const indices = new THREE.Vector4(),
    weights = new THREE.Vector4(),
    point = new THREE.Vector3()
  const meshes: THREE.SkinnedMesh[] = []
  vrm.scene.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh
    if (mesh.isSkinnedMesh && mesh.skeleton && meshes.length < 128) meshes.push(mesh)
  })
  const perMesh = Math.max(16, Math.floor(8192 / Math.max(1, meshes.length)))
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position')
    const skinIndex = mesh.geometry.getAttribute('skinIndex')
    const skinWeight = mesh.geometry.getAttribute('skinWeight')
    if (!position || !skinIndex || !skinWeight) continue
    mesh.skeleton.update()
    const stride = Math.max(1, Math.ceil(position.count / perMesh))
    for (let index = 0; index < position.count && samples < 8192; index += stride) {
      samples++
      indices.set(
        skinIndex.getX(index),
        skinIndex.getY(index),
        skinIndex.getZ(index),
        skinIndex.getW(index),
      )
      weights.set(
        skinWeight.getX(index),
        skinWeight.getY(index),
        skinWeight.getZ(index),
        skinWeight.getW(index),
      )
      let torsoWeight = 0,
        leftWeight = 0,
        rightWeight = 0,
        leftForearmWeight = 0,
        rightForearmWeight = 0
      for (let component = 0; component < 4; component++) {
        const joint = mesh.skeleton.bones[indices.getComponent(component)]
        const weight = weights.getComponent(component)
        if (torso.has(joint)) torsoWeight += weight
        if (armSets.left.has(joint)) leftWeight += weight
        if (armSets.right.has(joint)) rightWeight += weight
        if (forearmSets.left.has(joint)) leftForearmWeight += weight
        if (forearmSets.right.has(joint)) rightForearmWeight += weight
      }
      if (torsoWeight < 0.6 && Math.max(leftWeight, rightWeight) < 0.2) continue
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld)
      if (torsoWeight >= 0.6 && leftWeight + rightWeight <= 0.05) {
        const local = point.clone().sub(center)
        if (Math.abs(local.dot(up)) > height * 0.49) continue
        const lateral = Math.abs(local.dot(x)),
          depth = local.dot(front)
        if (!Number.isFinite(lateral) || !Number.isFinite(depth)) continue
        torsoSamples++
        measuredHalfWidth = Math.max(measuredHalfWidth, lateral)
        measuredNear = Math.min(measuredNear, depth)
        measuredFar = Math.max(measuredFar, depth)
      } else {
        for (const side of ['left', 'right'] as const) {
          if ((side === 'left' ? leftWeight : rightWeight) < 0.2) continue
          // Skin is measured in its bind pose, before normalized playback is
          // copied to raw bones. Use that same raw basis for sleeve thickness.
          const shoulder =
            raw(`${side}UpperArm`)?.getWorldPosition(new THREE.Vector3()) ??
            (side === 'left' ? left : right)
          const hand =
            raw(`${side}Hand`)?.getWorldPosition(new THREE.Vector3()) ?? get(`${side}Hand`)
          if (!hand) continue
          const axis = hand.clone().sub(shoulder).normalize()
          const offset = point.clone().sub(shoulder)
          const distance = offset.addScaledVector(axis, -offset.dot(axis)).length()
          armRadius[side] = Math.max(armRadius[side], Math.min(height * 0.15, distance))
          if ((side === 'left' ? leftForearmWeight : rightForearmWeight) < 0.6) continue
          const elbow = forearms[side]?.getWorldPosition(new THREE.Vector3())
          if (!elbow) continue
          const forearmAxis = hand.clone().sub(elbow)
          const length = forearmAxis.length()
          if (length < 0.001) continue
          forearmAxis.normalize()
          const local = point.clone().sub(elbow)
          const along = local.dot(forearmAxis)
          if (along < 0 || along > length) continue
          const radius = local.addScaledVector(forearmAxis, -along).length()
          forearmRadius[side] = Math.max(
            forearmRadius[side] ?? height * 0.055,
            Math.min(height * 0.15, radius),
          )
        }
      }
    }
  }
  if (
    torsoSamples >= 16 &&
    measuredHalfWidth >= height * 0.05 &&
    measuredFar - measuredNear >= height * 0.05
  ) {
    halfWidth = measuredHalfWidth
    near = measuredNear
    far = measuredFar
  }
  return {
    halfWidth,
    halfDepth: (far - near) * 0.5,
    forwardOffset: (far + near) * 0.5,
    scale: Math.max(0.001, Math.abs(vrm.scene.getWorldScale(new THREE.Vector3()).y)),
    armRadius,
    forearmRadius,
  }
}
