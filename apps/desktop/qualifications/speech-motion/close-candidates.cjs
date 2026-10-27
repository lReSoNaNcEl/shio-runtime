const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { recordCanvas } = require('./record-canvas.cjs')

async function qualifyCloseCandidates({ application, page, directory, report, pause }) {
  const seed = Number(
    process.argv.find((value) => value.startsWith('--close-seed='))?.split('=')[1] ?? 271,
  )
  assert(Number.isInteger(seed) && seed >= 0 && seed <= 2147483647)
  const overlay = application.windows().find((target) => target.url().includes('overlay=1'))
  assert(overlay)
  assert.equal(await page.locator('canvas').count(), 0)
  report.closeCandidates = {
    seed,
    scope: 'Manual draft rig/readability qualification only; no conversational or artistic PASS',
    cases: [],
  }
  await overlay.evaluate(() => {
    const c = window.__motionAbController,
      model = c.avatarRuntime.controller.vrmModel
    const camera = c.scene.camera
    const state = {
      cases: {},
      camera: {
        position: camera.position.toArray(),
        quaternion: camera.quaternion.toArray(),
        fov: camera.fov,
        maxDelta: 0,
      },
    }
    const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))
    const frame = () => {
      state.camera.maxDelta = Math.max(
        state.camera.maxDelta,
        distance(state.camera.position, camera.position.toArray()),
        distance(state.camera.quaternion, camera.quaternion.toArray()),
        Math.abs(state.camera.fov - camera.fov),
      )
      const pose = model.bodyPlayback.mirror
      if (pose?.executionId && pose.profileId.endsWith('_close')) {
        state.cases[pose.executionId] ??= {
          profileId: pose.profileId,
          phases: [],
          strokeFrames: 0,
          visibleFrames: 0,
          handTravelM: 0,
          strokeTravelM: 0,
          maxElbowAboveShoulderM: 0,
          eyeCoveredFrames: 0,
        }
        const item = state.cases[pose.executionId]
        if (!item.phases.includes(pose.phaseId)) item.phases.push(pose.phaseId)
        item.outcome = pose.outcome
        const hand = model.vrm.humanoid.getRawBoneNode('rightHand')
        const p = hand.getWorldPosition(hand.position.clone()).toArray()
        item.initial ??= p
        item.handTravelM = Math.max(item.handTravelM, distance(item.initial, p))
        if (pose.phaseId === 'stroke') {
          const elbow = model.vrm.humanoid.getRawBoneNode('rightLowerArm')
          const shoulder = model.vrm.humanoid.getRawBoneNode('rightUpperArm')
          item.maxElbowAboveShoulderM = Math.max(
            item.maxElbowAboveShoulderM,
            elbow.getWorldPosition(elbow.position.clone()).y -
              shoulder.getWorldPosition(shoulder.position.clone()).y,
          )
          item.strokeFrames++
          item.strokeInitial ??= p
          item.strokeTravelM = Math.max(item.strokeTravelM, distance(item.strokeInitial, p))
          const names = ['rightHand', 'rightIndexDistal', 'rightLittleDistal']
          const visible = names.every((name) => {
            const bone = model.vrm.humanoid.getRawBoneNode(name)
            if (!bone) return false
            const projected = bone.getWorldPosition(bone.position.clone()).project(camera)
            return (
              Math.abs(projected.x) < 0.95 &&
              Math.abs(projected.y) < 0.95 &&
              projected.z > -1 &&
              projected.z < 1
            )
          })
          if (visible) item.visibleFrames++
          const silhouette = [
            'rightHand',
            'rightThumbDistal',
            'rightIndexDistal',
            'rightMiddleDistal',
            'rightRingDistal',
            'rightLittleDistal',
          ]
            .map((name) => model.vrm.humanoid.getRawBoneNode(name))
            .filter(Boolean)
            .map((bone) => bone.getWorldPosition(bone.position.clone()).project(camera))
          const minX = Math.min(...silhouette.map((v) => v.x)),
            maxX = Math.max(...silhouette.map((v) => v.x)),
            minY = Math.min(...silhouette.map((v) => v.y)),
            maxY = Math.max(...silhouette.map((v) => v.y))
          const eyes = ['leftEye', 'rightEye']
            .map((name) => model.vrm.humanoid.getRawBoneNode(name))
            .filter(Boolean)
            .map((bone) => bone.getWorldPosition(bone.position.clone()).project(camera))
          if (eyes.some((v) => v.x >= minX && v.x <= maxX && v.y >= minY && v.y <= maxY))
            item.eyeCoveredFrames++
          item.strokeStartedAt ??= Date.now()
        }
      }
      state.frame = requestAnimationFrame(frame)
    }
    state.stop = () => {
      cancelAnimationFrame(state.frame)
      return { cases: state.cases, camera: state.camera }
    }
    window.__closeProbe = state
    frame()
  })
  const stop = await recordCanvas(overlay, path.join(directory, 'close-candidates.webm'), {
    captureFps: 90,
  })
  try {
    const ids = ['greet_wave_close', 'explain_point_close', 'celebrate_close']
    const subset = process.argv
      .find((value) => value.startsWith('--close-case-ids='))
      ?.split('=')[1]
      .split(',')
    assert(!subset || subset.every((id) => ids.includes(id)))
    for (const id of ids.filter((id) => !subset || subset.includes(id))) {
      await page.evaluate(
        ({ id, seed }) => window.__motionAbController.avatarRuntime.previewVariation(id, seed),
        { id, seed },
      )
      const deadline = Date.now() + 45000
      let current,
        preparationGoals,
        maxContacts = 0,
        contactEvents = [],
        errors = []
      while (Date.now() < deadline) {
        current = await page.evaluate(() => {
          const m = window.__motionAbController.avatarRuntime.controller.vrmModel
          const generated = m.getBodyMotionDebugState().generated
          const safety = m.bodyPlayback.bodySafety
          const goals = safety.arms.map((arm) => {
            const goal = safety.handGoal(arm)
            if (!goal) return null
            const wrist = arm.end.getWorldPosition(arm.end.position.clone())
            const offset = wrist.clone().sub(goal.center)
            const rotation = arm.end.getWorldQuaternion(arm.end.quaternion.clone())
            return {
              side: arm.side,
              positionViolationM: Math.max(
                ...goal.axes.map((axis, index) => Math.abs(offset.dot(axis)) - goal.extents[index]),
              ),
              palmDot: goal.palm
                ? arm.palmAxis.clone().applyQuaternion(rotation).dot(goal.palm)
                : null,
              fingerDot: goal.fingers
                ? arm.fingerAxis.clone().applyQuaternion(rotation).dot(goal.fingers)
                : null,
            }
          })
          return {
            debug: m.getMotionLibraryDebug(),
            applied: m.getBodyMotionDebugState().appliedPose,
            error: generated?.error,
            contacts: generated?.safety?.unresolvedArmContacts ?? 0,
            contactGeometry: safety.arms.map((arm) => ({
              side: arm.side,
              contact: safety.torso() ? safety.contact(arm, safety.torso()) : null,
            })),
            goals,
          }
        })
        if (current.contacts && contactEvents.length < 64)
          contactEvents.push({
            at: Date.now(),
            applied: current.applied,
            contacts: current.contacts,
            geometry: current.contactGeometry,
          })
        if (current.applied?.profileId === id) maxContacts = Math.max(maxContacts, current.contacts)
        if (current.debug.runningProfileId === id && current.debug.phase === 'prepare')
          preparationGoals = current.goals
        if (current.error && !errors.includes(current.error)) errors.push(current.error)
        const terminal = await overlay.evaluate(
          (id) =>
            Object.values(window.__closeProbe.cases).find((item) => item.profileId === id)?.outcome,
          id,
        )
        if (terminal || (current.debug.runningProfileId === id && current.debug.outcome)) break
        await pause(40)
      }
      await pause(100)
      const observed = await overlay.evaluate(
        (id) => Object.values(window.__closeProbe.cases).find((item) => item.profileId === id),
        id,
      )
      const item = {
        id,
        ...observed,
        maxContacts,
        contactEvents,
        errors,
        terminal: current?.debug,
        goals: current?.goals,
        preparationGoals,
        visualAcceptance: 'pending',
      }
      item.passed = Boolean(
        observed &&
          ['prepare', 'stroke', 'hold', 'recover'].every((p) => observed.phases.includes(p)) &&
          (observed.outcome === 'completed' || current?.debug.outcome === 'completed') &&
          !errors.length &&
          maxContacts === 0 &&
          observed.strokeFrames >= 6 &&
          observed.visibleFrames / observed.strokeFrames >= 0.6 &&
          observed.handTravelM >= 0.035 &&
          observed.strokeTravelM >= 0.015 &&
          observed.eyeCoveredFrames / observed.strokeFrames < 0.05 &&
          observed.maxElbowAboveShoulderM <= 0.08,
      )
      report.closeCandidates.cases.push(item)
      fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
      console.log(JSON.stringify({ closeCandidate: id, passed: item.passed, observed, errors }))
    }
  } finally {
    report.closeCandidates.observed = await overlay.evaluate(() => window.__closeProbe.stop())
    report.closeCandidates.video = await stop()
  }
  report.closeCandidates.passed =
    report.closeCandidates.cases.every((item) => item.passed) &&
    report.closeCandidates.observed.camera.maxDelta < 1e-6
}
module.exports = { qualifyCloseCandidates }
