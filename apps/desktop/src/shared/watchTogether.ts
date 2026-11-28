import type { AutonomySettings } from './alive'

export const WATCH_FRAME_WIDTH = 768
export const WATCH_FRAME_HEIGHT = 432
export const WATCH_MAX_FRAME_BYTES = 300_000
export const WATCH_DETAIL_MAX_BYTES = 300_000
export const WATCH_DETAIL_MAX_SIDE = 960
export const WATCH_DETAIL_MAX_REGIONS = 2
export const WATCH_TURN_MAX_SIDE = 3840
export const WATCH_TURN_MAX_PIXELS = 3840 * 2160
export const WATCH_TURN_MAX_BYTES = 3 * 1024 * 1024

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

export const WATCH_BLOCK_REASONS = ['suspended', 'off', 'private'] as const
export type WatchBlockReason = (typeof WATCH_BLOCK_REASONS)[number]

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
  timing?: { earlierMs: number; currentMs: number; peakMs?: number }
  peak?: ArrayBuffer
  details?: ArrayBuffer[]
  phrases?: WatchPlaybackPhrase[]
}

/** Milliseconds relative to the observation's capture time. */
export interface WatchPlaybackPhrase {
  startMs: number
  endMs: number
  text: string
  final: boolean
}

export type WatchAudioStatus = 'application' | 'system' | 'unavailable'

export type WatchDecision =
  | { kind: 'quiet' | 'stopped' | 'reference-checked' }
  | { kind: 'unavailable'; reason: WatchModelIssue }
  | { kind: 'comment'; turnId: string; expiresAt: number }

export type WatchSpeechDisposition = 'addressed' | 'aside' | 'ignore'
export interface WatchVoiceSample {
  utteranceId: string
  frame?: ArrayBuffer
  playbackTranscript: string
}
export type WatchReaction = 'glance' | 'surprise'
export type WatchModelIssue = 'rateLimited' | 'unavailable'

export interface WatchTogetherApi {
  prepareModel(): Promise<boolean>
  start(sourceId: string, reference?: string): Promise<WatchStartResult>
  stop(sessionId: string): Promise<void>
  yield(sessionId: string, reason?: 'scene' | 'speech'): Promise<void>
  classifySpeech(
    sessionId: string,
    text: string,
    recentAddress: boolean,
    sample?: WatchVoiceSample,
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
