import { vi } from 'vitest'

export class FakeAnalyser {
  fftSize = 0
  connected = false
  connect(): void {
    this.connected = true
  }
  disconnect(): void {
    this.connected = false
  }
}

export class FakeBufferSource {
  buffer: AudioBuffer | null = null
  onended: (() => void) | null = null
  connected = false
  started = false
  stopped = false
  connect(): void {
    this.connected = true
  }
  disconnect(): void {
    this.connected = false
  }
  start(): void {
    this.started = true
  }
  stop(): void {
    this.stopped = true
  }
  end(): void {
    this.onended?.()
  }
}

export class FakeWorkletPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  readonly sent: Array<{ type: string; pcm?: ArrayBuffer }> = []
  postMessage(message: { type: string; pcm?: ArrayBuffer }): void {
    this.sent.push(message)
  }
  emit(message: { type: string; samples?: number; sampleOffset?: number }): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>)
  }
}

export function createAudioBuffer(): AudioBuffer {
  const samples = new Float32Array(72_000).fill(0.1)
  return {
    duration: 1.5,
    sampleRate: 48_000,
    length: samples.length,
    numberOfChannels: 1,
    getChannelData: () => samples,
    copyFromChannel: (destination, _channel, start = 0) => {
      destination.set(samples.subarray(start, start + destination.length))
    },
    copyToChannel: (source, _channel, start = 0) => {
      samples.set(source.subarray(0, samples.length - start), start)
    },
  }
}

// Only WebAudio and interval delivery are fake. Tests drive the production AudioPlayer.
// Each install has fresh objects; the owning suite must dispose players before unstubbing.
export function installAudioEnvironment() {
  const sources: FakeBufferSource[] = []
  const contexts: FakeAudioContext[] = []
  const worklets: FakeAudioWorkletNode[] = []
  const intervals = new Map<number, () => void>()
  let nextInterval = 0

  class FakeAudioContext {
    state = 'running'
    currentTime = 0
    destination = {}
    analyser = new FakeAnalyser()
    audioWorklet = { addModule: vi.fn(async () => undefined) }
    decodeAudioData = vi.fn(async (_buffer: ArrayBuffer) => createAudioBuffer())
    close = vi.fn(async () => {
      this.state = 'closed'
    })
    constructor() {
      contexts.push(this)
    }
    createAnalyser(): AnalyserNode {
      return this.analyser as unknown as AnalyserNode
    }
    createBufferSource(): AudioBufferSourceNode {
      const source = new FakeBufferSource()
      sources.push(source)
      return source as unknown as AudioBufferSourceNode
    }
    async resume(): Promise<void> {
      this.state = 'running'
    }
  }

  class FakeAudioWorkletNode {
    readonly port = new FakeWorkletPort()
    connected = false
    constructor() {
      worklets.push(this)
    }
    connect(): void {
      this.connected = true
    }
    disconnect(): void {
      this.connected = false
    }
  }

  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
  vi.stubGlobal('window', {
    setInterval: (callback: () => void) => {
      const id = ++nextInterval
      intervals.set(id, callback)
      return id
    },
    clearInterval: (id: number) => intervals.delete(id),
  })
  return { sources, contexts, worklets, intervals }
}
