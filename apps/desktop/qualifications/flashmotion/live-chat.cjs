const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { setTimeout: pause } = require('node:timers/promises')
const { _electron } = require('playwright-core')
const { recordCanvas } = require('../speech-motion/record-canvas.cjs')
const { installGeometryProbe, loadRigGeometry } = require('../speech-motion/rig-geometry.cjs')

const desktop = path.resolve(__dirname, '../..')
const root = path.resolve(desktop, '../..')
const destination = path.join(root, 'tmp', 'flashmotion', `chat-${Date.now()}`)
const profile = path.join(destination, 'profile')
const original = path.join(process.env.APPDATA, 'shio-runtime-desktop')
const report = { state: 'starting', samples: [], errors: [] }
const contextPrompt = {
  reflection:
    'Сегодня я сомневаюсь, что смогу закончить свой проект. Всё идёт медленно, и я устал. Давай спокойно подумаем, как к этому отнестись. Ответь по-русски, примерно пятью связными предложениями.',
  celebration:
    'У меня наконец получилось! После долгих попыток первая версия проекта заработала, и друзья уже тестируют её. Раздели со мной эту радость и расскажи, что тебе хочется узнать. Ответь по-русски, примерно пятью связными предложениями.',
}
const contextCase = process.argv.find((argument) => argument.startsWith('--context='))?.slice(10)
const actionCase = process.argv.find((argument) => argument.startsWith('--action='))?.slice(9)
const actionSeed = process.argv.find((argument) => argument.startsWith('--seed='))?.slice(7)
const actionPrompts = {
  wave: 'Слушай, а можешь помахать рукой в кадре?',
  turn: 'А можешь покрутиться в кадре?',
  dance: 'А ты можешь потанцевать в кадре?',
  'dance-smooth': 'Можешь станцевать в кадре что-нибудь плавное и спокойное?',
}
function writeReport() {
  fs.writeFileSync(path.join(destination, 'report.json'), JSON.stringify(report, null, 2))
}

async function status(page) {
  return page.evaluate(async () => {
    const health = await window.api.system.getRuntimeSupportBundle()
    return {
      worker: await window.api.motion.status(),
      workerHealth: health.motionWorker,
      avatar: health.avatarRuntime?.health,
    }
  })
}

