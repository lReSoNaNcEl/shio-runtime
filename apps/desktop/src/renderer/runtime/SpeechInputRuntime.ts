import type {
  CharacterRuntimeMode,
  CharacterState,
  EventBus,
  RuntimeEventType,
} from '../../shared/runtime'
import type { SerializedSpeechError } from '../../shared/speech'
import { MicCapture } from '../audio/micCapture'
import { StreamingPcmCapture } from '../audio/StreamingPcmCapture'
import {
  type AsrStreamEvent,
  StreamingAsrClient,
} from '../speech/continuous-listening/StreamingAsrClient'
import type { AvatarMode, AvatarRuntime } from './AvatarRuntime'
import type { OverlayRuntime, SyncedAvatarState } from './OverlayRuntime'
import type { RecognizedSpeech, SpeechRuntime } from './SpeechRuntime'
import { isSpeechServiceError } from './speechCapabilities'

export type SpeechInputStatus =
  | 'idle'
  | 'listening'
  | 'recognizing'
  | 'thinking'
  | 'synthesizing'
  | 'speaking'
type SpeechInputMessageRole = 'user' | 'assistant' | 'error' | 'meta'

export interface ContinuousRecognizedSpeech extends RecognizedSpeech {
  streamingSessionId: string
  segmentId: string
  confidence?: number
  capturedDuringPlayback: boolean
}

export interface ContinuousPartialSpeech {
  text: string
  streamingSessionId: string
  segmentId: string
  revision: number
  speechDurationMs: number
  confidence?: number
  capturedDuringPlayback: boolean
}

export interface SpeechInputRuntimeDeps {
  speechRuntime: SpeechRuntime
  avatarRuntime: AvatarRuntime
  overlayRuntime: OverlayRuntime
  events: EventBus
  setStatus: (status: SpeechInputStatus) => void
  pushMessage: (role: SpeechInputMessageRole, text: string) => void
  formatMicrophoneUnavailable: (error: string) => string
  emptyRecordingMessage: () => string
  recordRuntimeEvent: (label: string, detail?: string) => void
  /** Report a normalized Speech Adapter failure to the capabilities health component. */
  reportSpeechServiceError: (error: SerializedSpeechError) => void
  updateCharacterState: (patch: {
    status: SpeechInputStatus
    mode: CharacterRuntimeMode
    emotion: string
    vrmEmotion?: string
    avatar?: ReturnType<AvatarRuntime['getMirrorState']>
  }) => CharacterState
}

export class SpeechInputRuntime {
  private micCapture = new MicCapture()
  private streamingCapture = new StreamingPcmCapture()
  private micDeviceId = ''
  private speechRuntime: SpeechRuntime
  private avatarRuntime: AvatarRuntime
  private overlayRuntime: OverlayRuntime
  private events: EventBus
  private setStatus: SpeechInputRuntimeDeps['setStatus']
  private pushMessage: SpeechInputRuntimeDeps['pushMessage']
  private formatMicrophoneUnavailable: SpeechInputRuntimeDeps['formatMicrophoneUnavailable']
  private emptyRecordingMessage: SpeechInputRuntimeDeps['emptyRecordingMessage']
  private recordRuntimeEvent: SpeechInputRuntimeDeps['recordRuntimeEvent']
  private updateCharacterState: SpeechInputRuntimeDeps['updateCharacterState']
  private reportSpeechServiceError: SpeechInputRuntimeDeps['reportSpeechServiceError']
  private continuousEnabled = false
  private onStreamingServiceLost: ((error: SerializedSpeechError) => void) | null = null
  private onContinuousFinal:
    | ((recognized: ContinuousRecognizedSpeech) => void | Promise<void>)
    | null = null
  private onContinuousPartial: ((partial: ContinuousPartialSpeech) => void) | null = null
  private onContinuousDeviceLost: (() => void) | null = null
  private playbackCapturedSegments = new Set<string>()
  private streamingClient = new StreamingAsrClient({
    onEvent: (event) => this.handleStreamingEvent(event),
    onState: (state) => this.handleStreamingState(state),
  })
  // If the streaming transport stays in reconnect longer than this, we treat the
  // Speech API as lost, tear the session down, and stop retrying forever.
  private reconnectWatchdog: ReturnType<typeof setTimeout> | null = null
  private static readonly RECONNECT_LOST_MS = 12_000
  // Monotonic streaming-session generation. Bumped whenever a streaming session
  // starts or ends so a stale reconnect watchdog can never tear down a session
  // that was already recovered, disabled, or replaced.
  private streamingGeneration = 0
  // Last transport state reported by the streaming client. Used to keep the
  // watchdog invariant explicit: it may only fire while still reconnecting.
  private streamingState = 'idle'

