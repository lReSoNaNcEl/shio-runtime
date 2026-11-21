const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const workerCommand = '^/opt/shio-flashmotion/bin/python -B -u worker.py$'
const wsl = (...args) =>
  execFileSync('wsl.exe', ['--distribution', 'ShioFlashMotionV1', '--exec', ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
  }).trim()

function workerFinder() {
  const directory = wsl('wslpath', '-a', path.resolve(__dirname, '../../flashmotion'))
  return () => {
    let pids
    try {
      pids = wsl('pgrep', '-f', workerCommand).split(/\s+/u)
    } catch (error) {
      if (error.status === 1) return []
      throw error
    }
    return pids.filter((pid) => {
      if (!/^\d+$/u.test(pid)) return false
      try {
        return wsl('readlink', `/proc/${pid}/cwd`) === directory
      } catch (error) {
        if (error.status === 1) return false
        throw error
      }
    })
  }
}

async function qualifyLivingLifecycle({ page, report, pause }) {
  const result = { errors: [], provider: report.motionProvider }
  report.livingLifecycle = result
  try {
    assert.equal(report.motionProvider, 'flashmotion')
    const workersForThisApp = workerFinder()
    const ready = async (minimumGeneration) => {
      const deadline = Date.now() + 120000
      let lastState
      while (Date.now() < deadline) {
        const state = await page.evaluate(async () => ({
          motion: await window.api.motion.status(),
          avatar: (await window.api.system.getRuntimeSupportBundle()).avatarRuntime,
          layer:
            window.__motionAbController.avatarRuntime.controller.vrmModel.bodyPlayback.getAppliedMotionLayer(),
        }))
        lastState = state
        if (
          ['ready', 'generating'].includes(state.motion.state) &&
          !state.motion.error &&
          state.motion.modelGeneration >= minimumGeneration &&
          state.motion.session?.modelGeneration === state.motion.modelGeneration &&
          state.avatar.reportFresh &&
          state.avatar.health?.operational &&
          state.avatar.health.motion?.state === 'ready' &&
          !state.avatar.health.motion.error &&
          state.avatar.health.embodimentAvailability?.modelGeneration ===
            state.motion.modelGeneration &&
          state.layer === 'base'
        ) {
          const workerCount = workersForThisApp().length
          assert(workerCount <= 1, 'Lifecycle recovery created multiple owned worker trees')
          if (workerCount === 1) return state
        }
        await pause(200)
      }
      result.readinessFailure = lastState
      throw new Error('Lifecycle recovery readiness timeout')
    }
    const originalGeneration = await page.evaluate(
      async () => (await window.api.motion.status()).modelGeneration,
    )
    await page.evaluate(() => window.__motionAbController.reloadPreviewModel())
    result.reload = await ready(originalGeneration + 1)
    const count = workersForThisApp().length
    assert.equal(count, 1, 'Model reload created multiple motion workers')
    result.reloadWorkerCount = count
    await page.evaluate(async () => {
      if ((await window.api.overlay.isVisible()).visible) await window.api.overlay.toggle()
    })
    await pause(1000)
    await page.evaluate(() => window.api.overlay.toggle())
    await pause(3000)
    const overlays = application.windows().filter((target) => target.url().includes('overlay=1'))
    assert.equal(overlays.length, 1, 'Overlay reconnect duplicated the presentation window')
    const mirrored = await overlays[0].evaluate(() => {
      const body = window.__motionAbController.avatarRuntime.controller.vrmModel.bodyPlayback
      return { presentationOnly: body.presentationOnly, lease: body.mirror?.lease }
    })
    assert(
      mirrored.presentationOnly && mirrored.lease,
      'Reconnected Overlay did not consume a composed pose',
    )
    result.overlayReconnect = { passed: true, workerCount: workersForThisApp().length }
    assert.equal(result.overlayReconnect.workerCount, 1)
    const beforeFault = await ready(result.reload.motion.modelGeneration)
    const workers = workersForThisApp()
    assert.equal(workers.length, 1, 'Fault injection requires one exact owned worker tree')
    wsl('kill', '-TERM', workers[0])
    await pause(1500)
    result.faultObserved = await page.evaluate(async () => ({
      motion: await window.api.motion.status(),
      error:
        window.__motionAbController.avatarRuntime.controller.vrmModel.getBodyMotionDebugState()
          .generated.error,
    }))
    await page.evaluate(() => window.__motionAbController.reloadPreviewModel())
    result.afterFault = await ready(beforeFault.motion.modelGeneration + 1)
    result.recoveredWorkerCount = workersForThisApp().length
    assert.equal(
      result.recoveredWorkerCount,
      1,
      'Worker recovery did not retain one owned worker tree',
    )
    assert.equal(result.afterFault.layer, 'base', 'Recovery replayed a stale gesture')
    result.passed = true
  } catch (error) {
    result.errors.push(error.message)
    result.passed = false
  }
  console.log(JSON.stringify({ livingLifecycle: result.passed, errors: result.errors }))
}

module.exports = { qualifyLivingLifecycle }
