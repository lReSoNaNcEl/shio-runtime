import type { AutonomySettings } from './alive'

export type WatchBlockReason = 'suspended' | 'off'

export function watchBlockReason(settings: AutonomySettings): WatchBlockReason | undefined {
  if (settings.globallySuspended) return 'suspended'
  if (settings.mode === 'off') return 'off'
}

export type WatchStartResult =
  | { kind: 'started'; id: string }
  | { kind: 'blocked'; reason: WatchBlockReason }

export interface WatchStopped {
  id: string
  reason?: WatchBlockReason
}

/** One ephemeral window of 16 kHz mono playback and two time-ordered video samples. */
export interface WatchMoment {
  sessionId: string
  endedAt: number
  frames: ArrayBuffer
  pcm: ArrayBuffer
  playbackTranscript: string
}

export type WatchDecision =
  | { kind: 'quiet' | 'stopped' | 'unavailable' }
  | { kind: 'comment'; turnId: string; expiresAt: number }

export interface WatchTogetherApi {
  start(sourceId: string): Promise<WatchStartResult>
  stop(sessionId: string): Promise<void>
  yield(sessionId: string): Promise<void>
  prepareTurn(
    sessionId: string,
    turnId: string,
    fromMicrophone: boolean,
    frame?: ArrayBuffer,
    playbackTranscript?: string,
  ): Promise<void>
  observe(moment: WatchMoment): Promise<WatchDecision>
  onStopped(listener: (event: WatchStopped) => void): () => void
}
