import {
  type EmbodimentAvailability,
  embodimentAvailabilitySchema,
} from '../../../shared/character-response'
import { MOTION_CATALOG_REVISION } from '../../../shared/motion'
import type { AvatarRuntimeHealth } from '../../../shared/runtime'

/** Reads the existing Avatar-owned projection; no second availability cache. */
export function currentEmbodimentAvailability(
  health: AvatarRuntimeHealth | null | undefined,
  now = Date.now(),
): EmbodimentAvailability | undefined {
  if (health?.status !== 'ready' || !health.modelLoaded) return undefined
  const age = now - Date.parse(health.updatedAt)
  if (!Number.isFinite(age) || age < -1_000 || age > 10_000) return undefined
  const parsed = embodimentAvailabilitySchema.safeParse(health.embodimentAvailability)
  return parsed.success && parsed.data.catalogRevision === MOTION_CATALOG_REVISION
    ? parsed.data
    : undefined
}

export function embodimentAvailabilityPrompt(value: unknown): string {
  const parsed = embodimentAvailabilitySchema.safeParse(value)
  return [
    '## Current Avatar Embodiment Availability',
    'Request-scoped capability facts only. A request is not proof of execution. Draft profiles have not passed visual qualification.',
    parsed.success
      ? JSON.stringify(parsed.data)
      : 'Availability unavailable or stale. Use calm presence; do not promise a gesture.',
  ].join('\n')
}
