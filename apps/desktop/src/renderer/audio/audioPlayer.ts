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
  onProgress?: (progress: number) => void
}

export interface PlaybackCompletion {
  playbackId: string
  turnId: string
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

  async play(wavBuffer: ArrayBuffer, options: AudioPlayOptions): Promise<PlaybackCompletion> {
    if (wavBuffer.byteLength < 44) throw new Error('Speech audio response is empty or invalid')
    if (this.activePlayback) {
      console.warn(
        `[audio] guard activeTurnId=${this.activePlayback.turnId} requestedTurnId=${options.turnId}`,
      )
      throw new ParallelPlaybackError(this.activePlayback.turnId, options.turnId)
    }

    const sequence = ++this.playbackSeq
    const playbackId = `${options.turnId}:playback-${sequence}`
    const active: ActivePlayback = {
      playbackId,
      turnId: options.turnId,
      analyser: this.analyser,
      startedAt: performance.now(),
      playbackItemId: playbackId,
      normalizationReference: 0.12,
      durationMs: 0,
      sequence,
      source: null,
      settle: null,
    }
    // Reserve ownership synchronously, before decode or the first await.
    this.activePlayback = active
    console.log(`[audio] playbackId=${playbackId} turnId=${options.turnId} reserved`)

    try {
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume()
      this.assertOwner(active)
      const audioBuffer = await this.audioCtx.decodeAudioData(wavBuffer.slice(0))
      active.normalizationReference = this.estimateNormalizationReference(audioBuffer)
      active.durationMs = audioBuffer.duration * 1000
      this.assertOwner(active)
      const source = this.audioCtx.createBufferSource()
      active.source = source
      source.buffer = audioBuffer
      source.connect(this.analyser)
      this.duration = audioBuffer.duration

      const ended = new Promise<void>((resolve) => {
        active.settle = resolve
      })
      source.onended = () => {
        if (this.activePlayback !== active || active.source !== source) {
          console.debug(
            `[audio] playbackId=${playbackId} turnId=${options.turnId} stale-ended ignored`,
          )
          return
        }
        console.log(`[audio] playbackId=${playbackId} turnId=${options.turnId} ended`)
        options.onProgress?.(1)
        active.settle?.()
      }

      // The graph is now connected. LipSync attaches and speaking state becomes
      // visible inside this awaited hook, immediately before source.start().
      await options.onReady({
        playbackId,
        playbackItemId: active.playbackItemId,
        turnId: options.turnId,
        analyser: this.analyser,
        startedAt: performance.now(),
        normalizationReference: active.normalizationReference,
        durationMs: audioBuffer.duration * 1000,
      })
      this.assertOwner(active)
      const startedAt = this.audioCtx.currentTime
      source.start()
      console.log(`[audio] playbackId=${playbackId} turnId=${options.turnId} started`)
      options.onProgress?.(0)
      this.progressTimer = window.setInterval(() => {
        if (this.activePlayback !== active || this.duration <= 0) return
        options.onProgress?.(Math.min(1, (this.audioCtx.currentTime - startedAt) / this.duration))
      }, 100)
      await ended
      return { playbackId, turnId: options.turnId }
    } finally {
      if (this.activePlayback === active) {
        this.clearProgressTimer()
        this.disposeSource(active.source, playbackId)
        active.source = null
        active.settle = null
        this.activePlayback = null
        console.log(`[audio] playbackId=${playbackId} turnId=${options.turnId} released`)
      }
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
