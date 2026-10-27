const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const sinks = new WeakMap()
const registered = new WeakSet()

/** Chromium timestamps and real WebAudio, without a synthetic 10-FPS write clock. */
async function recordCanvas(page, filename, { captureFps = 60 } = {}) {
  const sink = { filename, bytes: 0 }
  sinks.set(page, sink)
  if (!registered.has(page))
    await page.exposeFunction('__motionVideoChunk', (data) => {
      const buffer = Buffer.from(data, 'base64')
      const current = sinks.get(page)
      current.bytes += buffer.length
      fs.appendFileSync(current.filename, buffer)
    })
  registered.add(page)
  await page.evaluate(async (captureFps) => {
    const canvas = document.querySelector('canvas')
    if (!canvas) throw new Error('No rendered VRM canvas to record')
    const audio = new AudioContext()
    const destination = audio.createMediaStreamDestination()
    const silence = audio.createOscillator(),
      silentGain = audio.createGain()
    silentGain.gain.value = 0
    silence.connect(silentGain).connect(destination)
    silence.start()
    const stream = canvas.captureStream(captureFps)
    stream.addTrack(destination.stream.getAudioTracks()[0])
    const connect = AudioNode.prototype.connect
    const captured = new Map()
    const capture = (target) => {
      if (!(target instanceof AnalyserNode) || target.context === audio || captured.has(target))
        return
      const tap = target.context.createMediaStreamDestination()
      connect.call(target, tap)
      const source = audio.createMediaStreamSource(tap.stream)
      connect.call(source, destination)
      captured.set(target, { tap, source })
    }
    capture(window.__motionAbController?.player?.analyser)
    AudioNode.prototype.connect = function (target, ...args) {
      const result = connect.call(this, target, ...args)
      capture(target)
      return result
    }
    await audio.resume()
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp8,opus',
      videoBitsPerSecond: 6000000,
    })
    let writes = Promise.resolve(),
      frames = 0,
      callback,
      errors = []
    recorder.onerror = (event) =>
      errors.push(event.error?.message ?? 'MediaRecorder encoding failed')
    const count = () => {
      frames++
      callback = canvas.requestVideoFrameCallback ? null : requestAnimationFrame(count)
    }
    callback = requestAnimationFrame(count)
    recorder.ondataavailable = (event) => {
      writes = writes.then(async () => {
        const bytes = new Uint8Array(await event.data.arrayBuffer())
        let binary = ''
        for (let i = 0; i < bytes.length; i += 32768)
          binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
        await window.__motionVideoChunk(btoa(binary))
      })
    }
    const started = performance.now()
    const startedAt = Date.now()
    recorder.start(250)
    window.__stopMotionVideo = async () => {
      if (recorder.state !== 'inactive')
        await new Promise((resolve) => {
          recorder.onstop = resolve
          recorder.stop()
        })
      await writes
      if (callback) cancelAnimationFrame(callback)
      AudioNode.prototype.connect = connect
      for (const [target, { tap, source }] of captured) {
        target.disconnect(tap)
        source.disconnect()
        for (const track of tap.stream.getTracks()) track.stop()
      }
      for (const track of stream.getTracks()) track.stop()
      silence.stop()
      await audio.close()
      return {
        frames,
        startedAt,
        durationMs: performance.now() - started,
        audioSources: captured.size,
        errors,
      }
    }
  }, captureFps)
  let stopped
  return () =>
    (stopped ??= (async () => {
      const result = await page.evaluate(() => window.__stopMotionVideo())
      const probe = JSON.parse(
        execFileSync(
          'ffprobe',
          [
            '-v',
            'error',
            '-count_frames',
            '-select_streams',
            'v:0',
            '-show_entries',
            'stream=nb_read_frames',
            '-of',
            'json',
            filename,
          ],
          { encoding: 'utf8', windowsHide: true },
        ),
      )
      const frames = Number(probe.streams[0]?.nb_read_frames ?? 0)
      return {
        file: filename,
        requestedFps: captureFps,
        timestampSource: 'Chromium MediaRecorder',
        ...result,
        renderCallbacks: result.frames,
        frames,
        measuredAverageFps: frames / (result.durationMs / 1000),
        bytes: sink.bytes,
        exitCode: 0,
      }
    })())
}
module.exports = { recordCanvas }
