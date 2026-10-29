const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { recordCanvas } = require('./record-canvas.cjs')

/** Opt-in, bounded instrumentation of the existing isolated qualification model.
 * No production exports, IPC, pose archive or second animation owner. */
async function installStabilizationProbe(page, options = {}) {
  assert(!options.summaryOnly || !options.staticSource, 'Static-source analysis needs full poses')
  await page.evaluate((options) => {
    const c = window.__motionAbController,
      model = c.avatarRuntime.controller.vrmModel
    const body = model.bodyPlayback,
      safety = body.bodySafety,
      facial = model.facialRuntime
    const vrm = model.vrm
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
      'head',
      ...(options.captureFingers
        ? ['left', 'right'].flatMap((side) =>
            ['Thumb', 'Index', 'Middle', 'Ring', 'Little'].flatMap((finger) =>
              (finger === 'Thumb'
                ? ['Metacarpal', 'Proximal', 'Distal']
                : ['Proximal', 'Intermediate', 'Distal']
              ).map((part) => `${side}${finger}${part}`),
            ),
          )
        : []),
    ]
    const bones = names.map((name) => vrm.humanoid.getNormalizedBoneNode(name))
    const raw = names.map((name) => vrm.humanoid.getRawBoneNode(name))
    const springs = [...(vrm.springBoneManager?.joints ?? [])]
      .slice(0, 16)
      .map((joint) => joint.bone)
    const state = {
      frames: [],
      names,
      springNames: springs.map((bone) => bone.name),
      timeOrigin: performance.timeOrigin,
      overflow: false,
      frozen: null,
      recording: true,
      observedFrames: 0,
      horizons: [],
      pipelineTimings: [],
      pipelineOverflow: false,
      staticInputMaxComponentDelta: 0,
      renderDeltasMs: [],
      renderDeltaOverflow: false,
    }
    const capturedHorizons = new WeakSet()
    let current = null
    const restorers = []
    const pose = (nodes) =>
      nodes.flatMap((bone) => (bone ? bone.quaternion.toArray() : [null, null, null, null]))
    const snapshot = (stage, nodes = bones) => {
      if (current && !options.summaryOnly) current.stages[stage] = pose(nodes)
    }
    const wrap = (owner, method, replacement) => {
      const original = owner[method]
      const wrapped = replacement(original)
      owner[method] = function (...args) {
        const started = performance.now()
        try {
          return wrapped.apply(this, args)
        } finally {
          if (current)
            current.timings[method] = (current.timings[method] ?? 0) + performance.now() - started
        }
      }
      restorers.push(() => {
        owner[method] = original
      })
    }
    const observer = body.dynamicsObserver
    if (body.somaHands) wrap(body.somaHands, 'sample', (original) => original)
    wrap(body, 'validateFinalComposition', (original) => original)
    body.dynamicsObserver = (sample) => {
      observer?.(sample)
      if (!current || options.summaryOnly) return
      const index = names.indexOf(sample.bone)
      if (index < 0) return
      current.stages[sample.stage] ??= Array(names.length * 4).fill(null)
      current.stages[sample.stage].splice(index * 4, 4, ...sample.rotation)
    }
    restorers.push(() => {
      body.dynamicsObserver = observer
    })
    wrap(
      body,
      'apply',
      (original) =>
        function (chunk, ...args) {
          if (!capturedHorizons.has(chunk)) {
            capturedHorizons.add(chunk)
            if (!options.summaryOnly && state.horizons.length < 512)
              state.horizons.push(structuredClone(chunk))
            if (state.pipelineTimings.length < 10000)
              state.pipelineTimings.push({
                at: performance.now(),
                startFrame: chunk.startFrame,
                inferenceMs: chunk.inferenceMs,
                ...chunk.timings,
              })
            else state.pipelineOverflow = true
          }
          if (current && !options.summaryOnly) {
            const index = Math.min(59, Math.max(0, Math.floor(this.cursor - chunk.startFrame)))
            current.actualArdy = names.flatMap((name) => {
              const binding = this.bindings.find((value) => value.name === name)
              return binding ? chunk.rotations[index][binding.index] : [null, null, null, null]
            })
          }
          if (options.staticSource) {
            if (!state.frozen) {
              const index = Math.min(59, Math.max(0, Math.floor(this.cursor - chunk.startFrame)))
              state.frozen = {
                rotations: structuredClone(chunk.rotations[index]),
                root: [...chunk.rootPositions[index]],
              }
            }
            const freeze = (value) => ({
              ...value,
              rotations: Array.from({ length: 60 }, () => state.frozen.rotations),
              rootPositions: Array.from({ length: 60 }, () => state.frozen.root),
            })
            const queue = this.queue
            this.queue = queue.map(freeze)
            try {
              return original.call(this, freeze(chunk), ...args)
            } finally {
              this.queue = queue
            }
          }
          return original.call(this, chunk, ...args)
        },
    )
    wrap(
      facial,
      'updateProceduralMotion',
      (original) =>
        function (...args) {
          snapshot('neuralBase')
          const result = original.apply(this, args)
          snapshot('procedural')
          return result
        },
    )
    wrap(
      safety,
      'projectHandWorkspaces',
      (original) =>
        function (...args) {
          const result = original.apply(this, args)
          snapshot('workspace')
          return result
        },
    )
    wrap(
      safety,
      'sweepChain',
      (original) =>
        function (...args) {
          snapshot('beforeSweep')
          const result = original.apply(this, args)
          snapshot('contact')
          return result
        },
    )
    wrap(
      vrm,
      'update',
      (original) =>
        function (...args) {
          snapshot('beforeVrm')
          const result = original.apply(this, args)
          snapshot('finalVrm')
          snapshot('rawVrm', raw)
          if (current && !options.summaryOnly) current.springs = pose(springs)
          return result
        },
    )
    wrap(
      model,
      'update',
      (original) =>
        function (delta) {
          if (!state.recording) return original.call(this, delta)
          state.observedFrames++
          if (options.summaryOnly) {
            if (state.renderDeltasMs.length < 120000) state.renderDeltasMs.push(delta * 1000)
            else state.renderDeltaOverflow = true
          }
          if (state.observedFrames % (options.frameStride ?? 1) !== 0)
            return original.call(this, delta)
          const now = performance.now()
          if (now - (state.lastCapturedAt ?? -Infinity) < (options.minIntervalMs ?? 0))
            return original.call(this, delta)
          if (state.frames.length >= (options.maxFrames ?? 10000)) {
            state.overflow = true
            return original.call(this, delta)
          }
          state.lastCapturedAt = now
          current = { at: now, delta, stages: {}, timings: {} }
          const started = performance.now()
          original.call(this, delta)
          if (options.staticSource && current.stages.source) {
            state.staticInput ??= current.stages.source.slice()
            current.stages.source.forEach((value, index) => {
              if (value !== null)
                state.staticInputMaxComponentDelta = Math.max(
                  state.staticInputMaxComponentDelta,
                  Math.abs(value - state.staticInput[index]),
                )
            })
          }
          current.costMs = performance.now() - started
          current.sourceFrame = body.cursor
          current.pcm = c.player.getPcmClock()
          if (options.summaryOnly && current.pcm) {
            const { turnId, playbackId, sourceSampleRate, sourceSampleOffset, state } = current.pcm
            current.pcm = { turnId, playbackId, sourceSampleRate, sourceSampleOffset, state }
          }
          current.sampledPcm = body.sampledClock?.sourceSampleOffset ?? null
          current.profile = body.appliedProfileId
          current.phase = body.appliedPhaseId
          current.executionId = body.appliedExecutionId
          current.phaseElapsedMs = body.execution?.elapsedMs ?? null
          current.mirror = body.mirror
            ? {
                sourceFrame: body.mirror.frame,
                profile: body.mirror.profileId,
                executionId: body.mirror.executionId,
                composedAt: body.mirror.composedAtMs,
              }
            : null
          current.safety = safety.getDebugState()
          if (options.summaryOnly) {
            // Four bone positions per sample: hand and head excursion from the
            // hips measure visible gesture and attention coverage cheaply.
            current.positions = ['hips', 'leftHand', 'rightHand', 'head'].flatMap((name) => {
              const bone = vrm.humanoid.getNormalizedBoneNode(name)
              return bone
                ? bone.getWorldPosition(bone.position.clone()).toArray()
                : [null, null, null]
            })
            state.frames.push(current)
            current = null
            return
          }
          current.poles = safety.arms.map((arm) => safety.workspaceSolutions.get(arm)?.pole ?? null)
          current.workspaces = safety.arms.map((arm) => {
            const goal = safety.handGoal(arm),
              solution = safety.workspaceSolutions.get(arm)
            return {
              side: arm.side,
              center: goal?.center.toArray(),
              extents: goal?.extents,
              axes: goal?.axes.map((axis) => axis.toArray()),
              offset: solution?.offset.toArray(),
              scale: safety.workspaceTrajectories.get(arm)?.scale,
            }
          })
          current.breath = facial.proceduralMotionController.getDebugState().breathing
          current.head = facial.headMotionRuntime.getDebugState()
          current.positions = ['hips', 'chest', 'leftHand', 'rightHand', 'head'].flatMap((name) => {
            const bone = vrm.humanoid.getNormalizedBoneNode(name)
            return bone
              ? bone.getWorldPosition(bone.position.clone()).toArray()
              : [null, null, null]
          })
          state.frames.push(current)
          current = null
        },
    )
    state.stop = () => {
      if (!state.recording) return
      state.recording = false
      for (const restore of restorers.reverse()) restore()
    }
    state.metadata = () => ({
      names,
      springNames: state.springNames,
      timeOrigin: state.timeOrigin,
      overflow: state.overflow,
      frameCount: state.frames.length,
      frameStride: options.frameStride ?? 1,
      observedFrames: state.observedFrames,
      horizonCount: state.horizons.length,
      pipelineHorizonCount: state.pipelineTimings.length,
      pipelineTimings: state.pipelineTimings,
      pipelineOverflow: state.pipelineOverflow,
      minIntervalMs: options.minIntervalMs ?? 0,
      summaryOnly: options.summaryOnly === true,
      renderDeltasMs: state.renderDeltasMs,
      renderDeltaOverflow: state.renderDeltaOverflow,
      staticInputMaxComponentDelta: state.staticInputMaxComponentDelta,
    })
    state.take = (offset, count) => state.frames.slice(offset, offset + Math.min(128, count))
    state.takeHorizons = (offset) => state.horizons.slice(offset, offset + 4)
    state.release = () => {
      state.frames = []
      state.horizons = []
      state.renderDeltasMs = []
      state.pipelineTimings = []
      state.frozen = null
    }
    window.__stabilizationProbe = state
  }, options)
}

