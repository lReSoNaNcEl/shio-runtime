const ASR_SAMPLE_RATE = 16000

function downsampleFloat32(buffer: Float32Array, inSr: number, outSr: number): Float32Array {
  if (outSr === inSr) return buffer.slice()
  const ratio = inSr / outSr
  const newLen = Math.round(buffer.length / ratio)
  const result = new Float32Array(newLen)
  let oRes = 0
  let oBuf = 0
  while (oRes < newLen) {
    const next = Math.round((oRes + 1) * ratio)
    let accum = 0
    let count = 0
    for (let i = oBuf; i < next && i < buffer.length; i++) {
      accum += buffer[i]
      count++
    }
    result[oRes++] = count ? accum / count : 0
    oBuf = next
  }
  return result
}

function floatToInt16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length)
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

function encodeWav(pcm16: Int16Array, sr: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + pcm16.length * 2)
  const view = new DataView(buffer)
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + pcm16.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sr, true)
  view.setUint32(28, sr * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, pcm16.length * 2, true)
  let off = 44
  for (let i = 0; i < pcm16.length; i++, off += 2) view.setInt16(off, pcm16[i], true)
  return buffer
}

// The mic in Electron often captures quietly; Silero VAD on the server then
// rejects the speech as noise. Peak-normalize so the loudest sample reaches
// ~90% full scale, capped to avoid blowing up a near-silent recording.
const NORM_TARGET = 0.9 * 0x7fff
const NORM_MAX_GAIN = 12

function normalizePeak(pcm: Int16Array): void {
  let peak = 0
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i])
    if (a > peak) peak = a
  }
  if (peak === 0) return
  const gain = Math.min(NORM_MAX_GAIN, NORM_TARGET / peak)
  if (gain <= 1) return
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = Math.max(-0x8000, Math.min(0x7fff, Math.round(pcm[i] * gain)))
  }
}

export class MicCapture {
  private stream: MediaStream | null = null
  private audioCtx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private chunks: Int16Array[] = []
  private recording = false

  async start(deviceId?: string): Promise<void> {
    const audioConstraints: MediaTrackConstraints =
      deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false
    })

    this.audioCtx = new AudioContext()
    // After `await getUserMedia` the gesture is consumed, so the context can start
    // suspended — then ScriptProcessorNode.onaudioprocess never fires and we'd
    // capture pure silence. Force it running.
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume()
    }
    this.source = this.audioCtx.createMediaStreamSource(this.stream)
    this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1)
    this.chunks = []
    this.recording = true

    this.processor.onaudioprocess = (e) => {
      if (!this.recording) return
      const input = e.inputBuffer.getChannelData(0)
      const ds = downsampleFloat32(input, this.audioCtx!.sampleRate, ASR_SAMPLE_RATE)
      this.chunks.push(floatToInt16(ds))
    }

    this.source.connect(this.processor)
    this.processor.connect(this.audioCtx.destination)
  }

  stop(): ArrayBuffer {
    this.recording = false

    if (this.processor) {
      this.processor.onaudioprocess = null
      this.processor.disconnect()
      this.processor = null
    }
    if (this.source) {
      this.source.disconnect()
      this.source = null
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
    }
    if (this.audioCtx) {
      void this.audioCtx.close()
      this.audioCtx = null
    }

    return this.consumeChunks()
  }

  /** Returns the audio captured so far without closing the microphone stream. */
  take(): ArrayBuffer {
    if (!this.recording) return encodeWav(new Int16Array(), ASR_SAMPLE_RATE)
    return this.consumeChunks()
  }

  private consumeChunks(): ArrayBuffer {
    let total = 0
    for (const c of this.chunks) total += c.length
    const pcm = new Int16Array(total)
    let off = 0
    for (const c of this.chunks) {
      pcm.set(c, off)
      off += c.length
    }
    this.chunks = []

    normalizePeak(pcm)
    return encodeWav(pcm, ASR_SAMPLE_RATE)
  }

  isRecording(): boolean {
    return this.recording
  }
}
