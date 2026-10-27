const assert = require('node:assert/strict')
const path = require('node:path')
const { recordCanvas } = require('./record-canvas.cjs')
const { captureWindow } = require('./capture-window.cjs')

async function qualifyLiving({ application, page, directory, report, pause, recordVideo }) {
  const chatView = process.argv.includes('--living-chat-view')
  await page.waitForFunction(() => !!window.__motionAbController)
  if (!chatView) {
    await page.locator('.app-sidebar').getByRole('button', { name: 'Avatar', exact: true }).click()
    await page.getByRole('button', { name: 'Full body', exact: true }).click()
  }
  report.livingPresentation = chatView
    ? 'Chat + Overlay, Avatar Preview never mounted'
    : 'Avatar Preview + Overlay'
  report.living = []
  report.livingScope =
    'Delivery and executor transport fixtures only; not visible conversational gesture acceptance. Use --conversation-cases for that acceptance.'
  report.characterSource =
    'Typed fixtures and the explicit emotion-chat real-LLM case through Conversation Admission; real Fish and ARDY'
  const fixtures = [
    {
      id: 'emotion-chat',
      realLlm: true,
      text: 'Проиграй какие-нибудь эмоции в ответе для теста 3д движка',
    },
    {
      id: 'emotion-chat-repeat',
      realLlm: true,
      text: 'Проиграй какие-нибудь эмоции в ответе для теста 3д движка',
    },
    {
      id: 'emotion-cues',
      text: 'Проверка трёх контрастных эмоций.',
      hint: 'explain',
      segments: [
        {
          emotion: 'happy',
          text: 'Я так рада, у нас всё получилось! Какой прекрасный сегодня день.',
        },
        {
          emotion: 'sad',
          text: 'Мне очень грустно, что наша встреча закончилась. Я буду скучать.',
        },
        {
          emotion: 'angry',
          text: 'Я сержусь, потому что ты снова нарушил наше обещание. Так нельзя.',
        },
      ],
    },
    { id: 'idle-60', seconds: 60 },
    { id: 'short', hint: 'agree', text: 'Да, конечно. Я тебя внимательно слушаю.' },
    {
      id: 'conversational',
      hint: 'explain',
      text: 'Смотри, сначала мы выбираем понятную цель, а затем спокойно разбираем её на небольшие шаги. Так легче заметить результат и продолжить разговор.',
    },
    {
      id: 'long',
      hint: 'compare',
      text: 'Представь, что мы гуляем по тихому парку. Слева растут высокие деревья, а справа открывается солнечная поляна. Можно выбрать короткую дорогу и сразу оказаться у озера. А можно пройти немного дальше, посмотреть на цветы и послушать птиц. Мне нравятся оба варианта. Давай сначала неспешно пройдём по дорожке, а потом вместе решим, куда двигаться дальше.',
    },
    {
      id: 'emotional',
      hint: 'delight',
      emotion: 'happy',
      text: 'Как здорово, у нас получилось! Мне очень приятно видеть этот результат. Спасибо, что помог мне разобраться. Теперь можно спокойно порадоваться и продолжить нашу работу.',
    },
    {
      id: 'consecutive-1',
      hint: 'greeting',
      text: 'Привет! Рада снова тебя видеть. Давай немного поболтаем и выберем интересную тему.',
    },
    {
      id: 'consecutive-2',
      hint: 'explain',
      text: 'Я думаю, что здесь полезно начать с простого примера. Тогда общая идея станет понятнее и мы сможем спокойно обсудить детали.',
    },
    {
      id: 'consecutive-3',
      hint: 'compare',
      text: 'У первого варианта есть понятное преимущество, а второй даёт больше свободы. Давай сравним их и выберем то, что сейчас подходит лучше.',
    },
  ]
  const subset = process.argv
    .find((arg) => arg.startsWith('--living-case-ids='))
    ?.slice('--living-case-ids='.length)
    .split(',')
  assert(
    !subset || subset.every((id) => fixtures.some((fixture) => fixture.id === id)),
    'Unknown living qualification case',
  )
  const overlay = application.windows().find((target) => target.url().includes('overlay=1'))
  assert(overlay, 'Overlay unavailable for delivery qualification')
  for (const fixture of fixtures.filter((item) => !subset || subset.includes(item.id))) {
    if (fixture.realLlm)
      await page.evaluate(() => window.__motionAbController.startNewConversation())
    const emotionCase = fixture.realLlm || fixture.segments
    if (!chatView)
      await page
        .getByRole('button', { name: emotionCase ? 'Face' : 'Full body', exact: true })
        .click()
    await overlay.evaluate(() => {
      const state = {
        finalExpressionPeaks: {},
        profiles: [],
        chestMinY: Infinity,
        chestMaxY: -Infinity,
      }
      const frame = () => {
        const model = window.__motionAbController.avatarRuntime.controller.vrmModel
        const debug = model.getFacialDebugState()
        if (!state.profiles.includes(debug.currentProfile))
          state.profiles.push(debug.currentProfile)
        for (const name of ['happy', 'sad', 'angry', 'surprised', 'relaxed']) {
          const value = model.vrm?.expressionManager?.getValue(name) ?? 0
          state.finalExpressionPeaks[name] = Math.max(state.finalExpressionPeaks[name] ?? 0, value)
        }
        const y = model.vrm?.humanoid.getNormalizedBoneNode('chest')?.position.y
        if (y !== undefined) {
          state.chestMinY = Math.min(state.chestMinY, y)
          state.chestMaxY = Math.max(state.chestMaxY, y)
        }
        state.frame = requestAnimationFrame(frame)
      }
      state.stop = () => {
        cancelAnimationFrame(state.frame)
        const { frame, stop, ...result } = state
        return result
      }
      window.__livingOverlayProbe = state
      frame()
    })
    await page.evaluate((fixture) => {
      const c = window.__motionAbController,
        a = c.avatarRuntime.controller
      const body = a.vrmModel.bodyPlayback
      const state = {
        samples: [],
        errors: [],
        inferenceMs: [],
        timings: {},
        sourceFrames: new Set(),
        maxMouth: 0,
        peakBlink: 0,
        consumedSamples: 0,
        done: false,
        providerWaitMs: 0,
        sourceHoldMs: 0,
        chestMinY: Infinity,
        chestMaxY: -Infinity,
        speechGestureSamples: 0,
        springJointCount: a.vrmModel.vrm.springBoneManager?.joints.size ?? 0,
        springMotionRad: 0,
        errorStates: [],
        deliveryEmotions: [],
        facialProfiles: [],
        emotionPeaks: {},
        finalExpressionPeaks: {},
        emotionTimeline: [],
        llmEvents: [],
      }
      const restores = []
      const springs = [...(a.vrmModel.vrm.springBoneManager?.joints ?? [])].map((joint) => ({
        bone: joint.bone,
        initial: joint.bone.quaternion.clone(),
      }))
      const measure = (owner, method, label) => {
        const original = owner?.[method]
        if (typeof original !== 'function') return
        owner[method] = function (...args) {
          const at = performance.now()
          try {
            return original.apply(this, args)
          } finally {
            state.timings[label] ??= []
            const list = state.timings[label]
            if (list.length < 12000) list.push(performance.now() - at)
          }
        }
        restores.push(() => {
          owner[method] = original
        })
      }
      measure(body, 'apply', 'retarget-candidates')
      measure(body, 'validateFinalComposition', 'final-body-composition')
      measure(body.bodySafety, 'apply', 'target-projection-filter-sweep')
      measure(body.bodySafety.temporalFilter, 'step', 'temporal-filter-per-joint')
      measure(a.vrmModel.vrm, 'update', 'vrm-final-update')
      let lastAt = performance.now(),
        previousCursor,
        inference,
        lastSample = 0
      const frame = () => {
        const now = performance.now(),
          dt = Math.min(100, now - lastAt)
        lastAt = now
        const debug = a.vrmModel.getBodyMotionDebugState()
        const pose = a.getBodyPresentation()
        const clock = c.player.getPcmClock()
        const playing = clock?.state === 'playing' && clock.turnId === state.turnId
        const facial = a.vrmModel.getFacialDebugState()
        if (playing) {
          if (a.speechDeliveryEmotion && !state.deliveryEmotions.includes(a.speechDeliveryEmotion))
            state.deliveryEmotions.push(a.speechDeliveryEmotion)
          if (!state.facialProfiles.includes(facial.currentProfile))
            state.facialProfiles.push(facial.currentProfile)
          for (const [name, value] of Object.entries(facial.emotion))
            state.emotionPeaks[name] = Math.max(state.emotionPeaks[name] ?? 0, value)
        }
        if (playing) {
          for (const name of ['happy', 'sad', 'angry', 'surprised', 'relaxed'])
            state.finalExpressionPeaks[name] = Math.max(
              state.finalExpressionPeaks[name] ?? 0,
              a.vrmModel.vrm.expressionManager?.getValue(name) ?? 0,
            )
          if (state.emotionTimeline.at(-1)?.emotion !== a.speechDeliveryEmotion)
            state.emotionTimeline.push({
              emotion: a.speechDeliveryEmotion,
              sourceSampleOffset: clock.sourceSampleOffset,
            })
        }
        const chestY = a.vrmModel.vrm.humanoid.getNormalizedBoneNode('chest')?.position.y
        if (chestY !== undefined) {
          state.chestMinY = Math.min(state.chestMinY, chestY)
          state.chestMaxY = Math.max(state.chestMaxY, chestY)
        }
        for (const spring of springs)
          state.springMotionRad = Math.max(
            state.springMotionRad,
            spring.bone.quaternion.angleTo(spring.initial),
          )
        if (
          playing &&
          pose &&
          !pose.profileId.startsWith('presence_') &&
          ['prepare', 'stroke', 'hold'].includes(pose.phaseId)
        )
          state.speechGestureSamples++
        state.maxMouth = Math.max(state.maxMouth, ...Object.values(a.getMouthWeights()))
        state.peakBlink = Math.max(state.peakBlink, a.getDebugState().facial?.blink ?? 0)
        if (playing)
          state.consumedSamples = Math.max(state.consumedSamples, clock.sourceSampleOffset)
        if (debug.generated.error && !state.errors.includes(debug.generated.error)) {
          state.errors.push(debug.generated.error)
          state.errorStates.push({
            atMs: now,
            error: debug.generated.error,
            cursor: body.cursor,
            generatedEnd: body.generatedEnd,
            forecast: body.forecast,
            inFlightPhase: body.inFlightPhase,
            clockBase: body.clockBase,
            sourceSampleOffset: clock?.sourceSampleOffset,
            inferenceMs: debug.generated.inferenceMs,
            planning: debug.generated.planning,
          })
        }
        if (debug.generated.inferenceMs > 0 && inference !== debug.generated.inferenceMs) {
          inference = debug.generated.inferenceMs
          state.inferenceMs.push(inference)
        }
        if (body.inFlight && body.generatedEnd <= body.cursor + 0.001) state.providerWaitMs += dt
        if (body.cursor === previousCursor && !body.localRecovery) state.sourceHoldMs += dt
        previousCursor = body.cursor
        if (pose && state.sourceFrames.size < 10000)
          state.sourceFrames.add(
            pose.lease
              ? `${pose.lease.sessionId}:${pose.lease.epoch}:${Math.floor(pose.frame)}`
              : `local:${pose.localGeneration}`,
          )
        if (now - lastSample >= 50 && state.samples.length < 2400) {
          lastSample = now
          state.samples.push({
            atMs: now,
            profileId: pose?.profileId,
            phase: pose?.phaseId,
            executionId: pose?.executionId,
            sourceFrame: pose?.frame,
            sourceSampleOffset: clock?.sourceSampleOffset ?? null,
            mouth: Math.max(...Object.values(a.getMouthWeights())),
            queueFrames: debug.generated.queueFrames,
            corrections: debug.generated.safety,
            outcome: debug.motionExecution.outcome,
            recoveryBlockedBy: debug.generated.planning?.recoveryBlockedBy,
            maxRecoveryArmError: body.localRecovery
              ? Math.max(
                  ...body.bindings
                    .filter((b) => /Arm|Shoulder|Hand/u.test(b.name))
                    .map((b) => b.bone.quaternion.angleTo(b.safe)),
                )
              : null,
            availableSemanticIntents: a.getEmbodimentAvailability().availableSemanticIntents,
            intent: a.conversationEmbodimentIntent,
            eligibility: a.intentContext?.eligibility,
            prepared: a.preparedGesture?.resolved.animationId,
            requested: a.playback.getCurrentContext()?.animationId,
            pending: body.pendingProfiles.map((item) => item.id),
          })
        }
        state.frame = requestAnimationFrame(frame)
      }
      state.stop = () => {
        cancelAnimationFrame(state.frame)
        for (const restore of restores) restore()
        const { frame, stop, sourceFrames, timings, ...result } = state
        const percentile = (values, p) =>
          values[Math.min(values.length - 1, Math.floor(values.length * p))] ?? null
        return {
          ...result,
          sourceFramesActuallyObserved: sourceFrames.size,
          timingMs: Object.fromEntries(
            Object.entries(timings).map(([name, values]) => {
              values.sort((a, b) => a - b)
              return [
                name,
                {
                  count: values.length,
                  p50: percentile(values, 0.5),
                  p95: percentile(values, 0.95),
                  max: values.at(-1),
                },
              ]
            }),
          ),
        }
      }
      window.__livingProbe = state
      frame()
      if (fixture.text) {
        const text = fixture.text,
          emotion = fixture.emotion ?? 'calm'
        const intent = { intensity: 'normal', gestureHint: fixture.hint }
        const originalCreateReply = c.characterResponse.createReply
        restores.push(() => {
          c.characterResponse.createReply = originalCreateReply
        })
        if (fixture.realLlm)
          c.characterResponse.createReply = async function (...args) {
            state.turnId = args[0]
            const originalEvent = args[3]
            args[3] = (event) => {
              if (event.type === 'text-delta')
                state.llmEvents.push({
                  type: event.type,
                  emotion: event.delta.emotion,
                  characters: event.delta.text?.length ?? 0,
                })
              originalEvent?.(event)
            }
            const draft = await originalCreateReply.apply(this, args)
            state.llmProtocolMarkers = draft.replyText.match(/\[[a-z-]+\]/gu) ?? []
            state.llmSegments = draft.segments?.map((part) => ({
              emotion: part.emotion,
              characters: part.text.length,
            }))
            return draft
          }
        else
          c.characterResponse.createReply = async (turnId, _user, _screen, onEvent) => {
            state.turnId = turnId
            const base = { turnId, requestId: `fixture:${turnId}`, at: Date.now(), llmRound: 0 }
            const segments = fixture.segments ?? [{ emotion, text }]
            onEvent?.({ ...base, type: 'embodiment-intent', timing: 'early', intent })
            for (const segment of segments)
              onEvent?.({ ...base, type: 'text-delta', delta: segment })
            onEvent?.({ ...base, type: 'completed' })
            return {
              replyText: segments.map((segment) => `[${segment.emotion}]${segment.text}`).join(' '),
              displayText: segments.map((segment) => segment.text).join(' '),
              speechText: segments.map((segment) => segment.text).join(' '),
              emotionKey: segments[0].emotion,
              embodimentIntent: intent,
              segments: segments.map((segment, index) => ({
                id: `${fixture.id}:${index}`,
                index,
                ...segment,
                boundaryAfter: 'sentence',
                targetMaxGapMs: 0,
              })),
            }
          }
        void c
          .sendText(
            fixture.realLlm ? fixture.text : 'Проверочная реплика для движения и настоящей речи.',
          )
          .then(
            () => {
              state.done = true
            },
            () => {
              state.done = true
              state.errors.push('ADMISSION_OR_SPEECH_FAILED')
            },
          )
      }
    }, fixture)
    const stopVideo =
      recordVideo && !chatView
        ? await recordCanvas(page, path.join(directory, `${fixture.id}.webm`))
        : null
    const started = Date.now()
    const stopOverlayVideo =
      recordVideo && (emotionCase || chatView)
        ? await recordCanvas(overlay, path.join(directory, `${fixture.id}-overlay.webm`))
        : null
    const capturedFaces = new Set()
    while (Date.now() - started < (fixture.seconds ?? (fixture.realLlm ? 180 : 75)) * 1000) {
      if (fixture.text && (await page.evaluate(() => window.__livingProbe.done))) break
      if (emotionCase) {
        const face = await overlay.evaluate(() => {
          const model = window.__motionAbController.avatarRuntime.controller.vrmModel
          const profile = model.getFacialDebugState().currentProfile
          return { profile, weight: model.vrm?.expressionManager?.getValue(profile) ?? 0 }
        })
        if (
          ['happy', 'sad', 'angry'].includes(face.profile) &&
          face.weight > 0.45 &&
          !capturedFaces.has(face.profile)
        ) {
          await captureWindow(
            application,
            overlay,
            path.join(directory, `${fixture.id}-${face.profile}-overlay.png`),
          )
          capturedFaces.add(face.profile)
        }
      }
      await pause(200)
    }
    const state = await page.evaluate(() => window.__livingProbe.stop())
    const overlayState = await overlay.evaluate(() => window.__livingOverlayProbe.stop())
    const video = stopVideo ? await stopVideo() : null
    const overlayVideo = stopOverlayVideo ? await stopOverlayVideo() : null
    if (fixture.text && !state.done) {
      await page.evaluate(() => window.__motionAbController.interruptCurrentResponse('manual-stop'))
      state.errors.push('QUALIFICATION_SPEECH_TIMEOUT')
    }
    const requiredFamilies = fixture.segments
      ? new Set(fixture.segments.map((segment) => segment.emotion)).size
      : 2
    const passed =
      state.errors.length === 0 &&
      (!video || (video.frames > 0 && video.errors.length === 0)) &&
      (!overlayVideo || (overlayVideo.frames > 0 && overlayVideo.errors.length === 0)) &&
      (fixture.text
        ? state.done &&
          state.consumedSamples > 10000 &&
          state.maxMouth > 0.05 &&
          (fixture.realLlm || fixture.segments
            ? Object.values(state.finalExpressionPeaks).filter((value) => value > 0.2).length >=
                requiredFamilies &&
              Object.values(overlayState.finalExpressionPeaks).filter((value) => value > 0.2)
                .length >= requiredFamilies
            : state.speechGestureSamples > 3) &&
          state.chestMaxY - state.chestMinY > 0.0001 &&
          (state.springJointCount === 0 || state.springMotionRad > 0.0001)
        : state.sourceFramesActuallyObserved > 300)
    report.living.push({
      id: fixture.id,
      ...state,
      overlay: overlayState,
      video,
      overlayVideo,
      passed,
      visualAcceptance: 'pending',
    })
    await captureWindow(application, page, path.join(directory, `${fixture.id}.png`))
    assert(state.samples.length > 0, 'Missing actual body samples')
  }
}
module.exports = { qualifyLiving }
