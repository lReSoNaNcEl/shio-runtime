import type { CharacterRuntimeMode, CharacterState } from '../../shared/runtime/characterState'
import type { EventBus, RuntimeEventType } from '../../shared/runtime/events'
import { MicCapture } from '../audio/micCapture'
import { StreamingPcmCapture } from '../audio/StreamingPcmCapture'
import { StreamingAsrClient, type AsrStreamEvent } from '../continuousListening/StreamingAsrClient'
import type { AvatarMode, AvatarRuntime } from './AvatarRuntime'
import type { OverlayRuntime, SyncedAvatarState } from './OverlayRuntime'
import type { RecognizedSpeech, SpeechRuntime } from './SpeechRuntime'

export type SpeechInputStatus = 'idle' | 'listening' | 'recognizing' | 'thinking' | 'synthesizing' | 'speaking'
type SpeechInputMessageRole = 'user' | 'assistant' | 'error' | 'meta'

export interface ContinuousRecognizedSpeech extends RecognizedSpeech {
  streamingSessionId: string
  segmentId: string
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
  recordRuntimeEvent: (label: string, detail?: string) => void
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
  private recordRuntimeEvent: SpeechInputRuntimeDeps['recordRuntimeEvent']
  private updateCharacterState: SpeechInputRuntimeDeps['updateCharacterState']
  private continuousEnabled = false
  private continuousSessionId = 0
  private onContinuousFinal: ((recognized: ContinuousRecognizedSpeech) => void | Promise<void>) | null = null
  private onContinuousPartial: ((text: string) => void) | null = null
  private onContinuousDeviceLost: (() => void) | null = null
  private playbackCapturedSegments = new Set<string>()
  private streamingClient = new StreamingAsrClient({
    onEvent: (event) => this.handleStreamingEvent(event),
    onState: (state) => this.recordRuntimeEvent('Continuous ASR State', state)
  })

  constructor(deps: SpeechInputRuntimeDeps) {
    this.speechRuntime = deps.speechRuntime
    this.avatarRuntime = deps.avatarRuntime
    this.overlayRuntime = deps.overlayRuntime
    this.events = deps.events
    this.setStatus = deps.setStatus
    this.pushMessage = deps.pushMessage
    this.recordRuntimeEvent = deps.recordRuntimeEvent
    this.updateCharacterState = deps.updateCharacterState
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
    onPartial?: (text: string) => void,
    onDeviceLost?: () => void
  ): Promise<void> {
    this.onContinuousFinal = onFinal ?? this.onContinuousFinal
    this.onContinuousPartial = onPartial ?? this.onContinuousPartial
    this.onContinuousDeviceLost = onDeviceLost ?? this.onContinuousDeviceLost
    if (enabled === this.continuousEnabled) return
    this.continuousSessionId += 1
    this.continuousEnabled = enabled
    if (!enabled) {
      this.playbackCapturedSegments.clear()
      await this.streamingCapture.stop()
      await this.streamingClient.stop()
      this.publishSpeechEvent('ListeningFinished', 'continuous')
      this.recordRuntimeEvent('Continuous Listening Disabled')
      return
    }
    try {
      const config = await window.api.config.get()
      await this.streamingClient.connect(config.pythonSpeechUrl, config.ttsLanguage || 'ru')
      if (!this.continuousEnabled) {
        await this.streamingClient.stop()
        return
      }
      await this.streamingCapture.start(
        this.micDeviceId,
        (frame) => this.streamingClient.sendPcm(frame),
        () => this.handleContinuousDeviceLost()
      )
      this.publishSpeechEvent('ListeningStarted', 'continuous')
      this.recordRuntimeEvent('Continuous Listening Enabled')
    } catch (error) {
      this.continuousEnabled = false
      await this.streamingCapture.stop()
      await this.streamingClient.stop()
      this.recordRuntimeEvent('Continuous Listening Error', String(error))
      throw error
    }
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
      this.pushMessage('error', `Микрофон недоступен: ${String(e)}`)
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
      return
    }
    if (event.type === 'partial') {
      this.onContinuousPartial?.(event.text)
      this.recordRuntimeEvent('Continuous ASR Partial', `${event.segmentId}:r${event.revision}`)
      return
    }
    if (event.type !== 'final') return
    const stableId = `${event.sessionId}:${event.segmentId}`
    const capturedDuringPlayback = this.playbackCapturedSegments.delete(stableId)
    this.publishSpeechEvent('RecognitionCompleted', `continuous final ${event.reason}`)
    this.recordRuntimeEvent('Continuous ASR Final', `${event.segmentId}:${event.reason}`)
    void Promise.resolve(this.onContinuousFinal?.({
      text: event.text,
      streamingSessionId: event.sessionId,
      segmentId: event.segmentId,
      confidence: event.confidence,
      capturedDuringPlayback
    })).catch((error) => {
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
      this.pushMessage('error', 'Запись пустая - проверьте микрофон и разрешения.')
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
      this.recordRuntimeEvent('ASR Error', String(e))
      this.pushMessage('error', `Ошибка распознавания: ${String(e)}`)
      this.returnToIdle()
      return null
    }
  }

  private isEmptyRecognition(error: unknown): boolean {
    return error instanceof Error && error.message.trim().toLowerCase() === 'no text'
  }

  private enterAvatarMode(mode: Exclude<AvatarMode, 'speaking' | 'awaitingSpeech'>, emotionKey: string, status: SpeechInputStatus): void {
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
      detail
    })
  }
}
