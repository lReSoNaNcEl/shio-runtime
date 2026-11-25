import {
  WATCH_FRAME_HEIGHT,
  WATCH_FRAME_WIDTH,
  type WatchBlockReason,
  type WatchModelIssue,
} from '../../shared/watchTogether'
import { StreamingPcmCapture } from '../audio/StreamingPcmCapture'
import type { ControllerState } from '../Controller'
import { controller } from '../Controller'
import { observeRendererPromise } from '../reliability/observePromise'
import { WatchPlaybackSpeech } from './WatchPlaybackSpeech'

export type WatchFailure =
  | 'watch.sourceError'
  | 'watch.micError'
  | 'watch.startError'
  | `watch.blocked.${WatchBlockReason}`

/** One user-selected playback stream. Microphone/ASR and audible output keep their existing owners. */
export class WatchTogetherCapture {
  private id?: string
  private readonly lifetime = new AbortController()
  private ended = false
  private stream?: MediaStream
  private video = document.createElement('video')
  private readonly thumbnail = document.createElement('canvas')
  private playback = new StreamingPcmCapture()
  private readonly playbackSpeech = new WatchPlaybackSpeech(
    () => {
      if (this.pending && !this.turnId && this.id) {
        this.epoch++
        observeRendererPromise(window.api.watchTogether.yield(this.id), 'wait for playback speech')
      }
    },
    () => this.releasePlayback(),
    () => this.onPlaybackGap(),
  )
  private timer?: ReturnType<typeof setInterval>
  private unsubscribe?: () => void
  private unsubscribeVoice?: () => void
  private unsubscribeStop?: () => void
  private microphone = false
  private frame?: HTMLCanvasElement
  private pcm: Int16Array[] = []
  private samples = 0
  private previousSignature?: Uint8ClampedArray
  private sceneChange?: { frame: HTMLCanvasElement; at: number; score: number }
  private lastSampleAt = 0
  private lastTranscript = ''
  private pending = false
  private pendingEpoch?: number
  private holdUntil = 0
  private epoch = 0
  private speaking = false
  private playbackEnabled = false
  private occupied = false
  private turnId?: string
  constructor(
    private readonly onEnd: (error?: WatchFailure) => void,
    private readonly onPlaybackGap: () => void,
    private readonly onModelIssue: (issue?: WatchModelIssue) => void,
  ) {
    this.thumbnail.width = 48
    this.thumbnail.height = 27
  }

  // Borrow the granted video-only stream. Closing the preview must not pause analysis.
  readonly mountPreview = (video: HTMLVideoElement | null) => {
    if (!video || this.ended || !this.video.srcObject) return
    video.srcObject = this.video.srcObject
    return () => {
      video.srcObject = null
    }
  }

  async start(sourceId: string): Promise<void> {
    let failure: WatchFailure = 'watch.startError'
    try {
      const result = await window.api.watchTogether.start(sourceId)
      if (result.kind === 'blocked') {
        this.stop(`watch.blocked.${result.reason}`)
        return
      }
      const { id } = result
      if (this.ended) {
        await window.api.watchTogether.stop(id)
        return
      }
      this.id = id
      this.unsubscribeStop = window.api.watchTogether.onStopped((event) => {
        if (event.id === id) this.stop(event.reason && `watch.blocked.${event.reason}`)
      })
      failure = 'watch.sourceError'
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      if (this.ended) {
        for (const track of stream.getTracks()) track.stop()
        return
      }
      this.stream = stream
      if (!stream.getVideoTracks().length) throw new Error('WATCH_CAPTURE')
      for (const track of stream.getVideoTracks())
        track.addEventListener('ended', this.lost, { once: true })
      for (const track of stream.getAudioTracks())
        track.addEventListener('ended', this.releasePlayback, { once: true })
      this.video.muted = true
      this.video.srcObject = new MediaStream(stream.getVideoTracks())
      await this.video.play()
      if (this.ended) return
      if (stream.getAudioTracks().length)
        observeRendererPromise(this.startPlayback(stream), 'start optional playback capture')
      failure = 'watch.micError'
      this.unsubscribeVoice = controller.onWatchSpeech(this.voiceActivity)
      this.microphone = true
      await controller.setWatchMicrophone(id, true, this.lifetime.signal, this.prepareUserTurn)
      if (this.ended) return
      if (!controller.getState().continuousListening.microphoneCaptured)
        throw new Error('WATCH_MICROPHONE')
      this.unsubscribe = controller.subscribe(this.activity)
      this.activity(controller.getState())
      this.timer = setInterval(
        () =>
          observeRendererPromise(
            this.tick().catch(() => this.stop('watch.sourceError')),
            'sample shared playback',
          ),
        400,
      )
    } catch {
      this.stop(failure)
    }
  }

