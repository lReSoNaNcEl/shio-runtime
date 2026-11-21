import { z } from 'zod'

export const characterReplyOriginSchema = z.enum([
  'user',
  'autonomous',
  'watch-together',
  'watch-user',
])
export type CharacterReplyOrigin = z.infer<typeof characterReplyOriginSchema>
