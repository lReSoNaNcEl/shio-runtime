const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { _electron } = require('playwright-core')
const { installGeometryProbe, loadRigGeometry } = require('./rig-geometry.cjs')
const { recordCanvas } = require('./record-canvas.cjs')
const { captureWindow } = require('./capture-window.cjs')
const { qualifyLiving } = require('./living-cases.cjs')
const { qualifyConversation } = require('./conversation-cases.cjs')
const { replayDynamics } = require('./dynamics-replay.cjs')
const { SEMANTIC_EMBODIMENT_CASES } = require('./semantic-embodiment-cases.cjs')
const { FIXED_SEEDS, createStandingQualificationPlan } = require('./standing-motion-cases.cjs')
const emotionNames = require('../../emotion_manifest.json').emotions.map((emotion) => emotion.id)
const visibleControlSyntax = new RegExp(
  `(?:<\\/?|\\[)(?:${emotionNames.join('|')})(?:\\]|>)|\\[voice:|<\\/?shio-`,
  'iu',
)

const desktop = path.resolve(__dirname, '../..')
const repository = path.resolve(desktop, '../..')
const option = (name, fallback) =>
  Number(process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=')[1] ?? fallback)
const duration = option('duration-seconds', 1800)
const responseCount = option('warm-responses', 20)
const componentSmoke = process.argv.includes('--component-smoke')
const shortSpeech = process.argv.includes('--short-speech')
const audibleOutput = process.argv.includes('--audible')
const recordVideo = process.argv.includes('--record-video')
const replaceModelDuringSpeech = process.argv.includes('--replace-model-during-speech')
const semanticCasesRequested = process.argv.includes('--semantic-cases')
const modelsOnly = process.argv.includes('--models-only')
const coreOnly = process.argv.includes('--core-only')
const semanticCaseArguments = process.argv.filter((value) =>
  value.startsWith('--semantic-case-ids='),
)
assert(semanticCaseArguments.length <= 1, 'Specify --semantic-case-ids only once')
assert(!semanticCaseArguments.length || semanticCasesRequested, 'Subset requires --semantic-cases')
const semanticCaseIds = semanticCaseArguments.length
  ? semanticCaseArguments[0].slice('--semantic-case-ids='.length).split(',')
  : SEMANTIC_EMBODIMENT_CASES.map((entry) => entry.id)
assert(
  semanticCaseIds.length > 0 &&
    new Set(semanticCaseIds).size === semanticCaseIds.length &&
    semanticCaseIds.every((id) => SEMANTIC_EMBODIMENT_CASES.some((entry) => entry.id === id)),
  'Unknown, empty or duplicate semantic case ID',
)
const selectedSemanticCases = semanticCaseIds.map((id) =>
  SEMANTIC_EMBODIMENT_CASES.find((entry) => entry.id === id),
)
const turnCases = process.argv.includes('--turn-cases')
const turnSeedArgument = process.argv.find((value) => value.startsWith('--turn-seeds='))
const turnSeeds = turnSeedArgument?.slice('--turn-seeds='.length).split(',').map(Number)
assert(
  !turnSeeds ||
    (turnCases &&
      turnSeeds.length > 0 &&
      turnSeeds.every((seed) => [17, 101, 271, 503].includes(seed))),
  'Unknown turn fixture seed',
)
const livingCases = process.argv.includes('--living-cases')
const conversationCases = process.argv.includes('--conversation-cases')
const dynamicsReplay = process.argv.includes('--dynamics-replay')
const bodyStabilityOnly =
  process.argv.includes('--body-stability-only') ||
  turnCases ||
  livingCases ||
  conversationCases ||
  dynamicsReplay
const bodySeconds = option('body-seconds', 18)
// Capture both hand scores during the short accent before reviewing wider views.
const accentCameras = ['Right hand', 'Left hand', 'Full body', 'Bust', 'Face']
assert(Number.isFinite(bodySeconds) && bodySeconds >= 4 && bodySeconds <= 60)
const seedCount = option('seed-count', FIXED_SEEDS.length)
assert(Number.isInteger(seedCount) && seedCount >= 1 && seedCount <= FIXED_SEEDS.length)
const motionCatalog = JSON.parse(
  fs.readFileSync(path.join(desktop, 'motion/motion-profiles.json'), 'utf8'),
)
const motionProfiles = motionCatalog.profiles
const profileArguments = process.argv.filter((value) => value.startsWith('--profile-ids='))
assert(profileArguments.length <= 1, 'Specify --profile-ids only once')
assert(
  !profileArguments.length || !process.argv.includes('--skip-profiles'),
  '--profile-ids cannot be combined with --skip-profiles',
)
const profileIds = profileArguments.length
  ? profileArguments[0].slice('--profile-ids='.length).split(',')
  : motionProfiles.map((entry) => entry.id)
assert(
  profileIds.length > 0 && profileIds.length <= motionProfiles.length,
  'Invalid profile subset size',
)
assert(new Set(profileIds).size === profileIds.length, 'Duplicate profile ID')
assert(
  profileIds.every((id) => motionProfiles.some((entry) => entry.id === id)),
  'Unknown or empty profile ID',
)
const selectedProfiles = profileIds.map((id) => motionProfiles.find((entry) => entry.id === id))
const fingerProfileIds = new Set(
  motionProfiles
    .filter((profile) =>
      ['left', 'right'].some((side) => {
        const fingers = profile.handScore.phases.hold[side].fingers
        return fingers.ring.curl[0] - fingers.index.curl[0] > 0.35
      }),
    )
    .map((profile) => profile.id),
)
const responseSpacing = option('response-spacing-seconds', 0)
assert(Number.isFinite(responseSpacing) && responseSpacing >= 0 && responseSpacing <= 180)
const modelOnly = process.argv.includes('--model-only')
const focused = process.argv.includes('--focused') || modelOnly || componentSmoke
assert(Number.isInteger(duration) && duration >= 20 && duration <= 7200)
assert(Number.isInteger(responseCount) && responseCount >= 1 && responseCount <= 50)
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const directory = path.join(desktop, 'motion/.artifacts', `joint-${stamp}`)
const profile = path.join(repository, 'tmp', `shio-joint-${stamp}`)
fs.mkdirSync(directory, { recursive: true })
fs.mkdirSync(path.join(profile, 'credentials'), { recursive: true })
const original = path.join(process.env.APPDATA, 'shio-runtime-desktop')
const config = JSON.parse(fs.readFileSync(path.join(original, 'config.json'), 'utf8'))
config.setup = { ...config.setup, completed: true }
config.uiLocale = 'en'
config.uiTheme = 'dark'
config.developerModeEnabled = 'true'
config.ttsEngine = 'fish-s2-pro'
config.ttsLanguage = 'ru'
if (process.argv.includes('--bundled-model')) config.vrmPath = ''
const fixtureArgument = process.argv.find((value) => value.startsWith('--vrm-fixture='))
if (fixtureArgument) {
  assert(!process.argv.includes('--bundled-model'), 'Choose one qualification model fixture')
  const filename = path.resolve(fixtureArgument.slice('--vrm-fixture='.length))
  assert(path.extname(filename).toLowerCase() === '.vrm' && fs.statSync(filename).isFile())
  config.vrmPath = filename
}
if (process.env.SHIO_QUALIFICATION_LLM_MODEL) {
  const provider = process.env.SHIO_QUALIFICATION_LLM_PROVIDER || config.llm.activeProvider
  config.llm.providers[provider].model = process.env.SHIO_QUALIFICATION_LLM_MODEL
}
if (process.env.SHIO_QUALIFICATION_LLM_PROVIDER)
  config.llm.activeProvider = process.env.SHIO_QUALIFICATION_LLM_PROVIDER
fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify(config))
for (const relative of ['Local State', 'credentials/llm-credentials.bin']) {
  const source = path.join(original, relative)
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(profile, relative))
}
const environment = {
  ...process.env,
  SHIO_DESKTOP_USER_DATA_ROOT: profile,
  SHIO_MOTION_ROOT: process.env.SHIO_MOTION_ROOT || path.join(desktop, 'motion'),
}
delete environment.ELECTRON_RUN_AS_NODE
const launchDesktop = process.env.SHIO_QUALIFICATION_DESKTOP_ROOT || desktop
const report = {
  modelFixture: {
    source: fixtureArgument
      ? 'explicit-qualification-fixture'
      : config.vrmPath
        ? 'configured-model'
        : 'bundled-green-fox',
    sha256: createHash('sha256')
      .update(
        fs.readFileSync(
          config.vrmPath || path.join(desktop, 'src/renderer/assets/vrm/green_fox.vrm'),
        ),
      )
      .digest('hex'),
  },
  startedAt: new Date().toISOString(),
  mode: bodyStabilityOnly ? 'body-stability-only' : componentSmoke ? 'component-smoke' : 'joint',
  audioOutput: audibleOutput ? 'audible' : 'muted-at-owned-WebContents',
  durationRequestedSeconds: duration,
  responseSpacingSeconds: responseSpacing,
  warmResponsesRequested: responseCount,
  profileIdsRequested: profileIds,
  standingQualification: createStandingQualificationPlan(motionCatalog, profileIds),
  build: {},
  responses: [],
  cancellations: [],
  samples: [],
  resources: [],
  frames: [],
  failures: [],
  componentEvidence: {
    blinkCycles: 0,
    peakBlink: 0,
    fullClosureObserved: false,
    blinkEvents: [],
    captures: [],
    inferenceMs: [],
  },
}
for (const relative of [
  'out/main/index.js',
  'out/preload/index.js',
  'out/preload/overlay.js',
  'out/renderer/index.html',
  ...fs
    .readdirSync(path.join(desktop, 'out/renderer/assets'))
    .filter((filename) => /\.(?:js|css)$/u.test(filename))
    .map((filename) => `out/renderer/assets/${filename}`),
  'motion/worker.py',
  'motion/backend.py',
  'motion/research-pins.json',
  'motion/motion-profiles.json',
  'qualifications/speech-motion/qualify.cjs',
  'qualifications/speech-motion/rig-geometry.cjs',
  'qualifications/speech-motion/semantic-embodiment-cases.cjs',
  'qualifications/speech-motion/standing-motion-cases.cjs',
  'qualifications/speech-motion/record-canvas.cjs',
  'qualifications/speech-motion/living-cases.cjs',
  'qualifications/speech-motion/dynamics-replay.cjs',
  'qualifications/motion-ab/record.cjs',
])
  report.build[relative] = createHash('sha256')
    .update(fs.readFileSync(path.join(desktop, relative)))
    .digest('hex')