async function saveStabilizationProbe(page, filename) {
  const metadata = await page.evaluate(() => window.__stabilizationProbe.metadata())
  fs.writeFileSync(filename, JSON.stringify({ ...metadata, frames: [] }).slice(0, -2))
  for (let offset = 0; offset < metadata.frameCount; offset += 128) {
    const batch = await page.evaluate(
      (offset) => window.__stabilizationProbe.take(offset, 128),
      offset,
    )
    fs.appendFileSync(filename, `${offset ? ',' : ''}${JSON.stringify(batch).slice(1, -1)}`)
  }
  fs.appendFileSync(filename, '],"horizons":[')
  for (let offset = 0; offset < metadata.horizonCount; offset += 4) {
    const batch = await page.evaluate(
      (offset) => window.__stabilizationProbe.takeHorizons(offset),
      offset,
    )
    fs.appendFileSync(filename, `${offset ? ',' : ''}${JSON.stringify(batch).slice(1, -1)}`)
  }
  fs.appendFileSync(filename, ']}')
  await page.evaluate(() => window.__stabilizationProbe.release())
  return metadata
}

async function qualifyStabilization({ application, page, directory, report, pause, duration }) {
  assert(duration >= 60 && duration <= 180, 'Stabilization episodes require 60–180 seconds')
  const kind =
    process.argv.find((arg) => arg.startsWith('--stabilization-kind='))?.split('=')[1] ?? 'baseline'
  assert(['baseline', 'static', 'idle', 'ab'].includes(kind), 'Unknown stabilization scenario')
  const overlay = application.windows().find((target) => target.url().includes('overlay=1'))
  assert(overlay, 'Stabilization needs the existing Overlay')
  if (kind === 'ab') return qualifyIdenticalSource({ page, overlay, directory, report, pause })
  const episodes = [
    ...(kind !== 'idle'
      ? [{ id: 'static-poised', profile: 'presence_poised', staticSource: true }]
      : []),
    ...(kind !== 'static'
      ? ['presence_poised', 'presence_warm'].map((profile) => ({ id: profile, profile }))
      : []),
  ]
  report.stabilization = {
    scope: 'isolated RCA; diagnostic static-source intervention is not production animation',
    kind,
    cases: [],
    artisticAcceptance: 'PENDING USER REVIEW',
  }
  for (const episode of episodes) {
    const previousExecution = await page.evaluate(
      () =>
        window.__motionAbController.avatarRuntime.controller.vrmModel.getBodyMotionDebugState()
          .appliedPose?.executionId,
    )
    await page.evaluate(
      (profile) => window.__motionAbController.avatarRuntime.previewVariation(profile, 17),
      episode.profile,
    )
    await page.waitForFunction(
      ({ profile, previousExecution }) => {
        const pose =
          window.__motionAbController.avatarRuntime.controller.vrmModel.getBodyMotionDebugState()
            .appliedPose
        return (
          pose?.profileId === profile &&
          pose.phaseId === 'hold' &&
          pose.executionId !== previousExecution
        )
      },
      { profile: episode.profile, previousExecution },
      { timeout: 45000 },
    )
    await pause(1500)
    await installStabilizationProbe(page, episode)
    await installStabilizationProbe(overlay)
    const camera = () =>
      overlay.evaluate(() => {
        const cam = window.__motionAbController.scene.camera
        return [cam.position.toArray(), cam.quaternion.toArray(), cam.fov]
      })
    const beforeCamera = await camera()
    const videoFile = path.join(directory, `${episode.id}-raw.webm`)
    const stopVideo = await recordCanvas(overlay, videoFile, { captureFps: 90 })
    const started = Date.now()
    let video, primary, mirror
    try {
      while (Date.now() - started < duration * 1000) await pause(200)
    } finally {
      await Promise.all([
        page.evaluate(() => window.__stabilizationProbe.stop()),
        overlay.evaluate(() => window.__stabilizationProbe.stop()),
      ])
      video = await stopVideo()
      primary = await saveStabilizationProbe(
        page,
        path.join(directory, `${episode.id}-primary.json`),
      )
      mirror = await saveStabilizationProbe(
        overlay,
        path.join(directory, `${episode.id}-overlay.json`),
      )
    }
    const primaryFile = `${episode.id}-primary.json`,
      mirrorFile = `${episode.id}-overlay.json`
    const cameraUnchanged = JSON.stringify(beforeCamera) === JSON.stringify(await camera())
    const staticInputMaxComponentDelta = episode.staticSource
      ? primary.staticInputMaxComponentDelta
      : null
    const result = {
      ...episode,
      durationMs: Date.now() - started,
      primaryFile,
      mirrorFile,
      video,
      cameraUnchanged,
      primaryFrames: primary.frameCount,
      overlayFrames: mirror.frameCount,
      overflow: primary.overflow || mirror.overflow,
      staticInputMaxComponentDelta,
      technicalPassed:
        cameraUnchanged &&
        !primary.overflow &&
        !mirror.overflow &&
        video.measuredAverageFps >= 60 &&
        (!episode.staticSource ||
          (staticInputMaxComponentDelta !== null && staticInputMaxComponentDelta < 1e-8)),
      motionContinuity: 'PENDING ANALYSIS',
      gestureReadability: 'NOT APPLICABLE',
      artisticAcceptance: 'PENDING USER REVIEW',
    }
    const output = path.join(directory, `${episode.id}-60fps.mp4`)
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        videoFile,
        '-vf',
        'fps=60',
        '-c:v',
        'libx264',
        '-crf',
        '18',
        '-c:a',
        'aac',
        output,
      ],
      { windowsHide: true },
    )
    result.export = output
    report.stabilization.cases.push(result)
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
    console.log(
      JSON.stringify({
        stabilization: episode.id,
        technicalPassed: result.technicalPassed,
        frames: result.primaryFrames,
        recordedFps: video.measuredAverageFps,
      }),
    )
  }
  report.stabilization.technicalPassed = report.stabilization.cases.every(
    (entry) => entry.technicalPassed,
  )
}

