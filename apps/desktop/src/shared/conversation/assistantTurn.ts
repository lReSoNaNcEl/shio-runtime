import { z } from 'zod'

export const assistantTurnKindSchema = z.enum([
  'character',
  'provider-failure',
  'tool-requirement-failure',
  'runtime-fallback',
])

/** Main-owned origin metadata for assistant text persisted in short conversation history. */
export type AssistantTurnKind = z.infer<typeof assistantTurnKindSchema>
