export interface AvatarRigProfile {
  secondaryMotion?: {
    tail?: {
      boneNamePatterns: readonly string[]
      boneNameExcludes: readonly string[]
      minimumChainLength: number
      maximumChainLength: number
    }
  }
}

/** Generic capability profile; it contains no concrete model or bone identity. */
export const DEFAULT_AVATAR_RIG_PROFILE: AvatarRigProfile = {
  secondaryMotion: {
    tail: {
      boneNamePatterns: ['tail', 'shippo', '尻尾'],
      boneNameExcludes: ['ponytail', 'hair', 'detail'],
      minimumChainLength: 2,
      maximumChainLength: 8,
    },
  },
}