if (launchDesktop !== desktop) {
  const emitted = [
    'out/main/index.js',
    'out/preload/index.js',
    'out/preload/overlay.js',
    'out/renderer/index.html',
    ...fs
      .readdirSync(path.join(launchDesktop, 'out/renderer/assets'))
      .filter((name) => /\.(?:js|css)$/u.test(name))
      .map((name) => `out/renderer/assets/${name}`),
  ]
  report.instrumentedBuild = Object.fromEntries(
    emitted.map((relative) => [
      relative,
      createHash('sha256')
        .update(fs.readFileSync(path.join(launchDesktop, relative)))
        .digest('hex'),
    ]),
  )
  report.instrumentedSnapshot = JSON.parse(
    fs.readFileSync(path.join(launchDesktop, '../../snapshot.json')),
  )
}
const persist = () =>
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
const log = (value) => {
  console.log(JSON.stringify(value))
  persist()
}
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
let application,
  page,
  stopRecording,
  lastSampleAt = 0,
  lastResourceAt = 0
let blinkStartedAt = null,
  priorInference = null,
  openCaptured = false,
  blinkCaptured = false,
  speechCaptured = false
const sleepSample = async (period = 200) => {
  if (Date.now() - lastSampleAt < period) return null
  lastSampleAt = Date.now()
  const value = await page.evaluate(async () => {
    const support = await window.api.system.getRuntimeSupportBundle()
    return {
      motion: await window.api.motion.status(),
      avatar: support.avatarRuntime,
      speech: support.speech,
      errors: support.latestRuntimeErrors,
      incidents: support.recentIncidents,
      latency: await window.api.latency.snapshot(),
    }
  })
  report.samples.push({ at: Date.now(), motion: value.motion, avatar: value.avatar })
  if (componentSmoke) {
    const health = value.avatar.health
    const weight = health?.speech?.blinkWeight ?? 0
    const evidence = report.componentEvidence
    evidence.peakBlink = Math.max(evidence.peakBlink, weight)
    evidence.fullClosureObserved ||= weight >= 0.95
    if (weight >= 0.3 && blinkStartedAt === null) blinkStartedAt = Date.now()
    if (weight <= 0.02 && blinkStartedAt !== null) {
      evidence.blinkCycles += 1
      if (evidence.blinkEvents.length < 32)
        evidence.blinkEvents.push({ startedAt: blinkStartedAt, openedAt: Date.now() })
      blinkStartedAt = null
    }
    const inference = health?.motion?.inferenceMs
    if (inference > 0 && inference !== priorInference) {
      evidence.inferenceMs.push(inference)
      priorInference = inference
    }
    const overlay = application.windows().find((target) => target.url().includes('overlay=1'))
    if (overlay && !overlay.isClosed()) {
      const capture =
        !blinkCaptured && weight >= 0.45
          ? 'blink-peak'
          : !openCaptured && weight <= 0.02 && evidence.blinkCycles > 0
            ? 'blink-open'
            : !speechCaptured && health.speech?.active && health.speech.mouthWeight > 0.1
              ? 'speaking-lipsync'
              : null
      if (capture) {
        await overlay.screenshot({ path: path.join(directory, `${capture}.png`) })
        evidence.captures.push({
          capture,
          at: Date.now(),
          blinkWeight: weight,
          mouthWeight: health.speech?.mouthWeight,
          consumedSamples: health.speech?.sourceSampleOffset,
        })
        if (capture === 'blink-peak') blinkCaptured = true
        if (capture === 'blink-open') openCaptured = true
        if (capture === 'speaking-lipsync') speechCaptured = true
      }
    }
  }

  if (Date.now() - lastResourceAt > 30000) {
    lastResourceAt = Date.now()
    const processes = await application.evaluate(({ app }) =>
      app.getAppMetrics().map((metric) => ({
        type: metric.type,
        pid: metric.pid,
        workingSetKiB: metric.memory.workingSetSize,
        peakWorkingSetKiB: metric.memory.peakWorkingSetSize,
      })),
    )
    let gpu = ''
    try {
      gpu = execFileSync(
        'nvidia-smi',
        ['--query-gpu=memory.used,utilization.gpu', '--format=csv,noheader,nounits'],
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 5000,
          env: Object.fromEntries(
            Object.entries(process.env).filter(([key]) =>
              /^(path|systemroot|windir|programfiles|programfiles\(x86\)|programw6432|systemdrive|comspec)$/i.test(
                key,
              ),
            ),
          ),
        },
      ).trim()
    } catch {
      gpu = 'unavailable'
    }
    const ownedProcesses = JSON.parse(
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          "@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:SHIO_QA_ROOT + '\\', [StringComparison]::OrdinalIgnoreCase) -and $_.Name -in @('python.exe','electron.exe','Shio Runtime.exe') } | ForEach-Object { $p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if($p){@{pid=$p.Id;name=$p.ProcessName;workingSetBytes=$p.WorkingSet64;privateBytes=$p.PrivateMemorySize64}} }) | ConvertTo-Json -Compress",
        ],
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 10000,
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(([key]) =>
                /^(path|systemroot|windir|programfiles|programfiles\(x86\)|programw6432|systemdrive|comspec)$/i.test(
                  key,
                ),
              ),
            ),
            SHIO_QA_ROOT: repository,
          },
        },
      ).trim() || '[]',
    )
    report.resources.push({ at: Date.now(), gpu, processes, ownedProcesses })
    persist()
  }
  return value
}
async function ready(requireSpeech = true) {
  const deadline = Date.now() + (requireSpeech ? 900000 : 660000)
  let cancelledSince = null
  while (Date.now() < deadline) {
    const state = await sleepSample()
    const api = requireSpeech ? await page.evaluate(() => window.api.health.check()) : null
    const avatarReady = requireSpeech
      ? state?.avatar.health?.operational
      : state?.avatar.health?.modelLoaded && state.avatar.health.motion?.state === 'ready'
    // Renderer reload first releases the previous owner. Its cancellation is an
    // expected transient until the replacement renderer attaches its model.
    if (state?.motion.state === 'unavailable' && state.motion.error) {
      if (state.motion.error !== 'ARDY_CANCELLED') throw new Error(state.motion.error)
      cancelledSince ??= Date.now()
      if (Date.now() - cancelledSince > 5000)
        throw new Error('ARDY_CANCELLED did not settle after model attachment')
    } else cancelledSince = null
    if (
      (!requireSpeech || (api.data?.asr?.ready && api.data?.synthesis?.ready)) &&
      avatarReady &&
      ['ready', 'generating'].includes(state.motion.state)
    ) {
      const retry = page.getByRole('button', { name: 'Retry connection', exact: true })
      if (requireSpeech && (await retry.isVisible())) {
        await retry.click()
        await pause(2000)
      }
      return
    }
    await pause(300)
  }
  throw new Error(
    requireSpeech ? 'ARDY/VRM/speech readiness timeout' : 'ARDY/VRM readiness timeout',
  )
}
async function frameProbe(target) {
  observePageErrors(target)
  await target.evaluate(() => {
    if (window.__shioFrameProbe) return
    const state = {
      startedAt: performance.now(),
      count: 0,
      dropped: 0,
      maximumMs: 0,
      histogram: Array(1024).fill(0),
      last: null,
      raf: 0,
    }
    window.__shioFrameProbe = state
    const tick = (at) => {
      if (state.last !== null) {
        const delta = at - state.last
        state.count++
        state.dropped += Math.max(0, Math.round(delta / (1000 / 60)) - 1)
        state.maximumMs = Math.max(state.maximumMs, delta)
        state.histogram[Math.min(1023, Math.floor(delta * 2))]++
      }
      state.last = at
      state.raf = requestAnimationFrame(tick)
    }
    state.raf = requestAnimationFrame(tick)
  })
}
const prompts = [
  'Скажи только одну короткую тёплую фразу о погоде. Без инструментов.',
  'Say one short, calm English sentence. Do not use tools.',
  'Прочитай кратко: версия 4.2, порт 8000, API и WebSocket. Без инструментов.',
  'Очень коротко порадуйся хорошей новости. Без инструментов.',
  'Коротко и смущённо поблагодари. Без инструментов.',
  'Прошепчи одну короткую поддерживающую фразу. Без инструментов.',
  'Две короткие фразы: начни спокойно, закончи весёлым смешком. Без инструментов.',
  'Вздохни и коротко скажи, что всё получится. Без инструментов.',
  'Коротко удивись красивому закату. Без инструментов.',
  'Ответь одной короткой заботливой фразой. Без инструментов.',
]
async function response(index, cancellation, semanticCase) {
  await page.locator('.app-sidebar').getByRole('button', { name: 'Chat', exact: true }).click()
  const prior = new Set(
    (await page.evaluate(() => window.api.latency.snapshot())).recentTraces.map(
      (trace) => trace.turnId,
    ),
  )
  const submitted = Date.now()
  const priorProjection = semanticCase ? await overlayProjection() : null
  if (semanticCase)
    await page.evaluate(() => {
      window.__qualificationSemanticStop?.()
      window.__qualificationSemanticEvents = []
      window.__qualificationSemanticStop = window.api.llm.onReplyStreamEvent((event) => {
        if (event.type === 'embodiment-intent' && window.__qualificationSemanticEvents.length < 8)
          window.__qualificationSemanticEvents.push({
            turnId: event.turnId,
            at: event.at,
            timing: event.timing,
            intent: event.intent,
          })
      })
    })
  const witnessedGestures = []
  const input = page.getByRole('textbox', { name: 'Message', exact: true })
  await input.fill(
    semanticCase?.userPrompt ??
      (cancellation
        ? 'Расскажи подробно о спокойной прогулке, не используй инструменты.'
        : focused && !shortSpeech && index === 0
          ? `Прочитай дословно весь следующий тестовый текст, без сокращений и без инструментов: ${'Мы идём по тихой дорожке. Ветер мягко шевелит листья, а тёплый солнечный свет ложится на траву. '.repeat(12)}`
          : prompts[index % prompts.length]),
  )
  await input.press('Enter')
  let trace,
    latest,
    peakMouth = 0,
    peakRms = 0,
    peakBlink = 0,
    cancelledAt = null,
    stoppedAfterMs = null
  let switchedModel = false
  let switchedMouth = 0
  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    latest = await sleepSample(cancelledAt === null ? 100 : 15)
    if (latest) {
      trace = latest.latency.recentTraces.find((item) => !prior.has(item.turnId)) ?? trace
      const speech = latest.avatar.health?.speech
      peakMouth = Math.max(peakMouth, speech?.mouthWeight ?? 0)
      peakRms = Math.max(peakRms, speech?.rawRms ?? 0)
      peakBlink = Math.max(peakBlink, speech?.blinkWeight ?? 0)
      if (semanticCase && speech?.active && witnessedGestures.length < 32) {
        const projected = await overlayProjection()
        const executingProfile = motionProfiles.find((entry) => entry.id === projected?.profileId)
        const hint = executingProfile?.kind === 'gesture' ? executingProfile.semanticIntent : null
        if (
          hint &&
          projected.executionId !== priorProjection?.executionId &&
          ['stroke', 'hold'].includes(projected.phaseId)
        )
          witnessedGestures.push({
            hint,
            profileId: projected.profileId,
            phaseId: projected.phaseId,
            executionId: projected.executionId,
            consumedSamples: speech.sourceSampleOffset,
          })
      }
      if (
        focused &&
        (!componentSmoke || replaceModelDuringSpeech) &&
        index === 0 &&
        !cancellation &&
        !switchedModel &&
        speech?.active &&
        speech.sourceSampleOffset >= 22050
      ) {
        const modelPath = path.join(profile, 'qualification-replacement.vrm')
        fs.copyFileSync(
          config.vrmPath || path.join(desktop, 'src/renderer/assets/vrm/green_fox.vrm'),
          modelPath,
        )
        report.modelSwitch = {
          before: latest.motion,
          requestedAt: Date.now(),
          fixture: 'same VRM, new opaque asset handle',
        }
        await application.evaluate(({ dialog }, filePath) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
        }, modelPath)
        await page
          .locator('.app-sidebar')
          .getByRole('button', { name: 'Settings', exact: true })
          .click()
        await page
          .locator('.settings-nav')
          .getByRole('button', { name: 'Avatar', exact: true })
          .click()
        await page.getByRole('button', { name: 'Choose file…', exact: true }).click()
        await page
          .locator('.app-sidebar')
          .getByRole('button', { name: 'Chat', exact: true })
          .click()
        switchedModel = true
      }
      if (
        switchedModel &&
        latest.avatar.health?.modelLoaded &&
        latest.motion.modelGeneration > report.modelSwitch.before.modelGeneration
      )
        switchedMouth = Math.max(switchedMouth, speech?.mouthWeight ?? 0)
      if (
        cancellation &&
        cancelledAt === null &&
        (cancellation === 'before-pcm' ||
          (speech?.active &&
            (cancellation === 'during-pcm'
              ? speech.sourceSampleOffset >= 44100 && speech.mouthWeight > 0.02
              : trace?.milestones.some((m) => m.name === 'llm_completed'))))
      ) {
        const stop = page.getByRole('button', { name: "Stop Shio's response", exact: true })
        if (await stop.isVisible()) {
          await stop.click()
          cancelledAt = Date.now()
        }
      }
      if (
        cancelledAt !== null &&
        stoppedAfterMs === null &&
        !speech?.active &&
        (speech?.mouthWeight ?? 0) < 0.01
      )
        stoppedAfterMs = Date.now() - cancelledAt
      if (trace?.terminalAt && (cancelledAt === null || stoppedAfterMs !== null)) break
      if (cancelledAt !== null && Date.now() - cancelledAt > 5000) break
    }
    await pause(40)
  }
  assert(trace?.terminalAt, 'Conversation did not settle')
  const speech = latest.avatar.health?.speech
  if (switchedModel) {
    report.modelSwitch.after = latest.motion
    report.modelSwitch.peakMouthAfter = switchedMouth
    assert(switchedMouth > 0.01, 'Reloaded VRM did not resume live LipSync')
  }
  const result = {
    index,
    submitted,
    trace,
    peakMouth,
    peakRms,
    peakBlink,
    speech,
    motion: latest.motion,
    cancellation,
    cancelledAt,
    stoppedAfterMs,
  }
  if (semanticCase) {
    const events = await page.evaluate(() => {
      window.__qualificationSemanticStop?.()
      window.__qualificationSemanticStop = null
      return window.__qualificationSemanticEvents
    })
    result.semantic = {
      caseId: semanticCase.id,
      intents: events.filter((event) => event.turnId === trace.turnId),
      witnessedGestures,
    }
  }
  if (cancellation) {
    report.cancellations.push(result)
    assert(cancelledAt !== null, 'Cancellation control was not exercised')
    assert(
      stoppedAfterMs !== null && stoppedAfterMs <= 200,
      'Local output exceeded cancellation deadline',
    )
  } else {
    report.responses.push(result)
    assert.equal(trace.status, 'success', 'Warm reply failed')
    const visibleReply = await page
      .locator('.message-assistant:not(.message-loading) .msg-text')
      .last()
      .innerText()
    result.visibleControlSyntaxLeaked = visibleControlSyntax.test(visibleReply)
    assert(!result.visibleControlSyntaxLeaked, 'Internal control syntax leaked into visible reply')
    if (componentSmoke) {
      assert(
        trace.milestones.some((milestone) => milestone.name === 'llm_completed'),
        'No completed provider request for component speech',
      )
    } else {
      assert(
        trace.milestones.some((milestone) => milestone.name === 'llm_connected'),
        'No real Character provider stream',
      )
    }
    const providerIncident = latest.incidents?.some((incident) => incident.occurredAt >= submitted)
    result.characterProviderVerified =
      !providerIncident && trace.milestones.some((milestone) => milestone.name === 'llm_connected')
    if (componentSmoke && providerIncident) {
      report.failures.push(
        'Provider failure cannot qualify as Character speech; component checks use the actual runtime failure presentation',
      )
    } else {
      assert(!providerIncident, 'Provider failure cannot qualify as Character speech')
    }
    assert(speech?.firstPcmAt >= submitted, 'No current-turn PCM evidence')
    assert(peakMouth > 0.01 && peakRms > 0.0001, 'No live LipSync activity')
    assert((speech.maxCueErrorMs ?? Infinity) <= 100, 'PCM delivery cue missed its bound')
  }
  log({
    response: index,
    cancellation: cancellation ?? null,
    status: trace.status,
    peakMouth,
    queue: latest.motion.state,
  })
  return result
}

