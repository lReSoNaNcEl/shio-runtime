class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.blockSize = Math.round(sampleRate * 0.02)
    this.buffer = new Float32Array(options.processorOptions.maxQueuedFrames)
    this.writeIndex = 0
    this.queued = 0
    this.inputEnd = undefined
    this.nextSend = 0
    this.awaitingAck = false
    this.port.onmessage = () => {
      this.awaitingAck = false
    }
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const channels = input.length
    const samples = input[0].length
    if (this.inputEnd !== currentFrame) this.queued = 0
    this.inputEnd = currentFrame + samples
    for (let index = 0; index < samples; index++) {
      let mono = 0
      for (let channel = 0; channel < channels; channel++) mono += input[channel][index]
      this.buffer[this.writeIndex] = mono / channels
      this.writeIndex = (this.writeIndex + 1) % this.buffer.length
    }
    this.queued = Math.min(this.queued + samples, this.buffer.length)
    if (!this.awaitingAck && this.inputEnd >= this.nextSend && this.queued >= this.blockSize) {
      // One outstanding message; after a renderer stall, catch up at up to 2x real time.
      const length = Math.min(this.queued, 2 * this.blockSize)
      const startFrame = this.inputEnd - this.queued
      const readIndex = (this.writeIndex - this.queued + this.buffer.length) % this.buffer.length
      const first = Math.min(length, this.buffer.length - readIndex)
      const samples = new Float32Array(length)
      samples.set(this.buffer.subarray(readIndex, readIndex + first))
      if (first < length) samples.set(this.buffer.subarray(0, length - first), first)
      this.queued -= length
      this.awaitingAck = true
      this.nextSend = this.inputEnd + this.blockSize
      this.port.postMessage({ startFrame, samples }, [samples.buffer])
    }
    return true
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor)
