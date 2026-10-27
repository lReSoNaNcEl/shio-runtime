const { execFileSync, spawn } = require('node:child_process')

/** One owned-page recording; ACK every frame and retain only the latest JPEG. */
async function recordPage(page, filename, environment) {
  const executable = execFileSync('where.exe', ['ffmpeg'], {
    encoding: 'utf8',
    windowsHide: true,
    env: environment,
  })
    .trim()
    .split(/\r?\n/)[0]
  const process = spawn(
    executable,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      '-framerate',
      '10',
      '-i',
      'pipe:0',
      '-an',
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      filename,
    ],
    { env: environment, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] },
  )
  const result = { file: filename, frames: 0, droppedWrites: 0, errors: [], fps: 10 }
  process.stderr.on('data', () => undefined)
  process.on('error', (error) => result.errors.push(error.name))
  process.stdin.on('error', (error) => result.errors.push(error.code))
  const exited = new Promise((resolve) => process.once('exit', (code) => resolve(code)))
  const session = await page.context().newCDPSession(page)
  let latest = null
  let writable = true
  process.stdin.on('drain', () => {
    writable = true
  })
  const frame = (event) => {
    latest = Buffer.from(event.data, 'base64')
    void session
      .send('Page.screencastFrameAck', { sessionId: event.sessionId })
      .catch(() => undefined)
  }
  session.on('Page.screencastFrame', frame)
  await session.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 65,
    maxWidth: 1280,
    maxHeight: 850,
    everyNthFrame: 1,
  })
  const timer = setInterval(() => {
    if (!latest) return
    if (!writable) {
      result.droppedWrites++
      return
    }
    writable = process.stdin.write(latest)
    result.frames++
  }, 100)
  const started = Date.now()
  let stopped
  return () =>
    (stopped ??= (async () => {
      clearInterval(timer)
      await session.send('Page.stopScreencast').catch(() => undefined)
      session.off('Page.screencastFrame', frame)
      await session.detach().catch(() => undefined)
      latest = null
      process.stdin.end()
      result.durationMs = Date.now() - started
      let deadline
      try {
        result.exitCode = await Promise.race([
          exited,
          new Promise((resolve) => {
            deadline = setTimeout(() => resolve('timeout'), 10000)
          }),
        ])
      } finally {
        clearTimeout(deadline)
      }
      return result
    })())
}

module.exports = { recordPage }
