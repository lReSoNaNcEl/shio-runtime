const assert = require('node:assert/strict')
const path = require('node:path')
const { recordAudio } = require('./record-audio.cjs')
const { recordCanvas } = require('./record-canvas.cjs')

// An isolated-profile check of the existing validated Scheduler → Gate →
// Attention → Admission path. No injected appraisals, replies or gesture hints.
async function qualifyAutonomousPolicy({ application, page, directory, report, pause }) {
  const original = await page.evaluate(async () => (await window.api.alive.snapshot()).settings)
  const result = {
    blocked: [],
    commands: [],
    errors: [],
    source: 'real one-shot reminders via existing Main IPC',
  }
  report.autonomousPolicy = result
  await page.locator('.app-sidebar').getByRole('button', { name: 'Chat', exact: true }).click()
  await page.evaluate(() => {
    window.__autonomySmoke = { commands: [] }
    window.__autonomySmoke.stop = window.api.alive.onBehavior((command) => {
      if (command.intent.kind === 'conversation-candidate')
        window.__autonomySmoke.commands.push({
          at: Date.now(),
          sourceEventId: command.sourceEventId,
        })
    })
  })
  let stopAudio, stopVideo
  const taskIds = []
  try {
    for (const [name, overrides] of [
      ['off', { mode: 'off', globallySuspended: false }],
      ['suspend', { mode: 'full', globallySuspended: true }],
      ['privacy', { mode: 'full', globallySuspended: false, privacyMode: true }],
    ]) {
      const previousTurnId = await page.evaluate(
        () => window.__motionAbController.player.getPcmClock()?.turnId ?? null,
      )
      const id = await page.evaluate(
        async ({ original, overrides, name }) => {
          await window.api.alive.updateSettings({ ...original, ...overrides })
          const snapshot = await window.api.alive.createTask({
            kind: 'reminder',
            title: `Qualification ${name}: коротко напомни сделать паузу.`,
            dueAt: Date.now() + 1000,
          })
          return snapshot.tasks.find(
            (task) => task.title === `Qualification ${name}: коротко напомни сделать паузу.`,
          ).id
        },
        { original, overrides, name },
      )
      taskIds.push(id)
      await pause(12000)
      const commands = await page.evaluate(() => window.__autonomySmoke.commands)
      assert.equal(commands.length, 0, `${name} admitted an autonomous conversation`)
      const currentTurnId = await page.evaluate(
        () => window.__motionAbController.player.getPcmClock()?.turnId ?? null,
      )
      assert.equal(currentTurnId, previousTurnId, `${name} started a new speech playback`)
      result.blocked.push({ name, passed: true })
      await page.evaluate((id) => window.api.alive.setTaskStatus(id, 'paused'), id)
    }
    await page.evaluate(
      (settings) =>
        window.api.alive.updateSettings({
          ...settings,
          mode: 'full',
          globallySuspended: false,
        }),
      original,
    )
    const overlay = application.windows().find((target) => target.url().includes('overlay=1'))
    assert(overlay, 'No Overlay for proactive evidence')
    stopAudio = await recordAudio(page, path.join(directory, 'proactive-audio.webm'))
    stopVideo = await recordCanvas(overlay, path.join(directory, 'proactive-raw.webm'), {
      captureFps: 90,
    })
    const previousTurnId = await page.evaluate(
      () => window.__motionAbController.player.getPcmClock()?.turnId,
    )
    const id = await page.evaluate(async () => {
      const snapshot = await window.api.alive.createTask({
        kind: 'reminder',
        title: 'Напомни мне сделать небольшую паузу после нашей беседы. Одно короткое предложение.',
        dueAt: Date.now() + 1000,
      })
      return snapshot.tasks.find(
        (task) =>
          task.title ===
          'Напомни мне сделать небольшую паузу после нашей беседы. Одно короткое предложение.',
      ).id
    })
    taskIds.push(id)
    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      const sample = await page.evaluate(() => ({
        commands: window.__autonomySmoke.commands,
        clock: window.__motionAbController.player.getPcmClock(),
      }))
      result.commands = sample.commands
      if (
        sample.commands.length &&
        sample.clock?.state === 'playing' &&
        sample.clock.turnId !== previousTurnId &&
        sample.clock.sourceSampleOffset > 10000
      ) {
        result.consumedSamples = sample.clock.sourceSampleOffset
        result.turnId = sample.clock.turnId
        break
      }
      await pause(200)
    }
    assert(
      result.consumedSamples > 10000,
      'Allowed reminder did not produce real consumed Fish PCM',
    )
    const settledBy = Date.now() + 120000
    let settled = false
    while (Date.now() < settledBy) {
      settled = await page.evaluate((turnId) => {
        const c = window.__motionAbController
        const clock = c.player.getPcmClock()
        return (
          clock?.turnId === turnId &&
          clock.state === 'ended' &&
          c.conversationRuntime.getActiveResponseSnapshot().turnId === null
        )
      }, result.turnId)
      if (settled) break
      await pause(200)
    }
    assert(settled, 'Allowed initiative did not settle playback and conversation cleanup')
    await pause(15000)
    result.commands = await page.evaluate(() => window.__autonomySmoke.commands)
    assert.equal(result.commands.length, 1, 'One-shot reminder admitted more than one initiative')
    result.passed = true
  } catch (error) {
    result.errors.push(error.message)
    result.passed = false
    result.policyEvidence = await page.evaluate(async () => {
      const snapshot = await window.api.alive.snapshot()
      return {
        health: snapshot?.health,
        audit: snapshot?.audit.slice(-12).map(({ category, event, outcome, detail }) => ({
          category,
          event,
          outcome,
          detail,
        })),
      }
    })
  } finally {
    if (stopAudio) result.audio = await stopAudio()
    if (stopVideo) result.video = await stopVideo()
    for (const id of taskIds)
      await page.evaluate((id) => window.api.alive.setTaskStatus(id, 'paused'), id)
    await page.evaluate(() => window.__autonomySmoke.stop())
    await page.evaluate((settings) => window.api.alive.updateSettings(settings), original)
  }
  console.log(JSON.stringify({ autonomousPolicy: result.passed, errors: result.errors }))
}

module.exports = { qualifyAutonomousPolicy }
