class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(1024)
    this.offset = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const channels = input.length
    const samples = input[0].length
    for (let index = 0; index < samples; index++) {
      let mono = 0
      for (let channel = 0; channel < channels; channel++) mono += input[channel][index]
      this.buffer[this.offset++] = mono / channels
      if (this.offset === this.buffer.length) {
        const frame = this.buffer
        this.port.postMessage(frame, [frame.buffer])
        this.buffer = new Float32Array(1024)
        this.offset = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor)
