const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const processEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(path|systemroot|windir|programfiles|programfiles\(x86\)|programw6432|systemdrive|comspec|temp|tmp)$/i.test(
      key,
    ),
  ),
)

function ownedWorkers(ownerPid) {
  const worker = path.resolve(__dirname, '../../motionbricks/worker.py')
  const rows = JSON.parse(
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `$all = @(Get-CimInstance Win32_Process)
$index = @{}
foreach ($entry in $all) { $index[[int]$entry.ProcessId] = $entry }
@($all | Where-Object {
  if ($_.Name -ne 'python.exe' -or -not $_.CommandLine -or -not $_.CommandLine.Contains($env:SHIO_QA_WORKER)) { return $false }
  $candidate = $_
  for ($depth = 0; $depth -lt 16 -and $candidate; $depth++) {
    if ($candidate.ParentProcessId -eq [int]$env:SHIO_QA_OWNER) { return $true }
    $candidate = $index[[int]$candidate.ParentProcessId]
  }
  return $false
} | Select-Object ProcessId,ParentProcessId) | ConvertTo-Json -Compress`,
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000,
        env: { ...processEnvironment, SHIO_QA_WORKER: worker, SHIO_QA_OWNER: String(ownerPid) },
      },
    ).trim() || '[]',
  )
  const all = Array.isArray(rows) ? rows : [rows]
  return all.filter((row) => !all.some((parent) => parent.ProcessId === row.ParentProcessId))
}

async function qualifyLivingLifecycle({ application, page, report, pause }) {
  const result = { errors: [], provider: report.motionProvider }
  report.livingLifecycle = result
  const workersForThisApp = () => ownedWorkers(application.process().pid)
  try {
    assert.equal(report.motionProvider, 'motionbricks', 'Worker fault fixture is MotionBricks-only')
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
    // Only the exact Python tree whose command names this worktree's worker.
    execFileSync('taskkill.exe', ['/PID', String(workers[0].ProcessId), '/T', '/F'], {
      windowsHide: true,
      timeout: 10000,
      env: processEnvironment,
    })
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
