const fs = require('node:fs')

/** Read-only tap of the real AudioPlayer output, including an already connected graph. */
async function recordAudio(page, filename) {
  await page.exposeFunction('__conversationAudioChunk', (data) =>
    fs.appendFileSync(filename, Buffer.from(data, 'base64')),
  )
  await page.evaluate(() => {
    const analyser = window.__motionAbController.player.analyser
    const tap = analyser.context.createMediaStreamDestination()
    analyser.connect(tap)
    const recorder = new MediaRecorder(tap.stream, { mimeType: 'audio/webm;codecs=opus' })
    let writes = Promise.resolve(),
      failure = null
    recorder.ondataavailable = (event) => {
      writes = writes
        .then(async () => {
          const bytes = new Uint8Array(await event.data.arrayBuffer())
          let binary = ''
          for (let i = 0; i < bytes.length; i += 32768)
            binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
          await window.__conversationAudioChunk(btoa(binary))
        })
        .catch((error) => {
          failure ??= String(error)
        })
    }
    const startedAt = Date.now()
    recorder.start(250)
    window.__stopConversationAudio = async () => {
      if (recorder.state !== 'inactive')
        await new Promise((resolve) => {
          recorder.onstop = resolve
          recorder.stop()
        })
      await writes
      analyser.disconnect(tap)
      for (const track of tap.stream.getTracks()) track.stop()
      if (failure) throw new Error(failure)
      return { startedAt, fileDurationMs: Date.now() - startedAt }
    }
  })
  let stopped
  return () => (stopped ??= page.evaluate(() => window.__stopConversationAudio()))
}
module.exports = { recordAudio }
