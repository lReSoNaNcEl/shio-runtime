import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { type VRM, type VRMHumanBones, VRMHumanoid } from '@pixiv/three-vrm'
import * as THREE from 'three'

interface Accessor {
  bufferView: number
  byteOffset?: number
  componentType: number
  count: number
  type: string
  normalized?: boolean
}
interface RigDocument {
  scene: number
  scenes: Array<{ nodes: number[] }>
  nodes: Array<{
    name?: string
    children?: number[]
    translation?: number[]
    rotation?: number[]
    scale?: number[]
    mesh?: number
    skin?: number
  }>
  meshes: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>
  skins: Array<{ joints: number[]; inverseBindMatrices: number }>
  accessors: Accessor[]
  bufferViews: Array<{ byteOffset?: number; byteLength: number; byteStride?: number }>
  extensions: {
    VRM?: { humanoid: { humanBones: Array<{ bone: keyof VRMHumanBones; node: number }> } }
    VRMC_vrm?: { humanoid: { humanBones: Record<keyof VRMHumanBones, { node: number }> } }
  }
}

/** Real bundled bind hierarchy, official normalized rig and skin attributes; no WebGL mocks. */
export function greenFoxRig(filename?: string): VRM {
  const binary = readFileSync(
    filename ??
      fileURLToPath(new URL('../../../src/renderer/assets/vrm/green_fox.vrm', import.meta.url)),
  )
  const jsonLength = binary.readUInt32LE(12)
  const document = JSON.parse(binary.subarray(20, 20 + jsonLength).toString()) as RigDocument
  const data = new DataView(binary.buffer, binary.byteOffset + 28 + jsonLength)
  const attribute = (id: number): THREE.BufferAttribute => {
    const accessor = document.accessors[id]
    const view = document.bufferViews[accessor.bufferView]
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type]
    if (!size) throw new Error('Unsupported qualification accessor')
    const bytes = accessor.componentType === 5126 ? 4 : accessor.componentType === 5123 ? 2 : 1
    const values = new Float32Array(accessor.count * size)
    for (let index = 0; index < accessor.count; index++) {
      for (let component = 0; component < size; component++) {
        const offset =
          (view.byteOffset ?? 0) +
          (accessor.byteOffset ?? 0) +
          index * (view.byteStride ?? bytes * size) +
          component * bytes
        let value =
          bytes === 4
            ? data.getFloat32(offset, true)
            : bytes === 2
              ? data.getUint16(offset, true)
              : data.getUint8(offset)
        if (accessor.normalized && bytes !== 4) value /= bytes === 2 ? 65535 : 255
        values[index * size + component] = value
      }
    }
    return new THREE.BufferAttribute(values, size)
  }
  const nodes = document.nodes.map((node) => {
    const bone = new THREE.Bone()
    bone.name = node.name ?? ''
    if (node.translation) bone.position.fromArray(node.translation)
    if (node.rotation) bone.quaternion.fromArray(node.rotation)
    if (node.scale) bone.scale.fromArray(node.scale)
    return bone
  })
  document.nodes.forEach((node, index) => {
    node.children?.forEach((child) => {
      nodes[index].add(nodes[child])
    })
  })
  const scene = new THREE.Scene()
  document.scenes[document.scene].nodes.forEach((index) => {
    scene.add(nodes[index])
  })
  scene.updateMatrixWorld(true)
  document.nodes.forEach((node, index) => {
    if (node.mesh === undefined || node.skin === undefined) return
    const skin = document.skins[node.skin]
    const inverse = attribute(skin.inverseBindMatrices)
    const skeleton = new THREE.Skeleton(
      skin.joints.map((joint) => nodes[joint]),
      skin.joints.map((_, joint) => new THREE.Matrix4().fromArray(inverse.array, joint * 16)),
    )
    for (const primitive of document.meshes[node.mesh].primitives) {
      const geometry = new THREE.BufferGeometry()
      for (const [source, target] of [
        ['POSITION', 'position'],
        ['JOINTS_0', 'skinIndex'],
        ['WEIGHTS_0', 'skinWeight'],
      ]) {
        const accessor = primitive.attributes[source]
        if (accessor !== undefined) geometry.setAttribute(target, attribute(accessor))
      }
      const mesh = new THREE.SkinnedMesh(geometry)
      nodes[index].add(mesh)
      mesh.updateMatrixWorld(true)
      mesh.bind(skeleton, mesh.matrixWorld)
    }
  })
  // Match the installed VRM0 loader's thumb-name migration into VRM1 normalized names.
  const thumbNames: Record<string, keyof VRMHumanBones> = {
    leftThumbProximal: 'leftThumbMetacarpal',
    leftThumbIntermediate: 'leftThumbProximal',
    rightThumbProximal: 'rightThumbMetacarpal',
    rightThumbIntermediate: 'rightThumbProximal',
  }
  const humanBones = Object.fromEntries(
    document.extensions.VRMC_vrm
      ? Object.entries(document.extensions.VRMC_vrm.humanoid.humanBones).map(([name, entry]) => [
          name,
          { node: nodes[entry.node] },
        ])
      : (document.extensions.VRM?.humanoid.humanBones.map((entry) => [
          thumbNames[entry.bone] ?? entry.bone,
          { node: nodes[entry.node] },
        ]) ?? []),
  ) as unknown as VRMHumanBones
  const humanoid = new VRMHumanoid(humanBones)
  scene.add(humanoid.normalizedHumanBonesRoot)
  scene.updateMatrixWorld(true)
  return {
    scene,
    humanoid,
    meta: { metaVersion: document.extensions.VRMC_vrm ? '1' : '0' },
  } as unknown as VRM
}
