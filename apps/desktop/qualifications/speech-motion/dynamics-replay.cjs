const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { recordCanvas } = require('./record-canvas.cjs')

async function replayDynamics({ page, desktop, directory, report, pause }) {
  const root = path.join(desktop, 'motion/.artifacts/living-motion')
  const before = JSON.parse(fs.readFileSync(path.join(root, 'baseline/report.json')))
  const after = JSON.parse(fs.readFileSync(path.join(root, 'final/report.json')))
  assert.equal(before.sourceSha256, after.sourceSha256, 'A/B source must be identical')
  assert.equal(before.vrmSha256, report.modelFixture.sha256, 'A/B rig must be identical')
  const baseline = JSON.parse(fs.readFileSync(path.join(root, 'baseline/samples.json')))
  const result = JSON.parse(fs.readFileSync(path.join(root, 'final/samples.json')))
  await page.waitForFunction(() => !!window.__motionAbController)
  await page.locator('.app-sidebar').getByRole('button', { name: 'Avatar', exact: true }).click()
  await page.getByRole('button', { name: 'Full body', exact: true }).click()
  report.dynamicsReplay = {
    sourceSha256: before.sourceSha256,
    videos: [],
    visualAcceptance: 'pending',
    note: 'Real captured SOMA poses replayed on the same VRM/camera. Shared root and relaxed fingers; live face/secondary composition. No fresh inference or seed between variants.',
  }
  let transportBase = 1000
  for (const profileId of ['presence_poised', 'explain_balance', 'surprise_small']) {
    for (const mode of ['retargeted', 'anatomical', 'baseline-final', 'final']) {
      const samples = mode === 'final' ? result : baseline
      const stage = mode === 'baseline-final' ? 'final' : mode
      const frames = new Map()
      for (const sample of samples.filter(
        (value) => value.profileId === profileId && value.stage === stage,
      )) {
        const pose = frames.get(sample.sourceFrame) ?? {}
        pose[sample.bone] = sample.rotation
        frames.set(sample.sourceFrame, pose)
      }
      assert.equal(frames.size, 360)
      await page.evaluate(
        ({ frames, profileId, transportBase }) => {
          const a = window.__motionAbController.avatarRuntime.controller
          const body = a.vrmModel.bodyPlayback
          const pose = body.getPresentation()
          if (!pose) throw new Error('No Main-owned presentation lease')
          let elapsed = 0
          body.update = (delta, procedural) => {
            elapsed += Math.max(0, Math.min(0.05, delta))
            const at = Math.min(359, elapsed * 60),
              index = Math.floor(at),
              t = at - index
            const from = frames[index],
              to = frames[Math.min(359, index + 1)]
            const bones = { ...pose.bones }
            for (const [name, rotation] of Object.entries(from)) {
              const bone = a.vrmModel.vrm.humanoid.getNormalizedBoneNode(name)
              if (bone) {
                bone.quaternion
                  .fromArray(rotation)
                  .slerp(bone.quaternion.clone().fromArray(to[name]), t)
                bones[name] = bone.quaternion.toArray()
              }
            }
            procedural()
            body.presentation = {
              ...pose,
              bones,
              profileId,
              frame: transportBase + at / 2,
              composedAtMs: performance.now(),
              phaseId: at < 120 ? 'prepare' : at < 240 ? 'stroke' : 'hold',
            }
          }
          window.__replayDone = () => elapsed >= 6.05
        },
        { frames: [...frames.values()], profileId, transportBase },
      )
      transportBase += 200
      const filename = path.join(directory, `${profileId}-${mode}.webm`)
      const stop = await recordCanvas(page, filename)
      while (!(await page.evaluate(() => window.__replayDone()))) await pause(100)
      const video = await stop()
      report.dynamicsReplay.videos.push({ profileId, mode, ...video, sourceFrames: 180 })
    }
  }
}
module.exports = { replayDynamics }
