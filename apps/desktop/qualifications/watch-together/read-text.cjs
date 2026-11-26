const assert = require('node:assert/strict')
const { randomInt, randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { chromium } = require('playwright-core')

async function writeSilentMicrophone(wav) {
  // A silent virtual device keeps the ordinary live microphone gate in the test.
  const pcmBytes = 48000 * 2
  const buffer = Buffer.alloc(44 + pcmBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + pcmBytes, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(48000, 24)
  buffer.writeUInt32LE(96000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(pcmBytes, 40)
  await fs.writeFile(wav, buffer)
}

function code() {
  const letters = 'ACDEFHJKMNPRTUVWXYZ'
  return (
    Array.from({ length: 3 }, () => letters[randomInt(letters.length)]).join('') +
    '-' +
    randomInt(100, 1000)
  )
}

async function exposeFixtureWindow(application, title) {
  await application.evaluate(async ({ desktopCapturer, nativeImage }, title) => {
    const list = desktopCapturer.getSources.bind(desktopCapturer)
    const windows = () =>
      list({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
    const matching = (await windows()).filter((source) => source.name.includes(title))
    if (matching.length !== 1)
      throw new Error('Expected exactly one native Chrome qualification window')
    const fixtureId = matching[0].id
    const placeholder = nativeImage.createFromBitmap(Buffer.from([40, 40, 40, 255]), {
      width: 1,
      height: 1,
    })
    desktopCapturer.getSources = async ({ thumbnailSize }) => {
      const fixture = (await windows()).find((source) => source.id === fixtureId)
      if (!fixture) return []
      // Never request thumbnails of unrelated windows. The real OS grant uses the original source.
      return thumbnailSize?.width ? [{ ...fixture, thumbnail: placeholder }] : [fixture]
    }
  }, title)
}

async function captureDimensions(page) {
  await page.getByRole('button', { name: 'Предпросмотр', exact: true }).click()
  try {
    await page.waitForFunction(
      () => {
        const video = document.querySelector('.watch-preview-frame')
        return video?.readyState >= 2 && video.videoWidth > 0
      },
      undefined,
      { timeout: 10000 },
    )
    const size = await page.locator('.watch-preview-frame').evaluate((video) => {
      const track = video.srcObject.getVideoTracks()[0]
      const { width, height } = track.getSettings()
      return { width, height, decodedWidth: video.videoWidth, decodedHeight: video.videoHeight }
    })
    assert(size.width > 0 && size.height > 0, 'Expected dimensions from the granted video track')
    return size
  } finally {
    await page.keyboard.press('Escape')
  }
}

async function askAboutScreen(page, question) {
  await page.bringToFront()
  // The text of the previous answer can appear before its turn releases the composer.
  await page
    .getByRole('button', { name: 'Добавить снимок экрана', exact: true, disabled: false })
    .waitFor({ timeout: 90000 })
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true })
  await input.fill(question)
  await page.getByRole('button', { name: 'Отправить', exact: true }).click()
  const user = page.locator('#chat-messages .message-user').filter({ hasText: question })
  await user.waitFor({ timeout: 15000 })
  const reply = user
    .locator('xpath=following-sibling::*[1]')
    .and(page.locator('.message-assistant:not(.message-loading):not([aria-busy="true"])'))
    .locator('.msg-text')
  await reply.waitFor({ timeout: 90000 })
  return (await reply.textContent()) ?? ''
}

function exactCodePosition(text, value) {
  return text.search(new RegExp(`(?<![\\w-])${value}(?![\\w-])`))
}

async function checkReadText(application, page, directory, startWatch) {
  const wide = process.argv.includes('--wide')
  const context = await chromium.launchPersistentContext(path.join(directory, 'fixture-chrome'), {
    channel: 'chrome',
    headless: false,
    viewport: null,
    args: [wide ? '--window-size=2744,1040' : '--window-size=1440,900', '--window-position=0,0'],
  })
  try {
    const fixture = context.pages()[0] ?? (await context.newPage())
    const title = `Board ${randomUUID().slice(0, 8)}`
    const values = new Set()
    while (values.size < 4) values.add(code())
    const [address, topLeft, bottomRight, afterScroll] = values
    const base = 'http://127.0.0.1/board'
    const html = `<!doctype html><meta charset="utf-8"><title>${title}</title>
      <style>
        body { margin: 0; background: #f5f6f7; color: #172028; font: 14px Arial, sans-serif }
        main { box-sizing: border-box; height: 100vh; display: flex; flex-direction: column; padding: 48px; }
        section { margin-top: auto; align-self: flex-end; }
        footer { box-sizing: border-box; height: 75vh; display: flex; padding: 48px; align-items: flex-end; }
      </style>
      <main><h1>Доска задач</h1><p>Заявка: ${topLeft}</p>
      <section>Проверка: ${bottomRight}</section></main><footer><span>Архив: ${afterScroll}</span></footer>`
    await context.route('**/*', (route) =>
      route.request().isNavigationRequest() && route.request().url().split('#')[0] === base
        ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
        : route.abort(),
    )
    await fixture.goto(`${base}#${address}`)
    await fixture.bringToFront()
    const size = await fixture.evaluate(() => [window.outerWidth, window.outerHeight])
    await exposeFixtureWindow(application, title)
    await startWatch(page, title)
    const live = page.locator('.watch-session[data-phase="live"]')
    await live.waitFor({ timeout: 35000 })
    const track = await captureDimensions(page)
    console.log(
      `Readability: Chrome outer ${size.join('×')} CSS px, video track ${track.width}×${track.height}, preview ${track.decodedWidth}×${track.decodedHeight}, body 14 CSS px; Codex CLI gpt-6-luna low`,
    )
    if (wide) {
      assert(
        Math.abs(size[0] - 2744) <= 2 && Math.abs(size[1] - 1040) <= 2,
        'Wide qualification needs a display large enough for a 2744×1040 CSS px Chrome window',
      )
    }
    const below = fixture.locator('footer span')
    assert(
      await below.evaluate((node) => node.getBoundingClientRect().top >= window.innerHeight),
      'The fourth code must begin completely below the fold',
    )
    const first = await askAboutScreen(
      page,
      'Прочитай на моём экране три вещи. В том же порядке назови весь видимый адрес из адресной строки Chrome, код «Заявка» слева вверху и код «Проверка» справа внизу. Сохрани регистр, цифры и дефисы.',
    )
    const visibleAddress = `127.0.0.1/board#${address}`
    const urls = [...first.matchAll(/(?:https?:\/\/)?\b127\.0\.0\.1\/[\w/#?%=&-]+/gu)]
    const url = urls.find(
      (match) => match[0] === visibleAddress || match[0] === `http://${visibleAddress}`,
    )
    const left = exactCodePosition(first, topLeft)
    const right = exactCodePosition(first, bottomRight)
    console.log(
      `Full visible address ${Boolean(url)}, upper left ${left >= 0}, lower right ${right >= 0}`,
    )
    assert(
      url && left >= 0 && right >= 0,
      `Expected ${visibleAddress}, ${topLeft}, ${bottomRight}; received ${first.slice(0, 420)}`,
    )
    assert(
      url.index < left && left < right,
      'Reply must associate the values with the requested locations in order',
    )
    assert.equal(
      exactCodePosition(first, afterScroll),
      -1,
      'The first reply disclosed a code that was below the fold',
    )

    await fixture.bringToFront()
    await fixture.mouse.move(300, 300)
    await fixture.mouse.wheel(0, size[1] * 2)
    await fixture.waitForFunction(
      () => {
        const bounds = document.querySelector('footer span').getBoundingClientRect()
        return bounds.top >= 0 && bounds.bottom <= window.innerHeight
      },
      undefined,
      { timeout: 7000 },
    )
    const second = await askAboutScreen(
      page,
      'Я прокрутил страницу. Какой код теперь виден рядом с надписью «Архив»? Прочитай точно.',
    )
    assert(
      exactCodePosition(second, afterScroll) >= 0,
      `Expected the newly revealed code ${afterScroll}; received ${second.slice(0, 420)}`,
    )
    console.log(
      'The offscreen code was absent in the first reply and read exactly after scrolling.',
    )
  } finally {
    try {
      const stop = page.getByRole('button', { name: 'Остановить трансляцию', exact: true })
      if (await stop.isVisible()) await stop.click()
    } finally {
      await context.close()
    }
  }
}

module.exports = { checkReadText, writeSilentMicrophone }
