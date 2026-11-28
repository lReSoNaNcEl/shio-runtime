const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { _electron, chromium } = require('playwright-core')
const { writePlaybackFixture } = require('./playback-fixture.cjs')
const { writeWatchProfile } = require('./profile.cjs')

const desktop = path.resolve(__dirname, '../..')
const replay = 'https://www.youtube.com/watch?v=7zPUZphM7kM'
const durationMs = process.argv.includes('--smoke') ? 15_000 : 300_000
const embeddedId = process.argv.find((arg) => arg.startsWith('--youtube-embed='))?.slice(16)
const embeddedTitle = 'Shio YouTube qualification'

async function openEmbeddedPlayer(page, server, videoId) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' })
  const frame = await (await page.locator('iframe').elementHandle()).contentFrame()
  assert(frame, 'YouTube player frame unavailable')
  await frame.waitForURL(`https://www.youtube.com/embed/${videoId}**`)
  return frame
}

async function run() {
  assert.equal(
    process.platform,
    'win32',
    'This qualification requires Windows window audio capture',
  )
  const output = path.join(desktop, 'out')
  const directory = await fs.mkdtemp(path.join(output, 'watch-playback-'))
  let browser
  let app
  let server
  try {
    if (embeddedId !== undefined) {
      assert.match(embeddedId, /^[A-Za-z0-9_-]{11}$/u, 'Expected a YouTube video ID')
      assert(!process.argv.includes('--fixture'), 'Choose a single playback source')
    }
    await writeWatchProfile(directory, {
      uiTheme: process.argv.includes('--dark') ? 'dark' : 'light',
      speechVolumePercent: 35,
    })
    browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      ignoreDefaultArgs: ['--mute-audio'],
      args: ['--autoplay-policy=no-user-gesture-required', '--window-size=1600,1000'],
    })
    const videoPage = await browser.newPage({ viewport: null })
    const fixture = process.argv.includes('--fixture')
      ? await writePlaybackFixture(directory)
      : undefined
    let mediaPage = videoPage
    if (embeddedId) {
      server = http.createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
          `<!doctype html><title>${embeddedTitle}</title>
          <style>html,body{height:100%;margin:0;background:black}iframe{border:0;width:100%;height:100%;display:block}</style>
          <iframe title="YouTube" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; fullscreen" src="https://www.youtube.com/embed/${embeddedId}?autoplay=1"></iframe>`,
        )
      })
      mediaPage = await openEmbeddedPlayer(videoPage, server, embeddedId)
    } else {
      await videoPage.goto(fixture?.url ?? replay, { waitUntil: 'domcontentloaded' })
    }
    if (fixture) {
      assert.equal(await videoPage.title(), fixture.title)
      await videoPage.bringToFront()
      await videoPage.locator('#track').waitFor()
    }
    const video = mediaPage.locator('video.html5-main-video').first()
    if (!fixture) {
      await video.waitFor({ state: 'attached' })
      await video.evaluate(async (media) => {
        media.volume = 0.25
        media.muted = false
        await media.play()
      })
      const skipAd = mediaPage.getByRole('button', {
        name: /^(skip( ad)?|пропустить( рекламу)?)$/iu,
      })
      const liveVideo = mediaPage.waitForFunction(
        (seconds) => {
          const media = document.querySelector('video.html5-main-video')
          return media?.duration > seconds + 1 && media.currentTime > 1 && !media.paused
        },
        durationMs / 1000,
        { timeout: 90_000 },
      )
      const skip = skipAd
        .first()
        .click({ timeout: 12_000 })
        .catch(() => undefined)
      await Promise.race([liveVideo, skip])
      await liveVideo
      await video.evaluate((media) => media.pause())
    }

    const env = { ...process.env, SHIO_DESKTOP_USER_DATA_ROOT: directory, SHIO_MOTION_ENABLED: '0' }
    delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({
      executablePath: require('electron'),
      cwd: desktop,
      args: [desktop],
      env,
    })
    const page = await app.firstWindow()
    await page.addInitScript(() => {
      const evidence = {
        microphoneRequests: 0,
        captures: [],
        asr: 0,
        partials: 0,
        audible: 0,
        ended: 0,
        asrDuringPlayback: 0,
        playing: false,
      }
      window.watchQualification = evidence
      const mic = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = (options) => {
        if (options?.audio) evidence.microphoneRequests++
        return mic(options)
      }
      const display = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getDisplayMedia = async (options) => {
        const stream = await display(options)
        evidence.captures.push({
          video: stream.getVideoTracks()[0]?.getSettings(),
          audio: stream.getAudioTracks().length,
        })
        return stream
      }
      const Socket = window.WebSocket
      window.WebSocket = class extends Socket {
        constructor(...args) {
          super(...args)
          if (new URL(args[0]).pathname !== '/ws/asr') return
          this.addEventListener('message', ({ data }) => {
            if (typeof data !== 'string') return
            const event = JSON.parse(data)
            if (event.type === 'partial') evidence.partials++
            if (event.type === 'final' && event.text.trim()) {
              evidence.asr++
              if (evidence.playing) evidence.asrDuringPlayback++
            }
          })
        }
      }
      const WorkletNode = window.AudioWorkletNode
      window.AudioWorkletNode = class extends WorkletNode {
        constructor(context, name, options) {
          super(context, name, options)
          if (name !== 'shio-pcm-stream-player') return
          this.port.addEventListener('message', ({ data }) => {
            if (data.type === 'audible') {
              evidence.audible++
              evidence.playing = true
            }
            if (['ended', 'expired', 'error'].includes(data.type)) {
              evidence.playing = false
              if (data.type === 'ended') evidence.ended++
            }
          })
        }
      }
    })
    await page.reload()
    await page.getByRole('button', { name: 'Трансляция', exact: true }).click()
    const source = embeddedId
      ? new RegExp(embeddedTitle, 'u')
      : fixture
        ? /Shio playback fixture/iu
        : /ДАХАК нашел ГЛАВНУЮ ИМБУ/iu
    await page.getByRole('button', { name: source }).click()
    await page.getByRole('button', { name: 'Начать трансляцию', exact: true }).click()
    const stop = page.getByRole('button', { name: 'Остановить трансляцию', exact: true })
    await stop.waitFor()
    assert.equal(await page.getByRole('switch', { name: 'Микрофон трансляции' }).isChecked(), false)
    await page.getByText('Звук выбранного приложения', { exact: true }).waitFor()
    const preview = page.getByRole('button', { name: 'Предпросмотр' })
    await preview.click()
    const previewSize = await page
      .getByLabel('Текущее изображение трансляции')
      .evaluate((media) =>
        media.readyState >= 2
          ? [media.videoWidth, media.videoHeight]
          : new Promise((resolve) =>
              media.addEventListener(
                'loadeddata',
                () => resolve([media.videoWidth, media.videoHeight]),
                { once: true },
              ),
            ),
      )
    await page.keyboard.press('Escape')
    await videoPage.bringToFront()
    const startPosition = fixture
      ? await videoPage.evaluate(() => {
          window.startFixture()
          return window.fixturePosition()
        })
      : await video.evaluate(async (media) => {
          await media.play()
          return media.currentTime
        })
    const sourcePosition = () =>
      fixture
        ? videoPage.evaluate(() => window.fixturePosition())
        : video.evaluate((media) => media.currentTime)
    const start = Date.now()
    const deadline = start + durationMs + (embeddedId ? 30_000 : 0)
    const counts = () => page.evaluate(() => window.watchQualification)
    console.log(JSON.stringify({ stage: 'started', previewSize, startPosition, durationMs }))
    let position = startPosition
    let nextReportAt = start + 30_000
    let inlineResumes = 0
    while (Date.now() < deadline && (position - startPosition) * 1000 < durationMs) {
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(embeddedId ? 1500 : 30_000, Math.max(0, deadline - Date.now())),
        ),
      )
      assert(await stop.isVisible(), 'Watch session ended before the qualification finished')
      const source = fixture
        ? undefined
        : await video.evaluate((media) => ({
            duration: media.duration,
            paused: media.paused,
            ended: media.ended,
            readyState: media.readyState,
          }))
      if (
        embeddedId &&
        source?.paused &&
        !source.ended &&
        source.readyState >= 2 &&
        inlineResumes < 3
      ) {
        inlineResumes++
        await video.evaluate((media) => {
          void media.play().catch(() => undefined)
        })
      }
      position = await sourcePosition()
      const now = Date.now()
      if (now < nextReportAt && now < deadline && (position - startPosition) * 1000 < durationMs)
        continue
      nextReportAt = now + 30_000
      console.log(
        JSON.stringify({
          seconds: Math.round((now - start) / 1000),
          position: Math.round(position),
          source: source ?? 'fixture',
          ...(await counts()),
        }),
      )
    }
    const evidence = await counts()
    position = await sourcePosition()
    const lines = await page
      .locator('#chat-messages .message-assistant .msg-text')
      .allTextContents()
    if (!fixture) await video.evaluate((media) => media.pause())
    await page.bringToFront()
    await stop.click()
    await stop.waitFor({ state: 'hidden' })
    console.log(
      JSON.stringify({
        stage: 'finished',
        elapsedMs: Date.now() - start,
        position,
        startPosition,
        inlineResumes,
        lines,
        ...evidence,
      }),
    )
    assert(
      position - startPosition >= (durationMs / 1000) * 0.95,
      'Video did not play through the qualification',
    )
    assert.equal(evidence.microphoneRequests, 0, 'Watch requested a microphone')
    assert.equal(evidence.captures[0].audio, 1)
    if (durationMs === 300_000) {
      assert(evidence.asr > 0, 'No source speech was recognized')
      assert(
        evidence.audible >= 2 && evidence.ended >= 2,
        'Fewer than two comments reached AudioPlayer completion',
      )
    }
  } finally {
    await app?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    if (server?.listening) await new Promise((resolve) => server.close(resolve))
    if (path.dirname(path.resolve(directory)) === output)
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
