const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { connectOwned } = require('./cdp.cjs')
const { installGeometryProbe, loadRigGeometry } = require('../speech-motion/rig-geometry.cjs')
const { recordPage } = require('./record.cjs')

const desktop = path.resolve(__dirname, '../..')
const root = fs.readFileSync(path.join(__dirname, '.latest-root'), 'utf8').trim()
const variant = process.argv.find((value) => value.startsWith('--variant='))?.split('=')[1]
assert(['core8', 'soma60'].includes(variant))
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'snapshot.json')))
const target = snapshot.variants[variant].desktop
const seed = Number(process.argv.find((value) => value.startsWith('--seed='))?.split('=')[1] ?? 17)
const previewMode = process.argv.includes('--preview')
const noVideo = process.argv.includes('--no-video')
const withOverlay = process.argv.includes('--overlay')
const cancelAfterPcm = Number(
  process.argv.find((value) => value.startsWith('--cancel-after-pcm='))?.split('=')[1] ?? 0,
)
assert(Number.isFinite(cancelAfterPcm) && cancelAfterPcm >= 0 && cancelAfterPcm <= 10000)
assert(Number.isSafeInteger(seed) && seed >= 0)
const caseFilter = process.argv
  .find((value) => value.startsWith('--cases='))
  ?.split('=')[1]
  ?.split(',')
const fixtures = [
  { id: 'presence', hint: null, profile: 'presence_speaking' },
  { id: 'greeting', hint: 'greeting', profile: 'greet_wave_soft' },
  { id: 'explain', hint: 'explain', profile: 'explain_one_palm' },
  { id: 'shy', hint: 'shy', profile: 'shy_gather' },
  { id: 'fox-paw', hint: 'fox-paw', profile: 'fox_paw_single' },
  { id: 'peace', hint: 'peace', profile: 'peace_single' },
  { id: 'kiss', hint: 'kiss', profile: 'kiss_air_soft' },
].filter((item) => !caseFilter || caseFilter.includes(item.id))
assert(fixtures.length > 0 && (!caseFilter || fixtures.length === caseFilter.length))
const text =
  'Сейчас я показываю движение и спокойно продолжаю говорить. Мы проверяем плавность тела, положение рук и пальцев, а также движение рта. После жеста я возвращаюсь в спокойную стойку и заканчиваю проверку.'
const output = path.join(root, `run-${variant}-${seed}-${Date.now()}`)
const userData = path.join(output, 'userData')
fs.mkdirSync(userData, { recursive: true })
for (const file of ['run.cjs', 'record.cjs', 'cdp.cjs'])
  fs.copyFileSync(path.join(__dirname, file), path.join(output, `harness-${file}`))