  constructor(deps: SpeechInputRuntimeDeps) {
    this.speechRuntime = deps.speechRuntime
    this.avatarRuntime = deps.avatarRuntime
    this.overlayRuntime = deps.overlayRuntime
    this.events = deps.events
    this.setStatus = deps.setStatus
    this.pushMessage = deps.pushMessage
    this.formatMicrophoneUnavailable = deps.formatMicrophoneUnavailable
    this.emptyRecordingMessage = deps.emptyRecordingMessage
    this.recordRuntimeEvent = deps.recordRuntimeEvent
    this.updateCharacterState = deps.updateCharacterState
    this.reportSpeechServiceError = deps.reportSpeechServiceError
  }

  /** Register the owner's handler for irrecoverable streaming-transport loss. */
  setStreamingServiceLostHandler(handler: (error: SerializedSpeechError) => void): void {
    this.onStreamingServiceLost = handler
  }

  setMicrophone(deviceId: string, persist = true): void {
    this.micDeviceId = deviceId
    if (persist) void window.api.config.save({ micDeviceId: deviceId })
  }

  getMicrophoneId(): string {
    return this.micDeviceId
  }

  async setContinuousListening(
    enabled: boolean,
    onFinal?: (recognized: ContinuousRecognizedSpeech) => void | Promise<void>,
    onPartial?: (partial: ContinuousPartialSpeech) => void,
    onDeviceLost?: () => void,
  ): Promise<void> {
    this.onContinuousFinal = onFinal ?? this.onContinuousFinal
    this.onContinuousPartial = onPartial ?? this.onContinuousPartial
    this.onContinuousDeviceLost = onDeviceLost ?? this.onContinuousDeviceLost
    if (enabled === this.continuousEnabled) return
    this.continuousEnabled = enabled
    if (!enabled) {
      this.streamingGeneration += 1
      this.clearReconnectWatchdog()
      this.playbackCapturedSegments.clear()
      await this.streamingCapture.stop()
      await this.streamingClient.stop()
      this.publishSpeechEvent('ListeningFinished', 'continuous')
      this.recordRuntimeEvent('Continuous Listening Disabled')
      return
    }
    let connected = false
    try {
      const config = await window.api.config.get()
      await this.streamingClient.connect(config.pythonSpeechUrl, config.ttsLanguage || 'ru')
      connected = true
      // A fresh working session: invalidate any watchdog from a previous session.
      this.streamingGeneration += 1
      if (!this.continuousEnabled) {
        await this.streamingClient.stop()
        return
      }
      await this.streamingCapture.start(
        this.micDeviceId,
        (frame) => this.streamingClient.sendPcm(frame),
        () => this.handleContinuousDeviceLost(),
      )
      this.publishSpeechEvent('ListeningStarted', 'continuous')
      this.recordRuntimeEvent('Continuous Listening Enabled')
    } catch (error) {
      this.continuousEnabled = false
      this.clearReconnectWatchdog()
      await this.streamingCapture.stop()
      await this.streamingClient.stop()
      this.recordRuntimeEvent('Continuous Listening Error', String(error))
      // A failure before the transport connected is a Speech API reachability
      // problem (streaming capability), not a microphone/device problem.
      if (!connected) {
        this.reportSpeechServiceError({
          code: 'SERVICE_UNAVAILABLE',
          operation: 'streaming',
          recoverable: true,
          technicalMessage: 'streaming transport connect failed',
        })
      }
      throw error
    }
  }

