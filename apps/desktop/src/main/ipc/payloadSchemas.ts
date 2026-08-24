import { z } from 'zod'

import { BUNDLED_DEFAULT_VRM_ASSET_HANDLE } from '../../shared/avatarAsset'
import {
  EMBODIMENT_GAZE_HINTS,
  EMBODIMENT_GESTURE_HINTS,
  EMBODIMENT_INTENSITIES,
} from '../../shared/character-response'

function serializedSizeAtMost(value: unknown, maximumBytes: number): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= maximumBytes
  } catch {
    return false
  }
}

const boundedObject = z
  .record(z.string().max(100), z.unknown())
  .refine((value) => serializedSizeAtMost(value, 200_000), 'Payload is too large')

export const configSaveSchema = z
  .object({
    configSchemaVersion: z.number().int().nonnegative().optional(),
    setup: z
      .object({
        completed: z.boolean(),
        completedAt: z.string().datetime().optional(),
      })
      .strict()
      .optional(),
    llm: boundedObject.optional(),
    uiLocale: z.enum(['ru', 'en']).optional(),
    uiTheme: z.enum(['dark', 'light']).optional(),
    ttsLanguage: z.string().min(1).max(20).optional(),
    ttsEngine: z.string().min(1).max(100).optional(),
    micDeviceId: z.string().max(1_000).optional(),
    overlayWidth: z.string().max(20).optional(),
    overlayHeight: z.string().max(20).optional(),
    overlayMargin: z.string().max(20).optional(),
    overlayOpacity: z.string().max(20).optional(),
    overlayTransparentBackground: z.enum(['true', 'false']).optional(),
    overlayClickThrough: z.enum(['true', 'false']).optional(),
    overlayCorner: z.string().max(50).optional(),
    overlayScale: z.string().max(20).optional(),
    overlayViewMode: z.enum(['bust', 'portrait', 'face']).optional(),
    developerOverlayAnimationHudEnabled: z.enum(['true', 'false']).optional(),
    developerModeEnabled: z.enum(['true', 'false']).optional(),
    lookAtEnabled: z.enum(['true', 'false']).optional(),
    continuousListeningReplyCooldownMs: z.string().max(20).optional(),
    continuousListeningFollowUpWindowMs: z.string().max(20).optional(),
    continuousListeningCuriosityChance: z.string().max(20).optional(),
  })
  .strict()

export const vrmAssetHandleSchema = z
  .string()
  .max(80)
  .refine(
    (value) =>
      value === BUNDLED_DEFAULT_VRM_ASSET_HANDLE ||
      /^vrm-asset:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
    'Invalid VRM asset handle',
  )

const optionalBoundedText = z.string().max(200).optional()

export const avatarStateSchema = z
  .object({
    mode: z.enum(['idle', 'listening', 'thinking', 'awaitingSpeech', 'speaking']),
    emotionKey: optionalBoundedText,
    vrmEmotion: optionalBoundedText,
    reaction: z.literal('user-interruption').optional(),
    reactionId: optionalBoundedText,
    earImpulse: z
      .enum([
        'user-interruption',
        'direct-address',
        'question',
        'thinking-entry',
        'reply-emphasis',
        'recognition-uncertain',
      ])
      .optional(),
    earImpulseId: optionalBoundedText,
    embodimentIntent: z
      .object({
        intensity: z.enum(EMBODIMENT_INTENSITIES),
        gestureHint: z.enum(EMBODIMENT_GESTURE_HINTS).optional(),
        gazeHint: z.enum(EMBODIMENT_GAZE_HINTS).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const mouthWeight = z.number().finite().min(0).max(1)
export const avatarMouthSchema = z
  .object({
    aa: mouthWeight,
    ih: mouthWeight,
    ou: mouthWeight,
    ee: mouthWeight,
    oh: mouthWeight,
  })
  .strict()

export const avatarRuntimeHealthSchema = z
  .object({
    contractVersion: z.literal(1),
    status: z.enum(['not-initialized', 'loading', 'ready', 'failed', 'disposed']),
    modelLoaded: z.boolean(),
    presentationAttached: z.boolean(),
    operational: z.boolean(),
    updatedAt: z.string().datetime(),
    lastFailure: z
      .object({
        name: z.string().max(100),
        message: z.string().max(500),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .refine(
    (health) =>
      health.operational ===
      (health.status === 'ready' && health.modelLoaded && health.presentationAttached),
    'Inconsistent Avatar Runtime health',
  )

const transitionRecordingFrameSchema = z
  .object({
    at: z.number().finite().nonnegative(),
    frame: z.number().int().nonnegative(),
    reason: z.string().max(500).optional(),
    avatar: z.record(z.string().max(100), z.unknown()),
    runtimeHealth: z.record(z.string().max(100), z.unknown()).nullable(),
  })
  .strict()
  .refine(
    (frame) => serializedSizeAtMost(frame, 750_000),
    'Transition recording frame is too large',
  )

export const transitionRecordingSchema = z
  .object({
    schema: z.literal('shio.transition-recording.v1'),
    id: z.number().int().positive(),
    reason: z.string().min(1).max(500),
    startedAtFrame: z.number().int().nonnegative(),
    savedAt: z.string().datetime(),
    frames: z.array(transitionRecordingFrameSchema).min(1).max(121),
  })
  .strict()
  .refine(
    (recording) => serializedSizeAtMost(recording, 5_000_000),
    'Transition recording is too large',
  )
