const { _electron: electron } = require('playwright-core')
const path = require('node:path')
const fs = require('node:fs/promises')
const assert = require('node:assert/strict')

;(async () => {
  const output = path.resolve('../../.work/qualification-desktop')
  await fs.mkdir(output, { recursive: true })
  await fs.copyFile('src/renderer/audio/pcmStreamWorklet.js', 'out/renderer/pcmStreamWorklet.js')
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [process.cwd()],
    cwd: path.resolve('../..'),
  })
  const errors = []
  let savedTheme
  try {
    const page = await app.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForTimeout(1500)
    savedTheme = await page.evaluate(async () => (await window.api.config.get()).uiTheme)
    for (const theme of ['dark', 'light']) {
      await page.evaluate(async (theme) => window.api.config.save({ uiTheme: theme }), theme)
      await page.reload()
      await page
        .getByRole('button', { name: /^(Аватар|Avatar)$/ })
        .first()
        .click()
      await page.waitForTimeout(3500)
      assert(await page.locator('canvas').count())
      await page.screenshot({ path: path.join(output, `avatar-${theme}.png`) })
    }
    await page
      .getByRole('button', { name: /^(Чат|Chat)$/ })
      .first()
      .click()
    const existing = await page.evaluate(() => window.api.overlay.isVisible())
    if (!existing.visible) await page.evaluate(() => window.api.overlay.toggle())
    await page.waitForTimeout(3500)
    const overlay = app.windows().find((window) => window !== page)
    assert(overlay, 'Overlay did not open')
    overlay.on('pageerror', (error) => errors.push(error.message))
    assert(await overlay.locator('canvas').count())
    const result = await page.evaluate(async () => {
      const module = await import(new URL('./qualification-speech-2d.mjs', location.href).href)
      return module.run()
    })
    await overlay.screenshot({ path: path.join(output, 'overlay.png') })
    if (!existing.visible) await page.evaluate(() => window.api.overlay.toggle())
    assert.deepEqual(errors, [])
    await fs.writeFile(
      path.join(output, 'report.json'),
      JSON.stringify({ result, errors }, null, 2),
    )
    console.log(JSON.stringify(result))
  } finally {
    const page = app.windows()[0]
    if (savedTheme && page)
      await page.evaluate((theme) => window.api.config.save({ uiTheme: theme }), savedTheme)
    await app.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
