import { z } from 'zod'

import {
  initialMarkdownProtocolState,
  scanMarkdownProtocol,
} from '../character-stream/MarkdownProtocolScope'
import { bodyTurnIntentSchema } from '../motion/physicalAction'
import { EMOTION_INTENSITIES } from '../speech/emotions.generated'
import { containInternalReasoning } from './reasoning'

export const EMBODIMENT_PROPOSAL_TTL_MS = 10000

export const EMBODIMENT_INTENSITIES = EMOTION_INTENSITIES
/** Canonical semantic vocabulary. Physical catalog entries map to these meanings. */
export const EMBODIMENT_GESTURE_DEFINITIONS = [
  { id: 'greeting', meaning: 'greet or wave hello; never substitute agreement' },
  { id: 'farewell', meaning: 'say goodbye or wave farewell' },
  { id: 'agree', meaning: 'acknowledge or agree' },
  { id: 'disagree', meaning: 'gently disagree' },
  { id: 'explain', meaning: 'clarify an explanation' },
  { id: 'compare', meaning: 'compare two alternatives' },
  { id: 'invite', meaning: 'invite attention or participation' },
  { id: 'reassure', meaning: 'offer support or reassurance' },
  { id: 'thanks', meaning: 'express gratitude' },
  { id: 'present', meaning: 'present a result or idea' },
  { id: 'delight', meaning: 'express restrained delight' },
  { id: 'laugh', meaning: 'a real amused reaction' },
  { id: 'shy', meaning: 'a reserved shy response' },
  { id: 'curious', meaning: 'show attentive curiosity' },
  { id: 'surprise', meaning: 'express a small surprised reaction' },
  { id: 'concern', meaning: 'show care or concern; sadness alone is not disagreement' },
  { id: 'resolve', meaning: 'express calm determination' },
  { id: 'celebrate', meaning: 'celebrate an actual achievement' },
  { id: 'fox-paw', meaning: 'an optional playful fox-paw accent' },
  { id: 'peace', meaning: 'an optional playful peace sign' },
  { id: 'kiss', meaning: 'an affectionate kiss gesture only when appropriate' },
  { id: 'stretch', meaning: 'a small standing rest stretch' },
  { id: 'think', meaning: 'a contemplative pause' },
  { id: 'tease', meaning: 'an optional playful accent' },
] as const
export type EmbodimentGestureHint = (typeof EMBODIMENT_GESTURE_DEFINITIONS)[number]['id']
export const EMBODIMENT_GESTURE_HINTS = Object.freeze(
  EMBODIMENT_GESTURE_DEFINITIONS.map(({ id }) => id),
) as readonly [EmbodimentGestureHint, ...EmbodimentGestureHint[]]
export const EMBODIMENT_GAZE_HINTS = ['user', 'screen', 'away'] as const
export type EmbodimentIntensity = (typeof EMBODIMENT_INTENSITIES)[number]
export type EmbodimentGazeHint = (typeof EMBODIMENT_GAZE_HINTS)[number]

export const characterEmbodimentIntentSchema = z
  .object({
    intensity: z.enum(EMBODIMENT_INTENSITIES),
    gestureHint: z.enum(EMBODIMENT_GESTURE_HINTS).optional(),
    gazeHint: z.enum(EMBODIMENT_GAZE_HINTS).optional(),
    bodyAction: bodyTurnIntentSchema.optional(),
  })
  .strict()
/** Provider-agnostic visual proposal; Avatar Runtime owns concrete execution. */
export type CharacterEmbodimentIntent = z.infer<typeof characterEmbodimentIntentSchema>
export interface EmbodimentIntentContext {
  receivedAt: number
  eligibility: 'opening' | 'future-only'
  turnId: string
}
export interface CharacterResponseIntent {
  emotion: string
  embodiment?: CharacterEmbodimentIntent
}

export const EMBODIMENT_UNAVAILABLE_REASONS = [
  'model-unavailable',
  'motion-unavailable',
  'rig-unsupported',
  'unqualified',
  'stale',
] as const
export const embodimentAvailabilitySchema = z
  .object({
    version: z.literal(2),
    catalogRevision: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9._:-]+$/u),
    modelGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    availableSemanticIntents: z
      .array(z.enum(EMBODIMENT_GESTURE_HINTS))
      .max(24)
      .refine((values) => new Set(values).size === values.length),
    availableBodyActions: z.array(z.literal('turn-in-place')).max(1).optional(),
    unavailableReasons: z
      .array(z.enum(EMBODIMENT_UNAVAILABLE_REASONS))
      .max(5)
      .refine((values) => new Set(values).size === values.length),
    qualification: z.enum(['draft', 'qualified']),
  })
  .strict()
export type EmbodimentAvailability = z.infer<typeof embodimentAvailabilitySchema>

const earlyIntentSchema = characterEmbodimentIntentSchema.extend({ version: z.literal(2) }).strict()
export const EMBODIMENT_ENVELOPE_MAX_CHARACTERS = 512
export function parseEarlyEmbodimentEnvelope(
  payload: string,
): CharacterEmbodimentIntent | undefined {
  if (payload.length > EMBODIMENT_ENVELOPE_MAX_CHARACTERS) return undefined
  try {
    const input: unknown = JSON.parse(payload)
    const keys = [
      ...payload.matchAll(
        /"(version|intensity|gestureHint|gazeHint|bodyAction|action|turns|direction|tempo|finishFacing)"\s*:/gu,
      ),
    ].map((match) => match[1])
    if (new Set(keys).size !== keys.length) return undefined
    const parsed = earlyIntentSchema.safeParse(input)
    if (!parsed.success) return undefined
    const { version: _version, ...intent } = parsed.data
    return intent
  } catch {
    return undefined
  }
}
export function normalizeCharacterEmbodimentIntent(
  value: unknown,
): CharacterEmbodimentIntent | undefined {
  const parsed = characterEmbodimentIntentSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** Both protocol versions are contained; only a provider's bounded semantic envelope is accepted. */
export function parseCharacterEmbodimentResponse(text: string): {
  replyText: string
  embodimentIntent?: CharacterEmbodimentIntent
} {
  const safeText = containInternalReasoning(text).text
  const allowed = scanMarkdownProtocol(safeText, initialMarkdownProtocolState())
  const markers = /<shio-(intent|embodiment)>([\s\S]*?)<\/shio-\1>/giu
  let embodimentIntent: CharacterEmbodimentIntent | undefined
  let seen = false
  for (const match of safeText.matchAll(markers)) {
    if (seen || !allowed[match.index]) continue
    seen = true
    if (match[1].toLowerCase() === 'intent')
      embodimentIntent = parseEarlyEmbodimentEnvelope(match[2])
    else {
      try {
        embodimentIntent = normalizeCharacterEmbodimentIntent(JSON.parse(match[2]))
      } catch {
        /* contained */
      }
    }
  }
  const stripped = safeText.replace(/<shio-([a-z][a-z0-9-]*)\b[^>]*>[\s\S]*?<\/shio-\1>/giu, '')
  const malformed = stripped.search(/<shio-[a-z][a-z0-9-]*\b/iu)
  const contained = malformed >= 0 ? stripped.slice(0, malformed) : stripped
  return {
    replyText: contained.replace(/<\/?shio-[a-z][a-z0-9-]*\b[^>]*>?/giu, '').trim(),
    ...(embodimentIntent ? { embodimentIntent } : {}),
  }
}
