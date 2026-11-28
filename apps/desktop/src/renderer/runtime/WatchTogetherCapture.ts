import {
  WATCH_DETAIL_MAX_BYTES,
  WATCH_FRAME_HEIGHT,
  WATCH_FRAME_WIDTH,
  WATCH_MAX_FRAME_BYTES,
  WATCH_TURN_MAX_BYTES,
  WATCH_TURN_MAX_PIXELS,
  WATCH_TURN_MAX_SIDE,
  type WatchAudioStatus,
  type WatchBlockReason,
  type WatchModelIssue,
} from '../../shared/watchTogether'
import { type CapturedPcmTiming, StreamingPcmCapture } from '../audio/StreamingPcmCapture'
import type { ControllerState } from '../Controller'
import { controller } from '../Controller'
import { observeRendererPromise } from '../reliability/observePromise'
import { WatchPlaybackSpeech } from './WatchPlaybackSpeech'
import { watchDetailRegions } from './watchDetailRegions'

export type WatchFailure =
  | 'watch.sourceError'
  | 'watch.startError'
  | `watch.blocked.${WatchBlockReason}`

async function encodeFrame(
  canvas: HTMLCanvasElement,
  qualities: readonly number[],
  maxBytes: number,
): Promise<ArrayBuffer | undefined> {
  for (const quality of qualities) {
    const image = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    )
    if (image && image.size >= 100 && image.size <= maxBytes) return image.arrayBuffer()
  }
}

async function encodeDetail(canvas: HTMLCanvasElement): Promise<ArrayBuffer | undefined> {
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (png && png.size >= 100 && png.size <= WATCH_DETAIL_MAX_BYTES) return png.arrayBuffer()
  return encodeFrame(canvas, [0.94, 0.82, 0.68], WATCH_DETAIL_MAX_BYTES)
}

function changedPixels(before: Uint8ClampedArray, after: Uint8ClampedArray): number {
  let count = 0
  for (let i = 0; i < after.length; i += 4) {
    if (
      Math.abs(after[i] - before[i]) > 18 ||
      Math.abs(after[i + 1] - before[i + 1]) > 18 ||
      Math.abs(after[i + 2] - before[i + 2]) > 18
    )
      count++
  }
  return count
}

const sceneHistoryMs = 8_000
const sampleIntervalMs = 4_000
const speechPauseWaitMs = 1_200

export type WatchMicrophoneStatus = 'off' | 'starting' | 'on' | 'stopping' | 'failed'

/** One user-selected playback stream. Microphone/ASR and audible output keep their existing owners. */
export class WatchTogetherCapture {
  private id?: string
  get sessionId() {
    return this.id
  }
  private readonly lifetime = new AbortController()
  private ended = false
  private stream?: MediaStream
  private video = document.createElement('video')
  private readonly thumbnail = document.createElement('canvas')
  private playback = new StreamingPcmCapture()
  private readonly playbackSpeech = new WatchPlaybackSpeech(
    () => this.releasePlayback(),
    () => this.onPlaybackGap(),
  )
  private timer?: ReturnType<typeof setInterval>
  private unsubscribe?: () => void
  private unsubscribeVoice?: () => void
  private unsubscribeStop?: () => void
  private microphone?: { abort: AbortController; start: Promise<undefined | 'cancelled'> }
  private frame?: HTMLCanvasElement
  private frameAt = 0
  private pcm: Int16Array[] = []
  private samples = 0
  private previousSignature?: Uint8ClampedArray
  private submittedSignature?: Uint8ClampedArray
  private sceneChange?: {
    before: HTMLCanvasElement
    after: HTMLCanvasElement
    beforeAt: number
    signature: Uint8ClampedArray
    at: number
    score: number
  }
  private lastSampleAt = 0
  private lastTranscript = ''
  private pending = false
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
    private readonly onAudioStatus: (status: WatchAudioStatus) => void = () => undefined,
    private readonly onMicrophoneStatus: (status: WatchMicrophoneStatus) => void = () => undefined,
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

  readonly readPlaybackLevel = (): number => this.playback.readLevel()

  readonly readMicrophoneLevel = (): number =>
    this.id && this.microphone && !this.microphone.abort.signal.aborted
      ? controller.readWatchMicrophoneLevel(this.id)
      : 0