async function paceResponse() {
  const until = Date.now() + responseSpacing * 1000
  while (Date.now() < until) {
    await sleepSample()
    await pause(500)
  }
}
async function semanticQualification() {
  report.semanticCases = []
  assert(
    report.responses.at(-1)?.characterProviderVerified,
    'Semantic qualification requires a real Character provider stream',
  )
  for (const fixture of selectedSemanticCases) {
    if (responseSpacing) await paceResponse()
    let availability = null
    const deadline = Date.now() + 120000
    do {
      const sampled = await sleepSample(0)
      assert(
        !sampled.avatar.health?.motion?.error,
        `Motion failed before semantic case ${fixture.id}: ${sampled.avatar.health?.motion?.error}`,
      )
      availability = sampled.avatar.health?.embodimentAvailability
      if (
        fixture.expectedAllowedHints.length === 0 ||
        fixture.expectedAllowedHints.some((hint) =>
          availability?.availableSemanticIntents.includes(hint),
        )
      )
        break
      await pause(500)
    } while (Date.now() < deadline)
    const supported =
      fixture.expectedAllowedHints.length === 0 ||
      fixture.expectedAllowedHints.some((hint) =>
        availability?.availableSemanticIntents.includes(hint),
      )
    if (!supported) {
      report.semanticCases.push({ caseId: fixture.id, status: 'unavailable', availability })
      report.failures.push(`Semantic case unavailable: ${fixture.id}`)
      persist()
      continue
    }
    const result = await response(report.responses.length, undefined, fixture)
    const hints = result.semantic.intents.map((event) => event.intent.gestureHint).filter(Boolean)
    const witnessed = [...new Set(result.semantic.witnessedGestures.map((event) => event.hint))]
    const wrong = [...hints, ...witnessed].some(
      (hint) =>
        fixture.forbiddenHints.includes(hint) || !fixture.expectedAllowedHints.includes(hint),
    )
    const requiredVisible =
      (fixture.allowNoHint && hints.length === 0) ||
      (result.semantic.intents.some(
        (event) =>
          event.timing === 'early' &&
          fixture.expectedAllowedHints.includes(event.intent.gestureHint),
      ) &&
        witnessed.some((hint) => fixture.expectedAllowedHints.includes(hint)))
    const passed = !wrong && requiredVisible && result.characterProviderVerified
    report.semanticCases.push({
      caseId: fixture.id,
      status: passed ? 'passed' : 'failed',
      availability,
      provider: result.trace.provider,
      model: result.trace.model,
      ...result.semantic,
    })
    if (!passed)
      report.failures.push(`Semantic intent/visible speech gesture failed: ${fixture.id}`)
    log({ semanticCase: fixture.id, passed, hints, witnessed })
  }
}
const errorObservedPages = new WeakSet()
async function restartMotionAfterCancellation() {
  // Cancellation intentionally terminates the generator. Request a new owned
  // preview before requiring readiness for the next independent scenario.
  await page.locator('.app-sidebar').getByRole('button', { name: 'Avatar', exact: true }).click()
  const library = page.locator('.animation-library')
  await library.getByRole('searchbox').fill('Poised presence')
  await library.getByText('Poised presence', { exact: true }).click()
  await page.getByRole('heading', { name: 'Poised presence', exact: true }).waitFor()
  await page.getByRole('button', { name: /^(Play|Retry generation)$/u }).click()
}
function observePageErrors(target) {
  if (errorObservedPages.has(target)) return
  errorObservedPages.add(target)
  target.on('pageerror', (failure) => {
    report.failures.push(failure.message)
    persist()
  })
}
async function probeActualWindows() {
  for (const target of application.windows()) if (!target.isClosed()) await frameProbe(target)
}
function overlayPage() {
  const target = application.windows().find((window) => window.url().includes('overlay=1'))
  assert(target, 'Qualification Overlay is unavailable')
  return target
}
async function overlayProjection() {
  return overlayPage().evaluate(async () => {
    const pose = await window.overlayApi.avatarBody.get()
    if (!pose?.lease) return null
    const hands = {
      left: { boneCount: 0, nonNeutralBones: 0, totalAngle: 0, maximumAngle: 0 },
      right: { boneCount: 0, nonNeutralBones: 0, totalAngle: 0, maximumAngle: 0 },
    }
    for (const [name, quaternion] of Object.entries(pose.bones)) {
      const match = /^(left|right)(Thumb|Index|Middle|Ring|Little)/u.exec(name)
      if (!match) continue
      const norm = Math.hypot(...quaternion)
      if (!Number.isFinite(norm) || norm <= 0) continue
      const angle = 2 * Math.acos(Math.min(1, Math.abs(quaternion[3]) / norm))
      const hand = hands[match[1]]
      hand.boneCount += 1
      hand.nonNeutralBones += angle > 0.05 ? 1 : 0
      hand.totalAngle += angle
      hand.maximumAngle = Math.max(hand.maximumAngle, angle)
      if (name.endsWith('IndexProximal')) hand.indexProximalAngle = angle
      if (name.endsWith('RingProximal')) hand.ringProximalAngle = angle
    }
    for (const hand of Object.values(hands)) {
      hand.meanAngle = hand.boneCount ? hand.totalAngle / hand.boneCount : 0
      delete hand.totalAngle
    }
    return {
      profileId: pose.profileId,
      phaseId: pose.phaseId,
      executionId: pose.executionId,
      sessionId: pose.lease.sessionId,
      sourceFrame: pose.frame,
      epoch: pose.lease.epoch,
      modelGeneration: pose.lease.modelGeneration,
      avatarGeneration: pose.lease.avatarGeneration,
      seed: pose.lease.seed,
      fingerAggregate: hands,
    }
  })
}
function sameProjectionLease(left, right) {
  return ['sessionId', 'epoch', 'modelGeneration', 'avatarGeneration', 'seed'].every(
    (key) => left[key] === right[key],
  )
}
function assertFingerPose(profileId, snapshot, checkShape = false) {
  const profile = motionProfiles.find((entry) => entry.id === profileId)
  assert(profile, 'Unknown hand score profile')
  for (const side of ['left', 'right'])
    assert(
      snapshot.fingerAggregate[side].boneCount === 15,
      `Missing complete ${side} finger chains: ${profileId}`,
    )
  if (!checkShape || !fingerProfileIds.has(profileId)) return
  for (const side of ['left', 'right']) {
    const expected = profile.handScore.phases.hold[side].fingers
    if (expected.ring.curl[0] - expected.index.curl[0] <= 0.35) continue
    const actual = snapshot.fingerAggregate[side]
    assert(
      actual.indexProximalAngle < 0.45 && actual.ringProximalAngle > 0.6,
      `Selected hand score has no side-correct index/ring shape: ${profileId}/${side}`,
    )
  }
}
async function appliedProfile(profileId, expectedSeed) {
  const deadline = Date.now() + 30000
  let first = null
  let firstMatchedAt = null
  while (Date.now() < deadline) {
    const state = await sleepSample()
    assert(!state?.avatar.health?.motion?.error, `Profile motion failed: ${profileId}`)
    if (bodyStabilityOnly) {
      const applied = await overlayPage().evaluate(() => {
        const probe = window.__bodyProbe
        return probe
          ? {
              profileId: probe.profileId,
              frames: probe.lastSourceFrame - probe.firstSourceFrame,
              stroke: probe.phases.stroke ?? 0,
              fingers: probe.fingerBoneCount,
            }
          : null
      })
      if (applied?.profileId === profileId && applied.frames >= 8 && applied.stroke > 0) {
        assert.equal(applied.fingers, 30, 'Incomplete projected finger chains')
        return applied
      }
    }
    const snapshot = await overlayProjection()
    if (
      snapshot?.profileId === profileId &&
      (expectedSeed === undefined || snapshot.seed === expectedSeed)
    ) {
      if (!first || !sameProjectionLease(first, snapshot)) {
        first = snapshot
        firstMatchedAt = Date.now()
      }
      const phase =
        snapshot.phaseId ??
        (await page.locator('[data-motion-phase]').getAttribute('data-motion-phase'))
      const witnessedAccent =
        bodyStabilityOnly &&
        (await overlayPage().evaluate((id) => {
          const probe = window.__bodyProbe
          return probe?.profileId === id && (probe.phases.stroke > 0 || probe.phases.hold > 0)
        }, profileId))
      if (
        state?.avatar.health?.motion?.state === 'ready' &&
        snapshot.sourceFrame - first.sourceFrame >= 8 &&
        (['stroke', 'hold'].includes(phase) || witnessedAccent)
      ) {
        assertFingerPose(profileId, snapshot, true)
        return { first, firstMatchedAt, snapshot, health: state.avatar.health }
      }
    }
    await pause(50)
  }
  throw new Error(`Profile did not consume eight matching source frames: ${profileId}`)
}
async function prepareFingerViewport() {
  const settings = await page.evaluate(async () => {
    const value = await window.api.config.get()
    return { overlayViewMode: value.overlayViewMode }
  })
  const bounds = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().includes('overlay=1'))
      ?.getBounds(),
  )
  assert(bounds, 'Qualification Overlay window is unavailable')
  await page.evaluate(async () => {
    await window.api.config.save({ overlayViewMode: 'bust' })
    await window.api.overlay.applySettings()
  })
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().includes('overlay=1'))
      ?.setSize(720, 1000),
  )
  return async () => {
    await page.evaluate(async (original) => {
      await window.api.config.save(original)
      await window.api.overlay.applySettings()
    }, settings)
    await application.evaluate(
      ({ BrowserWindow }, original) =>
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.getURL().includes('overlay=1'))
          ?.setBounds(original),
      bounds,
    )
  }
}