/** Visual comparison of diagnostic compositions only. Production keeps live MotionBricks. */
async function qualifyIdenticalSource({ page, overlay, directory, report, pause }) {
  const root = path.resolve(__dirname, '../../motion/.artifacts/stabilization-2026-10-28')
  const before = JSON.parse(fs.readFileSync(path.join(root, 'full/report.json')))
  const after = JSON.parse(fs.readFileSync(path.join(root, 'critical/report.json')))
  assert.equal(before.sourceSha256, after.sourceSha256)
  assert.equal(before.vrmSha256, after.vrmSha256)
  assert.equal(after.vrmSha256, report.modelFixture.sha256)
  const camera = () =>
    overlay.evaluate(() => {
      const cam = window.__motionAbController.scene.camera
      return [cam.position.toArray(), cam.quaternion.toArray(), cam.fov]
    })
  const initialCamera = await camera()
  await page.evaluate(() => {
    window.__identicalSourceTemplate =
      window.__motionAbController.avatarRuntime.controller.vrmModel.bodyPlayback.getPresentation()
  })
  report.stabilization = {
    kind: 'identical-source-ab',
    sourceSha256: before.sourceSha256,
    scope:
      'Diagnostic captured MotionBricks, baseline/candidate exact composition series; shared fixed root and relaxed fingers. This is not final live inference qualification.',
    cases: [],
    artisticAcceptance: 'PENDING USER REVIEW',
  }
  let transportBase = 10000
  for (const [variant, folder] of [
    ['baseline', 'full'],
    ['candidate', 'critical'],
  ]) {
    const samples = JSON.parse(fs.readFileSync(path.join(root, folder, 'samples.json')))
    await pause(1500)
    for (const profile of before.cases.map((entry) => entry.profileId)) {
      const frames = new Map()
      for (const sample of samples) {
        if (sample.profileId !== profile || sample.stage !== 'final') continue
        const pose = frames.get(sample.sourceFrame) ?? {}
        pose[sample.bone] = sample.rotation
        frames.set(sample.sourceFrame, pose)
      }
      assert.equal(frames.size, 360)
      await page.evaluate(
        ({ frames, profile, transportBase }) => {
          const body = window.__motionAbController.avatarRuntime.controller.vrmModel.bodyPlayback
          const original = body.update,
            pose = window.__identicalSourceTemplate
          if (!pose) throw new Error('Primary composed presentation unavailable')
          let elapsed = 0
          body.update = (delta) => {
            elapsed += Math.max(0, Math.min(0.05, delta))
            const at = Math.min(359, elapsed * 60),
              index = Math.floor(at),
              fraction = at - index
            const bones = { ...pose.bones }
            const vrm = window.__motionAbController.avatarRuntime.controller.vrmModel.vrm
            for (const [name, value] of Object.entries(frames[index])) {
              const bone = vrm.humanoid.getNormalizedBoneNode(name)
              if (!bone) continue
              const target = bone.quaternion
                .clone()
                .fromArray(frames[Math.min(359, index + 1)][name])
              bone.quaternion.fromArray(value).slerp(target, fraction)
              bones[name] = bone.quaternion.toArray()
            }
            body.presentation = {
              ...pose,
              bones,
              profileId: profile,
              frame: transportBase + at / 2,
              composedAtMs: performance.now(),
              phaseId: at < 120 ? 'prepare' : at < 240 ? 'stroke' : 'hold',
            }
          }
          window.__identicalSourceReplay = {
            done: () => elapsed >= 6.05,
            stop: () => {
              body.update = original
            },
          }
        },
        { frames: [...frames.values()], profile, transportBase },
      )
      transportBase += 200
      const videoFile = path.join(directory, `${profile}-${variant}.webm`)
      const stop = await recordCanvas(overlay, videoFile, { captureFps: 90 })
      let video
      try {
        while (!(await page.evaluate(() => window.__identicalSourceReplay.done()))) await pause(100)
      } finally {
        video = await stop()
        await page.evaluate(() => window.__identicalSourceReplay.stop())
      }
      const cameraUnchanged = JSON.stringify(initialCamera) === JSON.stringify(await camera())
      report.stabilization.cases.push({
        profile,
        variant,
        video,
        cameraUnchanged,
        technicalPassed: cameraUnchanged && video.measuredAverageFps >= 60,
      })
      fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
      console.log(
        JSON.stringify({ identicalSource: profile, variant, fps: video.measuredAverageFps }),
      )
    }
  }
  report.stabilization.technicalPassed = report.stabilization.cases.every(
    (entry) => entry.technicalPassed,
  )
}

module.exports = { installStabilizationProbe, qualifyStabilization, saveStabilizationProbe }
