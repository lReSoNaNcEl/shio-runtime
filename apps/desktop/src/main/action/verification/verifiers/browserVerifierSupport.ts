import { createHash } from 'node:crypto'

import type { BrowserObservation } from '../../../../shared/desktop-control'

export interface BrowserObservationProvider {
  observe(signal: AbortSignal): Promise<BrowserObservation>
}

export function observationFingerprint(observation: BrowserObservation): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        url: observation.url,
        title: observation.title,
        content: observation.content,
        interactiveElements: observation.interactiveElements,
      }),
    )
    .digest('hex')
}

export async function freshObservation(
  provider: BrowserObservationProvider,
  signal: AbortSignal,
): Promise<BrowserObservation | undefined> {
  try {
    return await provider.observe(signal)
  } catch {
    return undefined
  }
}
