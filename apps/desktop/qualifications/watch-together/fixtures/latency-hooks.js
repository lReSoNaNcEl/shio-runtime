// Installed before the isolated qualification renderer starts.
;(() => {
  const qa = { active: undefined, context: undefined, bus: undefined }
  window.__watchVoiceLatency = qa
  // Borrow the AudioPlayer context, so microphone-source and speaker-node frame numbers
  // share exactly one sample clock. The real microphone receiver still uses its own graph.
  const analyser = AudioContext.prototype.createAnalyser
  AudioContext.prototype.createAnalyser = function (...args) {
    qa.context ??= this
    return analyser.apply(this, args)
  }
  const WorkletNode = window.AudioWorkletNode
  window.AudioWorkletNode = class extends WorkletNode {
    constructor(context, name, options) {
      super(context, name, options)
      if (name !== 'shio-pcm-stream-player' || !qa.active) return
      const row = qa.active
      if (context !== qa.context) throw new Error('AudioPlayer clock changed')
      const session = { sourceSampleRate: options.processorOptions.sourceSampleRate }
      row.playbacks.push(session)
      let queued = 0
      const post = this.port.postMessage.bind(this.port)
      this.port.postMessage = (data, ...rest) => {
        if (data?.type === 'push' && data.pcm instanceof ArrayBuffer) {
          session.firstPushedFrame ??= Math.round(context.currentTime * context.sampleRate)
          queued += data.pcm.byteLength / Float32Array.BYTES_PER_ELEMENT
          session.pushedSamples = queued
        }
        return post(data, ...rest)
      }
      const meter = new WorkletNode(context, 'shio-qualification-latency-meter', {
        processorOptions: { recordTail: row.detailed },
      })
      const mute = context.createGain()
      mute.gain.value = 0
      this.connect(meter).connect(mute).connect(context.destination)
      meter.port.onmessage = ({ data }) => {
        if (data.first !== undefined) session.firstFrame = data.first
        if (row.detailed && !data.pcm) return
        if (data.pcm) {
          qa.tailPcm = data.pcm
          session.lastFrame = data.last
          session.tailStart = data.start
        }
        this.disconnect(meter)
        meter.disconnect()
        mute.disconnect()
        meter.port.close()
      }
      this.port.addEventListener('message', ({ data }) => {
        if (data.type === 'audible') session.audibleSourceSample = data.sampleOffset
        if (data.type === 'ended' || data.type === 'expired' || data.type === 'error') {
          session.terminal = data.type
          if (row.detailed) meter.port.postMessage('finish')
        }
      })
    }
  }

  const Socket = window.WebSocket
  window.WebSocket = class extends Socket {
    constructor(...args) {
      super(...args)
      if (new URL(args[0]).pathname !== '/ws/asr') return
      this.addEventListener('message', ({ data }) => {
        const row = qa.active
        if (!row || typeof data !== 'string') return
        const msg = JSON.parse(data)
        if (!['partial', 'final', 'speech_started', 'speech_ended'].includes(msg.type)) return
        row.asr.push({
          ...msg,
          observedFrame: Math.round(qa.context.currentTime * qa.context.sampleRate),
        })
      })
    }
  }

  qa.setup = async (moduleUrl) => {
    const ctx = qa.context
    if (!ctx) throw new Error('Expected the AudioPlayer context')
    await ctx.audioWorklet.addModule(moduleUrl)
    qa.bus = ctx.createMediaStreamDestination()
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (!constraints?.audio || constraints.video) return original(constraints)
      return qa.bus.stream.clone()
    }
  }

  qa.takeTail = () =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(new Blob([qa.tailPcm]))
      qa.tailPcm = undefined
    })

  qa.speak = async ({ encoded, detailed }) => {
    const ctx = qa.context
    await ctx.resume()
    const pcm = await ctx.decodeAudioData(
      Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)).buffer,
    )
    if (pcm.numberOfChannels !== 1 || pcm.sampleRate !== ctx.sampleRate)
      throw new Error('Unexpected fixture audio format')
    const audio = pcm.getChannelData(0)
    let last = audio.length - 1
    while (last >= 0 && audio[last] === 0) last--
    if (last < 0) throw new Error('Empty fixture phrase')
    const row = {
      rate: ctx.sampleRate,
      asr: [],
      playbacks: [],
      detailed,
      clockTime: Date.now(),
      clockFrame: Math.round(ctx.currentTime * ctx.sampleRate),
    }
    qa.chatObserver?.disconnect()
    if (detailed) {
      const container = document.querySelector('#chat-messages')
      const userCount = container.querySelectorAll('.message-user').length
      let finalText = ''
      qa.chatObserver = new MutationObserver(() => {
        const user = container.querySelectorAll('.message-user')[userCount]
        const reply = user?.nextElementSibling
        if (!reply?.matches('.message-assistant:not(.message-loading):not([aria-busy="true"])'))
          return
        const text = reply.querySelector('.msg-text')?.textContent
        if (!text || text === finalText) return
        finalText = text
        row.chatFinalFrame = Math.round(ctx.currentTime * ctx.sampleRate)
        row.chatFinalCharacters = text.length
      })
      qa.chatObserver.observe(container, {
        attributes: true,
        attributeFilter: ['aria-busy'],
        subtree: true,
        childList: true,
        characterData: true,
      })
    }
    qa.active = row
    const start = Math.ceil((ctx.currentTime + 0.18) * ctx.sampleRate)
    row.expectedEnd = start + last + 1
    const tap = new WorkletNode(ctx, 'shio-qualification-latency-meter', {
      processorOptions: { until: row.expectedEnd + 128 },
    })
    const source = ctx.createBufferSource()
    source.buffer = pcm
    source.connect(tap).connect(qa.bus)
    tap.port.onmessage = ({ data }) => {
      row.start = data.first
      row.end = data.last + 1
      source.disconnect()
      tap.disconnect()
      tap.port.close()
    }
    source.start(start / ctx.sampleRate, 0, (last + 1) / ctx.sampleRate)
  }
})()