async function focusedPresentation() {
  report.presentation = []
  await page.locator('.app-sidebar').getByRole('button', { name: 'Avatar', exact: true }).click()
  await page.getByRole('button', { name: 'Full body', exact: true }).waitFor()
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => window.api.config.save({ uiTheme: theme }), theme)
    for (const camera of ['Full body', 'Bust', 'Face', 'Left hand', 'Right hand']) {
      await page.getByRole('button', { name: camera, exact: true }).click()
      await pause(1500)
      await page.screenshot({
        path: path.join(directory, `${theme}-${camera.replaceAll(' ', '-')}.png`),
      })
      report.presentation.push({ theme, camera, health: (await sleepSample()).avatar.health })
    }
  }
  await page.getByRole('button', { name: 'Full body', exact: true }).click()
  const profiles = process.argv.includes('--skip-profiles') ? [] : selectedProfiles
  const seedField = page.getByRole('textbox', { name: 'Fixed variation seed', exact: true })
  if (!(await seedField.isVisible()))
    await page.getByRole('button', { name: 'Developer details', exact: true }).click()
  const restoreViewport = profiles.some((entry) => fingerProfileIds.has(entry.id))
    ? await prepareFingerViewport()
    : null
  try {
    for (const profile of profiles) {
      const library = page.locator('.animation-library')
      await library.getByRole('searchbox').fill(profile.labels.en)
      await library.getByText(profile.labels.en, { exact: true }).click()
      for (const seed of FIXED_SEEDS.slice(0, seedCount)) {
        await page.getByRole('button', { name: 'Full body', exact: true }).click()
        await seedField.fill(String(seed))
        await seedField.press('Tab')
        const requestedAt = Date.now()
        await page.getByRole('button', { name: 'Generate variation', exact: true }).click()
        const applied = await appliedProfile(profile.id, seed)
        assert.equal(applied.snapshot.seed, seed, 'Composed body did not accept the fixed seed')
        const health = applied.health
        assert.equal(health.motion?.state, 'ready', `Profile not generating: ${profile.id}`)
        const evidence = {
          profileId: profile.id,
          requestedSeed: seed,
          seedPolicy: 'fixed',
          qualificationStatus: 'visual-review-pending',
          requestedAt,
          firstMatchedAt: applied.firstMatchedAt,
          firstAppliedFrame: applied.first.sourceFrame,
          capturedProjection: applied.snapshot,
          consumedMatchingFrames: applied.snapshot.sourceFrame - applied.first.sourceFrame,
          health,
          views: [],
        }
        for (const camera of accentCameras) {
          await page.getByRole('button', { name: camera, exact: true }).click()
          await pause(50)
          const snapshot = await overlayProjection()
          if (snapshot?.profileId !== profile.id || !sameProjectionLease(applied.first, snapshot)) {
            evidence.views.push({
              camera,
              captured: false,
              reason: 'execution-ended-before-capture',
            })
            continue
          }
          const file = `profile-${profile.id}-seed-${seed}-${camera.replaceAll(' ', '-')}.png`
          await page.screenshot({ path: path.join(directory, file) })
          evidence.views.push({ camera, captured: true, file, sourceFrame: snapshot.sourceFrame })
        }
        const snapshot = await overlayProjection()
        if (snapshot?.profileId === profile.id && sameProjectionLease(applied.first, snapshot)) {
          const file = `profile-${profile.id}-seed-${seed}-overlay.png`
          await overlayPage().screenshot({ path: path.join(directory, file) })
          evidence.overlay = { captured: true, file, sourceFrame: snapshot.sourceFrame }
        }
        const planned = report.standingQualification.cases.find(
          (entry) => entry.profileId === profile.id && entry.seed === seed,
        )
        assert(planned, 'Executed profile/seed was absent from the qualification plan')
        planned.status = 'sampled'
        planned.actualSeed = applied.snapshot.seed
        planned.firstAppliedFrame = applied.first.sourceFrame
        planned.consumedMatchingFrames = evidence.consumedMatchingFrames
        // Images and a valid applied seed are evidence for review, not artistic acceptance.
        report.presentation.push(evidence)
        persist()
      }
    }
    if (profiles.length)
      report.standingQualification.fixedSeedExecution =
        seedCount === FIXED_SEEDS.length
          ? 'sampled-visual-and-metric-review-pending'
          : 'subset-sampled-visual-and-metric-review-pending'
  } finally {
    if (restoreViewport) await restoreViewport()
  }
  await seedField.fill('')
  await seedField.press('Tab')
  if (process.argv.includes('--skip-profiles')) {
    const presence = motionProfiles.find((entry) => entry.id === 'presence_poised')
    const library = page.locator('.animation-library')
    await library.getByRole('searchbox').fill(presence.labels.en)
    await library.getByText(presence.labels.en, { exact: true }).click()
    await page.getByRole('button', { name: 'Play', exact: true }).click()
  }
  const previous = (await sleepSample(0)).motion
  await page.getByRole('button', { name: 'Generate variation', exact: true }).click()
  await pause(2500)
  let rerolled = (await sleepSample(0)).motion
  const rerollDeadline = Date.now() + 15000
  while (
    (!rerolled.session || rerolled.session.seed === previous.session?.seed) &&
    Date.now() < rerollDeadline
  ) {
    await pause(200)
    rerolled = (await sleepSample(0)).motion
  }
  assert.notEqual(rerolled.session?.seed, previous.session?.seed, 'Debug reroll reused its seed')
  assert(rerolled.session, 'Debug reroll lost the active session')
  assert.equal(
    rerolled.modelGeneration,
    previous.modelGeneration,
    'Debug reroll restarted the worker',
  )
  report.reroll = { before: previous, after: rerolled }
  await page.getByRole('button', { name: 'Reload Model', exact: true }).click()
  await ready()
  report.modelReload = (await sleepSample(0)).motion
  await page.evaluate(async () => {
    await window.api.config.save({ overlayViewMode: 'portrait' })
    await window.api.overlay.applySettings()
  })
  await pause(2000)
  for (const target of application.windows())
    if (target !== page)
      await target.screenshot({ path: path.join(directory, 'overlay-portrait.png') })
  const beforeHidden = await overlayProjection()
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => !w.webContents.getURL().includes('overlay=1'))
      .hide(),
  )
  await pause(2000)
  report.hiddenMain = (await sleepSample(0)).avatar.health
  const afterHidden = await overlayProjection()
  report.hiddenMainProjection = { before: beforeHidden, after: afterHidden }
  assert(
    report.hiddenMain.modelLoaded &&
      beforeHidden &&
      afterHidden &&
      sameProjectionLease(beforeHidden, afterHidden) &&
      afterHidden.sourceFrame > beforeHidden.sourceFrame,
    'Hidden Main did not continue publishing matching source motion',
  )
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => !w.webContents.getURL().includes('overlay=1'))
      .showInactive(),
  )
  for (let index = 0; index < 2; index++) {
    await page.evaluate(() => window.api.overlay.toggle())
    await pause(1500)
    await probeActualWindows()
  }
  await page.reload()
  await page.waitForFunction(() => !!window.api?.alive)
  await ready()
  report.rendererReload = (await sleepSample(0)).motion
  await probeActualWindows()
  log({ focusedPresentation: true, profiles: profiles.length })
}
async function qualifyTurns() {
  await page.waitForFunction(() => !!window.__motionAbController)
  await page.locator('.app-sidebar').getByRole('button', { name: 'Avatar', exact: true }).click()
  await page.getByRole('button', { name: 'Full body', exact: true }).click()
  const turnLibrary = page.locator('.animation-library')
  await turnLibrary.getByRole('searchbox').fill('Full body turn')
  await turnLibrary.getByText('Full body turn', { exact: true }).click()
  if (process.argv.includes('--hide-windows'))
    await application.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.hide()
    })
  report.turns = []
  report.turnSource = 'typed Debug Preview; real production body executor; procedural fallback'
  for (const fixture of [
    { direction: 'clockwise', seed: 17 },
    { direction: 'counterclockwise', seed: 101 },
    { direction: 'clockwise', seed: 271, interrupt: true },
    { direction: 'clockwise', seed: 503, speech: true },
  ].filter((fixture) => !turnSeeds || turnSeeds.includes(fixture.seed))) {
    if (report.turns.length) {
      await page.evaluate(() => window.__motionAbController.reloadPreviewModel())
      await ready()
    }
    const stopTurnVideo = recordVideo
      ? await recordCanvas(overlayPage(), path.join(directory, `turn-${fixture.seed}.webm`))
      : null
    const stopMainTurnVideo =
      recordVideo && !fixture.speech
        ? await recordCanvas(page, path.join(directory, `turn-${fixture.seed}-full-body.webm`))
        : null
    await page.evaluate((fixture) => {
      const c = window.__motionAbController
      const a = c.avatarRuntime.controller
      const state = {
        samples: [],
        maxDrift: 0,
        supportChanges: 0,
        maxMouth: 0,
        consumedSamples: 0,
        done: false,
        speechDone: false,
        maxFrameIntervalMs: 0,
      }
      let previousSupport,
        anchors = {},
        previousExecution
      const frame = () => {
        const now = performance.now()
        if (state.lastFrameAt !== undefined)
          state.maxFrameIntervalMs = Math.max(state.maxFrameIntervalMs, now - state.lastFrameAt)
        state.lastFrameAt = now
        state.planning = a.vrmModel.bodyPlayback.turn?.getPlanningDebug() ?? state.planning
        const pose = a.getBodyPresentation()
        const debug = a.vrmModel.getBodyMotionDebugState()
        const physical = debug.generated.physical
        if (physical && physical.executionId === state.executionId) {
          state.physical = physical
          state.done ||= physical.outcome !== null
        }
        if (
          pose?.profileId === 'turn_in_place' &&
          pose.lease?.seed === fixture.seed &&
          pose.executionId === physical?.executionId
        ) {
          state.executionId = pose.executionId
          if (pose.executionId !== previousExecution) {
            previousExecution = pose.executionId
            anchors = {}
          }
          const support = physical.support
          for (const side of ['left', 'right']) {
            const foot = a.vrmModel.vrm.humanoid.getRawBoneNode(`${side}Foot`)
            const position = foot.getWorldPosition(foot.position.clone())
            if (support === 'double' || support === side) {
              anchors[side] ??= position.clone()
              state.maxDrift = Math.max(state.maxDrift, position.distanceTo(anchors[side]))
            } else delete anchors[side]
          }
          if (previousSupport !== undefined && support !== previousSupport) state.supportChanges++
          previousSupport = support
          if (state.samples.length < 1800)
            state.samples.push({
              atMs: performance.now(),
              heading: physical.actionHeading,
              phase: pose.phaseId,
              support,
              outcome: physical.outcome,
              executionId: pose.executionId,
            })
          state.physical = physical
          state.done ||= physical.outcome !== null
        }
        state.maxMouth = Math.max(state.maxMouth, ...Object.values(a.getMouthWeights()))
        state.consumedSamples = Math.max(
          state.consumedSamples,
          c.player.getPcmClock()?.sourceSampleOffset ?? 0,
        )
        state.frame = requestAnimationFrame(frame)
      }
      window.__turnProbe = state
      frame()
      c.previewAvatarVariation('turn_in_place', fixture.seed, {
        action: 'turn-in-place',
        turns: 1,
        direction: fixture.direction,
        tempo: 1,
        finishFacing: 'viewer',
      })
    }, fixture)
    let interrupted = false,
      speechStarted = false,
      stopSpeechVideo
    const screenshots = new Set()
    const deadline = Date.now() + 45000
    let state
    while (Date.now() < deadline) {
      state = await page.evaluate(() => {
        const { frame, samples, ...state } = window.__turnProbe
        return { ...state, latest: samples.at(-1), sampleCount: samples.length }
      })
      if (fixture.interrupt && !interrupted && Math.abs(state.latest?.heading ?? 0) > 1.2) {
        await page.getByRole('button', { name: 'Stop', exact: true }).click()
        interrupted = true
      }
      if (fixture.speech && !speechStarted && state.latest?.phase === 'stroke') {
        stopSpeechVideo = await recordCanvas(page, path.join(directory, 'turn-with-fish.webm'))
        await page.evaluate(() => {
          const c = window.__motionAbController
          const text =
            'Конечно! Смотри, я плавно переношу вес и поворачиваюсь вокруг себя. Теперь снова смотрю на тебя. Мы можем спокойно продолжать наш разговор, пока движение завершается.'
          c.characterResponse.createReply = async (turnId, _user, _screen, onEvent) => {
            const base = { turnId, requestId: `fixture:${turnId}`, at: Date.now(), llmRound: 0 }
            onEvent?.({ ...base, type: 'text-delta', delta: { text, emotion: 'calm' } })
            onEvent?.({ ...base, type: 'completed' })
            return {
              replyText: `[calm]${text}`,
              displayText: text,
              speechText: text,
              emotionKey: 'calm',
              segments: [
                {
                  id: 'fixture',
                  index: 0,
                  emotion: 'calm',
                  text,
                  boundaryAfter: 'sentence',
                  targetMaxGapMs: 0,
                },
              ],
            }
          }
          void c.sendText('Шио, можешь покрутиться вокруг себя?').then(
            () => {
              window.__turnProbe.speechDone = true
            },
            () => {
              window.__turnProbe.speechDone = true
              window.__turnProbe.speechFailed = true
            },
          )
        })
        speechStarted = true
      }
      const quadrant = Math.floor(Math.abs(state.latest?.heading ?? 0) / (Math.PI / 2))
      if (quadrant > 0 && !screenshots.has(quadrant)) {
        screenshots.add(quadrant)
        await page.screenshot({
          path: path.join(directory, `turn-${fixture.seed}-${quadrant}.png`),
        })
      }
      if (state.done && (!fixture.speech || state.speechDone)) break
      await pause(40)
    }
    if (stopSpeechVideo) report.turnSpeechVideo = await stopSpeechVideo()
    const full = await page.evaluate(() => {
      const state = window.__turnProbe
      cancelAnimationFrame(state.frame)
      const { frame, ...result } = state
      return result
    })
    const expected = fixture.interrupt ? 'cancelled' : 'completed'
    await pause(200)
    const mainPose = await page.evaluate(() => {
      const model = window.__motionAbController.avatarRuntime.controller.vrmModel.vrm
      const hips = model.humanoid.getNormalizedBoneNode('hips')
      return {
        stage: model.scene.quaternion.toArray(),
        hips: hips.position.toArray(),
        feet: ['leftFoot', 'rightFoot'].map((name) => {
          const foot = model.humanoid.getNormalizedBoneNode(name)
          return foot.getWorldPosition(foot.position.clone()).toArray()
        }),
      }
    })
    const overlayPose = await overlayPage().evaluate(() => {
      const model = window.__qualificationModels?.findLast(
        (candidate) =>
          candidate.vrm && candidate.getBodyMotionDebugState().presentationMode === 'mirror',
      )?.vrm
      if (!model) return null
      const hips = model.humanoid.getNormalizedBoneNode('hips')
      return {
        stage: model.scene.quaternion.toArray(),
        hips: hips.position.toArray(),
        feet: ['leftFoot', 'rightFoot'].map((name) => {
          const foot = model.humanoid.getNormalizedBoneNode(name)
          return foot.getWorldPosition(foot.position.clone()).toArray()
        }),
      }
    })
    const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))
    const overlay = overlayPose
      ? {
          rootDistanceM: distance(mainPose.hips, overlayPose.hips),
          stageAngleRad:
            2 *
            Math.acos(
              Math.min(
                1,
                Math.abs(mainPose.stage.reduce((sum, v, i) => sum + v * overlayPose.stage[i], 0)),
              ),
            ),
          feetDistanceM: mainPose.feet.map((v, i) => distance(v, overlayPose.feet[i])),
        }
      : null
    const passed =
      full.physical?.outcome === expected &&
      full.physical.maxRootAccelerationMps2 < 8.5 &&
      full.maxDrift < 0.003 &&
      full.supportChanges >= 2 &&
      (fixture.interrupt ||
        Math.abs(Math.abs(full.physical.actionHeading) - 2 * Math.PI) < 0.002) &&
      (!fixture.speech ||
        (full.consumedSamples > 44100 && full.maxMouth > 0.05 && !full.speechFailed))
    const video = stopTurnVideo ? await stopTurnVideo() : null
    const mainVideo = stopMainTurnVideo ? await stopMainTurnVideo() : null
    report.turns.push({
      ...fixture,
      ...full,
      video,
      mainVideo,
      overlay,
      passed:
        passed &&
        !!overlay &&
        overlay.rootDistanceM < 0.012 &&
        overlay.stageAngleRad < 0.03 &&
        overlay.feetDistanceM.every((v) => v < 0.012),
      visualAcceptance: 'pending',
    })
    log({
      turn: fixture,
      outcome: full.physical?.outcome,
      maxDrift: full.maxDrift,
      supportChanges: full.supportChanges,
      passed,
    })
    for (const theme of ['light', 'dark']) {
      await page.evaluate((uiTheme) => window.api.config.save({ uiTheme }), theme)
      await page.screenshot({ path: path.join(directory, `turn-${fixture.seed}-${theme}.png`) })
    }
  }
}

