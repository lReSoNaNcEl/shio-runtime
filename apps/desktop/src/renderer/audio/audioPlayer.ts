export interface PlaybackSession {
  playbackId: string
  turnId: string
  analyser: AnalyserNode
  startedAt: number
  playbackItemId: string
  normalizationReference: number
  durationMs: number
}

export interface AudioPlayOptions {
  turnId: string
  onReady: (session: PlaybackSession) => void | Promise<void>
  onStarted?: () => void
  onProgress?: (progress: number) => void
}

export interface PlaybackCompletion {
  playbackId: string
  turnId: string
}

export interface PreparedAudio {
  audioBuffer: AudioBuffer
  durationMs: number
  normalizationReference: number
}

interface ActivePlayback extends PlaybackSession {
  sequence: number
  source: AudioBufferSourceNode | null
  settle: (() => void) | null
}

export class ParallelPlaybackError extends Error {
  constructor(
    readonly activeTurnId: string,
    readonly requestedTurnId: string,
  ) {
    super(
      `Parallel playback rejected: activeTurnId=${activeTurnId} requestedTurnId=${requestedTurnId}`,
    )
    this.name = 'ParallelPlaybackError'
  }
}

export class AudioPlayer {
  private audioCtx: AudioContext
  analyser: AnalyserNode
  private activePlayback: ActivePlayback | null = null
  private progressTimer: number | null = null
  private duration = 0
  private playbackSeq = 0

  constructor() {
    this.audioCtx = new AudioContext()
    this.analyser = this.audioCtx.createAnalyser()
    this.analyser.fftSize = 256
    this.analyser.connect(this.audioCtx.destination)
  }

  async prepare(wavBuffer: ArrayBuffer): Promise<PreparedAudio> {
    this.assertValidWav(wavBuffer)
    return this.decodePreparedAudio(wavBuffer)
  }

  async prepareEncoded(encodedBuffer: ArrayBuffer): Promise<PreparedAudio> {
    if (encodedBuffer.byteLength === 0) throw new Error('Audio preview is empty')
    return this.decodePreparedAudio(encodedBuffer)
  }

  private async decodePreparedAudio(encodedBuffer: ArrayBuffer): Promise<PreparedAudio> {
    const audioBuffer = await this.audioCtx.decodeAudioData(encodedBuffer.slice(0))
    return {
      audioBuffer,
      durationMs: audioBuffer.duration * 1000,
      normalizationReference: this.estimateNormalizationReference(audioBuffer),
    }
  }

  async play(wavBuffer: ArrayBuffer, options: AudioPlayOptions): Promise<PlaybackCompletion> {
    this.assertValidWav(wavBuffer)
    // Preserve the legacy synchronous reservation before decode and its first await.
    const active = this.reserve(options.turnId)
    try {
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume()
      this.assertOwner(active)
      const audioBuffer = await this.audioCtx.decodeAudioData(wavBuffer.slice(0))
      return await this.playReserved(
        active,
        {
          audioBuffer,
          durationMs: audioBuffer.duration * 1000,
          normalizationReference: this.estimateNormalizationReference(audioBuffer),
        },
        options,
      )
    } finally {
      this.release(active)
    }
  }

  async playPrepared(
    prepared: PreparedAudio,
    options: AudioPlayOptions,
  ): Promise<PlaybackCompletion> {
    const active = this.reserve(options.turnId)
    try {
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume()
      this.assertOwner(active)
      return await this.playReserved(active, prepared, options)
    } finally {
      this.release(active)
    }
  }

  stop(): void {
    const active = this.activePlayback
    if (!active) return
    // Invalidate ownership synchronously, including while decode/onReady is
    // still pending. Every later async continuation fails assertOwner and can
    // never create or start a stale source after interruption.
    this.activePlayback = null
    this.clearProgressTimer()
    this.duration = 0
    const source = active.source
    if (source) {
      source.onended = null
      try {
        source.stop()
      } catch {
        /* already stopped */
      }
      this.disposeSource(source, active.playbackId)
    }
    active.source = null
    active.settle?.()
    active.settle = null
  }

  async dispose(): Promise<void> {
    this.stop()
    this.clearProgressTimer()
    this.analyser.disconnect()
    if (this.audioCtx.state !== 'closed') await this.audioCtx.close()
  }

  stopCurrent(turnId: string, _reason: 'conversation-interrupted'): void {
    if (this.activePlayback?.turnId !== turnId) return
    this.stop()
  }

  isPlaying(): boolean {
    return this.activePlayback?.source !== null && Boolean(this.activePlayback)
  }
  isBusy(): boolean {
    return this.activePlayback !== null
  }

  getPlaybackDebug(): {
    playing: boolean
    activePlaybackId: number
    playbackId: string
    turnId: string
  } {
    return {
      playing: this.isPlaying(),
      activePlaybackId: this.activePlayback?.sequence ?? 0,
      playbackId: this.activePlayback?.playbackId ?? '',
      turnId: this.activePlayback?.turnId ?? '',
    }
  }

