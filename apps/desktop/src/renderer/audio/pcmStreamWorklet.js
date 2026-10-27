class ShioPcmStreamPlayer extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.sourceSampleRate = Number(options.processorOptions?.sourceSampleRate || sampleRate)
    this.maximumQueuedSamples = Math.ceil(this.sourceSampleRate * 1.5)
    this.receivedSamples = 0
    this.retiredSamples = 0
    this.positionReportCountdown = 0
    this.buffers = []
    this.offset = 0
    this.finished = false
    this.started = false
    this.audible = false
    this.ended = false
    this.sourcePosition = 0
    this.queuedSamples = 0
    this.initialBufferSamples = Math.ceil(this.sourceSampleRate * 0.12)
    this.underrunActive = false
    this.port.onmessage = (event) => {
      if (event.data?.type === 'push' && event.data.pcm instanceof ArrayBuffer) {
        const samples = new Float32Array(event.data.pcm)
        if (
          this.ended ||
          this.finished ||
          !samples.length ||
          this.buffers.length >= 512 ||
          this.queuedSamples + samples.length > this.maximumQueuedSamples ||
          !samples.every(Number.isFinite)
        ) {
          this.buffers.length = 0
          this.ended = true
          this.port.postMessage({ type: 'error', code: 'invalid-or-overflowing-pcm' })
          return
        }
        this.buffers.push(samples)
        this.receivedSamples += samples.length
        this.queuedSamples += samples.length
        this.underrunActive = false
      } else if (event.data?.type === 'finish') {
        this.finished = true
      } else if (event.data?.type === 'cancel') {
        this.buffers.length = 0
        this.finished = true
        this.ended = true
      }
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0]
    if (!output) return true
    output.fill(0)
    if (this.ended) return false
    if (!this.started && !this.finished && this.queuedSamples < this.initialBufferSamples)
      return true
    const ratio = this.sourceSampleRate / sampleRate
    for (let index = 0; index < output.length; index += 1) {
      const current = this.buffers[0]
      if (!current) break
      const sourceIndex = Math.floor(this.sourcePosition)
      if (sourceIndex >= current.length) {
        this.buffers.shift()
        this.queuedSamples = Math.max(0, this.queuedSamples - current.length)
        this.retiredSamples += current.length
        this.port.postMessage({ type: 'consumed', samples: current.length })
        this.sourcePosition -= current.length
        index -= 1
        continue
      }
      const fraction = this.sourcePosition - sourceIndex
      const next = current[sourceIndex + 1] ?? this.buffers[1]?.[0] ?? current[sourceIndex]
      output[index] = current[sourceIndex] + (next - current[sourceIndex]) * fraction
      if (!this.audible && Math.abs(output[index]) > 0.00001) {
        this.audible = true
        this.port.postMessage({ type: 'audible', sampleOffset: this.retiredSamples + sourceIndex })
      }
      this.sourcePosition += ratio
      if (!this.started) {
        this.started = true
        this.port.postMessage({ type: 'started' })
      }
    }
    if (--this.positionReportCountdown <= 0) {
      this.positionReportCountdown = 4
      this.port.postMessage({
        type: 'position',
        sampleOffset: Math.min(
          this.receivedSamples,
          this.retiredSamples + Math.floor(this.sourcePosition),
        ),
      })
    }
    if (this.started && !this.finished && this.buffers.length === 0 && !this.underrunActive) {
      this.underrunActive = true
      this.port.postMessage({ type: 'underrun' })
    }
    if (this.finished && this.buffers.length === 0 && !this.ended) {
      this.ended = true
      this.port.postMessage({ type: 'ended' })
    }
    return true
  }
}

registerProcessor('shio-pcm-stream-player', ShioPcmStreamPlayer)