  async start(sourceId: string, reference?: string): Promise<void> {
    let failure: WatchFailure = 'watch.startError'
    try {
      const result = await window.api.watchTogether.start(sourceId, reference)
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
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { resizeMode: 'none' } as MediaTrackConstraints,
        audio: { restrictOwnAudio: true } as MediaTrackConstraints,
      })
      if (this.ended) {
        for (const track of stream.getTracks()) track.stop()
        return
      }
      this.stream = stream
      if (!stream.getVideoTracks().length) throw new Error('WATCH_CAPTURE')
      observeRendererPromise(
        controller.refreshOverlayVisibility(),
        'refresh watch overlay visibility',
      )
      for (const track of stream.getVideoTracks())
        track.addEventListener('ended', this.lost, { once: true })
      for (const track of stream.getAudioTracks())
        track.addEventListener('ended', this.releasePlayback, { once: true })
      this.video.muted = true
      this.video.srcObject = new MediaStream(stream.getVideoTracks())
      await this.video.play()
      if (this.ended) return
      if (stream.getAudioTracks().length) {
        const scope = sourceId.startsWith('screen:') ? 'system' : 'application'
        observeRendererPromise(this.startPlayback(stream, scope), 'start optional playback capture')
      } else this.onAudioStatus('unavailable')
      controller.setWatchViewing(id, this.prepareUserTurn)
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

  async setMicrophone(enabled: boolean): Promise<void> {
    const id = this.id
    if (!id || this.ended) return
    if (!enabled) {
      if (!this.microphone || this.microphone.abort.signal.aborted) return
      this.onMicrophoneStatus('stopping')
      await this.releaseMicrophone(id)
      if (!this.ended) this.onMicrophoneStatus('off')
      return
    }
    if (this.microphone) return
    const abort = new AbortController()
    this.unsubscribeVoice = controller.onWatchSpeech(this.voiceActivity)
    const start = controller.setWatchMicrophone(id, true, abort.signal, async (utteranceId) => ({
      utteranceId,
      frame: await this.captureTurnFrame(),
      playbackTranscript: this.playbackSpeech.transcript(),
    }))
    this.microphone = { abort, start }
    this.onMicrophoneStatus('starting')
    let status: 'off' | 'failed' = 'off'
    try {
      const result = await start
      if (abort.signal.aborted) return
      if (result !== 'cancelled') {
        this.onMicrophoneStatus('on')
        return
      }
    } catch {
      if (abort.signal.aborted) return
      status = 'failed'
    }
    await this.releaseMicrophone(id)
    if (!this.ended) this.onMicrophoneStatus(status)
  }

  private async releaseMicrophone(id: string): Promise<void> {
    const microphone = this.microphone
    if (!microphone || microphone.abort.signal.aborted) return
    microphone.abort.abort()
    this.unsubscribeVoice?.()
    this.unsubscribeVoice = undefined
    this.speaking = false
    this.holdUntil = 0
    try {
      // A late startup cleanup must finish before the same session can start the mic again.
      const [release] = await Promise.allSettled([
        controller.setWatchMicrophone(id, false),
        microphone.start,
      ])
      if (release.status === 'rejected') throw release.reason
    } catch (error) {
      if (!this.ended) this.onMicrophoneStatus('failed')
      throw error
    } finally {
      this.microphone = undefined
    }
  }

  private async startPlayback(stream: MediaStream, scope: WatchAudioStatus): Promise<void> {
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
      else this.onAudioStatus(scope)
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
    this.onAudioStatus('unavailable')
    this.onPlaybackGap()
  }