  private assertOwner(active: ActivePlayback): void {
    if (this.activePlayback !== active)
      throw new Error(`Playback ownership lost for turnId=${active.turnId}`)
  }

  private assertValidWav(wavBuffer: ArrayBuffer): void {
    if (wavBuffer.byteLength < 44) throw new Error('Speech audio response is empty or invalid')
  }

  private reserve(turnId: string): ActivePlayback {
    if (this.activePlayback) {
      console.warn(
        `[audio] guard activeTurnId=${this.activePlayback.turnId} requestedTurnId=${turnId}`,
      )
      throw new ParallelPlaybackError(this.activePlayback.turnId, turnId)
    }
    const sequence = ++this.playbackSeq
    const playbackId = `${turnId}:playback-${sequence}`
    const active: ActivePlayback = {
      playbackId,
      turnId,
      analyser: this.analyser,
      startedAt: performance.now(),
      playbackItemId: playbackId,
      normalizationReference: 0.12,
      durationMs: 0,
      sequence,
      source: null,
      settle: null,
    }
    this.activePlayback = active
    console.log(`[audio] playbackId=${playbackId} turnId=${turnId} reserved`)
    return active
  }

  private async playReserved(
    active: ActivePlayback,
    prepared: PreparedAudio,
    options: AudioPlayOptions,
  ): Promise<PlaybackCompletion> {
    active.normalizationReference = prepared.normalizationReference
    active.durationMs = prepared.durationMs
    this.assertOwner(active)
    const source = this.audioCtx.createBufferSource()
    active.source = source
    source.buffer = prepared.audioBuffer
    source.connect(this.analyser)
    this.duration = prepared.audioBuffer.duration

    const ended = new Promise<void>((resolve) => {
      active.settle = resolve
    })
    source.onended = () => {
      if (this.activePlayback !== active || active.source !== source) {
        console.debug(
          `[audio] playbackId=${active.playbackId} turnId=${options.turnId} stale-ended ignored`,
        )
        return
      }
      console.log(`[audio] playbackId=${active.playbackId} turnId=${options.turnId} ended`)
      options.onProgress?.(1)
      active.settle?.()
    }

    // The graph is connected. LipSync and speaking state attach immediately
    // before the prepared source starts.
    await options.onReady({
      playbackId: active.playbackId,
      playbackItemId: active.playbackItemId,
      turnId: options.turnId,
      analyser: this.analyser,
      startedAt: performance.now(),
      normalizationReference: prepared.normalizationReference,
      durationMs: prepared.durationMs,
    })
    this.assertOwner(active)
    const startedAt = this.audioCtx.currentTime
    source.start()
    options.onStarted?.()
    console.log(`[audio] playbackId=${active.playbackId} turnId=${options.turnId} started`)
    options.onProgress?.(0)
    this.progressTimer = window.setInterval(() => {
      if (this.activePlayback !== active || this.duration <= 0) return
      options.onProgress?.(Math.min(1, (this.audioCtx.currentTime - startedAt) / this.duration))
    }, 100)
    await ended
    return { playbackId: active.playbackId, turnId: options.turnId }
  }

  private release(active: ActivePlayback): void {
    if (this.activePlayback !== active) return
    this.clearProgressTimer()
    this.disposeSource(active.source, active.playbackId)
    active.source = null
    active.settle = null
    this.activePlayback = null
    console.log(`[audio] playbackId=${active.playbackId} turnId=${active.turnId} released`)
  }

  private disposeSource(source: AudioBufferSourceNode | null, playbackId: string): void {
    if (!source) return
    source.onended = null
    try {
      source.disconnect()
    } catch {
      /* not connected */
    }
    console.debug(`[audio] playbackId=${playbackId} disposed`)
  }

  private clearProgressTimer(): void {
    if (this.progressTimer === null) return
    window.clearInterval(this.progressTimer)
    this.progressTimer = null
  }

  private estimateNormalizationReference(buffer: AudioBuffer): number {
    const windowSize = Math.max(64, Math.floor(buffer.sampleRate * 0.02))
    const energies: number[] = []
    for (let offset = 0; offset < buffer.length; offset += windowSize) {
      let sum = 0
      let count = 0
      const end = Math.min(buffer.length, offset + windowSize)
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel)
        for (let i = offset; i < end; i++) {
          sum += data[i] * data[i]
          count += 1
        }
      }
      const rms = count > 0 ? Math.sqrt(sum / count) : 0
      if (rms >= facialSilenceFloor) energies.push(rms)
    }
    if (energies.length === 0) return 0.12
    energies.sort((a, b) => a - b)
    const percentile = energies[Math.min(energies.length - 1, Math.floor(energies.length * 0.8))]
    return Math.max(0.04, Math.min(0.3, percentile))
  }
}

const facialSilenceFloor = 0.006
