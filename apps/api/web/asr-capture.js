class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.samples = []; this.phase = 0 }
  process(inputs) {
    const source = inputs[0]?.[0]
    if (!source) return true
    const step = sampleRate / 16000
    for (; this.phase < source.length; this.phase += step) {
      this.samples.push(Math.round(Math.max(-1, Math.min(1, source[Math.floor(this.phase)])) * 32767))
      if (this.samples.length === 320) { const pcm = Int16Array.from(this.samples); this.port.postMessage(pcm.buffer, [pcm.buffer]); this.samples.length = 0 }
    }
    this.phase -= source.length
    return true
  }
}
registerProcessor('shio-asr-capture', Capture)
