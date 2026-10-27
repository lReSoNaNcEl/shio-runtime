export interface PlaybackSession {
  playbackId: string
  turnId: string
  analyser: AnalyserNode
  startedAt: number
  playbackItemId: string
  normalizationReference: number
  durationMs: number
  durationFinal?: boolean
  getPcmPosition?: () => PcmPlaybackClock | null
}

export interface PcmPlaybackClock {
  firstPcmAt?: number
  firstOutputAt?: number
  firstAudibleAt?: number
  hardwareLatencyMs?: number
  cueCount?: number
  maxCueErrorMs?: number
  turnId: string
  playbackId: string
  sourceSampleRate: number
  sourceSampleOffset: number
  state: 'buffering' | 'playing' | 'ended' | 'cancelled'
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

export interface PcmStreamPlayback {
  session: PlaybackSession
  append(pcm: ArrayBuffer, onAudible?: () => void): Promise<void>
  finish(): Promise<PlaybackCompletion>
  cancel(reason: 'conversation-interrupted' | 'stream-failed'): void
}

export interface PreparedAudio {
  audioBuffer: AudioBuffer
  durationMs: number
  normalizationReference: number
}

interface ActivePlayback extends PlaybackSession {
  sequence: number
  source: AudioBufferSourceNode | null
  streamNode: AudioWorkletNode | null
  settle: (() => void) | null
  cancelStream: (() => void) | null
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
  private workletLoaded: Promise<void> | null = null
  private pcmClock: PcmPlaybackClock | null = null

  getPcmClock(): PcmPlaybackClock | null {
    return this.pcmClock ? { ...this.pcmClock } : null
  }

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

