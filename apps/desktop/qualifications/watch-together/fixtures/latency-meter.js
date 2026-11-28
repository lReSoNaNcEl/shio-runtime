class LatencyMeter extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.until = options.processorOptions?.until
    this.first = undefined
    this.last = undefined
    // Keep only the end of the detailed answer in memory for an independent ASR check.
    if (options.processorOptions?.recordTail) {
      this.tail = new Int16Array(sampleRate * 6)
      this.port.onmessage = () => {
        if (this.last === undefined) return
        const length = Math.min(this.tail.length, Math.ceil((this.last - this.first + 1) * 0.45))
        const pcm = new Int16Array(length)
        const start = this.last - length + 1
        for (let i = 0; i < length; i++) pcm[i] = this.tail[(start + i) % this.tail.length]
        this.port.postMessage({ last: this.last, start, pcm: pcm.buffer }, [pcm.buffer])
        this.finished = true
      }
    }
  }

  process(inputs, outputs) {
    if (this.finished) return false
    const input = inputs[0]?.[0]
    const output = outputs[0]?.[0]
    if (input?.length) output?.set(input)
    for (let i = 0; i < (output?.length ?? 0); i++) {
      const sample = input?.[i] ?? 0
      const frame = currentFrame + i
      if (this.tail)
        this.tail[frame % this.tail.length] = Math.round(Math.max(-1, Math.min(1, sample)) * 32767)
      if (sample === 0 || !Number.isFinite(sample)) continue
      this.last = frame
      if (this.first !== undefined) continue
      this.first = frame
      if (this.until === undefined) {
        this.port.postMessage({ first: frame })
        if (!this.tail) return false
      }
    }
    if (this.until !== undefined && currentFrame >= this.until) {
      this.port.postMessage({ first: this.first, last: this.last })
      return false
    }
    return true
  }
}
registerProcessor('shio-qualification-latency-meter', LatencyMeter)