  private async startPlayback(stream: MediaStream): Promise<void> {
    this.playbackEnabled = true
    try {
      await this.playbackSpeech.start(this.lifetime.signal)
      if (this.ended || !this.playbackEnabled) return
      await this.playback.startStream(
        new MediaStream(stream.getAudioTracks()),
        this.addAudio,
        this.releasePlayback,
      )
      if (this.ended || !this.playbackEnabled) await this.playback.stop()
    } catch {
      this.releasePlayback()
    }
  }

  private releasePlayback = (): void => {
    if (!this.playbackEnabled) return
    this.playbackEnabled = false
    this.pcm = []
    this.samples = 0
    this.lastTranscript = ''
    for (const track of this.stream?.getAudioTracks() ?? []) track.stop()
    observeRendererPromise(this.playback.stop(), 'release playback capture')
    observeRendererPromise(this.playbackSpeech.stop(), 'release playback ASR')
    this.onPlaybackGap()
  }

  private lost = () => this.stop('watch.sourceError')
  private activity = (state: ControllerState) => {
    if (!state.continuousListening.microphoneCaptured) {
      this.stop('watch.micError')
      return
    }
    const occupied = state.status !== 'idle'
    if (occupied && !this.occupied) {
      if (this.id) controller.clearWatchReaction(this.id)
      if (!this.turnId && this.id) {
        this.epoch++
        observeRendererPromise(
          window.api.watchTogether.yield(this.id),
          'defer viewing during conversation',
        )
      }
    }
    this.occupied = occupied
  }

  private voiceActivity = (talking: boolean) => {
    if (talking && !this.speaking) {
      this.epoch++
      this.holdUntil = Date.now() + 3200
      if (this.id) {
        controller.clearWatchReaction(this.id)
        observeRendererPromise(window.api.watchTogether.yield(this.id), 'yield shared viewing')
      }
      if (this.turnId)
        observeRendererPromise(
          controller.yieldWatchComment(this.turnId),
          'interrupt shared viewing comment',
        )
    }
    if (this.speaking && !talking) this.holdUntil = Date.now() + 2000
    this.speaking = talking
  }

  private blocked(): boolean {
    return (
      this.ended ||
      this.speaking ||
      Date.now() < this.holdUntil ||
      controller.getState().status !== 'idle'
    )
  }
  private resetSamples(): void {
    this.frame = undefined
    this.pcm = []
    this.samples = 0
    this.previousSignature = undefined
    this.sceneChange = undefined
    this.lastTranscript = ''
  }
  private addAudio = (buffer: ArrayBuffer) => {
    if (this.ended || !this.playbackEnabled) return
    this.playbackSpeech.push(buffer, controller.getState().status === 'speaking')
    const pcm = new Int16Array(buffer)
    this.pcm.push(pcm)
    this.samples += pcm.length
    while (this.samples > 16000 * 5) {
      const oldest = this.pcm.shift()
      if (!oldest) break
      this.samples -= oldest.length
    }
  }

  private drawFrame(width: number, height: number): HTMLCanvasElement | undefined {
    if (this.video.readyState < 2 || !this.video.videoWidth || !this.video.videoHeight) return
    const frame = document.createElement('canvas')
    frame.width = width
    frame.height = height
    const ctx = frame.getContext('2d')
    if (!ctx) return
    const scale = Math.min(width / this.video.videoWidth, height / this.video.videoHeight)
    const w = this.video.videoWidth * scale
    const h = this.video.videoHeight * scale
    ctx.drawImage(this.video, (width - w) / 2, (height - h) / 2, w, h)
    return frame
  }

  private prepareUserTurn = async (turnId: string, fromMicrophone: boolean): Promise<void> => {
    if (!this.id || this.ended) return
    const frame = this.drawFrame(768, 432)
    const image = frame
      ? await new Promise<Blob | null>((resolve) => frame.toBlob(resolve, 'image/jpeg', 0.72))
      : undefined
    if (!this.ended)
      await window.api.watchTogether.prepareTurn(
        this.id,
        turnId,
        fromMicrophone,
        await image?.arrayBuffer(),
        this.playbackSpeech.transcript(),
      )
  }

