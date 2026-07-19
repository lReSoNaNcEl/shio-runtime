import type { EmotionKey } from './contracts'
import { emotionRegistry } from './registry'

export function normalizeEmotionTag(tag?: string): EmotionKey {
  return emotionRegistry.normalize(tag)
}

export function parseLeadingEmotionTag(text: string): EmotionKey {
  return emotionRegistry.parseLeadingEmotionTag(text)
}

export function stripEmotionTags(text: string): string {
  return emotionRegistry.stripEmotionTags(text)
}

export function stripStageDirections(text: string): string {
  return text
    .replace(/\s*(?:\[[^\]]+\]|\((?:пауза|pause|вздох|sigh)\))\.{0,3}\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function stripAssistantMarkup(text: string): string {
  return stripStageDirections(stripEmotionTags(text))
}

export function supportedEmotionPromptList(): string {
  return emotionRegistry.promptList()
}
