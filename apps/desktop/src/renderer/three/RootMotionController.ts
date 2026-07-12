import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'
import type { VrmRootMotionPolicy } from './VrmModel'

export class RootMotionController {
  private rootAnchorPosition = new THREE.Vector3()

  setAnchorFromVrm(vrm: VRM): void {
    this.rootAnchorPosition.copy(vrm.scene.position)
  }

  applyRootMotionCompensation(vrm: VRM | null, rootMotionPolicy: VrmRootMotionPolicy | null | undefined): void {
    if (!vrm || !rootMotionPolicy) return

    switch (rootMotionPolicy) {
      case 'lockAll':
        vrm.scene.position.copy(this.rootAnchorPosition)
        return
      case 'lockY':
        vrm.scene.position.y = this.rootAnchorPosition.y
        return
      case 'lockXZ':
        vrm.scene.position.x = this.rootAnchorPosition.x
        vrm.scene.position.z = this.rootAnchorPosition.z
        return
      case 'allow':
      default:
        this.rootAnchorPosition.copy(vrm.scene.position)
    }
  }

  hasSceneRootPositionTrack(clip: THREE.AnimationClip): boolean {
    return clip.tracks.some((track) => /\.position$/.test(track.name) && this.isSceneRootTrackName(track.name))
  }

  isSceneRootTrackName(name: string): boolean {
    const target = name.replace(/\.position$/, '').toLowerCase()
    return target === 'root' || target === 'scene' || target === 'vrmroot' || target === 'armature'
  }
}