function runningWorkers() {
  try {
    const output = execFileSync(
      'wsl.exe',
      [
        '--distribution',
        'ShioFlashMotionV1',
        '--exec',
        'pgrep',
        '-f',
        '^/opt/shio-flashmotion/bin/python -B -u worker.py$',
      ],
      { timeout: 5000, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    return output
      .trim()
      .split(/\s+/u)
      .filter((value) => /^\d+$/u.test(value))
  } catch (failure) {
    if (failure.status === 1) return []
    throw failure
  }
}

function handProfileReached(id, right) {
  return id === 'peace_single'
    ? right.indexMiddleOpeningDeg >= 12 &&
        right.indexMiddleOpeningDeg <= 45 &&
        right.indexMiddleSignedSpread > 0 &&
        right.ringFlexDeg > right.indexFlexDeg + 15
    : right.palmForward >= 0.55 && right.indexFlexDeg < 35 && right.middleFlexDeg < 35
}

async function inspectHandProfiles(page, overlay) {
  await page.locator('.app-sidebar').getByRole('button', { name: 'Avatar', exact: true }).click()
  await page.getByRole('button', { name: 'Full body', exact: true }).click()
  const library = page.locator('.animation-library')
  const seedField = page.getByRole('textbox', { name: 'Fixed variation seed', exact: true })
  if (!(await seedField.isVisible()))
    await page.getByRole('button', { name: 'Developer details', exact: true }).click()
  report.handProfiles = []
  for (const [id, label] of [
    ['peace_single', 'Cute peace sign'],
    ['reassure_palm', 'Reassuring palm'],
  ]) {
    await library.getByRole('searchbox').fill(label)
    await library.getByText(label, { exact: true }).click()
    if (actionSeed !== undefined) {
      assert(/^\d{1,10}$/u.test(actionSeed), 'Invalid preview seed')
      const seed = page.getByRole('textbox', { name: 'Fixed variation seed', exact: true })
      if (!(await seed.isVisible()))
        await page.getByRole('button', { name: 'Developer details', exact: true }).click()
      await seed.fill(actionSeed)
      await seed.press('Tab')
    }
    await seedField.fill('42')
    await seedField.press('Tab')
    await page.getByRole('button', { name: 'Generate variation', exact: true }).click()
    const observed = []
    let qualifiedPhase
    const deadline = Date.now() + 12_000
    while (Date.now() < deadline) {
      const value = await overlay.evaluate(async (id) => {
        const pose = await window.overlayApi.avatarBody.get()
        if (pose?.profileId !== id || !['stroke', 'hold'].includes(pose.phaseId)) return null
        return { frame: pose.frame, phase: pose.phaseId, geometry: window.__measureRig(pose) }
      }, id)
      if (value && value.frame !== observed.at(-1)?.frame) observed.push(value)
      if (value && !qualifiedPhase && handProfileReached(id, value.geometry.right)) {
        qualifiedPhase = value
        await Promise.all([
          overlay.screenshot({ path: path.join(destination, `${id}-overlay.png`) }),
          page.screenshot({ path: path.join(destination, `${id}-preview.png`) }),
        ])
      }
      if (observed.length >= 16) break
      await pause(65)
    }
    report.handProfiles.push({
      id,
      passed: Boolean(qualifiedPhase),
      qualifiedPhase,
      observed,
      status: await status(page),
    })
    writeReport()
  }
}

async function observeMotion(overlay) {
  await overlay.evaluate(() => {
    let previous
    const channels = {
      fingers: { pattern: /^(left|right)(Thumb|Index|Middle|Ring|Little)/u, samples: [] },
      wrists: { pattern: /^(left|right)Hand$/u, samples: [] },
      arms: { pattern: /^(left|right)(Shoulder|UpperArm|LowerArm)$/u, samples: [] },
      torso: { pattern: /^(hips|spine|chest|upperChest)$/u, samples: [] },
    }
    const stop = window.overlayApi.avatarBody.onUpdated((pose) => {
      if (!pose?.bones) {
        previous = undefined
        return
      }
      const dt = (pose.composedAtMs - previous?.composedAtMs) / 1000
      if (dt > 0 && dt < 0.15 && pose.lease?.sessionId === previous?.lease?.sessionId) {
        for (const { pattern, samples } of Object.values(channels)) {
          let step = 0
          for (const [name, rotation] of Object.entries(pose.bones)) {
            const origin = previous.bones[name]
            if (!origin || !pattern.test(name)) continue
            const dot = Math.abs(
              rotation.reduce((value, component, i) => value + component * origin[i], 0),
            )
            step = Math.max(step, (360 / Math.PI) * Math.acos(Math.min(dot, 1)))
          }
          samples.push({ step, speed: step / dt })
        }
      }
      previous = pose
    })
    window.__motionStatistics = () => {
      stop()
      return Object.fromEntries(
        Object.entries(channels).map(([name, { samples }]) => {
          const speeds = samples.map(({ speed }) => speed).sort((a, b) => a - b)
          return [
            name,
            {
              observations: samples.length,
              p95DegreesPerSecond: speeds[Math.ceil(0.95 * speeds.length) - 1],
              maxDegreesPerSecond: speeds.at(-1),
              maxDegreesPerUpdate: Math.max(0, ...samples.map(({ step }) => step)),
            },
          ]
        }),
      )
    }
  })
  return () => overlay.evaluate(() => window.__motionStatistics())
}

async function interruptPlayback(page, before) {
  await page.getByRole('button', { name: "Stop Shio's response", exact: true }).click()
  const samples = []
  let workerGeneration = before
  const stopDeadline = Date.now() + 5000
  while (Date.now() < stopDeadline) {
    const { avatar, worker } = await status(page)
    if (avatar?.speech?.active === false) {
      samples.push(avatar.motion?.flashMotion?.appliedSpeechSample ?? null)
      workerGeneration = worker.modelGeneration
    }
    await pause(65)
  }
  assert(samples.length > 0, 'AudioPlayer remained active after Stop')
  const staleSpeechFrames = samples.filter((sample) => sample !== null).length
  assert.equal(staleSpeechFrames, 0, 'A stopped speech window remained active')
  return {
    inactivitySamples: samples.length,
    staleSpeechFrames,
    workerGenerationBefore: before,
    workerGenerationAfter: workerGeneration,
  }
}

async function inspectAction(page, overlay, action) {
  const preview = action.endsWith('-preview')
  const isDance = action.startsWith('dance')
  const physicalAction = preview || action === 'turn' || isDance
  if (preview) {
    await page.locator('.app-sidebar').getByRole('button', { name: 'Avatar', exact: true }).click()
    await page.getByRole('button', { name: 'Full body', exact: true }).click()
    const library = page.locator('.animation-library')
    const label = isDance ? 'Dance in place' : 'Full body turn'
    await library.getByRole('searchbox').fill(label)
    await library.getByText(label, { exact: true }).click()
    await page.getByRole('button', { name: 'Generate variation', exact: true }).click()
  } else {
    await page.evaluate(() => {
      window.__actionIntents = []
      window.api.llm.onReplyStreamEvent((event) => {
        if (event.type === 'embodiment-intent') window.__actionIntents.push(event.intent)
      })
    })
    await page.locator('.app-sidebar').getByRole('button', { name: 'Chat', exact: true }).click()
    const input = page.getByRole('textbox', { name: 'Message', exact: true })
    await input.fill(actionPrompts[action])
    await input.press('Enter')
  }
  const samples = []
  report.action = {
    action,
    samples,
    ...(preview && actionSeed ? { seed: Number(actionSeed) } : {}),
  }
  const deadline = Date.now() + (preview ? 32_000 : 95_000)
  const startedAt = Date.now()
  let endedAt
  let recordedWave = false
  while (Date.now() < deadline) {
    const current = await status(page)
    const pose = await overlay.evaluate(async () => {
      const value = await window.overlayApi.avatarBody.get()
      if (!value) return null
      return {
        profile: value.profileId,
        phase: value.phaseId,
        outcome: value.outcome,
        composedAtMs: value.composedAtMs,
        stage: value.stage?.continuousHeading,
        rightHand: window.__measureRig(value).right,
        armPose: ['turn_in_place', 'dance_in_place'].includes(value.profileId)
          ? [
              value.bones.leftUpperArm,
              value.bones.leftLowerArm,
              value.bones.rightUpperArm,
              value.bones.rightLowerArm,
            ]
          : undefined,
        torsoPose:
          value.profileId === 'dance_in_place'
            ? [value.bones.spine, value.bones.chest, value.bones.upperChest].filter(Boolean)
            : undefined,
        executionId: value.executionId,
      }
    })
    samples.push({
      elapsedMs: Date.now() - startedAt,
      ...pose,
      speech: current.avatar?.speech?.active,
      physical: current.avatar?.motion?.physical,
      safety: current.avatar?.motion?.safety,
      errors: [current.worker.error, current.avatar?.motion?.error].filter(Boolean),
    })
    if (
      action === 'wave' &&
      !recordedWave &&
      pose?.profile?.startsWith('greet_wave_') &&
      pose.phase === 'stroke' &&
      pose.rightHand.wristHeightTorso > 0.9
    ) {
      recordedWave = true
      await overlay.screenshot({ path: path.join(destination, 'wave-overlay.png') })
    }
    if (samples.length % 20 === 0) writeReport()
    if (physicalAction && current.avatar?.motion?.physical?.outcome) break
    if (physicalAction && current.avatar?.motion?.error?.startsWith('MOTION_DANCE_')) break
    if (samples.some((sample) => sample.speech) && !current.avatar?.speech?.active)
      endedAt ??= Date.now()
    if (endedAt && Date.now() - endedAt >= (physicalAction ? 28_000 : 4000)) break
    await pause(70)
  }
  if (preview) return report.action
  const intents = await page.evaluate(() => window.__actionIntents)
  const description = await page
    .locator('.message-assistant:not(.message-loading) .msg-text')
    .last()
    .evaluate((element) => Boolean(element.querySelector('em')))
    .catch(() => null)
  return { action, intents, samples, hasItalicDescription: description }
}

function jointTravel(samples, profile, channel) {
  const poses = samples
    .filter((sample) => sample.profile === profile && sample.phase === 'stroke')
    .map((sample) => sample[channel])
    .filter((pose) => pose?.every(Boolean))
  assert(poses.length > 1 && poses[0].length, `No poses for ${channel}`)
  return poses[0].map((joint, index) =>
    Math.max(
      ...poses.map((pose) => {
        const dot = joint.reduce(
          (value, component, axis) => value + component * pose[index][axis],
          0,
        )
        return (Math.acos(Math.min(1, Math.abs(dot))) * 360) / Math.PI
      }),
    ),
  )
}

function verifyRequestedAction(result) {
  const { action, samples, intents } = result
  if (action.startsWith('dance')) {
    if (!action.endsWith('-preview')) {
      const plan = intents.find((intent) => intent.bodyAction?.action === 'dance-in-place')
      assert(plan, 'No dance in the Chat plan')
      if (action === 'dance-smooth') assert.equal(plan.bodyAction.style, 'smooth')
    }
    const physical = samples.filter(({ physical }) => physical?.generator === 'flashmotion')
    const last = physical.at(-1)?.physical
    assert.equal(last?.outcome, 'completed', 'The dance did not complete')
    assert(
      last.steps >= 2 && last.support === 'double',
      'The dance needs steps and a stable landing',
    )
    assert(last.maxSupportDriftM < 0.003, 'A planted foot slid in the dance')
    assert(
      samples.some(({ profile }) => profile === 'dance_in_place'),
      'No dance in Overlay',
    )
    result.physicalDurationMs = physical.at(-1).elapsedMs - physical[0].elapsedMs
    result.armTravelDeg = jointTravel(samples, 'dance_in_place', 'armPose')
    result.torsoTravelDeg = jointTravel(samples, 'dance_in_place', 'torsoPose')
    assert(
      result.armTravelDeg.some((angle) => angle > 12),
      'Arms barely moved in the dance',
    )
    return
  }
  if (action === 'wave') {
    assert(
      intents.some((intent) => intent.gestureHint === 'greeting'),
      'No greeting in the Chat plan',
    )
    const wave = samples.filter((sample) => sample.profile?.startsWith('greet_wave_'))
    assert(
      wave.some((sample) => sample.outcome === 'completed'),
      'No completed wave in Overlay',
    )
    const active = wave.filter(
      (sample) => sample.phase === 'stroke' && sample.rightHand.palmForward >= 0.55,
    )
    assert(
      active.some((sample) => sample.rightHand.wristHeightTorso > 0.9),
      'The palm did not lift',
    )
    const side = active.map((sample) => sample.rightHand.wristSideTorso)
    assert(Math.max(...side) - Math.min(...side) > 0.08, 'No lateral wave stroke')
    return
  }
  if (action === 'turn')
    assert(
      intents.some((intent) => intent.bodyAction?.action === 'turn-in-place'),
      'No turn in the Chat plan',
    )
  const physicalSamples = samples.filter((sample) => sample.physical)
  const last = physicalSamples.at(-1)?.physical
  assert.equal(last?.outcome, 'completed', 'The turn did not complete')
  assert(
    Math.abs(Math.abs(last.actionHeading) - 2 * Math.PI) < 0.002,
    'Heading did not complete one revolution',
  )
  assert(last.maxSupportDriftM < 0.003, 'The planted foot slid')
  assert(
    last.steps > 0 && last.support === 'double',
    'The turn did not finish in verified double support',
  )
  assert(
    samples.some((sample) => Math.abs(sample.stage ?? 0) >= Math.PI),
    'Overlay missed the stage rotation',
  )
  result.physicalDurationMs = physicalSamples.at(-1).elapsedMs - physicalSamples[0].elapsedMs
  result.armTravelDeg = jointTravel(samples, 'turn_in_place', 'armPose')
  assert(
    result.armTravelDeg.some((angle) => angle > 6),
    'The arms stayed fixed during the turn',
  )
  assert(result.physicalDurationMs <= 4100, 'The smooth turn exceeded its motion budget')
  const turnPoses = samples.filter(
    ({ profile, stage, composedAtMs }) =>
      profile === 'turn_in_place' && Number.isFinite(stage) && Number.isFinite(composedAtMs),
  )
  const rates = turnPoses.slice(1).flatMap((sample, index) => {
    const previous = turnPoses[index]
    const elapsed = sample.composedAtMs - previous.composedAtMs
    const radians = Math.abs(sample.stage - previous.stage)
    return elapsed > 0 ? [(radians * 180 * 1000) / (Math.PI * elapsed)] : []
  })
  assert(rates.length, 'No timed Overlay poses during the turn')
  result.peakTurnSpeedDegPerSec = Math.max(...rates)
  assert(result.peakTurnSpeedDegPerSec < 315, 'The turn still has an abrupt speed peak')
}

async function main() {
  fs.mkdirSync(path.join(profile, 'credentials'), { recursive: true })
  if (contextCase) {
    assert(Object.hasOwn(contextPrompt, contextCase), 'Unknown conversation context')
    report.contextCase = contextCase
  }
  const config = JSON.parse(fs.readFileSync(path.join(original, 'config.json'), 'utf8'))
  assert(config.vrmPath && fs.statSync(config.vrmPath).isFile(), 'Configured user VRM is missing')
  report.vrmSha256 = createHash('sha256').update(fs.readFileSync(config.vrmPath)).digest('hex')
  config.setup = { ...config.setup, completed: true }
  config.uiLocale = 'en'
  config.ttsLanguage = 'ru'
  config.developerModeEnabled = 'true'
  const llmProvider = process.env.SHIO_QUALIFICATION_LLM_PROVIDER || config.llm.activeProvider
  assert(config.llm.providers[llmProvider], 'Unsupported qualification LLM provider')
  config.llm.activeProvider = llmProvider
  const llmSettings = config.llm.providers[llmProvider]
  if (process.env.SHIO_QUALIFICATION_LLM_MODEL)
    llmSettings.model = process.env.SHIO_QUALIFICATION_LLM_MODEL
  report.llm = { provider: llmProvider, model: llmSettings.model }
  fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify(config))
  for (const name of ['Local State', 'credentials/llm-credentials.bin']) {
    const source = path.join(original, name)
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(profile, name))
  }
  const environment = {
    ...process.env,
    SHIO_DESKTOP_USER_DATA_ROOT: profile,
  }
  delete environment.ELECTRON_RUN_AS_NODE
  const existingWorkers = new Set(runningWorkers())
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [desktop],
    cwd: desktop,
    env: environment,
    timeout: 30_000,
  })
  let finishRecording
  try {
    const page = await app.firstWindow()
    page.on('pageerror', (error) => report.errors.push(error.message.slice(0, 128)))
    await page.waitForFunction(() => !!window.api?.alive)
    assert.equal(
      path.resolve(await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))),
      profile,
    )
    await page.evaluate(async () => {
      const snapshot = await window.api.alive.snapshot()
      await window.api.alive.updateSettings({
        ...snapshot.settings,
        mode: 'off',
        globallySuspended: true,
      })
    })
    const until = Date.now() + 360_000
    while (Date.now() < until) {
      report.readiness = await status(page)
      writeReport()
      const worker = report.readiness.worker
      assert.equal(worker.provider, 'flashmotion')
      assert.equal(report.readiness.workerHealth?.provider, worker.provider)
      assert.equal(report.readiness.workerHealth?.weightsRevision, worker.weightsRevision)
      if (worker.error && worker.error !== 'MOTION_CANCELLED' && worker.state !== 'warming') {
        throw new Error(worker.error)
      }
      if (
        report.readiness.avatar?.modelLoaded &&
        report.readiness.avatar.motion?.flashMotion?.mode === 't2m'
      )
        break
      await pause(400)
    }
    assert.equal(
      report.readiness?.avatar?.motion?.flashMotion?.mode,
      't2m',
      'No T2M frame on the user VRM',
    )
    await page.evaluate(async () => {
      if (!(await window.api.overlay.isVisible()).visible) await window.api.overlay.toggle()
    })
    await pause(2500)
    const overlay = app.windows().find((window) => window.url().includes('overlay=1'))
    assert(overlay, 'Overlay did not open')
    await overlay.waitForFunction(() => !!window.overlayApi)
    assert.equal(await overlay.evaluate(() => typeof window.api), 'undefined')
    report.overlayViewport =
      overlay.viewportSize() ??
      (await overlay.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      })))
    const handsOnly = process.argv.includes('--hands-only')
    if (handsOnly || actionCase || process.argv.includes('--hands'))
      await overlay.evaluate(installGeometryProbe, await loadRigGeometry(config.vrmPath))
    finishRecording = await recordCanvas(overlay, path.join(destination, 'overlay.webm'))
    if (handsOnly) {
      const finishPreviewMotion = await observeMotion(overlay)
      await inspectHandProfiles(page, overlay)
      report.previewMotion = await finishPreviewMotion()
      assert(
        report.handProfiles.every((profile) => profile.passed),
        'A required hand gesture failed geometry or phase execution',
      )
      report.state = 'observed'
      return
    }
    if (process.argv.includes('--idle')) {
      const finishIdleMotion = await observeMotion(overlay)
      const idleStartedAt = Date.now()
      await pause(120_000)
      report.idle = {
        durationMs: Date.now() - idleStartedAt,
        motion: await finishIdleMotion(),
      }
      writeReport()
    }
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.setAudioMuted(true)
    })
    if (actionCase) {
      assert(
        ['turn-preview', 'dance-preview'].includes(actionCase) ||
          Object.hasOwn(actionPrompts, actionCase),
        'Unknown action case',
      )
      report.action = await inspectAction(page, overlay, actionCase)
      verifyRequestedAction(report.action)
      report.state = 'observed'
      return
    }
    await page.locator('.app-sidebar').getByRole('button', { name: 'Chat', exact: true }).click()
    const input = page.getByRole('textbox', { name: 'Message', exact: true })
    await input.fill(
      contextPrompt[contextCase] ??
        'Спокойно объясни по-русски, как вода перемещается от моря к облакам, горам и обратно. ' +
          'Ответь связным текстом из пяти разных предложений, примерно сто слов, без списка.',
    )
    const finishSpeechMotion = await observeMotion(overlay)
    await input.press('Enter')
    const speechDeadline = Date.now() + 120_000
    let lastProjection
    let spoke = false
    while (Date.now() < speechDeadline) {
      const current = await status(page)
      const health = current.avatar
      const speech = health?.speech
      const phase = health?.motion?.flashMotion
      const sample = {
        speechActive: Boolean(speech?.active),
        consumedSamples: speech?.sourceSampleOffset,
        mouth: speech?.mouthWeight,
        inferenceMs: health?.motion?.inferenceMs,
        errors: [current.worker.error, health?.motion?.error].filter(Boolean),
        mode: phase?.mode,
        motionSample: phase?.appliedSpeechSample,
        performance: phase?.performance,
      }
      if (sample.speechActive) spoke = true
      const native = sample.speechActive && sample.mode === 's2g' && sample.motionSample != null
      if (native || (contextCase && sample.speechActive && sample.performance)) {
        const projection = await overlay.evaluate(() => window.overlayApi.avatarBody.get())
        if (projection?.bones) {
          sample.profile = projection.profileId
          sample.gaze = projection.gazeMode
          const fingers = Object.entries(projection.bones).filter(([name]) =>
            /^(left|right)(Thumb|Index|Middle|Ring|Little)/u.test(name),
          )
          sample.projectionFrame = projection.frame
          sample.fingers = {
            left: fingers.filter(([name]) => name.startsWith('left')).length,
            right: fingers.filter(([name]) => name.startsWith('right')).length,
            moving: lastProjection
              ? fingers.filter(([name, q]) => {
                  const previous = lastProjection.bones[name]
                  return (
                    previous && Math.abs(q.reduce((dot, v, i) => dot + v * previous[i], 0)) < 0.9999
                  )
                }).length
              : 0,
          }
          lastProjection = projection
          if (!report.speakingImage) {
            report.speakingImage = true
            await overlay.screenshot({ path: path.join(destination, 'speaking.png') })
          }
          if (native && !report.nativeFingerGeometry && process.argv.includes('--hands')) {
            report.nativeFingerGeometry = await overlay.evaluate(async () =>
              window.__measureRig(await window.overlayApi.avatarBody.get()),
            )
          }
        }
      }
      report.samples.push(sample)
      if (report.samples.length % 20 === 0) writeReport()
      if (
        process.argv.includes('--interrupt') &&
        sample.speechActive &&
        sample.mode === 's2g' &&
        sample.motionSample != null &&
        sample.fingers?.moving > 0 &&
        sample.consumedSamples >= 4 * 44_100
      ) {
        report.interruption = await interruptPlayback(page, current.worker.modelGeneration)
        break
      }
      if (spoke && !sample.speechActive) break
      await pause(65)
    }
    assert(spoke, 'Normal Chat produced no observed Fish playback')
    assert(
      report.samples.some(({ mouth }) => mouth > 0.01),
      'Fish produced no live LipSync',
    )
    if (contextCase) {
      const applied = report.samples.filter(
        (sample) => sample.speechActive && sample.performance && sample.gaze,
      )
      assert(applied.length > 0, 'No contextual movement and gaze during speech')
      assert(
        applied.every(({ profile }) => profile?.startsWith('presence_')),
        'Ordinary contextual reply selected a catalog gesture',
      )
      report.contextual = {
        observations: applied.length,
        gaze: [...new Set(applied.map((sample) => sample.gaze))],
        performance: applied.at(-1).performance,
      }
      writeReport()
    }
    const aligned = report.samples.filter(
      (sample) =>
        sample.speechActive &&
        sample.mode === 's2g' &&
        sample.motionSample != null &&
        Math.abs(sample.motionSample - sample.consumedSamples) <= 2205,
    )
    assert(aligned.length, 'No S2G projection within the 50 ms consumed-PCM budget')
    assert(
      aligned.some(({ fingers }) => fingers?.left === 15 && fingers.right === 15),
      'Both hands were not projected',
    )
    assert(
      aligned.some(({ fingers }) => fingers?.moving > 0),
      'Overlay showed no native finger articulation',
    )
    report.state = 'observed'
    report.alignedSamples = aligned.length
    report.speechSamples = report.samples.filter((sample) => sample.speechActive).length
    report.maximumAlignedDeltaMs = Math.max(
      ...aligned.map((sample) => Math.abs(sample.motionSample - sample.consumedSamples) / 44.1),
    )
    report.speechMotion = await finishSpeechMotion()
    writeReport()
    if (process.argv.includes('--interrupt'))
      assert(report.interruption, 'No S2G window could be interrupted')
    if (process.argv.includes('--hands')) {
      if (report.interruption) {
        const recovered = await page.waitForFunction(
          async () => {
            const health = await window.api.system.getRuntimeSupportBundle()
            return (
              health.motionWorker?.provider === 'flashmotion' &&
              health.avatarRuntime?.health?.motion?.flashMotion?.mode === 't2m'
            )
          },
          null,
          { polling: 500, timeout: 120_000 },
        )
        await recovered.dispose()
      }
      const finishPreviewMotion = await observeMotion(overlay)
      await inspectHandProfiles(page, overlay)
      report.previewMotion = await finishPreviewMotion()
      assert(
        report.handProfiles.every((profile) => profile.passed),
        'A required hand gesture failed geometry or phase execution',
      )
    }
  } finally {
    try {
      if (finishRecording) report.recording = await finishRecording()
    } finally {
      await app.close()
      report.workerExited = runningWorkers().every((pid) => existingWorkers.has(pid))
      writeReport()
    }
  }
}

main()
  .finally(() => {
    for (const name of ['Local State', 'credentials/llm-credentials.bin']) {
      fs.rmSync(path.join(profile, name), { force: true })
    }
  })
  .catch((failure) => {
    report.state = 'failed'
    report.failure = failure.message
    writeReport()
    console.error(JSON.stringify({ report: destination, failure: report.failure }))
    process.exitCode = 1
  })
