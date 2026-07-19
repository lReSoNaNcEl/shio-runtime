import type { VRM } from '@pixiv/three-vrm'
import {
  createVRMAnimationClip,
  type VRMAnimation,
  VRMAnimationLoaderPlugin,
} from '@pixiv/three-vrm-animation'
import type * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import type { VrmAnimationLoadContext } from './VrmModel'

export interface LoadedAnimationClip {
  clip: THREE.AnimationClip
  facialTracksRemoved: number
  facialTrackNames: string[]
  bindDuration: number
  hasSceneRootTrack: boolean
}

export class AvatarAnimationLoader {
  parses = 0

  constructor(private readonly hasSceneRootPositionTrack: (clip: THREE.AnimationClip) => boolean) {}

  async load(
    blobUrl: string,
    vrm: VRM,
    context: VrmAnimationLoadContext,
    isCurrent?: () => boolean,
  ): Promise<LoadedAnimationClip | null> {
    const parseStarted = performance.now()
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser))
    const gltf = await loader.loadAsync(blobUrl)
    const animations = gltf.userData.vrmAnimations as VRMAnimation[] | undefined
    if (!animations || animations.length === 0) {
      throw new Error('В файле нет VRM-анимаций')
    }
    if (isCurrent && !isCurrent()) return null

    const bindStarted = performance.now()
    const clip = createVRMAnimationClip(animations[0], vrm)
    const bindDuration = performance.now() - bindStarted
    this.parses += 1
    console.log(
      `[ANIMDBG] parse animation=${context.animationId} file=${context.file} parseMs=${Math.round(performance.now() - parseStarted)} bindMs=${Math.round(bindDuration)} parses=${this.parses}`,
    )

    const hasSceneRootTrack = this.hasSceneRootPositionTrack(clip)
    this.logAnimationTrackHierarchy(clip, context)

    const facialTrackCount = clip.tracks.filter((track) =>
      this.isForbiddenFacialTrack(track.name),
    ).length
    const facialTrackNames = clip.tracks
      .filter((track) => this.isForbiddenFacialBoneTrack(track.name))
      .map((track) => track.name)
    if (facialTrackCount > 0 || facialTrackNames.length > 0) {
      clip.tracks = clip.tracks.filter(
        (track) =>
          !this.isForbiddenFacialTrack(track.name) && !this.isForbiddenFacialBoneTrack(track.name),
      )
    }

    return {
      clip,
      facialTracksRemoved: facialTrackCount,
      facialTrackNames,
      bindDuration,
      hasSceneRootTrack,
    }
  }

  private isForbiddenFacialTrack(trackName: string): boolean {
    return (
      /\.weight$/i.test(trackName) ||
      /(^|[./])(blink|lookAt|look_at|gaze|eyeTarget|eye_target|expression|blendShape|blendshape|morph)([./]|$)/i.test(
        trackName,
      )
    )
  }

  private isForbiddenFacialBoneTrack(trackName: string): boolean {
    return /(^|[./])(jaw|leftEye|rightEye|tongue|eyelid|leftEyelid|rightEyelid)([./]|$)/i.test(
      trackName,
    )
  }

  private logAnimationTrackHierarchy(
    clip: THREE.AnimationClip,
    context: VrmAnimationLoadContext,
  ): void {
    const interestingTracks = clip.tracks
      .map((track) => track.name)
      .filter((name) => /\.(position|quaternion|rotation)$/.test(name))
      .sort()

    console.log(
      [
        `[ANIMDBG] Animation Track Hierarchy animation=${context.animationId} file=${context.file}`,
        ...interestingTracks.map((name) => `  ${name}`),
      ].join('\n'),
    )
  }
}