  private handleStreamingState(state: string): void {
    this.streamingState = state
    this.recordRuntimeEvent('Continuous ASR State', state)
    if (!this.continuousEnabled) {
      this.clearReconnectWatchdog()
      return
    }
    if (state === 'reconnecting') {
      // Only a confirmed transport reconnect arms the watchdog. A normal speech
      // pause or a long ASR processing stretch keeps the state ready/listening,
      // so neither is ever mistaken for a lost service.
      if (this.reconnectWatchdog === null) {
        const generation = this.streamingGeneration
        this.reconnectWatchdog = setTimeout(() => {
          this.reconnectWatchdog = null
          // Stale-guard: a session that recovered, was disabled, or replaced has
          // a different generation; and the transport must still be reconnecting.
          // Never tear down a session that is already healthy again.
          if (
            generation !== this.streamingGeneration ||
            !this.continuousEnabled ||
            this.streamingState !== 'reconnecting'
          ) {
            return
          }
          this.declareStreamingServiceLost('reconnect timeout')
        }, SpeechInputRuntime.RECONNECT_LOST_MS)
      }
    } else if (state === 'ready' || state === 'listening' || state === 'idle') {
      // The transport is healthy again: cancel any pending loss watchdog.
      this.clearReconnectWatchdog()
    }
  }

  private clearReconnectWatchdog(): void {
    if (this.reconnectWatchdog !== null) {
      clearTimeout(this.reconnectWatchdog)
      this.reconnectWatchdog = null
    }
  }

  /**
   * The streaming Speech API was lost mid-session. Release microphone/stream
   * resources, drop any in-flight partial (it is not a completed turn), leave
   * the runtime in a stable state, and notify the owner. Never auto-reconnects
   * forever.
   */
  private declareStreamingServiceLost(reason: string): void {
    this.clearReconnectWatchdog()
    if (!this.continuousEnabled) return
    this.streamingGeneration += 1
    this.continuousEnabled = false
    void this.streamingCapture.stop()
    void this.streamingClient.stop()
    this.publishSpeechEvent('ListeningFinished', 'continuous')
    this.recordRuntimeEvent('Streaming Service Lost', reason)
    const error: SerializedSpeechError = {
      code: 'SERVICE_UNAVAILABLE',
      operation: 'streaming',
      recoverable: true,
      technicalMessage: `streaming transport lost (${reason})`,
    }
    this.reportSpeechServiceError(error)
    this.onStreamingServiceLost?.(error)
  }

  isContinuousListening(): boolean {
    return this.continuousEnabled
  }

  isContinuousCaptureAlive(): boolean {
    return this.continuousEnabled && this.streamingCapture.isAlive()
  }

  /**
   * The working input track ended on its own (device unplugged/disabled).
   * Notify the owner so it can tear down continuous listening and open the gate;
   * Speech Runtime does not decide policy here.
   */
  private handleContinuousDeviceLost(): void {
    if (!this.continuousEnabled) return
    this.recordRuntimeEvent('Continuous Microphone Lost')
    this.onContinuousDeviceLost?.()
  }

  async toggle(status: SpeechInputStatus): Promise<RecognizedSpeech | null> {
    if (this.continuousEnabled) return null
    if (status === 'listening') {
      return this.stopAndRecognize()
    }
    if (status !== 'idle') return null

    try {
      await this.micCapture.start(this.micDeviceId)
      this.enterAvatarMode('listening', 'calm', 'listening')
      this.publishSpeechEvent('ListeningStarted')
      this.recordRuntimeEvent('Listening')
    } catch (e) {
      this.recordRuntimeEvent('Microphone Error', String(e))
      this.pushMessage('error', this.formatMicrophoneUnavailable(String(e)))
    }

    return null
  }