  async startPcmStream(sampleRate: number, options: AudioPlayOptions): Promise<PcmStreamPlayback> {
    const active = this.reserve(options.turnId)
    try {
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume()
      await this.ensurePcmWorklet()
      this.assertOwner(active)
      const node = new AudioWorkletNode(this.audioCtx, 'shio-pcm-stream-player', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { sourceSampleRate: sampleRate },
      })
      active.streamNode = node
      this.pcmClock = {
        turnId: options.turnId,
        playbackId: active.playbackId,
        sourceSampleRate: sampleRate,
        sourceSampleOffset: 0,
        state: 'buffering',
        hardwareLatencyMs:
          ((this.audioCtx.baseLatency ?? 0) + (this.audioCtx.outputLatency ?? 0)) * 1000,
      }
      node.connect(this.analyser)
      const maximumBufferedSamples = Math.ceil(sampleRate * 1.5)
      let bufferedSamples = 0
      let started = false
      let audibleReady = false
      let audibleReadiness: Promise<void> = Promise.resolve()
      let finished = false
      const capacityWaiters: Array<() => void> = []
      const normalizationEnergies: number[] = []
      let receivedSamples = 0
      let submittedSamples = 0
      let consumedSamples = 0
      const markers: Array<{ sample: number; run: () => void }> = []
      const runMarkers = (): void => {
        if (!audibleReady) return
        while (markers.length && markers[0].sample <= consumedSamples) {
          const marker = markers.shift()
          if (!marker) break
          if (this.pcmClock) {
            this.pcmClock.cueCount = (this.pcmClock.cueCount ?? 0) + 1
            this.pcmClock.maxCueErrorMs = Math.max(
              this.pcmClock.maxCueErrorMs ?? 0,
              ((consumedSamples - marker.sample) / sampleRate) * 1000,
            )
          }
          marker.run()
        }
      }
      const wakeCapacity = (): void => {
        for (const resolve of capacityWaiters.splice(0)) resolve()
      }
      active.cancelStream = wakeCapacity
      let rejectPlayback!: (error: unknown) => void
      const ended = new Promise<void>((resolve, reject) => {
        active.settle = resolve
        rejectPlayback = reject
      })
      void ended.catch(() => undefined)
      const failPlayback = (error: unknown): void => {
        rejectPlayback(error)
        this.stopCurrent(options.turnId, 'conversation-interrupted')
      }
      node.port.onmessage = (event: MessageEvent<unknown>) => {
        if (this.activePlayback !== active) return
        const message = event.data as { type?: string; samples?: number; sampleOffset?: number }
        if (message.type === 'position') {
          const offset = message.sampleOffset
          if (
            !Number.isInteger(offset) ||
            offset === undefined ||
            offset < consumedSamples ||
            offset > submittedSamples
          ) {
            failPlayback(new Error('Invalid PCM playback position'))
            return
          }
          if (this.pcmClock) {
            if (offset > consumedSamples) this.pcmClock.state = 'playing'
            this.pcmClock.sourceSampleOffset = offset
          }
          consumedSamples = offset
          try {
            runMarkers()
          } catch (error) {
            failPlayback(error)
          }
        } else if (message.type === 'audible') {
          if (this.pcmClock && this.pcmClock.firstAudibleAt === undefined)
            this.pcmClock.firstAudibleAt = Date.now()
        } else if (message.type === 'consumed') {
          bufferedSamples = Math.max(0, bufferedSamples - Number(message.samples ?? 0))
          try {
            runMarkers()
          } catch (error) {
            failPlayback(error)
          }
          wakeCapacity()
        } else if (message.type === 'started' && !started) {
          started = true
          if (this.pcmClock) this.pcmClock.firstOutputAt = Date.now()
          if (this.pcmClock) this.pcmClock.state = 'playing'
          session.startedAt = performance.now()
          active.startedAt = session.startedAt
          audibleReadiness = Promise.resolve()
            .then(() => options.onReady(session))
            .then(() => {
              this.assertOwner(active)
              audibleReady = true
              options.onStarted?.()
              options.onProgress?.(0)
              runMarkers()
            })
            .catch(failPlayback)
        } else if (message.type === 'underrun') {
          if (this.pcmClock) this.pcmClock.state = 'buffering'
          console.warn(`[audio] PCM underrun turnId=${options.turnId}`)
        } else if (message.type === 'ended') {
          if (this.pcmClock) {
            this.pcmClock.state = 'ended'
            this.pcmClock.sourceSampleOffset = submittedSamples
          }
          consumedSamples = submittedSamples
          void audibleReadiness
            .then(() => {
              runMarkers()
              options.onProgress?.(1)
              active.settle?.()
            })
            .catch(failPlayback)
        } else if (message.type === 'error') {
          failPlayback(new Error('PCM processor rejected audio input'))
        }
      }
      const session: PlaybackSession = {
        playbackId: active.playbackId,
        playbackItemId: active.playbackItemId,
        turnId: options.turnId,
        analyser: this.analyser,
        startedAt: performance.now(),
        normalizationReference: 0.12,
        durationMs: 0,
        durationFinal: false,
        getPcmPosition: () =>
          this.pcmClock?.playbackId === active.playbackId ? this.getPcmClock() : null,
      }
      return {
        session,
        append: async (pcm, onAudible) => {
          if (pcm.byteLength === 0 || pcm.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0)
            throw new Error('PCM stream chunk is empty or misaligned')
          const samples = pcm.byteLength / Float32Array.BYTES_PER_ELEMENT
          if (samples > sampleRate * 30 || !new Float32Array(pcm).every(Number.isFinite))
            throw new Error('PCM chunk exceeds its bound or contains non-finite samples')
          this.assertOwner(active)
          if (this.pcmClock && this.pcmClock.firstPcmAt === undefined)
            this.pcmClock.firstPcmAt = Date.now()
          const source = new Float32Array(pcm)
          receivedSamples += samples
          session.durationMs = (receivedSamples / sampleRate) * 1000
          active.durationMs = session.durationMs
          normalizationEnergies.push(...this.collectNormalizationEnergies(source, sampleRate))
          if (normalizationEnergies.length > 512) {
            normalizationEnergies.splice(0, normalizationEnergies.length - 512)
          }
          if (normalizationEnergies.length > 0) {
            const sorted = normalizationEnergies.slice().sort((a, b) => a - b)
            const percentileIndex = Math.min(
              sorted.length - 1,
              Math.max(0, Math.ceil(sorted.length * 0.8) - 1),
            )
            session.normalizationReference = Math.max(0.04, Math.min(0.3, sorted[percentileIndex]))
            active.normalizationReference = session.normalizationReference
          }
          if (onAudible) {
            if (markers.length >= 128) throw new Error('PCM marker queue exceeded its bound')
            markers.push({ sample: submittedSamples, run: onAudible })
          }
          const requiresReframing = samples > maximumBufferedSamples
          const maximumPushSamples = requiresReframing
            ? Math.max(1, Math.floor(maximumBufferedSamples / 2))
            : samples
          for (let offset = 0; offset < samples; offset += maximumPushSamples) {
            const pushSamples = Math.min(maximumPushSamples, samples - offset)
            while (bufferedSamples + pushSamples > maximumBufferedSamples) {
              await new Promise<void>((resolve) => capacityWaiters.push(resolve))
              this.assertOwner(active)
            }
            this.assertOwner(active)
            const pushPcm = requiresReframing
              ? source.slice(offset, offset + pushSamples).buffer
              : pcm
            bufferedSamples += pushSamples
            submittedSamples += pushSamples
            node.port.postMessage({ type: 'push', pcm: pushPcm }, [pushPcm])
          }
        },
        finish: async () => {
          if (!finished) {
            finished = true
            session.durationFinal = true
            node.port.postMessage({ type: 'finish' })
          }
          await ended
          const completion = { playbackId: active.playbackId, turnId: options.turnId }
          this.release(active)
          return completion
        },
        cancel: () => this.stopCurrent(options.turnId, 'conversation-interrupted'),
      }
    } catch (error) {
      this.release(active)
      throw error
    }
  }

