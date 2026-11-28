const TARGET_SAMPLE_RATE = 16_000
const maxQueuedAudioMs = 1500

export interface CapturedPcmTiming {
  endedAt: number
  discontinuous: boolean
}

type CaptureFrame = (pcm: ArrayBuffer, timing: CapturedPcmTiming) => void

export class StreamingPcmCapture {
  private stream: MediaStream | null = null
  private captureDeviceId = 'default'
  private audioContext: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private worklet: AudioWorkletNode | null = null
  private silentGain: GainNode | null = null
  private resampleBuffer = new Float32Array(0)
  private resamplePosition = 0
  private onFrame: CaptureFrame | null = null
  private onDeviceLost: (() => void) | null = null
  private deviceLostNotified = false
  private startTask: Promise<void> | null = null
  private levelListener: ((rms: number, at: number) => void) | null = null
  private level?: { rms: number; at: number }

  /** Levels from the existing capture only; no audio is retained for reactions. */
  setLevelListener(listener: ((rms: number, at: number) => void) | null): void {
    this.levelListener = listener
  }

  /**
   * @param onDeviceLost Invoked once if the working input track ends on its own
   *   (device unplugged / disabled). It is the authoritative loss signal for the
   *   working stream; `devicechange` is not used to own the working stream.
   */
  async start(
    deviceId: string | undefined,
    onFrame: CaptureFrame,
    onDeviceLost?: () => void,
  ): Promise<void> {
    if (this.audioContext) return
    if (this.startTask) return this.startTask
    this.startTask = this.startInternal(deviceId, onFrame, onDeviceLost)
    try {
      await this.startTask
    } finally {
      this.startTask = null
    }
  }

