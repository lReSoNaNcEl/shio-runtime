import type { VRM } from '@pixiv/three-vrm'

import { breathProfiles, microMotionProfiles } from '../../tuning/motionTuning'
import type { LookAtMode } from '../gaze/LookAtRuntime'
import type { AvatarProceduralMode } from '../types'
import { type AvatarBodyMotionLayer, resolveAvatarMotionAuthority } from './AvatarMotionLayer'
import { BreathController, type BreathDebugState } from './BreathController'
import { MicroMotionController, type MicroMotionDebugState } from './MicroMotionController'

export interface ProceduralMotionDebugState {
  mode: AvatarProceduralMode
  bodyLayer: AvatarBodyMotionLayer
  lookAtMode: LookAtMode
  breathing: BreathDebugState
  microMotion: MicroMotionDebugState
}

/** Single per-frame owner for low-authority breathing and body micro-motion. */
export class ProceduralMotionController {
  private readonly breath = new BreathController()
  private readonly microMotion = new MicroMotionController()
  private presentationOnly = false
  private mode: AvatarProceduralMode = 'idle'
  private bodyLayer: AvatarBodyMotionLayer = 'base'
  private lookAtMode: LookAtMode = 'idle'

  attach(vrm: VRM): void {
    this.breath.attach(vrm)
    this.microMotion.attach(vrm)
    this.applyProfile()
    this.applyAuthority()
  }

  detach(): void {
    this.breath.detach()
    this.microMotion.detach()
  }

  remove(): void {
    this.breath.remove()
    this.microMotion.remove()
  }

  update(delta: number): void {
    if (!this.presentationOnly) this.breath.update(delta)
    this.microMotion.update(delta)
  }

  setPresentationOnly(value: boolean): void {
    if (this.presentationOnly === value) return
    this.breath.remove()
    this.microMotion.remove()
    this.presentationOnly = value
    this.applyAuthority()
  }

  setMode(mode: AvatarProceduralMode): void {
    this.mode = mode
    this.applyProfile()
  }

  setBodyMotionLayer(layer: AvatarBodyMotionLayer): void {
    this.bodyLayer = layer
    this.applyAuthority()
  }

  setLookAtMode(mode: LookAtMode): void {
    this.lookAtMode = mode
    this.applyAuthority()
  }

  setLookAtActive(active: boolean): void {
    this.microMotion.setLookAtActive(active)
  }

  nudge(options: {
    headX?: number
    headY?: number
    eyeX?: number
    eyeY?: number
    duration?: number
  }): void {
    this.microMotion.nudge(options)
  }

  getDebugState(): ProceduralMotionDebugState {
    return {
      mode: this.mode,
      bodyLayer: this.bodyLayer,
      lookAtMode: this.lookAtMode,
      breathing: this.breath.getDebugState(),
      microMotion: this.microMotion.getDebugState(),
    }
  }

  private applyProfile(): void {
    this.breath.setProfile(breathProfiles[this.mode])
    this.microMotion.setProfile(microMotionProfiles[this.mode])
  }

  private applyAuthority(): void {
    const authority = resolveAvatarMotionAuthority({
      bodyLayer: this.bodyLayer,
      directedGaze:
        this.lookAtMode === 'userFocus' ||
        this.lookAtMode === 'listening' ||
        this.lookAtMode === 'speaking',
      screenGaze: this.lookAtMode === 'screenFocus',
    })
    this.microMotion.setAuthority(
      this.presentationOnly ? 0 : authority.proceduralUpperBodyWeight,
      authority.proceduralHeadWeight,
    )
  }
}
