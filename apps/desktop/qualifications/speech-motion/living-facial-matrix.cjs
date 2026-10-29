const path = require('node:path')
const { recordCanvas } = require('./record-canvas.cjs')

// Component qualification only. These explicit semantic inputs are not LLM
// replies and never participate in ordinary Chat/15-minute acceptance.
async function qualifyLivingFacialMatrix({ page, directory, report, pause }) {
  const result = {
    source: 'existing Avatar Facial owner; explicit debug semantic emotions',
    cases: [],
    errors: [],
    artisticAcceptance: 'PENDING USER REVIEW',
  }
  report.livingFacialMatrix = result
  await page.locator('.app-sidebar').getByRole('button', { name: 'Avatar', exact: true }).click()
  await page.getByRole('button', { name: 'Face', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('canvas'))
  const stopVideo = await recordCanvas(page, path.join(directory, 'facial-matrix-raw.webm'), {
    captureFps: 90,
  })
  await page.evaluate(() => {
    const facial = window.__motionAbController.avatarRuntime.controller.vrmModel.facialRuntime
    window.__facialMatrix = { original: facial.currentEmotionKey, emotion: 'neutral' }
    window.__facialMatrix.timer = setInterval(
      () => facial.applyEmotion(window.__facialMatrix.emotion),
      50,
    )
  })
  try {
    for (const emotion of [
      'neutral',
      'happy',
      'laugh',
      'surprised',
      'shy',
      'thinking',
      'sad',
      'worried',
      'calm',
    ]) {
      await page.evaluate((emotion) => {
        window.__facialMatrix.emotion = emotion
      }, emotion)
      await pause(4000)
      const state = await page.evaluate(() => {
        const facial =
          window.__motionAbController.avatarRuntime.controller.vrmModel.getFacialDebugState()
        return {
          profile: facial.currentProfile,
          acting: facial.facialActing,
          warnings: facial.stuckWarnings,
        }
      })
      await page.screenshot({ path: path.join(directory, `facial-${emotion}.png`) })
      result.cases.push({ emotion, ...state })
      await page.evaluate(() => {
        window.__facialMatrix.emotion = 'neutral'
      })
      await pause(2000)
    }
  } catch (error) {
    result.errors.push(error.message)
  } finally {
    await page.evaluate(() => {
      const state = window.__facialMatrix
      clearInterval(state.timer)
      window.__motionAbController.avatarRuntime.controller.vrmModel.facialRuntime.applyEmotion(
        state.original,
      )
      delete window.__facialMatrix
    })
  }
  result.video = await stopVideo()
  result.technicalPassed =
    result.errors.length === 0 &&
    result.cases.length === 9 &&
    result.cases.every((item) => item.warnings.length === 0)
  console.log(JSON.stringify({ facialMatrix: result.technicalPassed, errors: result.errors }))
}

module.exports = { qualifyLivingFacialMatrix }