  private async startInternal(
    deviceId: string | undefined,
    onFrame: CaptureFrame,
    onDeviceLost?: () => void,
  ): Promise<void> {
    const deviceConstraint =
      deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...deviceConstraint,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })
    this.captureDeviceId = deviceId || 'default'
    await this.startStream(stream, onFrame, onDeviceLost)
  }

  /** Takes ownership of an already granted audio source. */
  async startStream(
    stream: MediaStream,
    onFrame: CaptureFrame,
    onDeviceLost?: () => void,
  ): Promise<void> {
    const audioContext = new AudioContext()
    try {
      if (audioContext.state === 'suspended') await audioContext.resume()
      await audioContext.audioWorklet.addModule('./pcmCaptureWorklet.js')
      const source = audioContext.createMediaStreamSource(stream)
      const worklet = new AudioWorkletNode(audioContext, 'pcm-capture-processor', {
        processorOptions: {
          maxQueuedFrames: Math.ceil((audioContext.sampleRate * maxQueuedAudioMs) / 1000),
        },
      })
      const silentGain = audioContext.createGain()
      silentGain.gain.value = 0
      this.stream = stream
      this.audioContext = audioContext
      this.source = source
      this.worklet = worklet
      this.silentGain = silentGain
      this.onFrame = onFrame
      this.onDeviceLost = onDeviceLost ?? null
      this.deviceLostNotified = false
      // The working track ending without a stop() call means the OS removed the
      // device. This is the authoritative loss signal for the working stream.
      stream.getAudioTracks().forEach((track) => {
        track.addEventListener('ended', this.handleTrackEnded)
      })
      let expectedFrame: number | undefined
      let skipped = false
      worklet.port.onmessage = (
        event: MessageEvent<{ startFrame: number; samples: Float32Array }>,
      ) => {
        if (worklet !== this.worklet) return
        const { startFrame, samples } = event.data
        const endFrame = startFrame + samples.length
        const lagMs = Math.max(
          0,
          (audioContext.currentTime - endFrame / audioContext.sampleRate) * 1000,
        )
        const discontinuous =
          skipped || (expectedFrame !== undefined && startFrame !== expectedFrame)
        expectedFrame = endFrame
        skipped = lagMs > maxQueuedAudioMs
        try {
          if (!skipped)
            this.handleNativeFrame(samples, { endedAt: Date.now() - lagMs, discontinuous })
        } finally {
          worklet.port.postMessage(null)
        }
      }
      source.connect(worklet)
      worklet.connect(silentGain)
      silentGain.connect(audioContext.destination)
    } catch (error) {
      stream.getTracks().forEach((track) => {
        track.stop()
      })
      await audioContext.close().catch(() => undefined)
      throw error
    }
  }

  private readonly handleTrackEnded = (): void => {
    if (this.deviceLostNotified) return
    this.deviceLostNotified = true
    this.onDeviceLost?.()
  }

  async stop(): Promise<void> {
    this.onFrame = null
    this.onDeviceLost = null
    this.level = undefined
    if (this.worklet) {
      this.worklet.port.onmessage = null
      this.worklet.port.close()
      this.worklet.disconnect()
      this.worklet = null
    }
    this.source?.disconnect()
    this.source = null
    this.silentGain?.disconnect()
    this.silentGain = null
    this.stream?.getAudioTracks().forEach((track) => {
      track.removeEventListener('ended', this.handleTrackEnded)
    })
    this.stream?.getTracks().forEach((track) => {
      track.stop()
    })
    this.stream = null
    if (this.audioContext) await this.audioContext.close()
    this.audioContext = null
    this.resampleBuffer = new Float32Array(0)
    this.resamplePosition = 0
  }

  isAlive(): boolean {
    return Boolean(
      this.audioContext &&
        this.audioContext.state !== 'closed' &&
        this.stream?.getAudioTracks().some((track) => track.readyState === 'live'),
    )
  }

  readLevel(): number {
    const level = this.level
    return this.isAlive() && level && performance.now() - level.at < 300 ? level.rms : 0
  }

  activeMicrophone(
    selectedDeviceId: string,
  ): { label: string; changePending: boolean } | undefined {
    const track = this.stream?.getAudioTracks().find((candidate) => candidate.readyState === 'live')
    if (!track) return undefined
    const selection = selectedDeviceId || 'default'
    return {
      label: track.label.trim().slice(0, 160),
      changePending:
        selection !== this.captureDeviceId && selection !== track.getSettings().deviceId,
    }
  }

  private handleNativeFrame(frame: Float32Array, timing: CapturedPcmTiming): void {
    const context = this.audioContext
    if (!context || !this.onFrame) return
    if (timing.discontinuous) {
      this.resampleBuffer = new Float32Array(0)
      this.resamplePosition = 0
    }
    if (frame.length > 0) {
      let energy = 0
      for (const sample of frame) energy += sample * sample
      const rms = Math.sqrt(energy / frame.length)
      const at = performance.now()
      const previous = timing.discontinuous ? 0 : (this.level?.rms ?? 0)
      this.level = { rms: Math.max(rms, previous * 0.82), at }
      this.levelListener?.(rms, at)
    }
    const combined = new Float32Array(this.resampleBuffer.length + frame.length)
    combined.set(this.resampleBuffer)
    combined.set(frame, this.resampleBuffer.length)
    const ratio = context.sampleRate / TARGET_SAMPLE_RATE
    const output: number[] = []
    while (this.resamplePosition + ratio <= combined.length) {
      const start = Math.floor(this.resamplePosition)
      const end = Math.max(start + 1, Math.floor(this.resamplePosition + ratio))
      let sum = 0
      for (let index = start; index < end; index++) sum += combined[index]
      output.push(sum / (end - start))
      this.resamplePosition += ratio
    }
    const consumed = Math.floor(this.resamplePosition)
    this.resampleBuffer = combined.slice(consumed)
    this.resamplePosition -= consumed
    if (output.length === 0) return
    const pcm = new Int16Array(output.length)
    for (let index = 0; index < output.length; index++) {
      const sample = Math.max(-1, Math.min(1, output[index]))
      pcm[index] = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff)
    }
    this.onFrame(pcm.buffer, timing)
  }
}
