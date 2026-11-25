import type { AutonomySettings } from './alive'

export const WATCH_FRAME_WIDTH = 768
export const WATCH_FRAME_HEIGHT = 432
export const WATCH_MAX_FRAME_BYTES = 300_000

/** Exact destination chosen in the share picker for the lifetime of one session. */
export function watchReferenceUrl(value: string): string | undefined {
  if (value.length > 2048 || !/^https:\/\//iu.test(value) || /[\\\s\p{Cc}]/u.test(value)) return
  const authority = value.slice('https://'.length).split(/[/?#]/u, 1)[0]
  if (!authority || authority.includes('@')) return
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 2048)
      return url.href
  } catch {
    return undefined
  }
}

export type WatchReference = string | { kind: 'wikipedia' }
export type WatchBlockReason = 'suspended' | 'off' | 'private'

export function watchBlockReason(settings: AutonomySettings): WatchBlockReason | undefined {
  if (settings.globallySuspended) return 'suspended'
  if (settings.mode === 'off') return 'off'
  if (settings.privacyMode) return 'private'
}

export type WatchStartResult =
  | { kind: 'started'; id: string }
  | { kind: 'blocked'; reason: WatchBlockReason }

export interface WatchStopped {
  id: string
  reason?: WatchBlockReason
}

/** Two time-ordered video samples with optional 16 kHz mono playback. */
export interface WatchMoment {
  sessionId: string
  endedAt: number
  frames: ArrayBuffer
  pcm: ArrayBuffer
  playbackTranscript: string
}

export type WatchDecision =
  | { kind: 'quiet' | 'stopped' | 'reference-checked' }
  | { kind: 'unavailable'; reason: WatchModelIssue }
  | { kind: 'comment'; turnId: string; expiresAt: number }

export type WatchSpeechDisposition = 'addressed' | 'aside' | 'ignore'
export type WatchReaction = 'glance' | 'surprise'
export type WatchModelIssue = 'rateLimited' | 'unavailable'

export interface WatchTogetherApi {
  start(sourceId: string, reference?: WatchReference): Promise<WatchStartResult>
  stop(sessionId: string): Promise<void>
  yield(sessionId: string, reason?: 'scene'): Promise<void>
  classifySpeech(
    sessionId: string,
    text: string,
    recentAddress: boolean,
  ): Promise<WatchSpeechDisposition | undefined>
  finishComment(sessionId: string, turnId: string, played: boolean): Promise<void>
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
