const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { recordCanvas } = require('./record-canvas.cjs')
const { recordAudio } = require('./record-audio.cjs')
const { captureWindow } = require('./capture-window.cjs')
const { assessGesture } = require('./conversation-evidence.cjs')

async function qualifyConversation({
  application,
  page,
  directory,
  report,
  pause,
  duration,
  motionProfiles,
}) {
  const overlay = application.windows().find((target) => target.url().includes('overlay=1'))
  assert(overlay, 'Real conversation requires Overlay')
  assert.equal(await page.locator('canvas').count(), 0, 'Avatar Preview must stay unmounted')
  const fixtures = [
    { id: 'ordinary', at: 0, text: 'Привет! Как настроение? Ответь коротко.' },
    {
      id: 'explanation',
      at: 60,
      text: 'Объясни на простом примере, чем привычка отличается от разового решения. Два-три предложения, примерно на 10–15 секунд.',
      requireGesture: true,
    },
    {
      id: 'greeting',
      at: 125,
      text: 'Поприветствуй меня лёгким взмахом руки и скажи пару слов.',
      requireGesture: true,
      expectedHint: 'greeting',
    },
    {
      id: 'surprise',
      at: 165,
      text: 'Представь: знакомый кот только что совершенно отчётливо произнёс твоё имя! Как бы ты удивилась? Ответь одной-двумя фразами.',
    },
    {
      id: 'emotion',
      at: 210,
      text: 'Ура, у нас всё получилось с первой попытки! Очень рад поделиться с тобой. Как тебе такая новость? Ответь коротко.',
      requireGesture: true,
    },
    {
      id: 'settle',
      at: 260,
      text: 'Спасибо, я немного помолчу. Ответь одним коротким предложением.',
    },
  ]
  const subset = process.argv
    .find((arg) => arg.startsWith('--conversation-case-ids='))
    ?.split('=')[1]
    .split(',')
  assert(
    !subset || subset.every((id) => fixtures.some((item) => item.id === id)),
    'Unknown conversation case',
  )
  const cases = fixtures.filter((item) => !subset || subset.includes(item.id))
  report.conversation = {
    source: 'Unmodified CharacterResponsePort; actual Main LLM, Fish, ARDY; Chat + Overlay',
    cases: [],
    visualAcceptance: 'pending',
    selectedView: await page.evaluate(async () => {
      const config = await window.api.config.get()
      return {
        mode: config.overlayViewMode,
        scale: config.overlayScale,
        width: config.overlayWidth,
        height: config.overlayHeight,
      }
    }),
    facialCapabilities: await page.evaluate(
      () =>
        window.__motionAbController.avatarRuntime.controller.vrmModel.getFacialDebugState()
          .actingCapabilities,
    ),
  }
  await overlay.evaluate(() => {
    const c = window.__motionAbController,
      model = c.avatarRuntime.controller.vrmModel
    const state = {
      executions: {},
      facial: {},
      camera: {
        position: c.scene.camera.position.toArray(),
        quaternion: c.scene.camera.quaternion.toArray(),
        fov: c.scene.camera.fov,
        maxPositionDelta: 0,
        maxQuaternionDelta: 0,
        maxFovDelta: 0,
      },
    }
    const distance = (x, y) => Math.hypot(...x.map((value, i) => value - y[i]))
    const frame = () => {
      model.vrm.scene.traverse((mesh) => {
        if (!mesh.morphTargetDictionary) return
        for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
          if (!/^(brow|eyeWide|eyeSquint|mouthSmile|mouthDimple|mouthFrown)/.test(name)) continue
          const value = mesh.morphTargetInfluences?.[index] ?? 0
          state.facial[name] ??= { min: 1, max: 0 }
          state.facial[name].min = Math.min(state.facial[name].min, value)
          state.facial[name].max = Math.max(state.facial[name].max, value)
        }
      })
      const camera = state.camera
      camera.maxPositionDelta = Math.max(
        camera.maxPositionDelta,
        distance(camera.position, c.scene.camera.position.toArray()),
      )
      camera.maxQuaternionDelta = Math.max(
        camera.maxQuaternionDelta,
        distance(camera.quaternion, c.scene.camera.quaternion.toArray()),
      )
      camera.maxFovDelta = Math.max(camera.maxFovDelta, Math.abs(camera.fov - c.scene.camera.fov))
      const pose = model.bodyPlayback.mirror
      if (pose?.executionId) {
        state.executions[pose.executionId] ??= {
          profileId: pose.profileId,
          hands: {},
        }
        const entry = state.executions[pose.executionId]
        for (const side of ['left', 'right']) {
          const raw = model.vrm.humanoid.getRawBoneNode(`${side}Hand`)
          if (!raw) continue
          const p = raw.getWorldPosition(raw.position.clone())
          entry.hands[side] ??= {
            initial: p.toArray(),
            excursionM: 0,
            strokeFrames: 0,
            visibleStrokeFrames: 0,
          }
          const hand = entry.hands[side]
          hand.excursionM = Math.max(hand.excursionM, distance(hand.initial, p.toArray()))
          if (pose.phaseId === 'stroke') {
            hand.strokeFrames++
            const points = [`${side}Hand`, `${side}IndexDistal`, `${side}LittleDistal`]
              .map((name) => model.vrm.humanoid.getRawBoneNode(name))
              .filter(Boolean)
            const visible = points.every((bone) => {
              const v = bone.getWorldPosition(bone.position.clone()).project(c.scene.camera)
              return Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 && v.z > -1 && v.z < 1
            })
            if (visible) hand.visibleStrokeFrames++
          }
        }
      }
      state.frame = requestAnimationFrame(frame)
    }
    state.stop = () => {
      cancelAnimationFrame(state.frame)
      return state.executions
    }
    window.__conversationOverlayProbe = state
    frame()
  })
  await page.evaluate(
    (profiles) => {
      const c = window.__motionAbController,
        a = c.avatarRuntime.controller,
        model = a.vrmModel,
        body = model.bodyPlayback
      const profileById = Object.fromEntries(profiles.map((profile) => [profile.id, profile]))
      const names = [
        'hips',
        'spine',
        'chest',
        'leftShoulder',
        'rightShoulder',
        'leftUpperArm',
        'rightUpperArm',
        'leftLowerArm',
        'rightLowerArm',
        'leftHand',
        'rightHand',
      ]
      const bones = Object.fromEntries(
        names
          .map((name) => [name, model.vrm.humanoid.getNormalizedBoneNode(name)])
          .filter(([, bone]) => bone),
      )
      const state = {
        timeOrigin: performance.timeOrigin,
        samples: [],
        cases: {},
        current: null,
        sourceStages: {},
        lastStamp: null,
        idleChestMin: Infinity,
        idleChestMax: -Infinity,
        layerViolations: 0,
        bodyEvents: [],
      }
      const angle = (x, y) =>
        2 * Math.acos(Math.min(1, Math.abs(x.reduce((sum, value, i) => sum + value * y[i], 0))))
      const distance = (x, y) => Math.hypot(...x.map((value, i) => value - y[i]))
      const previousStages = new Map(),
        originalObserver = body.dynamicsObserver
      const originalPump = body.pump
      state.requests = []
      body.pump = function (...args) {
        const active = this.inFlight
        originalPump.apply(this, args)
        if (!active && this.inFlight)
          state.requests.push({
            atMs: performance.now(),
            cursor: this.cursor,
            generatedEnd: this.generatedEnd,
            phase: this.inFlightPhase,
            forecast: this.forecast,
            executionId: this.execution?.id,
            version: this.profileVersion,
            replan: this.replan,
            wantsRecovery: this.execution?.wantsRecovery,
            clock: this.clock?.state,
            pending: this.pendingProfiles.map((item) => item.id),
          })
      }
      body.dynamicsObserver = (sample) => {
        originalObserver?.(sample)
        if (!names.includes(sample.bone)) return
        const key = `${sample.stage}:${sample.bone}`,
          previous = previousStages.get(key)
        state.sourceStages[key] ??= { travelRad: 0, peakRadS: 0, samples: 0 }
        const metric = state.sourceStages[key]
        if (
          previous &&
          sample.sourceFrame > previous.sourceFrame &&
          sample.sourceFrame - previous.sourceFrame < 4
        ) {
          const movement = angle(previous.rotation, sample.rotation)
          metric.travelRad += movement
          metric.peakRadS = Math.max(
            metric.peakRadS,
            movement / ((sample.sourceFrame - previous.sourceFrame) / 30),
          )
          metric.samples++
        }
        previousStages.set(key, sample)
      }
      const unsubscribe = window.api.llm.onReplyStreamEvent((event) => {
        const current = state.cases[state.current]
        if (!current) return
        current.turnId ??= event.turnId
        if (event.turnId !== current.turnId) return
        if (event.type === 'embodiment-intent') {
          current.intent = event.intent
          current.events.push({
            atMs: performance.now(),
            intent: event.intent,
            timing: event.timing,
          })
        }
      })
      let lastSample = 0
      const frame = () => {
        const pose = a.getBodyPresentation(),
          clock = c.player.getPcmClock(),
          now = performance.now()
        const current = state.cases[state.current]
        const generated = model.getBodyMotionDebugState().generated
        if (current) {
          const facial = model.getFacialDebugState()
          if (!current.facialProfiles.includes(facial.currentProfile))
            current.facialProfiles.push(facial.currentProfile)
          for (const [name, value] of Object.entries(facial.facialActing ?? {})) {
            current.facialActing[name] ??= { min: 1, max: 0 }
            current.facialActing[name].min = Math.min(current.facialActing[name].min, value)
            current.facialActing[name].max = Math.max(current.facialActing[name].max, value)
          }
          for (const warning of facial.stuckWarnings)
            if (!current.facialWarnings.includes(warning)) current.facialWarnings.push(warning)
        }
        const signature = JSON.stringify([
          body.execution?.id,
          body.execution?.phase,
          body.execution?.revision,
          body.execution?.ready,
          body.profileVersion,
          body.inFlightPhase,
          body.forecast,
          body.queue.map((chunk) => [
            chunk.startFrame,
            chunk.plan.phaseId,
            chunk.plan.planRevision,
          ]),
        ])
        if (signature !== state.lastBodyEvent && state.bodyEvents.length < 3000) {
          state.lastBodyEvent = signature
          state.bodyEvents.push({
            atMs: now,
            caseId: state.current,
            cursor: body.cursor,
            generatedEnd: body.generatedEnd,
            clockBase: body.clockBase,
            sourceSampleOffset: clock?.sourceSampleOffset,
            phase: body.execution?.phase,
            ready: body.execution?.ready,
            elapsedMs: body.execution?.elapsedMs,
            revision: body.execution?.revision,
            version: body.profileVersion,
            phaseAppliedFrame: body.phaseAppliedFrame,
            forecast: body.forecast,
            inFlightPhase: body.inFlightPhase,
            executionId: body.execution?.id,
            inferenceMs: body.lastInferenceMs,
            queue: body.queue.map((chunk) => ({ start: chunk.startFrame, plan: chunk.plan })),
          })
        }
        if (current && generated.error && !current.errors.includes(generated.error)) {
          current.errors.push(generated.error)
          current.errorStates.push({
            atMs: now,
            error: generated.error,
            planning: generated.planning,
            cursor: body.cursor,
            generatedEnd: body.generatedEnd,
            forecast: body.forecast,
            inFlightPhase: body.inFlightPhase,
            inferenceMs: generated.inferenceMs,
            sourceSampleOffset: clock?.sourceSampleOffset,
            queue: body.queue.map((chunk) => ({
              start: chunk.startFrame,
              phase: chunk.plan.phaseId,
              revision: chunk.plan.planRevision,
            })),
          })
        }
        if (pose && pose.composedAtMs !== state.lastStamp) {
          state.lastStamp = pose.composedAtMs
          const profile = profileById[pose.profileId],
            layer = model.facialRuntime.bodyMotionLayer
          if (profile?.kind === 'presence' && layer !== 'base') state.layerViolations++
          const playing = clock?.state === 'playing' && current && clock.turnId === current.turnId
          if (current && playing) {
            current.consumedSamples = Math.max(current.consumedSamples, clock.sourceSampleOffset)
            current.mouthPeak = Math.max(current.mouthPeak, ...Object.values(a.getMouthWeights()))
          }
          const chest = bones.chest?.position.y
          if (!playing && chest !== undefined) {
            state.idleChestMin = Math.min(state.idleChestMin, chest)
            state.idleChestMax = Math.max(state.idleChestMax, chest)
          }
          if (current && pose.executionId && profile?.kind === 'gesture') {
            current.executions[pose.executionId] ??= {
              profileId: pose.profileId,
              phases: [],
              joints: {},
              hands: {},
              strokeSamples: 0,
              strokeDurationMs: 0,
            }
            const execution = current.executions[pose.executionId]
            if (!execution.phases.includes(pose.phaseId)) execution.phases.push(pose.phaseId)
            const stroke = playing && pose.phaseId === 'stroke'
            if (stroke) {
              execution.strokeSamples++
              execution.strokeStartedMs ??= now
              execution.strokeDurationMs = now - execution.strokeStartedMs
            }
            for (const [name, bone] of Object.entries(bones)) {
              const q = bone.quaternion.toArray()
              execution.joints[name] ??= { initial: q, excursionRad: 0 }
              const joint = execution.joints[name]
              if (playing && ['stroke', 'hold'].includes(pose.phaseId))
                joint.excursionRad = Math.max(joint.excursionRad, angle(joint.initial, q))
              if (name.endsWith('Hand')) {
                const p = bone.getWorldPosition(bone.position.clone()).toArray()
                execution.hands[name] ??= {
                  initial: p,
                  excursionM: 0,
                  strokeExcursionM: 0,
                }
                const hand = execution.hands[name]
                if (playing && ['stroke', 'hold'].includes(pose.phaseId))
                  hand.excursionM = Math.max(hand.excursionM, distance(hand.initial, p))
                if (stroke) {
                  hand.strokeInitial ??= p
                  hand.strokeExcursionM = Math.max(
                    hand.strokeExcursionM,
                    distance(hand.strokeInitial, p),
                  )
                }
              }
            }
          }
          if (now - lastSample >= 50 && state.samples.length < 12000) {
            lastSample = now
            const requested = a.playback.getCurrentContext()
            state.samples.push({
              atMs: now,
              caseId: state.current,
              intent: a.conversationEmbodimentIntent,
              selectedProfile: requested?.animationId,
              requestedLayer: requested?.motionLayer,
              appliedProfile: pose.profileId,
              motionLayer: layer,
              executionId: pose.executionId,
              phase: pose.phaseId,
              consumedSamples: clock?.sourceSampleOffset,
              playing: clock?.state,
              availability: a.getEmbodimentAvailability(),
              error: generated.error,
              facial: pose.facialActing,
            })
          }
        }
      }
      state.begin = (fixture) => {
        state.current = fixture.id
        const current = {
          startedMs: performance.now(),
          intent: null,
          events: [],
          errors: [],
          errorStates: [],
          executions: {},
          consumedSamples: 0,
          mouthPeak: 0,
          facialProfiles: [],
          facialActing: {},
          facialWarnings: [],
          done: false,
          availabilityAtAdmission: a.getEmbodimentAvailability(),
        }
        state.cases[fixture.id] = current
        void c.sendText(fixture.text).then(
          () => {
            current.done = true
          },
          (error) => {
            current.errors.push(String(error))
            current.done = true
          },
        )
      }
      state.stop = () => {
        clearInterval(state.frame)
        unsubscribe()
        body.dynamicsObserver = originalObserver
        body.pump = originalPump
        const { begin, stop, frame, ...result } = state
        return result
      }
      window.__conversationProbe = state
      frame()
      // Primary Avatar composition is timer-owned even when Chat is occluded.
      // A paint-throttled RAF probe can see only one frame of a valid stroke.
      state.frame = setInterval(frame, 1000 / 60)
    },
    motionProfiles.map(({ id, kind }) => ({ id, kind })),
  )
  const audioFile = path.join(directory, 'conversation-audio.webm'),
    videoFile = path.join(directory, 'conversation-raw.webm')
  let stopAudio, stopVideo, captured
  const started = Date.now()
  try {
    stopAudio = await recordAudio(page, audioFile)
    stopVideo = await recordCanvas(overlay, videoFile, { captureFps: 90 })
    for (const fixture of cases) {
      const scheduled = duration >= 300 ? fixture.at : 0
      while ((Date.now() - started) / 1000 < scheduled) await pause(200)
      await page.evaluate((fixture) => window.__conversationProbe.begin(fixture), fixture)
      const deadline = Date.now() + 120000
      while (
        Date.now() < deadline &&
        !(await page.evaluate(
          () => window.__conversationProbe.cases[window.__conversationProbe.current].done,
        ))
      )
        await pause(200)
      const result = await page.evaluate(
        () => window.__conversationProbe.cases[window.__conversationProbe.current],
      )
      if (!result.done) {
        await page.evaluate(() =>
          window.__motionAbController.interruptCurrentResponse('manual-stop'),
        )
        result.errors.push('CONVERSATION_QUALIFICATION_TIMEOUT')
      }
      const executions = Object.entries(result.executions).map(([id, execution]) => ({
        id,
        ...execution,
        evidence: assessGesture(execution, result.intent?.gestureHint),
      }))
      const hintMatches =
        !fixture.expectedHint || result.intent?.gestureHint === fixture.expectedHint
      const visibleSemanticGesture = executions.some(
        (execution) =>
          execution.evidence.passed &&
          execution.phases.includes('prepare') &&
          motionProfiles.find((profile) => profile.id === execution.profileId)?.semanticIntent ===
            result.intent?.gestureHint,
      )
      const overlayExecutions = await overlay.evaluate(
        () => window.__conversationOverlayProbe.executions,
      )
      const overlayEvidence = executions.map((execution) => {
        const observed = overlayExecutions[execution.id]
        const hand = Object.values(observed?.hands ?? {}).sort(
          (a, b) => b.excursionM - a.excursionM,
        )[0]
        return {
          executionId: execution.id,
          rawHandExcursionM: hand?.excursionM ?? 0,
          visibleStrokeFraction: hand?.strokeFrames
            ? hand.visibleStrokeFrames / hand.strokeFrames
            : 0,
        }
      })
      const visibleInOverlay = overlayEvidence.some(
        (value) => value.rawHandExcursionM >= 0.035 && value.visibleStrokeFraction >= 0.6,
      )
      const technicalPassed =
        result.done &&
        !result.errors.length &&
        !result.facialWarnings.length &&
        result.consumedSamples > 10000 &&
        result.mouthPeak > 0.05
      const readabilityPassed =
        hintMatches && (!fixture.requireGesture || (visibleSemanticGesture && visibleInOverlay))
      const passed = technicalPassed && readabilityPassed
      report.conversation.cases.push({
        id: fixture.id,
        ...result,
        executions,
        overlayEvidence,
        technicalPassed,
        readabilityPassed,
        passed,
        visualAcceptance: 'pending',
      })
      fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
      console.log(
        JSON.stringify({
          conversationCase: fixture.id,
          hint: result.intent?.gestureHint,
          passed,
          errors: result.errors,
          evidence: executions.map((execution) => ({
            id: execution.profileId,
            ...execution.evidence,
          })),
        }),
      )
      await captureWindow(
        application,
        overlay,
        path.join(directory, `conversation-${fixture.id}.png`),
      )
      if (!result.done) break
    }
    while (Date.now() - started < duration * 1000) await pause(200)
  } finally {
    captured = await page.evaluate(() => window.__conversationProbe.stop())
    report.conversation.overlayExecutions = await overlay.evaluate(() =>
      window.__conversationOverlayProbe.stop(),
    )
    report.conversation.overlayFacial = await overlay.evaluate(
      () => window.__conversationOverlayProbe.facial,
    )
    report.conversation.camera = await overlay.evaluate(
      () => window.__conversationOverlayProbe.camera,
    )
    report.conversation.trace = captured
    report.conversation.elapsedMs = Date.now() - started
    if (stopAudio) report.conversation.audio = await stopAudio()
    if (stopVideo) report.conversation.video = await stopVideo()
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
  }
  const video = report.conversation.video,
    audio = report.conversation.audio
  const lastSampleMs = captured.samples.at(-1)?.atMs ?? 0
  const finalPresence = captured.samples.filter((sample) => sample.atMs >= lastSampleMs - 1000)
  report.conversation.returnedToPresence =
    finalPresence.length >= 10 &&
    finalPresence.every(
      (sample) =>
        sample.playing !== 'playing' &&
        sample.motionLayer === 'base' &&
        motionProfiles.find((profile) => profile.id === sample.appliedProfile)?.kind === 'presence',
    )
  const audioOffsetSeconds = (audio.startedAt - video.startedAt) / 1000
  if (video.measuredAverageFps >= 60) {
    const output = path.join(directory, 'conversation-60fps.mp4')
    execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-i',
        videoFile,
        '-itsoffset',
        String(audioOffsetSeconds),
        '-i',
        audioFile,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-vf',
        'fps=60',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-c:a',
        'aac',
        '-shortest',
        output,
      ],
      { windowsHide: true },
    )
    report.conversation.export = {
      file: output,
      fps: 60,
      audioOffsetSeconds,
      note: 'Select actual high-rate captured frames; no invented body poses.',
    }
  }
  report.conversation.technicalPassed =
    report.conversation.cases.every((entry) => entry.technicalPassed) &&
    report.conversation.returnedToPresence &&
    captured.layerViolations === 0 &&
    captured.idleChestMax - captured.idleChestMin > 0.002 &&
    report.conversation.camera.maxPositionDelta < 0.000001 &&
    report.conversation.camera.maxQuaternionDelta < 0.000001 &&
    report.conversation.camera.maxFovDelta === 0 &&
    duration >= 300 &&
    video.measuredAverageFps >= 60
  report.conversation.readabilityPassed = report.conversation.cases.every(
    (entry) => entry.readabilityPassed,
  )
  report.conversation.passed =
    report.conversation.technicalPassed && report.conversation.readabilityPassed
}
module.exports = { qualifyConversation }