async function bodyStability() {
  report.bodyStability = []
  const geometry = await loadRigGeometry(
    config.vrmPath || path.join(desktop, 'src/renderer/assets/vrm/green_fox.vrm'),
  )
  report.modelFixture.vrmVersion = geometry.vrmVersion
  await page.locator('.app-sidebar').getByRole('button', { name: 'Avatar', exact: true }).click()
  await page.getByRole('button', { name: 'Full body', exact: true }).click()
  const seed = page.getByRole('textbox', { name: 'Fixed variation seed', exact: true })
  if (!(await seed.isVisible()))
    await page.getByRole('button', { name: 'Developer details', exact: true }).click()
  for (const requestedSeed of FIXED_SEEDS.slice(0, seedCount)) {
    for (const profile of selectedProfiles) {
      const library = page.locator('.animation-library')
      await library.getByRole('searchbox').fill(profile.labels.en)
      await library.getByText(profile.labels.en, { exact: true }).click()
      await page.getByRole('heading', { name: profile.labels.en, exact: true }).waitFor()
      await seed.fill(String(requestedSeed))
      await seed.press('Tab')
      const overlay = overlayPage()
      await overlay.evaluate(installGeometryProbe, geometry)
      await overlay.evaluate(
        async ({ id, requestedSeed }) => {
          const preceding = await window.overlayApi.avatarBody.get()
          const result = {
            profileId: id,
            seed: requestedSeed,
            executionId: null,
            entryTransitionMaxDeg: 0,
            count: 0,
            maxTorsoTiltDeg: 0,
            steps: {},
            normalizedSteps: {},
            maxCompositionIntervalMs: 0,
            timestampedSamples: 0,
            reversals: {},
            jumps: [],
            maxHoldMs: 0,
            phases: {},
            outcome: null,
            firstSourceFrame: null,
            lastSourceFrame: null,
            fingerBoneCount: 0,
            geometry: {},
          }
          const multiply = (a, b) => [
            a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
            a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
            a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
            a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
          ]
          let previous = null
          let heldAt = null
          const directions = {}
          window.__bodyProbeStop?.()
          window.__bodyProbe = result
          window.__bodyProbeStop = window.overlayApi.avatarBody.onUpdated((pose) => {
            if (
              !pose ||
              pose.profileId !== id ||
              pose.lease?.seed !== requestedSeed ||
              pose.executionId === preceding?.executionId
            )
              return
            result.executionId ??= pose.executionId
            if (pose.executionId !== result.executionId) return
            if (result.count === 0 && preceding) {
              for (const [name, q] of Object.entries(pose.bones)) {
                const p = preceding.bones[name]
                if (!p) continue
                const product = q.reduce((sum, value, index) => sum + value * p[index], 0)
                result.entryTransitionMaxDeg = Math.max(
                  result.entryTransitionMaxDeg,
                  (2 * Math.acos(Math.min(1, Math.abs(product))) * 180) / Math.PI,
                )
              }
            }
            result.firstSourceFrame ??= pose.frame
            result.lastSourceFrame = pose.frame
            result.fingerBoneCount = Object.keys(pose.bones).filter((name) =>
              /^(left|right)(Thumb|Index|Middle|Ring|Little)/u.test(name),
            ).length
            result.count++
            if (Number.isFinite(pose.composedAtMs)) result.timestampedSamples++
            if (pose.phaseId) result.phases[pose.phaseId] = (result.phases[pose.phaseId] ?? 0) + 1
            if (pose.outcome) result.outcome = pose.outcome
            const measured = window.__measureRig(pose)
            result.geometry[pose.phaseId] ??= {
              count: 0,
              left: {},
              right: {},
            }
            const phaseGeometry = result.geometry[pose.phaseId]
            phaseGeometry.count++
            for (const side of ['left', 'right']) {
              for (const [name, value] of Object.entries(measured[side])) {
                phaseGeometry[side][name] ??= { min: value, max: value, sum: 0 }
                const metric = phaseGeometry[side][name]
                metric.min = Math.min(metric.min, value)
                metric.max = Math.max(metric.max, value)
                metric.sum += value
                metric.last = value
              }
            }
            if (previous && pose.frame === previous.frame && !pose.localRecovery) {
              heldAt ??= Date.now()
              result.maxHoldMs = Math.max(result.maxHoldMs, Date.now() - heldAt)
            } else heldAt = null
            let torso = [0, 0, 0, 1]
            for (const name of ['hips', 'spine', 'chest', 'upperChest']) {
              if (pose.bones[name]) torso = multiply(torso, pose.bones[name])
              const tilt =
                (Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (torso[0] ** 2 + torso[2] ** 2)))) *
                  180) /
                Math.PI
              result.maxTorsoTiltDeg = Math.max(result.maxTorsoTiltDeg, tilt)
            }
            if (previous) {
              const intervalMs = pose.composedAtMs - previous.composedAtMs
              result.maxCompositionIntervalMs = Math.max(
                result.maxCompositionIntervalMs,
                Number.isFinite(intervalMs) ? intervalMs : 0,
              )
              for (const [name, q] of Object.entries(pose.bones)) {
                if (
                  !/^(hips|spine|chest|upperChest|.*Shoulder|.*Arm|.*Leg)$/u.test(name) ||
                  !previous.bones[name]
                )
                  continue
                const p = previous.bones[name]
                let d = multiply(q, [-p[0], -p[1], -p[2], p[3]])
                if (d[3] < 0) d = d.map((v) => -v)
                const step = (2 * Math.acos(Math.min(1, Math.abs(d[3]))) * 180) / Math.PI
                if (step > 3 && result.jumps.length < 32)
                  result.jumps.push({
                    at: Date.now(),
                    name,
                    step,
                    frame: pose.frame,
                    frameDelta: pose.frame - previous.frame,
                  })
                result.steps[name] ??= []
                result.steps[name].push(step)
                if (intervalMs > 0) {
                  result.normalizedSteps[name] ??= []
                  result.normalizedSteps[name].push((step * (1000 / 30)) / intervalMs)
                }
                const old = directions[name]
                if (
                  old &&
                  step > 0.03 &&
                  old.step > 0.03 &&
                  d.slice(0, 3).reduce((s, v, i) => s + v * old.d[i], 0) < 0
                )
                  result.reversals[name] = (result.reversals[name] ?? 0) + 1
                directions[name] = { d, step }
              }
            }
            previous = pose
          })
        },
        { id: profile.id, requestedSeed },
      )
      await page.getByRole('button', { name: 'Generate variation', exact: true }).click()
      let readinessFailure = null
      try {
        await appliedProfile(profile.id, requestedSeed)
      } catch (error) {
        readinessFailure = error.message
      }
      const until = Date.now() + bodySeconds * 1000
      const deadline = until + 6000
      let unresolvedArmContacts = 0
      const recoveryBlockers = new Set()
      let capture = 0
      const views = []
      while (Date.now() < deadline) {
        if (Date.now() >= until) {
          const outcome = await overlay.evaluate(() => window.__bodyProbe.outcome)
          if (profile.kind === 'presence' || outcome) break
        }
        const sampled = await sleepSample()
        const blocker = sampled?.avatar.health?.motion?.planning?.recoveryBlockedBy
        if (blocker) recoveryBlockers.add(blocker)
        unresolvedArmContacts = Math.max(
          unresolvedArmContacts,
          sampled?.avatar.health?.motion?.safety?.unresolvedArmContacts ?? 0,
        )
        if (
          capture < 3 &&
          Date.now() >
            until - bodySeconds * 1000 + capture * Math.min(4000, (bodySeconds * 1000) / 3)
        ) {
          if (capture === 0) {
            for (const camera of accentCameras) {
              await page.getByRole('button', { name: camera, exact: true }).click()
              await pause(50)
              const projection = await overlayProjection()
              const matching =
                projection?.profileId === profile.id && projection.seed === requestedSeed
              const file = `stability-${profile.id}-seed-${requestedSeed}-${camera.replaceAll(' ', '-')}.png`
              if (matching) await page.screenshot({ path: path.join(directory, file) })
              views.push({
                camera,
                captured: matching,
                phaseId: projection?.phaseId ?? null,
                ...(matching ? { file, sourceFrame: projection.sourceFrame } : {}),
              })
            }
            await page.getByRole('button', { name: 'Full body', exact: true }).click()
          }
          await page.screenshot({
            path: path.join(
              directory,
              `stability-${profile.id}-seed-${requestedSeed}-${capture++}.png`,
            ),
          })
        }
        await pause(100)
      }
      const evidence = await overlay.evaluate(() => {
        window.__bodyProbeStop()
        const result = window.__bodyProbe
        for (const series of [result.steps, result.normalizedSteps]) {
          for (const [name, steps] of Object.entries(series)) {
            steps.sort((a, b) => a - b)
            series[name] = {
              count: steps.length,
              totalDeg: steps.reduce((sum, value) => sum + value, 0),
              p95Deg: steps[Math.floor(steps.length * 0.95)],
              maxDeg: steps.at(-1),
            }
          }
        }
        for (const phase of Object.values(result.geometry)) {
          for (const side of ['left', 'right']) {
            for (const metric of Object.values(phase[side])) {
              metric.mean = metric.sum / phase.count
              delete metric.sum
            }
          }
        }
        return result
      })
      evidence.unresolvedArmContacts = unresolvedArmContacts
      evidence.recoveryBlockers = [...recoveryBlockers]
      evidence.readinessFailure = readinessFailure
      evidence.actualProfileAtEnd = (await overlayProjection())?.profileId ?? null
      evidence.views = views
      const planned = report.standingQualification.cases.find(
        (entry) => entry.profileId === profile.id && entry.seed === requestedSeed,
      )
      planned.status = 'sampled'
      planned.actualSeed = requestedSeed
      planned.visualAcceptance = 'review-pending'
      planned.poseMetrics = 'recorded'
      report.bodyStability.push(evidence)
      log({
        bodyStability: {
          profileId: evidence.profileId,
          seed: requestedSeed,
          count: evidence.count,
          phases: evidence.phases,
          outcome: evidence.outcome,
          contacts: evidence.unresolvedArmContacts,
          maxStepDeg: Math.max(...Object.values(evidence.steps).map((step) => step.maxDeg)),
          maxStepDegAt30Hz: Math.max(
            ...Object.values(evidence.normalizedSteps).map((step) => step.maxDeg),
          ),
          readinessFailure,
        },
      })
    }
  }
  report.standingQualification.fixedSeedExecution =
    seedCount === FIXED_SEEDS.length
      ? 'sampled-visual-and-metric-review-pending'
      : 'subset-sampled-visual-and-metric-review-pending'
}
;(async () => {
  application = await _electron.launch({
    executablePath: process.env.SHIO_QUALIFICATION_DESKTOP_EXECUTABLE || require('electron'),
    args: process.env.SHIO_QUALIFICATION_DESKTOP_EXECUTABLE ? [] : [launchDesktop],
    cwd: launchDesktop,
    env: environment,
    timeout: 30000,
  })
  try {
    page = await application.firstWindow()
    await application.evaluate(({ app, BrowserWindow }, audible) => {
      const prepare = (window) => {
        window.setTitle('Shio · ARDY/Fish qualification')
        window.webContents.setAudioMuted(!audible)
        if (!window.webContents.getURL().includes('overlay=1')) window.setSize(1700, 1000)
        window.setFocusable(false)
      }
      for (const window of BrowserWindow.getAllWindows()) prepare(window)
      app.on('browser-window-created', (_event, window) => prepare(window))
    }, audibleOutput)
    await page.waitForLoadState('domcontentloaded')
    observePageErrors(page)
    application.on('window', (target) => observePageErrors(target))
    report.lifecycle = []
    page.on('console', (message) => {
      if (/^\[(lipsync|ANIMDBG)\]/u.test(message.text())) {
        report.lifecycle.push({ at: Date.now(), message: message.text().slice(0, 500) })
        if (report.lifecycle.length > 128) report.lifecycle.shift()
      }
    })
    await page.waitForFunction(() => !!window.api?.alive)
    if (modelsOnly) {
      report.mode = 'provider-model-discovery'
      report.providerModels = await page.evaluate(async () => {
        const providers = await window.api.llm.providers()
        return Promise.all(
          providers.map(async (provider) => ({
            providerId: provider.id,
            result: await window.api.llm.fetchModels(provider.id),
          })),
        )
      })
      report.passed = true
      persist()
      return
    }
    assert.equal(
      (await page.evaluate(() => window.api.config.get())).uiLocale,
      'en',
      'Main did not load its isolated qualification config',
    )
    await page.evaluate(async () => {
      const snapshot = await window.api.alive.snapshot()
      await window.api.alive.updateSettings({
        ...snapshot.settings,
        mode: 'off',
        globallySuspended: true,
        fastBrain: { ...snapshot.settings.fastBrain, enabled: false },
      })
    })
    const actualProfile = await application.evaluate(({ app }) => app.getPath('userData'))
    assert.equal(
      path.resolve(actualProfile),
      profile,
      'Qualification escaped its isolated userData',
    )
    if (coreOnly) {
      report.corePlugins = await page.evaluate(async () => {
        const plugins = await window.api.plugins.list()
        for (const plugin of plugins) await window.api.plugins.disable(plugin.manifest.id)
        return (await window.api.plugins.list()).map((plugin) => ({
          id: plugin.manifest.id,
          enabled: plugin.enabled,
          lifecycle: plugin.lifecycle,
        }))
      })
      assert(
        report.corePlugins.every((plugin) => !plugin.enabled),
        'Optional Plugin remained enabled',
      )
    }
    report.applicationVersion = await application.evaluate(({ app }) => app.getVersion())
    report.llm = await page.evaluate(() => window.api.llm.getReadiness())
    await ready()
    await frameProbe(page)
    const start = Date.now()
    report.readyAt = new Date(start).toISOString()
    await page.evaluate(async () => {
      if (!(await window.api.overlay.isVisible()).visible) await window.api.overlay.toggle()
    })
    await pause(6000)
    if (recordVideo && !turnCases && !livingCases && !conversationCases && !dynamicsReplay) {
      const overlay = application.windows().find((target) => target.url().includes('overlay=1'))
      assert(overlay, 'Overlay unavailable for video recording')
      stopRecording = await recordCanvas(overlay, path.join(directory, 'overlay.webm'))
    }
    for (const target of application.windows()) {
      await frameProbe(target)
      await captureWindow(
        application,
        target,
        path.join(directory, `start-${target === page ? 'main' : 'overlay'}.png`),
      )
    }
    if (conversationCases)
      await qualifyConversation({
        application,
        page,
        directory,
        report,
        pause,
        duration,
        motionProfiles,
      })
    else if (livingCases)
      await qualifyLiving({ application, page, directory, report, pause, recordVideo })
    else if (dynamicsReplay) await replayDynamics({ page, desktop, directory, report, pause })
    else if (turnCases) await qualifyTurns()
    else if (bodyStabilityOnly) await bodyStability()
    else if (focused && !modelOnly) await focusedPresentation()
    for (let index = 0; !bodyStabilityOnly && index < responseCount; index++) {
      await response(index)
      if (index < responseCount - 1 && responseSpacing) await paceResponse()
    }
    if (!bodyStabilityOnly && semanticCasesRequested) await semanticQualification()
    if (!bodyStabilityOnly && (duration >= 1800 || (focused && !modelOnly))) {
      const modes = ['before-pcm', 'during-pcm', 'after-input']
      for (const [index, mode] of modes.entries()) {
        if (responseSpacing) await paceResponse()
        await response(report.responses.length, mode)
        await restartMotionAfterCancellation()
        await ready(index < modes.length - 1)
      }
    }
    let nextReply = Date.now() + 90000
    while (!bodyStabilityOnly && Date.now() - start < duration * 1000) {
      await sleepSample()
      if (Date.now() >= nextReply) {
        await response(report.responses.length)
        nextReply = Date.now() + 90000
      }
      await pause(500)
    }
    await probeActualWindows()
    for (const target of application.windows()) {
      report.frames.push({
        url: target.url(),
        stats: await target.evaluate(() => {
          const stats = window.__shioFrameProbe
          return stats ? { ...stats, elapsedMs: performance.now() - stats.startedAt } : null
        }),
      })
      await captureWindow(
        application,
        target,
        path.join(directory, `end-${target === page ? 'main' : 'overlay'}.png`),
      )
    }
    report.elapsedSeconds = (Date.now() - start) / 1000
    if (bodyStabilityOnly && !turnCases && !livingCases && !conversationCases && !dynamicsReplay) {
      report.bodyStabilityAcceptance = report.bodyStability.map((entry) => {
        const opening = entry.geometry.hold?.right?.indexMiddleOpeningDeg?.last
        const correctV = entry.profileId !== 'peace_single' || (opening >= 12 && opening <= 45)
        const p95StepDeg =
          motionProfiles.find((profile) => profile.id === entry.profileId).kind === 'presence'
            ? 1
            : 3
        return {
          profileId: entry.profileId,
          seed: entry.seed,
          visualAcceptance: 'pending',
          ...(entry.profileId === 'peace_single' ? { indexMiddleOpeningDeg: opening } : {}),
          passed:
            correctV &&
            entry.count >= 30 &&
            !entry.readinessFailure &&
            Object.entries(entry.steps)
              .filter(([name]) => name.endsWith('Arm'))
              .reduce((sum, [, step]) => sum + step.totalDeg, 0) >= 2 &&
            (motionProfiles.find((profile) => profile.id === entry.profileId).kind === 'presence' ||
              (entry.outcome === 'completed' &&
                ['prepare', 'stroke', 'hold', 'recover'].every(
                  (phase) => entry.phases[phase] > 0,
                ))) &&
            entry.unresolvedArmContacts === 0 &&
            entry.maxTorsoTiltDeg <= 6 &&
            entry.timestampedSamples === entry.count &&
            Object.keys(entry.normalizedSteps).length > 0 &&
            Object.values(entry.normalizedSteps).every(
              (step) => step.p95Deg <= p95StepDeg && step.maxDeg <= 3,
            ),
          limits: {
            minimumSamples: 30,
            torsoTiltDeg: 6,
            p95StepDeg,
            maximumStepDeg: 3,
            stepIntervalMs: 1000 / 30,
            rawTransportStepsRetained: true,
          },
        }
      })
    }
    if (componentSmoke && !bodyStabilityOnly) {
      const evidence = report.componentEvidence
      const inference = [...evidence.inferenceMs].sort((a, b) => a - b)
      evidence.inferenceSummaryMs = {
        count: inference.length,
        p50: inference[Math.floor(inference.length * 0.5)] ?? null,
        p95: inference[Math.floor(inference.length * 0.95)] ?? null,
        p99: inference[Math.floor(inference.length * 0.99)] ?? null,
      }
      evidence.motionErrors = [
        ...new Set(
          report.samples.flatMap((sample) =>
            sample.avatar.health?.motion?.error ? [sample.avatar.health.motion.error] : [],
          ),
        ),
      ]
      assert(evidence.blinkCycles >= 3, 'Fewer than three live blink close/open cycles')
      assert(
        evidence.captures.some((capture) => capture.capture === 'speaking-lipsync'),
        'No real speaking frame captured',
      )
    }
    report.passed =
      report.failures.length === 0 &&
      (!bodyStabilityOnly ||
        (conversationCases
          ? report.conversation.passed
          : livingCases
            ? report.living.every((entry) => entry.passed)
            : dynamicsReplay
              ? report.dynamicsReplay.videos.every(
                  (entry) => entry.frames > 0 && entry.errors.length === 0,
                )
              : turnCases
                ? report.turns.every((entry) => entry.passed)
                : report.bodyStabilityAcceptance.every((entry) => entry.passed))) &&
      (bodyStabilityOnly || report.responses.length >= responseCount) &&
      (bodyStabilityOnly || report.elapsedSeconds >= duration) &&
      (!componentSmoke || report.componentEvidence.motionErrors.length === 0)
    assert(report.passed, 'Joint qualification failed')
  } catch (failure) {
    report.failures.push(failure.message)
    report.libraryUi = await page
      .locator('.animation-library')
      .ariaSnapshot()
      .catch(() => 'unavailable')
    report.testReply = await page
      .locator('.message-assistant')
      .last()
      .innerText()
      .catch(() => '')
    throw failure
  } finally {
    if (stopRecording) {
      try {
        report.video = await stopRecording()
        if (
          report.video.exitCode !== 0 ||
          report.video.frames === 0 ||
          report.video.errors.length
        ) {
          report.failures.push('Video recording failed')
          report.passed = false
        }
      } catch (error) {
        report.failures.push(`Video recording failed: ${error.message}`)
        report.passed = false
      }
    }
    await application.close()
    report.finishedAt = new Date().toISOString()
    log({ report: path.join(directory, 'report.json'), passed: report.passed ?? false })
  }
})().catch((failure) => {
  console.error(failure.message)
  process.exitCode = 1
})
