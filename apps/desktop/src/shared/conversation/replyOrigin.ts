import { z } from 'zod'

export const characterReplyOriginSchema = z.enum(['user', 'autonomous'])
export type CharacterReplyOrigin = z.infer<typeof characterReplyOriginSchema>
