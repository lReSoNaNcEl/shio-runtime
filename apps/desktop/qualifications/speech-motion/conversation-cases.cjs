const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { recordCanvas } = require('./record-canvas.cjs')
const { recordAudio } = require('./record-audio.cjs')
const { captureWindow } = require('./capture-window.cjs')
const { assessGesture } = require('./conversation-evidence.cjs')
const { installStabilizationProbe, saveStabilizationProbe } = require('./stabilization-cases.cjs')

async function qualifyConversation({
  application,
  page,
  directory,
  report,
  pause,
  duration,
  motionProfiles,
}) {
  const autonomousLiving = process.argv.includes('--autonomous-living')
  const autonomousSmoke = process.argv.includes('--autonomous-living-smoke')
  const autonomousInputs = autonomousLiving || autonomousSmoke
  const recoveryChat = process.argv.includes('--recovery-chat-smoke')
  assert(!autonomousLiving || !autonomousSmoke, 'Choose final or diagnostic living mode')
  assert(!autonomousLiving || duration === 900, 'Autonomous Living requires 900 seconds')
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
  if (process.argv.includes('--living-v2')) {
    fixtures.splice(0, fixtures.length, ...require('./living-v2-cases.cjs'))
  }
  if (autonomousInputs) {
    fixtures.splice(0, fixtures.length, ...require('./autonomous-living-cases.cjs'))
  }
  if (recoveryChat) {
    assert(!autonomousInputs, 'Use separate recovery and living qualification runs')
    fixtures.splice(
      0,
      fixtures.length,
      {
        id: 'interrupted',
        at: 0,
        text: 'Объясни подробно, почему полезно учиться понемногу каждый день. Пять предложений.',
        interruptAfterSeconds: 2,
      },
      {
        id: 'after-stop',
        at: 0,
        text: 'Проверим продолжение после остановки. Скажи вслух одну фразу: как лучше отдохнуть после работы?',
      },
    )
  }
  const subset = process.argv
    .find((arg) => arg.startsWith('--conversation-case-ids='))
    ?.split('=')[1]
    .split(',')
  assert(
    !subset || subset.every((id) => fixtures.some((item) => item.id === id)),
    'Unknown conversation case',
  )
  assert(!autonomousLiving || !subset, 'Final qualification requires the complete schedule')
  assert(!autonomousSmoke || subset, 'Diagnostic living smoke requires an explicit subset')
  const cases = fixtures.filter((item) => !subset || subset.includes(item.id))
  report.conversation = {
    inputPath:
      autonomousInputs || recoveryChat ? 'existing Spectrum Chat UI' : 'Controller.sendText',
    acceptanceScope:
      autonomousSmoke || subset ? 'diagnostic subset; no final acceptance' : 'full scenario',
    autonomyMode: 'off; proactive initiative requires separate policy qualification',
    schedule: cases.map(({ id, at }) => ({ id, at })),
    source: `Unmodified CharacterResponsePort; actual Main LLM, Fish, ${report.motionProvider || 'ardy'}; Chat + Overlay`,
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
      // Observe each produced pose once. High-refresh display RAFs must not run
      // repeated mesh traversal and FK allocations for the same 60-Hz composition.
      const stamp = model.bodyPlayback.mirror?.composedAtMs
      if (stamp === state.lastStamp) {
        state.frame = requestAnimationFrame(frame)
        return
      }
      state.lastStamp = stamp
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
    ({ profiles, qualityTrace, recoveryRepro, uiDriven, sampleIntervalMs }) => {
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
        clockDiscontinuities: [],
      }
      const originalClockSample = body.motionClock.sample
      const clockRing = []
      body.motionClock.sample = function (clock, delta) {
        const result = originalClockSample.call(this, clock, delta)
        clockRing.push({
          delta,
          playbackId: clock?.playbackId,
          consumed: clock?.sourceSampleOffset,
          sampleRate: clock?.sourceSampleRate,
          state: clock?.state,
          offset: result?.offset,
          discontinuity: result?.discontinuity,
        })
        if (clockRing.length > 32) clockRing.shift()
        if (result?.discontinuity && state.clockDiscontinuities.length < 40)
          state.clockDiscontinuities.push({ atMs: performance.now(), frames: [...clockRing] })
        return result
      }
      const angle = (x, y) =>
        2 * Math.acos(Math.min(1, Math.abs(x.reduce((sum, value, i) => sum + value * y[i], 0))))
      const distance = (x, y) => Math.hypot(...x.map((value, i) => value - y[i]))
      const previousStages = new Map(),
        originalObserver = body.dynamicsObserver
      const originalPump = body.pump
      const originalUpdate = body.update
      const originalInvalidatePhase = body.invalidatePhase
      const originalFinishExecution = body.finishExecution
      const originalSafetyApply = body.bodySafety.apply
      const targetHistory = []
      let targetHistoryIndex = 0
      if (recoveryRepro) {
        state.recoveryRepros = []
        state.failureStages = []
        state.comparisonPreparation = []
        let constraintFrame = 0
        body.bodySafety.apply = function (seconds, speed, advanceCandidate, ...args) {
          state.constraintStep = {
            id: ++constraintFrame,
            seconds,
            advanceCandidate,
            sampledPcm: body.sampledClock?.sourceSampleOffset,
          }
          return originalSafetyApply.call(this, seconds, speed, advanceCandidate, ...args)
        }
        const captureRecovery = (point) => {
          if (state.recoveryRepros.length >= 96) return
          if (body.error && state.failureStages.length < 8)
            state.failureStages.push({
              error: body.error,
              caseId: state.current,
              atMs: performance.now(),
              clockHistory: clockRing.slice(),
              stages: targetHistory
                .filter((row) => row && performance.now() - row.atMs < 2500)
                .sort((a, b) => a.atMs - b.atMs),
            })
          state.recoveryRepros.push({
            point,
            atMs: performance.now(),
            caseId: state.current,
            executionId: body.execution?.id,
            profileId: body.profileId,
            phase: body.execution?.phase,
            elapsedMs: body.execution?.elapsedMs,
            budget: body.execution?.budget,
            blocker: body.recoveryBlocker(),
            chain: body.bodySafety.chain.map((bone) => {
              const binding = body.bindings.find((entry) => entry.bone === bone)
              const filter = body.bodySafety.temporalFilter.states.get(bone)
              return {
                name: binding?.name ?? bone.name,
                position: bone.position.toArray(),
                quaternion: bone.quaternion.toArray(),
                safe: binding?.safe.toArray(),
                calibratedSafe: binding?.calibratedSafe.toArray(),
                recoveryPose: body.recoveryPose.get(bone)?.toArray(),
                basePose: body.basePose.get(bone)?.toArray(),
                sourceTarget: binding?.sourceTarget?.toArray(),
                target: filter?.target.toArray(),
                velocity: filter?.velocity.toArray(),
                integrated: filter?.integrated?.toArray(),
                previous: body.bodySafety.previousChain.get(bone)?.toArray(),
                sourceSpeed: body.sourceSpeeds.get(bone),
              }
            }),
          })
        }
        body.invalidatePhase = function (...args) {
          const result = originalInvalidatePhase.apply(this, args)
          if (this.localRecovery) captureRecovery('entry')
          return result
        }
        body.finishExecution = function (outcome, ...args) {
          if (outcome === 'timed-out') captureRecovery('timed-out')
          return originalFinishExecution.call(this, outcome, ...args)
        }
      }
      if (qualityTrace) {
        state.qualityFrames = []
        body.update = function (delta, ...args) {
          originalUpdate.call(this, delta, ...args)
          if (state.qualityFrames.length >= 24000) return
          const clock = c.player.getPcmClock()
          state.qualityFrames.push({
            atMs: performance.now(),
            delta,
            playbackId: clock?.playbackId,
            pcm: clock?.sourceSampleOffset,
            sampleRate: clock?.sourceSampleRate,
            state: clock?.state,
            sourceFrame: this.cursor,
            profile: this.appliedProfileId,
            phase: this.appliedPhaseId,
            rotations: Object.fromEntries(
              Object.entries(bones).map(([name, bone]) => [name, bone.quaternion.toArray()]),
            ),
          })
        }
      }
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
        if (
          recoveryRepro &&
          body.execution?.profile.kind === 'gesture' &&
          ['admissible', 'temporal', 'final'].includes(sample.stage)
        ) {
          targetHistory[targetHistoryIndex++ % 12000] = {
            ...sample,
            atMs: performance.now(),
            executionId: body.execution.id,
            profile: body.profileId,
            phase: body.appliedPhaseId,
            constraintStep: state.constraintStep,
          }
        }
        if (
          recoveryRepro &&
          body.execution?.profile.id === 'explain_balance' &&
          body.execution.phase === 'prepare' &&
          ['admissible', 'temporal', 'final'].includes(sample.stage) &&
          state.comparisonPreparation.length < 12000
        )
          state.comparisonPreparation.push({
            ...sample,
            atMs: performance.now(),
            elapsedMs: body.execution.elapsedMs,
            executionId: body.execution.id,
            constraintStep: state.constraintStep,
          })
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
        if (event.type === 'text-delta')
          current.textDeltaCharacters = (current.textDeltaCharacters ?? 0) + event.delta.text.length
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
      const spatialGoals = () =>
        body.bodySafety.arms.map((arm) => {
          const goal = body.bodySafety.handGoal(arm)
          if (!goal) return null
          const offset = arm.end.getWorldPosition(arm.end.position.clone()).sub(goal.center)
          const rotation = arm.end.getWorldQuaternion(arm.end.quaternion.clone())
          return {
            side: arm.side,
            positionViolationM: Math.max(
              ...goal.axes.map((axis, i) => Math.abs(offset.dot(axis)) - goal.extents[i]),
            ),
            palmDot: goal.palm
              ? arm.palmAxis.clone().applyQuaternion(rotation).dot(goal.palm)
              : null,
            fingerDot: goal.fingers
              ? arm.fingerAxis.clone().applyQuaternion(rotation).dot(goal.fingers)
              : null,
          }
        })
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
            spatialGoals: spatialGoals(),
            fingersReached: body.handPose.targetsReached(),
            bodyReached: body.bodySafety.handTargetsReached(),
            queue: body.queue.map((chunk) => ({ start: chunk.startFrame, plan: chunk.plan })),
          })
        }
        if (current && generated.error && !current.errors.includes(generated.error)) {
          current.errors.push(generated.error)
          current.errorStates.push({
            atMs: now,
            error: generated.error,
            spatialGoals: spatialGoals(),
            planning: generated.planning,
            cursor: body.cursor,
            generatedEnd: body.generatedEnd,
            forecast: body.forecast,
            inFlightPhase: body.inFlightPhase,
            inferenceMs: generated.inferenceMs,
            sourceSampleOffset: clock?.sourceSampleOffset,
            recoveryTargets: body.bindings
              .filter((binding) => /Arm|Shoulder|Hand/u.test(binding.name))
              .map((binding) => {
                const target = binding.safe
                  .clone()
                  .multiply(
                    body.handPose.getWristOffsets().get(binding.name) ??
                      binding.safe.clone().identity(),
                  )
                const projected = target.clone()
                body.bodySafety.constrainTarget(binding.bone, projected)
                return {
                  bone: binding.name,
                  errorRad: binding.bone.quaternion.angleTo(target),
                  rejectedTargetRad: projected.angleTo(target),
                }
              }),
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
              firstObservedMs: now,
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
          if (now - lastSample >= sampleIntervalMs && state.samples.length < 12000) {
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
      const originalSendText = c.sendText
      const response = c.conversationRuntime.deps.characterResponse
      const originalCreateReply = response.createReply
      response.createReply = async function (...args) {
        const current = state.cases[state.current]
        const draft = await originalCreateReply.apply(this, args)
        if (current)
          current.replyEvidence = {
            speechCharacters: draft.speechText.length,
            displayCharacters: draft.displayText.length,
            replyCharacters: draft.replyText.length,
          }
        return draft
      }
      c.sendText = function (...args) {
        const current = state.cases[state.current]
        const work = originalSendText.apply(this, args)
        void work.then(
          (result) => {
            if (!current) return
            current.resultStatus = result.status
            current.playbackCompleted = result.playbackCompleted
            current.completedMs = performance.now()
            current.synthesisFailures = c.diagnostics.timeline
              .filter(
                (event) =>
                  event.label === 'synthesis_degraded' && event.detail?.includes(current.turnId),
              )
              .map((event) => event.detail.slice(0, 256))
            if (result.status === 'failed') current.errors.push(result.failure.code)
            current.done = true
          },
          (error) => {
            if (!current) return
            current.errors.push(String(error))
            current.completedMs = performance.now()
            current.done = true
          },
        )
        return work
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
        if (!uiDriven) void c.sendText(fixture.text).catch(() => {})
      }
      state.stop = () => {
        clearInterval(state.frame)
        unsubscribe()
        body.dynamicsObserver = originalObserver
        body.pump = originalPump
        body.update = originalUpdate
        body.motionClock.sample = originalClockSample
        body.invalidatePhase = originalInvalidatePhase
        body.finishExecution = originalFinishExecution
        body.bodySafety.apply = originalSafetyApply
        c.sendText = originalSendText
        response.createReply = originalCreateReply
        const { begin, stop, frame, ...result } = state
        return result
      }
      window.__conversationProbe = state
      frame()
      // Primary Avatar composition is timer-owned even when Chat is occluded.
      // A paint-throttled RAF probe can see only one frame of a valid stroke.
      state.frame = setInterval(frame, 1000 / 60)
    },
    {
      profiles: motionProfiles.map(({ id, kind }) => ({ id, kind })),
      qualityTrace: process.argv.includes('--motion-quality-trace'),
      recoveryRepro: process.argv.includes('--recovery-repro'),
      uiDriven: autonomousInputs || recoveryChat,
      sampleIntervalMs: Math.max(50, Math.ceil((duration * 1000) / 11000)),
    },
  )
  const audioFile = path.join(directory, 'conversation-audio.webm'),
    videoFile = path.join(directory, 'conversation-raw.webm')
  let stopAudio, stopVideo, captured
  const stabilizationTrace = process.argv.includes('--stabilization-trace')
  assert(
    !process.argv.includes('--stabilization-summary') || stabilizationTrace,
    'Compact telemetry requires --stabilization-trace',
  )
  if (stabilizationTrace) {
    const summaryOnly = process.argv.includes('--stabilization-summary')
    // Bound retained diagnostics across the entire run. Video/FPS capture stays
    // independent; declare the stride instead of silently truncating the tail.
    const frameStride = autonomousLiving
      ? 1
      : Math.max(
          process.argv.includes('--body-trace-only') ? 2 : 1,
          Math.ceil(((duration + 120) * 144) / 23000),
        )
    report.conversation.diagnosticFrameStride = frameStride
    const minIntervalMs = autonomousLiving ? 1000 / 30 : 0
    const maxFrames = autonomousLiving ? Math.ceil((duration + 120) * 30) + 1 : 24000
    report.conversation.diagnosticSampling = { minIntervalMs, maxFrames, summaryOnly }
    await installStabilizationProbe(page, {
      maxFrames,
      minIntervalMs,
      frameStride,
      summaryOnly,
      captureFingers: report.nativeSomaHand && !process.argv.includes('--body-trace-only'),
    })
    await installStabilizationProbe(overlay, {
      maxFrames,
      minIntervalMs,
      frameStride,
      summaryOnly,
      captureFingers: report.nativeSomaHand && !process.argv.includes('--body-trace-only'),
    })
  }
  const started = Date.now()
  try {
    stopAudio = await recordAudio(page, audioFile)
    stopVideo = await recordCanvas(overlay, videoFile, { captureFps: 90 })
    for (const fixture of cases) {
      const scheduled = duration >= 300 ? fixture.at : 0
      while ((Date.now() - started) / 1000 < scheduled) await pause(200)
      if (autonomousLiving && fixture.id === 'question-1') {
        const quietStart = report.conversation.cases.find(
          (entry) => entry.id === 'idle-entry',
        )?.completedMs
        assert(Number.isFinite(quietStart), 'The idle-entry turn did not finish')
        let quietEnd
        do {
          const state = await page.evaluate(() => ({
            at: performance.now(),
            turnId:
              window.__motionAbController.conversationRuntime.getActiveResponseSnapshot().turnId,
            clock: window.__motionAbController.player.getPcmClock()?.state,
          }))
          assert(state.turnId === null, 'A conversation interrupted the continuous idle window')
          assert(!['playing', 'buffering'].includes(state.clock), 'Speech interrupted idle')
          quietEnd = state.at
          if (quietEnd - quietStart < 120000) await pause(200)
        } while (quietEnd - quietStart < 120000)
        report.conversation.continuousIdle = {
          startedMs: quietStart,
          endedMs: quietEnd,
          durationMs: quietEnd - quietStart,
          note: 'Actual completed speech to next input; schedule may extend beyond 900 s.',
        }
      }
      await page.evaluate((fixture) => window.__conversationProbe.begin(fixture), fixture)
      if (autonomousInputs || recoveryChat) {
        await page.locator('#controls-input input').fill(fixture.text)
        await page.locator('#controls-input input').press('Enter')
      }
      const deadline = Date.now() + 120000
      let interrupted = false
      while (
        Date.now() < deadline &&
        !(await page.evaluate(
          () => window.__conversationProbe.cases[window.__conversationProbe.current].done,
        ))
      ) {
        if (fixture.interruptAfterSeconds && !interrupted) {
          const elapsed = await page.evaluate(() => {
            const current = window.__conversationProbe.cases[window.__conversationProbe.current]
            const clock = window.__motionAbController.player.getPcmClock()
            return clock && clock.turnId === current.turnId && clock.state === 'playing'
              ? clock.sourceSampleOffset / clock.sourceSampleRate
              : 0
          })
          if (elapsed >= fixture.interruptAfterSeconds) {
            await page.evaluate(() => {
              window.__conversationProbe.cases[window.__conversationProbe.current].stopRequestedMs =
                performance.now()
            })
            await page.getByRole('button', { name: "Stop Shio's response", exact: true }).click()
            interrupted = true
          }
        }
        await pause(200)
      }
      if (
        await page.evaluate(
          () => window.__conversationProbe.cases[window.__conversationProbe.current].done,
        )
      ) {
        const settledBy = Date.now() + 15000
        let motionSettled = false
        let lastState
        while (Date.now() < settledBy) {
          const state = await page.evaluate(() => {
            const body = window.__motionAbController.avatarRuntime.controller.vrmModel.bodyPlayback
            return {
              layer: body.getAppliedMotionLayer(),
              profileId: body.profileId,
              profileKind: body.execution?.profile.kind,
              phase: body.execution?.phase,
              playing: body.playing,
              outcome: body.execution?.outcome,
              error: body.error,
              recoveryBlocker: body.localRecovery ? body.recoveryBlocker() : null,
            }
          })
          lastState = state
          // Ended executions keep their last phase name; an inactive ended
          // recover is a settled base, while a live blocked recover is not.
          const ended =
            !state.playing && ['completed', 'superseded', 'cancelled'].includes(state.outcome)
          const activeBase =
            state.playing &&
            state.profileKind === 'presence' &&
            ['prepare', 'stroke', 'hold'].includes(state.phase)
          if (state.layer === 'base' && !state.error && (activeBase || ended)) {
            motionSettled = true
            break
          }
          await pause(100)
        }
        await page.evaluate(
          ({ settled, state }) => {
            const current = window.__conversationProbe.cases[window.__conversationProbe.current]
            current.motionSettled = settled
            current.motionSettlementState = state
            if (!settled) current.errors.push('CONVERSATION_BODY_RECOVERY_TIMEOUT')
          },
          { settled: motionSettled, state: lastState },
        )
      }
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
        result.mouthPeak > 0.05 &&
        (!fixture.interruptAfterSeconds || interrupted)
      const readabilityPassed =
        hintMatches && (!fixture.requireGesture || (visibleSemanticGesture && visibleInOverlay))
      const passed = technicalPassed && readabilityPassed
      report.conversation.cases.push({
        id: fixture.id,
        scheduledAtSeconds: fixture.at,
        interrupted,
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
  } catch (error) {
    report.conversation.runError = error.message
    throw error
  } finally {
    if (stabilizationTrace)
      await Promise.all([
        page.evaluate(() => window.__stabilizationProbe.stop()),
        overlay.evaluate(() => window.__stabilizationProbe.stop()),
      ])
    if (stopAudio) report.conversation.audio = await stopAudio()
    if (stopVideo) {
      try {
        report.conversation.video = await stopVideo()
      } catch (error) {
        report.conversation.videoError = error.message
      }
    }
    if (stabilizationTrace) {
      for (const [id, target] of [
        ['primary', page],
        ['overlay', overlay],
      ]) {
        const data = await saveStabilizationProbe(
          target,
          path.join(directory, `conversation-${id}.json`),
        )
        assert(!data.overflow, 'Stabilization trace overflow')
      }
    }
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
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
  }
  assert(!report.conversation.videoError, report.conversation.videoError)
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
    (!autonomousLiving || report.conversation.continuousIdle?.durationMs >= 120000) &&
    video.measuredAverageFps >= 60
  report.conversation.readabilityPassed = report.conversation.cases.every(
    (entry) => entry.readabilityPassed,
  )
  report.conversation.passed =
    report.conversation.technicalPassed && report.conversation.readabilityPassed
  if (process.argv.includes('--fixed-preview-smoke')) {
    const camera = () =>
      overlay.evaluate(() => {
        const value = window.__motionAbController.scene.camera
        return [value.position.toArray(), value.quaternion.toArray(), value.fov]
      })
    const before = await camera()
    const originalModel = await page.evaluate(() => {
      window.__smokePrimaryModel = window.__motionAbController.avatarRuntime.controller.vrmModel
      return !!window.__smokePrimaryModel.vrm
    })
    await page.locator('.app-sidebar').getByRole('button', { name: 'Avatar', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('canvas').length === 1)
    const smoke = { modelLoaded: originalModel, previewAttached: true, phases: [], errors: [] }
    await page.evaluate(() =>
      window.__motionAbController.avatarRuntime.previewVariation('greet_wave_close', 17),
    )
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => {
        const model = window.__motionAbController.avatarRuntime.controller.vrmModel
        const body = model.getBodyMotionDebugState()
        return {
          sameModel: model === window.__smokePrimaryModel,
          applied: body.appliedPose,
          error: body.generated?.error,
        }
      })
      assert(state.sameModel, 'Attaching Preview replaced the primary model')
      if (state.error && !smoke.errors.includes(state.error)) smoke.errors.push(state.error)
      if (state.applied?.profileId === 'greet_wave_close') {
        const phase = state.applied.phaseId
        if (!smoke.phases.includes(phase)) smoke.phases.push(phase)
        if (phase === 'stroke' && !smoke.strokeCaptured) {
          await captureWindow(application, page, path.join(directory, 'fixed-preview-stroke.png'))
          smoke.strokeCaptured = true
        }
        if (smoke.phases.includes('stroke') && phase === 'recover') break
      }
      await pause(40)
    }
    smoke.health = await page.evaluate(
      async () => (await window.api.system.getRuntimeSupportBundle()).avatarRuntime.health,
    )
    smoke.cameraUnchanged = JSON.stringify(before) === JSON.stringify(await camera())
    smoke.passed =
      smoke.modelLoaded &&
      smoke.previewAttached &&
      smoke.strokeCaptured &&
      smoke.cameraUnchanged &&
      !smoke.errors.length
    report.conversation.fixedPreviewSmoke = smoke
    report.conversation.passed &&= smoke.passed
  }
  if (process.argv.includes('--autonomous-policy-smoke')) {
    const { qualifyAutonomousPolicy } = require('./autonomous-policy-smoke.cjs')
    await qualifyAutonomousPolicy({ application, page, directory, report, pause })
    report.conversation.passed &&= report.autonomousPolicy.passed
  }
}
module.exports = { qualifyConversation }
