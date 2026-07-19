import { type VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import type * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { avatarStartupTuning } from '../../tuning/startupTuning'

export class VrmModelLoader {
  async load(scene: THREE.Scene, buffer: ArrayBuffer): Promise<VRM> {
    const blob = new Blob([buffer], { type: 'model/gltf-binary' })
    const blobUrl = URL.createObjectURL(blob)

    try {
      const loader = new GLTFLoader()
      loader.register((parser) => new VRMLoaderPlugin(parser))
      const gltf = await loader.loadAsync(blobUrl)
      const vrm = gltf.userData.vrm as VRM
      VRMUtils.removeUnnecessaryJoints(vrm.scene)
      this.applyStartupTransform(vrm.scene)
      scene.add(vrm.scene)
      console.log(
        `[ANIMDBG] avatar startup transform position=${this.formatVector(vrm.scene.position)} rotation=${this.formatEuler(vrm.scene.rotation)}`,
      )
      return vrm
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  }

  dispose(scene: THREE.Scene, vrm: VRM): void {
    scene.remove(vrm.scene)
    VRMUtils.deepDispose(vrm.scene)
  }

  private applyStartupTransform(root: THREE.Object3D): void {
    root.position.set(
      avatarStartupTuning.rootPosition.x,
      avatarStartupTuning.rootPosition.y,
      avatarStartupTuning.rootPosition.z,
    )
    root.rotation.set(
      avatarStartupTuning.rootRotation.x,
      avatarStartupTuning.rootRotation.y,
      avatarStartupTuning.rootRotation.z,
    )
    root.updateMatrixWorld(true)
  }

  private formatVector(vector: THREE.Vector3): string {
    return `${vector.x.toFixed(2)},${vector.y.toFixed(2)},${vector.z.toFixed(2)}`
  }

  private formatEuler(euler: THREE.Euler): string {
    return `${euler.x.toFixed(2)},${euler.y.toFixed(2)},${euler.z.toFixed(2)}`
  }
}
