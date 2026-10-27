export interface EmotionManifestEntry {
  id: string
  displayName: string
  aliases?: string[]
  markers?: string[]
  avatar?: {
    behavior?: string
    expression?: string
    expressionWeights?: Record<string, number>
    bodyIntent?: string
  }
  speech?: {
    style?: string
    fishTags?: string[]
  }
}

export interface EmotionManifest {
  schemaVersion: number
  defaultEmotion: string
  emotions: EmotionManifestEntry[]
}

export interface EmotionContract {
  schemaVersion: number
  defaultEmotion: string
  supported: string[]
}

export type EmotionKey = string