  stop(): void {
    const active = this.activePlayback
    if (!active) return
    // Invalidate ownership synchronously, including while decode/onReady is
    // still pending. Every later async continuation fails assertOwner and can
    // never create or start a stale source after interruption.
    this.activePlayback = null
    if (this.pcmClock?.playbackId === active.playbackId && this.pcmClock.state !== 'ended')
      this.pcmClock.state = 'cancelled'
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
    const streamNode = active.streamNode
    active.cancelStream?.()
    active.cancelStream = null
    if (streamNode) {
      streamNode.port.onmessage = null
      streamNode.port.postMessage({ type: 'cancel' })
      try {
        streamNode.disconnect()
      } catch {
        /* already disconnected */
      }
    }
    active.streamNode = null
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
    return Boolean(this.activePlayback?.source || this.activePlayback?.streamNode)
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
      streamNode: null,
      settle: null,
      cancelStream: null,
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
      durationFinal: true,
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
    if (active.streamNode) {
      active.streamNode.port.onmessage = null
      try {
        active.streamNode.disconnect()
      } catch {
        /* already disconnected */
      }
    }
    active.source = null
    active.streamNode = null
    active.settle = null
    active.cancelStream = null
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

  private collectNormalizationEnergies(samples: Float32Array, sampleRate: number): number[] {
    const windowSize = Math.max(64, Math.floor(sampleRate * 0.02))
    const energies: number[] = []
    for (let offset = 0; offset < samples.length; offset += windowSize) {
      const end = Math.min(samples.length, offset + windowSize)
      let sum = 0
      let count = 0
      for (let index = offset; index < end; index += 1) {
        const sample = Number.isFinite(samples[index]) ? samples[index] : 0
        sum += sample * sample
        count += 1
      }
      const rms = count > 0 ? Math.sqrt(sum / count) : 0
      if (rms >= facialSilenceFloor) energies.push(rms)
    }
    return energies
  }

  private ensurePcmWorklet(): Promise<void> {
    this.workletLoaded ??= this.audioCtx.audioWorklet.addModule(
      // Worklet modules must remain self-origin files under the renderer CSP.
      new URL('./pcmStreamWorklet.js?no-inline', import.meta.url).href,
    )
    return this.workletLoaded
  }
}

const facialSilenceFloor = 0.006
