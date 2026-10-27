import type { EmbodimentAvailability } from '../character-response'
import type { GeneratedMotionHealth } from '../motion'

export type AvatarRuntimeHealthStatus =
  | 'not-initialized'
  | 'loading'
  | 'ready'
  | 'failed'
  | 'disposed'

export interface AvatarRuntimeFailure {
  name: string
  message: string
}

/** Public, serializable health contract owned by Avatar Runtime. */
export interface AvatarRuntimeHealth {
  contractVersion: 1
  status: AvatarRuntimeHealthStatus
  modelLoaded: boolean
  presentationAttached: boolean
  operational: boolean
  updatedAt: string
  lastFailure: AvatarRuntimeFailure | null
  motion?: GeneratedMotionHealth
  embodimentAvailability?: EmbodimentAvailability
  speech?: {
    firstPcmAt?: number
    firstOutputAt?: number
    firstAudibleAt?: number
    hardwareLatencyMs?: number
    cueCount?: number
    maxCueErrorMs?: number
    active: boolean
    sourceSampleOffset: number
    sourceSampleRate: number
    rawRms: number
    mouthWeight: number
    blinkWeight: number
  }
}