  private async tick(): Promise<void> {
    const id = this.id
    if (!id || this.ended || this.video.readyState < 2) return
    const now = this.drawFrame(WATCH_FRAME_WIDTH, WATCH_FRAME_HEIGHT)
    if (!now) return
    const prev = this.frame
    this.frame = now
    const tc = this.thumbnail.getContext('2d', { willReadFrequently: true })
    if (!tc) return
    const { width, height } = this.thumbnail
    tc.drawImage(now, 0, 0, width, height)
    const signature = tc.getImageData(0, 0, width, height).data
    const old = this.previousSignature
    this.previousSignature = signature
    const time = Date.now()
    if (this.sceneChange && time - this.sceneChange.at > 5000) this.sceneChange = undefined
    if (old && prev) {
      let score = 0
      for (let i = 0; i < signature.length; i += 4) {
        if (
          Math.abs(signature[i] - old[i]) > 18 ||
          Math.abs(signature[i + 1] - old[i + 1]) > 18 ||
          Math.abs(signature[i + 2] - old[i + 2]) > 18
        )
          score++
      }
      if (score >= 4 && score > (this.sceneChange?.score ?? 0))
        this.sceneChange = { frame: now, at: time, score }
      if (score > width * height * 0.55 && this.pendingEpoch === this.epoch && !this.turnId) {
        this.epoch++
        controller.clearWatchReaction(id)
        observeRendererPromise(
          window.api.watchTogether.yield(id, 'scene'),
          'discard replaced scene',
        )
      } else if (
        score > width * height * 0.55 &&
        this.turnId &&
        controller.getState().status !== 'speaking'
      ) {
        observeRendererPromise(controller.yieldWatchComment(this.turnId), 'discard replaced scene')
      }
    }
    if (
      this.blocked() ||
      (this.playbackEnabled && this.playbackSpeech.speaking) ||
      this.pending ||
      time - this.lastSampleAt < 4000
    )
      return
    const pcm = new Int16Array(this.samples >= 256 ? this.samples : 0)
    let offset = 0
    for (const chunk of pcm.length ? this.pcm : []) {
      pcm.set(chunk, offset)
      offset += chunk.length
    }
    this.pcm = []
    this.samples = 0
    const transcript = this.playbackSpeech.transcript()
    if (
      this.lastSampleAt &&
      !this.sceneChange &&
      transcript === this.lastTranscript &&
      !pcm.some((s) => Math.abs(s) > 170)
    )
      return
    const earlier =
      this.sceneChange?.frame === now ? (prev ?? now) : (this.sceneChange?.frame ?? prev ?? now)
    this.sceneChange = undefined
    this.lastTranscript = transcript
    this.lastSampleAt = time
    const sheet = document.createElement('canvas')
    sheet.width = WATCH_FRAME_WIDTH * 2
    sheet.height = WATCH_FRAME_HEIGHT
    const canvas = sheet.getContext('2d')
    if (!canvas) return
    canvas.drawImage(earlier, 0, 0)
    canvas.drawImage(now, WATCH_FRAME_WIDTH, 0)
    this.pending = true
    const epoch = this.epoch,
      endedAt = Date.now()
    this.pendingEpoch = epoch
    let commentId: string | undefined
    let played = false
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        sheet.toBlob(resolve, 'image/jpeg', 0.72),
      )
      if (!blob || epoch !== this.epoch || this.blocked()) return
      const result = await window.api.watchTogether.observe({
        sessionId: id,
        endedAt,
        frames: await blob.arrayBuffer(),
        pcm: pcm.buffer,
        playbackTranscript: transcript,
      })
      if (result.kind === 'comment') commentId = result.turnId
      if (this.ended || epoch !== this.epoch) return
      if (result.kind === 'stopped') {
        this.stop()
        return
      }
      this.onModelIssue(result.kind === 'unavailable' ? result.reason : undefined)
      if (result.kind !== 'comment' || Date.now() > result.expiresAt || this.blocked()) return
      this.turnId = result.turnId
      played = (await controller.watchComment(this.turnId, result.expiresAt)) === 'completed'
    } finally {
      this.turnId = undefined
      this.pending = false
      this.pendingEpoch = undefined
      if (commentId)
        observeRendererPromise(
          window.api.watchTogether.finishComment(id, commentId, played),
          'settle screen comment',
        )
    }
  }

  stop(error?: WatchFailure): void {
    if (this.ended) return
    this.ended = true
    if (error) console.warn('[WatchTogether] stopped', error)
    this.lifetime.abort()
    clearInterval(this.timer)
    this.unsubscribe?.()
    this.unsubscribeStop?.()
    this.unsubscribeVoice?.()
    for (const track of this.stream?.getTracks() ?? []) {
      track.removeEventListener('ended', this.lost)
      track.removeEventListener('ended', this.releasePlayback)
      track.stop()
    }
    this.video.pause()
    this.video.srcObject = null
    this.thumbnail.width = 0
    this.resetSamples()
    if (this.turnId)
      observeRendererPromise(
        controller.yieldWatchComment(this.turnId),
        'stop shared viewing comment',
      )
    observeRendererPromise(this.playback.stop(), 'release playback capture')
    observeRendererPromise(this.playbackSpeech.stop(), 'release playback recognition')
    if (this.id)
      observeRendererPromise(window.api.watchTogether.stop(this.id), 'release shared viewing grant')
    if (this.microphone && this.id)
      observeRendererPromise(
        controller.setWatchMicrophone(this.id, false),
        'release shared viewing microphone',
      )
    this.onEnd(error)
  }
}
