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
}
