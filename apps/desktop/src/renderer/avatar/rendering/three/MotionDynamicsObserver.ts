import type { VRMHumanBoneName } from '@pixiv/three-vrm'

/** Injected by offline qualification only. Never projected through Health or IPC. */
export type MotionDynamicsStage =
  | 'source'
  | 'retargeted'
  | 'anatomical'
  | 'artistic'
  | 'admissible'
  | 'temporal'
  | 'transition'
  | 'final'

export interface MotionDynamicsSample {
  stage: MotionDynamicsStage
  sourceFrame: number
  sourceIndex: number
  bone: VRMHumanBoneName
  rotation: [number, number, number, number]
}

export type MotionDynamicsObserver = (sample: MotionDynamicsSample) => void
