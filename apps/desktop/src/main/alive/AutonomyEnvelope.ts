import type { AutonomySettings, WorldContextSnapshot } from '../../shared/alive'

export type AutonomyDecision =
  | { outcome: 'execute' }
  | { outcome: 'preview'; reason: 'suggest_mode' | 'confirmation_required' }
  | {
      outcome: 'defer'
      reason: 'suspended' | 'off' | 'privacy' | 'busy'
      retryAt: number
    }

export class AutonomyEnvelope {
  decide(input: {
    settings: AutonomySettings
    world: WorldContextSnapshot
    now: number
    confirmedWatchSession?: boolean
  }): AutonomyDecision {
    const { settings, world, now } = input
    if (settings.globallySuspended)
      return { outcome: 'defer', reason: 'suspended', retryAt: now + 60_000 }
    if (settings.mode === 'off') return { outcome: 'defer', reason: 'off', retryAt: now + 60_000 }
    if (settings.privacyMode && !input.confirmedWatchSession)
      return { outcome: 'defer', reason: 'privacy', retryAt: now + 60_000 }
    if (world.conversationActive || world.audioActive)
      return { outcome: 'defer', reason: 'busy', retryAt: now + 30_000 }
    if (input.confirmedWatchSession) return { outcome: 'execute' }
    if (settings.mode === 'suggest') return { outcome: 'preview', reason: 'suggest_mode' }
    if (settings.mode === 'confirm') return { outcome: 'preview', reason: 'confirmation_required' }
    return { outcome: 'execute' }
  }
}