  private lost = () => this.stop('watch.sourceError')
  private activity = (state: ControllerState) => {
    if (this.speaking && !state.continuousListening.microphoneCaptured) this.voiceActivity(false)
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
        observeRendererPromise(
          window.api.watchTogether.yield(this.id, 'speech'),
          'yield shared viewing',
        )
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

  private blocked(forPlayback = false): boolean {
    return (
      this.ended ||
      this.speaking ||
      Date.now() < this.holdUntil ||
      (controller.getState().status !== 'idle' && (forPlayback || !this.turnId))
    )
  }
  private resetSamples(): void {
    this.frame = undefined
    this.pcm = []
    this.samples = 0
    this.previousSignature = undefined
    this.submittedSignature = undefined
    this.sceneChange = undefined
    this.lastTranscript = ''
  }
  private addAudio = (buffer: ArrayBuffer, timing: CapturedPcmTiming) => {
    if (this.ended || !this.playbackEnabled) return
    if (timing.discontinuous) {
      this.pcm = []
      this.samples = 0
    }
    this.playbackSpeech.push(buffer, timing)
    const pcm = new Int16Array(buffer)
    this.pcm.push(pcm)
    this.samples += pcm.length
    while (this.samples > 16000 * 5) {
      const oldest = this.pcm.shift()
      if (!oldest) break
      this.samples -= oldest.length
    }
  }

  private drawVideo(ctx: CanvasRenderingContext2D): boolean {
    if (this.video.readyState < 2 || !this.video.videoWidth || !this.video.videoHeight) return false
    const { width, height } = ctx.canvas
    const scale = Math.min(width / this.video.videoWidth, height / this.video.videoHeight)
    const w = this.video.videoWidth * scale
    const h = this.video.videoHeight * scale
    ctx.drawImage(this.video, (width - w) / 2, (height - h) / 2, w, h)
    return true
  }

  private drawFrame(): HTMLCanvasElement | undefined {
    const frame = document.createElement('canvas')
    frame.width = WATCH_FRAME_WIDTH
    frame.height = WATCH_FRAME_HEIGHT
    const ctx = frame.getContext('2d')
    if (ctx && this.drawVideo(ctx)) return frame
  }

  private captureDetails(): HTMLCanvasElement[] {
    const { videoWidth: width, videoHeight: height } = this.video
    if (!width || !height) return []
    const probe = document.createElement('canvas')
    const scale = Math.min(1, 1100 / Math.max(width, height))
    probe.width = Math.max(3, Math.round(width * scale))
    probe.height = Math.max(3, Math.round(height * scale))
    const context = probe.getContext('2d', { willReadFrequently: true })
    if (!context) return []
    context.drawImage(this.video, 0, 0, probe.width, probe.height)
    const pixels = context.getImageData(0, 0, probe.width, probe.height)
    return watchDetailRegions(pixels, width, height).flatMap((region) => {
      const crop = document.createElement('canvas')
      crop.width = region.width
      crop.height = region.height
      const draw = crop.getContext('2d')
      if (!draw) return []
      draw.drawImage(
        this.video,
        region.x,
        region.y,
        region.width,
        region.height,
        0,
        0,
        crop.width,
        crop.height,
      )
      return [crop]
    })
  }

  private async captureTurnFrame(): Promise<ArrayBuffer | undefined> {
    const { videoWidth: width, videoHeight: height, readyState } = this.video
    if (readyState < 2 || !width || !height) return
    const scale = Math.min(
      1,
      WATCH_TURN_MAX_SIDE / Math.max(width, height),
      Math.sqrt(WATCH_TURN_MAX_PIXELS / (width * height)),
    )
    const frame = document.createElement('canvas')
    frame.width = Math.max(1, Math.floor(width * scale))
    frame.height = Math.max(1, Math.floor(height * scale))
    const ctx = frame.getContext('2d')
    if (!ctx) return
    ctx.drawImage(this.video, 0, 0, frame.width, frame.height)
    const bytes = await encodeFrame(frame, [0.92, 0.8], WATCH_TURN_MAX_BYTES)
    if (bytes || this.ended) return bytes

    // Keep the moment of the question if a high-entropy desktop exceeds the byte limit.
    const smaller = document.createElement('canvas')
    smaller.width = Math.max(1, Math.floor(frame.width * 0.65))
    smaller.height = Math.max(1, Math.floor(frame.height * 0.65))
    const fallback = smaller.getContext('2d')
    if (!fallback) return
    fallback.drawImage(frame, 0, 0, smaller.width, smaller.height)
    return encodeFrame(smaller, [0.84, 0.68], WATCH_TURN_MAX_BYTES)
  }

  private prepareUserTurn = async (turnId: string, fromMicrophone: boolean): Promise<void> => {
    if (!this.id || this.ended) return
    const image = await this.captureTurnFrame()
    if (!this.ended)
      await window.api.watchTogether.prepareTurn(
        this.id,
        turnId,
        fromMicrophone,
        image,
        this.playbackSpeech.transcript(),
      )
  }

  private async tick(): Promise<void> {
    const id = this.id
    if (!id || this.ended || this.video.readyState < 2) return
    const tc = this.thumbnail.getContext('2d', { willReadFrequently: true })
    if (!tc) return
    const { width, height } = this.thumbnail
    tc.clearRect(0, 0, width, height)
    if (!this.drawVideo(tc)) return
    const signature = tc.getImageData(0, 0, width, height).data
    const old = this.previousSignature
    const time = Date.now()
    if (this.sceneChange && time - this.sceneChange.at > sceneHistoryMs)
      this.sceneChange = undefined
    const score = old ? changedPixels(old, signature) : 0
    // Compare against the last retained scene so slow, small changes can accumulate.
    let captured: HTMLCanvasElement | undefined
    if (!this.frame || score >= 4) {
      captured = this.drawFrame()
      if (!captured) return
      if (this.frame && old && score >= (this.sceneChange?.score ?? 0)) {
        this.sceneChange = {
          before: this.frame,
          after: captured,
          beforeAt: this.frameAt,
          signature,
          at: time,
          score,
        }
      }
      this.frame = captured
      this.frameAt = time
      this.previousSignature = signature
    }
    if (this.blocked() || this.pending || time - this.lastSampleAt < sampleIntervalMs) return
    const chunks = this.pcm
    const sampleCount = this.samples >= 256 ? this.samples : 0
    this.pcm = []
    this.samples = 0
    const phrases = this.playbackSpeech.observations(time)
    const transcript = phrases
      .map(({ text }) => text)
      .join(' ')
      .slice(-1000)
    if (
      this.lastSampleAt &&
      !this.sceneChange &&
      this.previousSignature === this.submittedSignature &&
      transcript === this.lastTranscript &&
      !(sampleCount && chunks.some((chunk) => chunk.some((s) => Math.abs(s) > 170)))
    )
      return
    // Audio-driven submissions still need the current frame.
    const now = captured ?? this.drawFrame()
    if (!now) return
    const change = this.sceneChange
    const earlier = change?.before ?? now
    const earlierMs = Math.max(-45_000, (change?.beforeAt ?? time) - time)
    const distinctPeak = change && changedPixels(change.signature, signature) >= 4
    this.frame = now
    this.frameAt = time
    this.previousSignature = signature
    this.sceneChange = undefined
    const pcm = new Int16Array(sampleCount)
    let offset = 0
    for (const chunk of sampleCount ? chunks : []) {
      pcm.set(chunk, offset)
      offset += chunk.length
    }
    this.lastTranscript = transcript
    this.lastSampleAt = time
    const sheet = document.createElement('canvas')
    sheet.width = WATCH_FRAME_WIDTH * 2
    sheet.height = WATCH_FRAME_HEIGHT
    const canvas = sheet.getContext('2d')
    if (!canvas) return
    canvas.drawImage(earlier, 0, 0)
    canvas.drawImage(now, WATCH_FRAME_WIDTH, 0)
    const currentDetails = this.captureDetails()
    this.pending = true
    const epoch = this.epoch
    try {
      const [frames, peak, details] = await Promise.all([
        encodeFrame(sheet, [0.72, 0.45], WATCH_MAX_FRAME_BYTES),
        distinctPeak ? encodeFrame(change.after, [0.8, 0.55], WATCH_MAX_FRAME_BYTES) : undefined,
        Promise.all(currentDetails.map(encodeDetail)),
      ])
      if (!frames || epoch !== this.epoch || this.blocked()) return
      this.submittedSignature = signature
      const result = await window.api.watchTogether.observe({
        sessionId: id,
        endedAt: time,
        frames,
        pcm: pcm.buffer,
        playbackTranscript: transcript,
        phrases,
        timing: { earlierMs, currentMs: 0, ...(peak && change && { peakMs: change.at - time }) },
        peak,
        details: details.filter((image) => image !== undefined),
      })
      if (result.kind === 'comment') {
        if (!this.ended && epoch === this.epoch) this.onModelIssue(undefined)
        observeRendererPromise(
          this.presentComment(id, result, epoch),
          'play shared viewing comment',
        )
        return
      }
      if (this.ended) return
      if (result.kind === 'reference-checked') this.lastSampleAt = 0
      if (epoch !== this.epoch) return
      if (result.kind === 'stopped') {
        this.stop()
        return
      }
      this.onModelIssue(result.kind === 'unavailable' ? result.reason : undefined)
    } finally {
      this.pending = false
    }
  }

  private async presentComment(
    id: string,
    { turnId, expiresAt }: { turnId: string; expiresAt: number },
    epoch: number,
  ): Promise<void> {
    let played = false
    try {
      if (epoch !== this.epoch || this.blocked(true) || this.turnId) return
      this.turnId = turnId
      const until = Math.min(expiresAt, Date.now() + speechPauseWaitMs)
      while (
        !this.ended &&
        this.playbackSpeech.speaking &&
        epoch === this.epoch &&
        Date.now() < until
      )
        await this.waitForPlaybackGap(Math.min(150, until - Date.now()))
      if (epoch !== this.epoch || this.blocked(true) || Date.now() >= expiresAt) return
      played = (await controller.watchComment(turnId, expiresAt)) === 'completed'
    } finally {
      if (this.turnId === turnId) this.turnId = undefined
      await window.api.watchTogether.finishComment(id, turnId, played)
    }
  }

  private waitForPlaybackGap(ms: number): Promise<void> {
    const { signal } = this.lifetime
    if (signal.aborted) return Promise.resolve()
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', finish)
        resolve()
      }
      const timer = setTimeout(finish, ms)
      signal.addEventListener('abort', finish, { once: true })
    })
  }

  stop(error?: WatchFailure): void {
    if (this.ended) return
    this.ended = true
    if (error) console.warn('[WatchTogether] stopped', error)
    this.lifetime.abort()
    clearInterval(this.timer)
    this.unsubscribe?.()
    this.unsubscribeStop?.()
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
    if (this.id) {
      controller.setWatchViewing(this.id)
      observeRendererPromise(window.api.watchTogether.stop(this.id), 'release shared viewing grant')
      observeRendererPromise(this.releaseMicrophone(this.id), 'release shared viewing microphone')
    }
    this.onEnd(error)
  }
}
