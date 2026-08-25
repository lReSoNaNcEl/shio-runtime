import type { ExperienceEvent } from '../../shared/alive'
import type { RuntimeEventInput } from '../../shared/runtime'

/** Maps Action Runtime terminal facts into bounded Experience events. */
export function actionExperienceEvent(
  event: RuntimeEventInput,
  at = Date.now(),
): ExperienceEvent | null {
  if (event.category !== 'action') return null
  const actionId = boundedMetadata(event.metadata?.actionId, 160)
  if (!actionId) return null
  const eventId = `action-runtime:${event.type}:${actionId}`.slice(0, 160)

  if (event.type === 'ToolCompleted') {
    if (event.metadata?.verificationStatus !== 'verified') return null
    return { type: 'action-verified', at, actionId, eventId }
  }
  if (event.type === 'PermissionDenied') {
    return { type: 'permission-denied', at, actionId, eventId }
  }
  if (event.type === 'ToolFailed') {
    const code = boundedMetadata(event.metadata?.errorCode, 100)
    return { type: 'action-failed', at, actionId, eventId, ...(code ? { code } : {}) }
  }
  return null
}

function boundedMetadata(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : undefined
}
