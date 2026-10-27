const assert = require('node:assert/strict')
const fs = require('node:fs')

// Capture the rendered Electron surface without Playwright's document-font wait.
// A stalled font promise must not prevent the actual speech/motion experiment.
async function captureWindow(application, page, filename) {
  const window = await application.browserWindow(page)
  try {
    const png = await window.evaluate(async (target) =>
      (await target.webContents.capturePage()).toPNG().toString('base64'),
    )
    assert(png.length > 0, 'Empty Electron surface capture')
    fs.writeFileSync(filename, Buffer.from(png, 'base64'))
  } finally {
    await window.dispose()
  }
}

module.exports = { captureWindow }