  private handleStreamingEvent(event: AsrStreamEvent): void {
    if (!this.continuousEnabled) return
    if (event.type === 'speech_started') {
      if (this.speechRuntime.getCharacterState().mode === 'speaking') {
        this.playbackCapturedSegments.add(`${event.sessionId}:${event.segmentId}`)
        if (this.playbackCapturedSegments.size > 64) {
          const oldest = this.playbackCapturedSegments.values().next().value
          if (oldest) this.playbackCapturedSegments.delete(oldest)
        }
        this.recordRuntimeEvent('Continuous ASR Captured During Playback', event.segmentId)
      }
      this.recordRuntimeEvent('Continuous Speech Started', event.segmentId)
      return
    }
    if (event.type === 'speech_ended') {
      this.recordRuntimeEvent('Continuous Speech Ended', event.segmentId)
      return
    }
    if (event.type === 'warning' || event.type === 'error') {
      this.recordRuntimeEvent(`Continuous ASR ${event.type}`, `${event.code}: ${event.message}`)
      if (event.type === 'error' && !event.recoverable) {
        this.declareStreamingServiceLost(`asr error ${event.code}`)
      }
      return
    }
    if (event.type === 'partial') {
      const stableId = `${event.sessionId}:${event.segmentId}`
      this.onContinuousPartial?.({
        text: event.text,
        streamingSessionId: event.sessionId,
        segmentId: event.segmentId,
        revision: event.revision,
        speechDurationMs: Math.max(0, event.endMs - event.startMs),
        confidence: event.confidence,
        capturedDuringPlayback: this.playbackCapturedSegments.has(stableId),
      })
      this.recordRuntimeEvent('Continuous ASR Partial', `${event.segmentId}:r${event.revision}`)
      return
    }
    if (event.type !== 'final') return
    const stableId = `${event.sessionId}:${event.segmentId}`
    const capturedDuringPlayback = this.playbackCapturedSegments.delete(stableId)
    this.publishSpeechEvent('RecognitionCompleted', `continuous final ${event.reason}`)
    this.recordRuntimeEvent('Continuous ASR Final', `${event.segmentId}:${event.reason}`)
    void Promise.resolve(
      this.onContinuousFinal?.({
        text: event.text,
        streamingSessionId: event.sessionId,
        segmentId: event.segmentId,
        confidence: event.confidence,
        capturedDuringPlayback,
      }),
    ).catch((error) => {
      this.recordRuntimeEvent('Continuous Decision Error', String(error))
    })
  }

  private async stopAndRecognize(): Promise<RecognizedSpeech | null> {
    const wavBuf = this.micCapture.stop()
    this.publishSpeechEvent('ListeningFinished')
    this.recordRuntimeEvent('Listening Finished')
    // 44 bytes = empty WAV header only, so nothing was actually captured.
    if (wavBuf.byteLength <= 44) {
      this.recordRuntimeEvent('ASR Empty')
      this.pushMessage('error', this.emptyRecordingMessage())
      this.returnToIdle()
      return null
    }

    this.enterAvatarMode('thinking', 'calm', 'recognizing')
    this.recordRuntimeEvent('Recognizing')

    try {
      const recognized = await this.speechRuntime.recognizeSpeech(wavBuf)
      this.publishSpeechEvent('RecognitionCompleted')
      this.recordRuntimeEvent('Recognition Completed')
      return recognized
    } catch (e) {
      if (this.isEmptyRecognition(e)) {
        // Silence, noise, or speech below the ASR confidence threshold is not
        // a user-facing runtime failure.
        this.recordRuntimeEvent('ASR No Speech Detected')
        this.returnToIdle()
        return null
      }
      // Infrastructure/ASR failures never become chat messages (ТЗ §2). A
      // normalized Speech Adapter error flips the recognition capability so the
      // banner/mic state and background recovery take over; other unexpected
      // errors are recorded for diagnostics only.
      this.recordRuntimeEvent('ASR Error', String(e))
      if (isSpeechServiceError(e)) this.reportSpeechServiceError(e.toSerialized())
      this.returnToIdle()
      return null
    }
  }

  private isEmptyRecognition(error: unknown): boolean {
    return error instanceof Error && error.message.trim().toLowerCase() === 'no text'
  }

  private enterAvatarMode(
    mode: Exclude<AvatarMode, 'speaking' | 'awaitingSpeech'>,
    emotionKey: string,
    status: SpeechInputStatus,
  ): void {
    this.updateCharacterState({ status, mode, emotion: emotionKey })
    this.applyAvatarCharacterState()
    this.publishAvatarState({ mode, emotionKey })
    this.setStatus(status)
  }

  private returnToIdle(): void {
    this.enterAvatarMode('idle', 'neutral', 'idle')
    this.recordRuntimeEvent('Idle')
  }

  private applyAvatarCharacterState(): void {
    this.avatarRuntime.applyCharacterState(this.speechRuntime.getCharacterState())
  }

  private publishAvatarState(state: SyncedAvatarState): void {
    this.overlayRuntime.publishAvatarState(state)
  }

  private publishSpeechEvent(type: RuntimeEventType, detail?: string): void {
    this.events.publish({
      type,
      category: 'speech',
      source: 'renderer.speechInputRuntime',
      detail,
    })
  }
}
