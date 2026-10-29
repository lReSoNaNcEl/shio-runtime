import type { VRM } from '@pixiv/three-vrm'

import { breathProfiles, microMotionProfiles, postureShiftTuning } from '../../tuning/motionTuning'
import type { LookAtMode } from '../gaze/LookAtRuntime'
import type { AvatarProceduralMode } from '../types'
import { type AvatarBodyMotionLayer, resolveAvatarMotionAuthority } from './AvatarMotionLayer'
import { BreathController, type BreathDebugState } from './BreathController'
import { MicroMotionController, type MicroMotionDebugState } from './MicroMotionController'
import {
  type PostureOrientation,
  PostureShiftController,
  type PostureShiftDebugState,
} from './PostureShiftController'

export interface ProceduralMotionDebugState {
  mode: AvatarProceduralMode
  bodyLayer: AvatarBodyMotionLayer
  lookAtMode: LookAtMode
  breathing: BreathDebugState
  microMotion: MicroMotionDebugState
  posture: PostureShiftDebugState
}

/** Single per-frame owner for low-authority breathing and body micro-motion. */
export class ProceduralMotionController {
  private readonly breath = new BreathController()
  private readonly microMotion = new MicroMotionController()
  private readonly posture = new PostureShiftController()
  private presentationOnly = false
  private mode: AvatarProceduralMode = 'idle'
  private bodyLayer: AvatarBodyMotionLayer = 'base'
  private lookAtMode: LookAtMode = 'idle'

  attach(vrm: VRM): void {
    this.breath.attach(vrm)
    this.microMotion.attach(vrm)
    this.posture.attach(vrm)
    this.applyProfile()
    this.applyAuthority()
  }

  detach(): void {
    this.breath.detach()
    this.microMotion.detach()
    this.posture.detach()
  }

  remove(): void {
    this.breath.remove()
    this.microMotion.remove()
    this.posture.remove()
  }

  update(delta: number): void {
    if (!this.presentationOnly) this.breath.update(delta)
    this.microMotion.update(delta)
    // Overlay presents the mirrored upper body; it never adds its own posture.
    if (!this.presentationOnly) this.posture.update(delta)
  }

  setPresentationOnly(value: boolean): void {
    if (this.presentationOnly === value) return
    this.breath.remove()
    this.microMotion.remove()
    this.posture.remove()
    this.presentationOnly = value
    this.applyAuthority()
  }

  setMode(mode: AvatarProceduralMode): void {
    if (mode !== 'speaking' || this.mode !== 'speaking') {
      this.microMotion.setSpeechEnergy(0)
      this.posture.setSpeechEnergy(0)
    }
    this.mode = mode
    this.posture.setMode(mode)
    this.applyProfile()
  }

  setSpeechEnergy(energy: number): void {
    this.microMotion.setSpeechEnergy(this.mode === 'speaking' ? energy : 0)
    this.posture.setSpeechEnergy(this.mode === 'speaking' ? energy : 0)
  }

  setBodyMotionLayer(layer: AvatarBodyMotionLayer): void {
    this.bodyLayer = layer
    this.applyAuthority()
  }

  setLookAtMode(mode: LookAtMode): void {
    this.lookAtMode = mode
    this.applyAuthority()
  }

  /** Upper-body share of the current head orientation (from Head Motion). */
  setOrientation(orientation: PostureOrientation): void {
    this.posture.setOrientation(orientation)
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
      posture: this.posture.getDebugState(),
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
    this.posture.setAuthority(
      this.presentationOnly
        ? 0
        : Math.max(authority.proceduralUpperBodyWeight, postureShiftTuning.minimumAuthority),
    )
  }
}