const original = path.join(process.env.APPDATA, 'shio-runtime-desktop')
const config = JSON.parse(fs.readFileSync(path.join(original, 'config.json'), 'utf8'))
assert(config.vrmPath && fs.existsSync(config.vrmPath), 'Configured user VRM missing')
Object.assign(config, {
  setup: { ...config.setup, completed: true },
  uiLocale: 'en',
  uiTheme: 'dark',
  developerModeEnabled: 'true',
  ttsEngine: 'fish-s2-pro',
  ttsLanguage: 'ru',
})
fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify(config))
// The existing admission readiness checks may require credential presence. No remote LLM is called.
for (const relative of ['Local State', 'credentials/llm-credentials.bin']) {
  const file = path.join(original, relative)
  if (fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(path.join(userData, relative)), { recursive: true })
    fs.copyFileSync(file, path.join(userData, relative))
  }
}
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(path|systemroot|windir|userprofile|localappdata|appdata|temp|tmp|programfiles|programfiles\(x86\)|programw6432|systemdrive|comspec|pathext|cuda_path)$/i.test(
      key,
    ),
  ),
)
Object.assign(environment, {
  SHIO_DESKTOP_USER_DATA_ROOT: userData,
  SHIO_MOTION_ROOT: snapshot.variants[variant].motionRoot,
  SHIO_SPEECH_API_URL: 'http://127.0.0.1:8000',
})
const report = {
  variant,
  mode: previewMode ? 'debug-preview-under-real-Fish' : 'conversational-typed-intent',
  seed,
  output,
  startedAt: new Date().toISOString(),
  cases: [],
  errors: [],
  model: JSON.parse(fs.readFileSync(path.join(target, 'motion/research-pins.json'))).motion,
  vrmSha256: createHash('sha256').update(fs.readFileSync(config.vrmPath)).digest('hex'),
  speechFixtureSha256: createHash('sha256').update(text).digest('hex'),
  responseSource: 'fixed typed CharacterResponsePort fixture; no remote LLM',
  audioOutput: 'muted at owned WebContents; real Fish/AudioPlayer/consumed PCM',
  buildHashes: Object.fromEntries(
    ['out/main/index.js', 'out/renderer/index.html'].map((file) => [
      file,
      createHash('sha256')
        .update(fs.readFileSync(path.join(target, file)))
        .digest('hex'),
    ]),
  ),
}
const save = () =>
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const stats = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.length
    ? {
        count: sorted.length,
        min: sorted[0],
        p50: sorted[Math.floor((sorted.length - 1) * 0.5)],
        p95: sorted[Math.floor((sorted.length - 1) * 0.95)],
        p99: sorted[Math.floor((sorted.length - 1) * 0.99)],
        max: sorted.at(-1),
      }
    : null
}
let app
let page
let child
let browser
let activeRecordingStop
let overlayPage
async function waitReady(timeout = 600000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await page.evaluate(async () => {
      const c = window.__motionAbController
      if (!c) return null
      const motion = await window.api.motion.status()
      return { loaded: c.avatarRuntime.isLoaded(), motion, health: c.avatarRuntime.getHealth() }
    })
    if (
      value?.loaded &&
      ['ready', 'generating'].includes(value.motion.state) &&
      value.health.motion?.state === 'ready'
    )
      return value
    if (
      value?.motion.state === 'unavailable' &&
      value.motion.error &&
      value.motion.error !== 'ARDY_CANCELLED'
    )
      throw new Error(value.motion.error)
    await pause(500)
  }
  throw new Error('AB_READY_TIMEOUT')
}
function installObserver() {
  const c = window.__motionAbController
  const a = c.avatarRuntime.controller
  let lastPose = null,
    lastComposedAt = null,
    lastAt = 0,
    lastSpeed = 0,
    lastInference = -1,
    lastPcm = -1,
    raf
  const state = {
    startedAt: performance.now(),
    samples: [],
    frameMs: [],
    angularSteps: [],
    speed: [],
    acceleration: [],
    gestureSpeed: [],
    gestureAcceleration: [],
    inferenceMs: [],
    maxMouth: 0,
    maxBlink: 0,
    blinkClosures: 0,
    firstPcmMs: null,
    firstPreparationMs: null,
    firstStrokeMs: null,
    firstHoldMs: null,
    consumedSamples: 0,
    phases: [],
    errors: [],
    done: false,
    result: null,
  }
  window.__motionAbCase = state
  let blinkClosed = false,
    lastSummary = -1
  let footAnchors
  const tick = (at) => {
    if (lastAt && state.frameMs.length < 30000) state.frameMs.push(at - lastAt)
    const pose = a.getBodyPresentation()
    const debug = a.getDebugState()
    const motion = a.getMotionLibraryDebug()
    const body = a.vrmModel.getBodyMotionDebugState()
    const native = a.vrmModel.bodyPlayback.queue[0]
    if (native && !state.wireEvidence)
      state.wireEvidence = {
        skeleton: native.skeleton,
        fps: native.fps,
        frames: native.rotations.length,
        joints: native.rotations[0].length,
        rootFrames: native.rootPositions.length,
        contactFrames: native.footContacts.length,
      }
    const clock = c.player.getPcmClock()
    if (body.generated.inferenceMs > 0 && body.generated.inferenceMs !== lastInference) {
      state.inferenceMs.push(body.generated.inferenceMs)
      lastInference = body.generated.inferenceMs
    }
    const mouth = Math.max(...Object.values(a.getMouthWeights()))
    const blink = debug.facial.blink
    state.maxMouth = Math.max(state.maxMouth, mouth)
    state.maxBlink = Math.max(state.maxBlink, blink)
    if (blink > 0.8 && !blinkClosed) state.blinkClosures++
    blinkClosed = blink > 0.8
    if (clock?.state === 'playing' && clock.sourceSampleOffset > 0) {
      state.firstPcmMs ??= at - state.startedAt
      state.consumedSamples = Math.max(state.consumedSamples, clock.sourceSampleOffset)
      lastPcm = clock.sourceSampleOffset
    }
    if (pose) {
      const phase = pose.phaseId
      if (pose.profileId === state.expectedProfile) {
        if (phase === 'prepare') state.firstPreparationMs ??= at - state.startedAt
        if (phase === 'stroke') state.firstStrokeMs ??= at - state.startedAt
        if (phase === 'hold') state.firstHoldMs ??= at - state.startedAt
      }
      const composedAt = pose.composedAtMs ?? at
      const compositionDelta = lastComposedAt === null ? 0 : (composedAt - lastComposedAt) / 1000
      let step = 0
      if (lastPose && compositionDelta > 0)
        for (const [name, q] of Object.entries(pose.bones)) {
          if (lastPose[name]) {
            const dot = Math.abs(q.reduce((sum, v, i) => sum + v * lastPose[name][i], 0))
            step = Math.max(step, 2 * Math.acos(Math.min(1, dot)))
          }
        }
      if (compositionDelta > 0 && state.speed.length < 30000) {
        const speed = step / compositionDelta
        state.angularSteps.push(step)
        state.speed.push(speed)
        state.acceleration.push(Math.abs(speed - lastSpeed) / compositionDelta)
        if (pose.profileId === state.expectedProfile && ['stroke', 'hold'].includes(pose.phaseId)) {
          state.gestureSpeed.push(speed)
          state.gestureAcceleration.push(Math.abs(speed - lastSpeed) / compositionDelta)
        }
        lastSpeed = speed
      }
      if (lastComposedAt !== composedAt) {
        lastPose = pose.bones
        lastComposedAt = composedAt
      }
      if (at - lastSummary >= 100 && state.samples.length < 3000) {
        const measure = window.__measureRig(pose)
        const feet = ['leftFoot', 'rightFoot'].map((name) => {
          const node = a.vrmModel.vrm.humanoid.getNormalizedBoneNode(name)
          return node.getWorldPosition(node.position.clone())
        })
        footAnchors ??= feet.map((value) => value.clone())
        state.samples.push({
          atMs: at - state.startedAt,
          profileId: pose.profileId,
          phase,
          outcome: pose.outcome,
          executionId: pose.executionId,
          consumedPcmOffset: clock?.sourceSampleOffset ?? lastPcm,
          pcmState: clock?.state ?? null,
          mouth,
          blink,
          hands: measure,
          jointCorrections: body.generated.safety?.jointCorrections ?? 0,
          unresolvedArmContacts: body.generated.safety?.unresolvedArmContacts ?? 0,
          hipsDeltaY: body.hipsDeltaY,
          footDriftM: Math.max(...feet.map((value, index) => value.distanceTo(footAnchors[index]))),
          sourceFrame: pose.frame,
          queueFrames: body.generated.queueFrames,
          underruns: motion.underruns,
          generatedError: body.generated.error,
          transitionRemaining: body.transitionRemaining,
        })
        lastSummary = at
      }
      const identity = `${pose.profileId}:${pose.executionId}:${phase}:${pose.outcome}`
      if (state.phases.at(-1)?.identity !== identity)
        state.phases.push({
          identity,
          atMs: at - state.startedAt,
          profileId: pose.profileId,
          phase,
          outcome: pose.outcome,
        })
    }
    lastAt = at
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  state.stop = () => cancelAnimationFrame(raf)
}
async function runCase(fixture, index) {
  if (index > 0) {
    await page.evaluate(() => window.__motionAbController.reloadPreviewModel())
    await waitReady()
  }
  await page.evaluate((seed) => {
    const a = window.__motionAbController.avatarRuntime.controller
    a.clearAnimationCooldowns()
    a.previewVariation('presence_poised', seed)
  }, seed)
  await pause(2500)
  await waitReady()
  const finishRecording = noVideo
    ? async () => ({ disabled: true })
    : await recordPage(page, path.join(output, `${fixture.id}.mp4`), environment)
  activeRecordingStop = finishRecording
  await page.evaluate(installObserver)
  await page.evaluate(
    ({ fixture, text, previewMode }) => {
      const c = window.__motionAbController
      const state = window.__motionAbCase
      state.expectedProfile = fixture.profile
      c.characterResponse.createReply = async (turnId, _user, _screen, onEvent) => {
        const intent =
          fixture.hint && !previewMode
            ? { intensity: 'normal', gestureHint: fixture.hint }
            : undefined
        const base = { turnId, requestId: `request:${turnId}`, at: Date.now(), llmRound: 0 }
        if (intent) onEvent?.({ ...base, type: 'embodiment-intent', timing: 'early', intent })
        onEvent?.({ ...base, type: 'text-delta', delta: { text, emotion: 'calm' } })
        onEvent?.({ ...base, type: 'completed' })
        return {
          replyText: `[calm]${text}`,
          displayText: text,
          speechText: text,
          emotionKey: 'calm',
          embodimentIntent: intent,
          segments: [
            {
              id: 'fixed',
              index: 0,
              emotion: 'calm',
              text,
              boundaryAfter: 'sentence',
              targetMaxGapMs: 0,
            },
          ],
        }
      }
      void c.sendText('Фиксированная проверочная реплика.').then(
        (value) => {
          state.result = value
          state.done = true
        },
        (error) => {
          state.errors.push(String(error?.code ?? error?.name ?? 'CASE_FAILED'))
          state.done = true
        },
      )
    },
    { fixture, text, previewMode },
  )
  const captures = []
  let previewRequested = false
  let cancelled = false
  const overlaySamples = []
  const started = Date.now()
  while (Date.now() - started < 100000) {
    const value = await page.evaluate(() => {
      const s = window.__motionAbCase
      const a = window.__motionAbController.avatarRuntime.controller
      return {
        done: s.done,
        firstPcm: s.firstPcmMs,
        phase: a.getBodyPresentation()?.phaseId,
        profile: a.getBodyPresentation()?.profileId,
        outcome: a.getMotionLibraryDebug().outcome,
        status: window.__motionAbController.getState().status,
      }
    })
    if (previewMode && !previewRequested && value.firstPcm !== null) {
      await page.evaluate(
        ({ profile, seed }) =>
          window.__motionAbController.avatarRuntime.controller.previewVariation(profile, seed),
        { profile: fixture.profile, seed },
      )
      previewRequested = true
    }
    if (
      cancelAfterPcm &&
      !cancelled &&
      value.firstPcm !== null &&
      Date.now() - started >= value.firstPcm + cancelAfterPcm
    ) {
      await page.evaluate(() => window.__motionAbController.interruptCurrentResponse('manual-stop'))
      cancelled = true
    }
    if (overlayPage && value.firstPcm !== null && !value.done && overlaySamples.length < 30) {
      overlaySamples.push(
        await overlayPage.evaluate(() => {
          const a = window.__motionAbController.avatarRuntime.controller
          const d = a.vrmModel.getBodyMotionDebugState()
          return {
            mode: d.presentationMode,
            activeExecutions: d.activeExecutionCount,
            poseOwners: d.poseOwnerCount,
            applied: d.appliedPose,
            mouth: Math.max(...Object.values(a.getMouthWeights())),
          }
        }),
      )
    }
    if (
      value.profile === fixture.profile &&
      ['stroke', 'hold'].includes(value.phase) &&
      !captures.includes(value.phase)
    ) {
      captures.push(value.phase)
      await page.screenshot({ path: path.join(output, `${fixture.id}-${value.phase}.png`) })
      if (value.phase === 'hold') {
        await page.evaluate(() => window.__motionAbController.previewCameraPreset('right-hand'))
        await pause(100)
        await page.screenshot({ path: path.join(output, `${fixture.id}-right-hand.png`) })
        await page.evaluate(() => window.__motionAbController.previewCameraPreset('full'))
      }
    }
    if (value.done && Date.now() - started > 5000 && ['idle', 'listening'].includes(value.status))
      break
    await pause(150)
  }
  await pause(1500)
  const data = await page.evaluate(() => {
    const s = window.__motionAbCase
    s.stop()
    delete s.stop
    return s
  })
  const video = await finishRecording()
  activeRecordingStop = undefined
  const frames = stats(data.frameMs),
    speed = stats(data.speed),
    acceleration = stats(data.acceleration)
  const outcome = {
    id: fixture.id,
    cancelled,
    overlaySamples,
    wireEvidence: data.wireEvidence,
    mode: previewMode ? 'debug-preview-under-real-Fish' : 'conversational-typed-intent',
    video,
    profile: fixture.profile,
    hint: fixture.hint,
    seed,
    done: data.done,
    result: data.result,
    firstPcmMs: data.firstPcmMs,
    firstPreparationMs: data.firstPreparationMs,
    firstStrokeMs: data.firstStrokeMs,
    firstHoldMs: data.firstHoldMs,
    consumedSamples: data.consumedSamples,
    maxMouth: data.maxMouth,
    maxBlink: data.maxBlink,
    blinkClosures: data.blinkClosures,
    inferenceMs: stats(data.inferenceMs),
    frameMs: frames,
    angularSpeedRadSec: speed,
    angularAccelerationRadSec2: acceleration,
    gestureSpeedRadSec: stats(data.gestureSpeed),
    gestureAccelerationRadSec2: stats(data.gestureAcceleration),
    angularStepsRad: stats(data.angularSteps),
    phases: data.phases,
    errors: data.errors,
    captures,
    peakUnderruns: Math.max(0, ...data.samples.map((s) => s.underruns)),
    motionErrors: [...new Set(data.samples.map((s) => s.generatedError).filter(Boolean))],
    unresolvedArmContactSamples: data.samples.filter((s) => s.unresolvedArmContacts > 0).length,
    samples: data.samples,
  }
  outcome.realSpeech = data.consumedSamples > 4410 && data.maxMouth > 0.05
  outcome.gestureWitnessed = fixture.hint
    ? data.firstStrokeMs !== null || data.firstHoldMs !== null
    : true
  outcome.passed =
    outcome.realSpeech &&
    outcome.gestureWitnessed &&
    outcome.motionErrors.length === 0 &&
    outcome.peakUnderruns === 0 &&
    data.errors.length === 0 &&
    data.done
  report.cases.push(outcome)
  save()
  console.log(
    JSON.stringify({
      variant,
      seed,
      case: fixture.id,
      passed: outcome.passed,
      realSpeech: outcome.realSpeech,
      gesture: outcome.gestureWitnessed,
      firstPcmMs: outcome.firstPcmMs,
      inferenceP95: outcome.inferenceMs?.p95,
      motionErrors: outcome.motionErrors,
      underruns: outcome.peakUnderruns,
    }),
  )
}
;(async () => {
  save()
  const readyStarted = Date.now()
  try {
    child = spawn(require('electron'), ['--remote-debugging-port=0', target], {
      cwd: target,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    child.on('error', (error) => {
      report.errors.push(`OWNED_PROCESS:${error.name}`)
      save()
    })
    report.ownedElectronPid = child.pid
    save()
    const portFile = path.join(userData, 'DevToolsActivePort')
    for (let attempt = 0; !fs.existsSync(portFile) && attempt < 120; attempt++) await pause(500)
    assert(fs.existsSync(portFile), 'Owned qualification CDP port unavailable')
    const port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0])
    const connected = await connectOwned(port, variant)
    browser = connected.browser
    page = connected.page
    assert(page, 'Owned qualification renderer unavailable')
    app = {
      close: async () => {
        const session = await browser.newBrowserCDPSession()
        await Promise.race([session.send('Browser.close').catch(() => undefined), pause(1500)])
        for (
          let attempt = 0;
          child.exitCode === null && child.signalCode === null && attempt < 60;
          attempt++
        )
          await pause(500)
        if (child.exitCode === null && child.signalCode === null)
          throw new Error('OWNED_PROCESS_DID_NOT_EXIT')
      },
    }
    const session = await browser.newBrowserCDPSession()
    const { windowId } = await session
      .send('Browser.getWindowForTarget', { targetId: undefined })
      .catch(() => ({}))
    if (windowId)
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: { width: 1500, height: 1000, windowState: 'normal' },
      })
    report.audioOutput = 'real audible Fish/AudioPlayer/consumed PCM'
    report.initialPage = { url: page.url(), title: await page.title() }
    report.initialGlobals = await page.evaluate(() => ({
      api: !!window.api,
      controller: !!window.__motionAbController,
    }))
    save()
    page.on('pageerror', (error) => {
      report.errors.push(String(error.name) + ':' + String(error.message).slice(0, 180))
      save()
    })
    await page.waitForFunction(
      () => !!window.__motionAbController && !!window.api?.alive,
      {},
      { timeout: 60000 },
    )
    await page.evaluate(async () => {
      const snapshot = await window.api.alive.snapshot()
      await window.api.alive.updateSettings({
        ...snapshot.settings,
        mode: 'off',
        globallySuspended: true,
        fastBrain: { ...snapshot.settings.fastBrain, enabled: false },
      })
      const plugins = await window.api.plugins.list()
      for (const plugin of plugins) await window.api.plugins.disable(plugin.manifest.id)
    })
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('.app-sidebar button')].find(
        (node) => node.textContent.trim() === 'Avatar',
      )
      if (!button) throw new Error('Avatar navigation missing')
      button.click()
    })
    await page.waitForFunction(() => !!window.__motionAbController.scene)
    await page.evaluate(() => window.__motionAbController.previewCameraPreset('full'))
    report.readiness = await waitReady()
    report.coldReadyMs = Date.now() - readyStarted
    const rig = await loadRigGeometry(config.vrmPath)
    await page.evaluate(installGeometryProbe, rig)
    report.speechHealth = await page.evaluate(() => window.api.health.check())
    if (withOverlay) {
      await page.evaluate(async () => {
        if (!(await window.api.overlay.isVisible()).visible) await window.api.overlay.toggle()
      })
      overlayPage = (await connectOwned(port, variant, true)).page
      await overlayPage.waitForFunction(
        () => window.__motionAbController?.avatarRuntime.isLoaded(),
        undefined,
        { timeout: 60000 },
      )
      report.overlayEnabled = true
    }
    report.harnessHashes = Object.fromEntries(
      ['run.cjs', 'record.cjs', 'cdp.cjs', 'prepare.cjs'].map((file) => [
        file,
        createHash('sha256')
          .update(fs.readFileSync(path.join(__dirname, file)))
          .digest('hex'),
      ]),
    )
    save()
    await page.screenshot({ path: path.join(output, 'ready.png') })
    for (let i = 0; i < fixtures.length; i++) await runCase(fixtures[i], i)
    report.passed = report.cases.every((item) => item.passed) && report.errors.length === 0
  } catch (error) {
    report.errors.push(
      String(error?.name ?? 'ERROR') + ':' + String(error?.message ?? 'AB_FAILED').slice(0, 300),
    )
    if (page)
      await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined)
    report.passed = false
  } finally {
    if (activeRecordingStop)
      await activeRecordingStop().catch((error) =>
        report.errors.push(`RECORDER_CLOSE:${error.name}`),
      )
    save()
    if (app)
      await app.close().catch((error) => report.errors.push('OWNED_CLOSE_FAILED:' + error.name))
    report.finishedAt = new Date().toISOString()
    report.productionUnchanged = Object.entries(snapshot.productionHashes).every(
      ([file, hash]) =>
        createHash('sha256')
          .update(fs.readFileSync(path.join(desktop, file)))
          .digest('hex') === hash,
    )
    save()
    console.log(
      JSON.stringify({
        variant,
        seed,
        passed: report.passed,
        output,
        errors: report.errors,
        productionUnchanged: report.productionUnchanged,
      }),
    )
  }
})().catch((error) => {
  console.error(error.name)
  process.exitCode = 1
})
