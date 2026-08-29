import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BrowserComputerUseRuntime,
  PlaywrightBrowserAdapter,
  resolveChromeExecutable,
} from '../../../../src/main/browser-control'
import {
  ContinuousVisualAdapter,
  closeServer,
  DeterministicReactiveTracker,
  InvalidReactivePlanAdapter,
  ProviderOutageContinuousVisualAdapter,
  removeProfile,
  ScriptedVisualAdapter,
  scopedDecision,
  startFixture,
  waitForSession,
} from '../BrowserControlSupport'

async function continuousRepro(
  executablePath: string,
  profileDirectory: string,
  origin: string,
): Promise<void> {
  const browser = new PlaywrightBrowserAdapter({ executablePath, profileDirectory })
  const events: string[] = []
  try {
    await browser.open(`${origin}/continuous`)
    const visual = new ContinuousVisualAdapter()
    const runtime = new BrowserComputerUseRuntime({
      browser,
      visual,
      reactiveTracker: new DeterministicReactiveTracker(),
      continuousBudget: {
        maximumDurationMs: 30_000,
        maxSlowDecisionsPerMinute: 120,
        maxReactiveInputEventsPerSecond: 30,
        maxReactiveInputEventsTotal: 2_000,
        maxPointerHoldMs: 1_000,
        maxKeyHoldMs: 1_500,
        maxFrameRate: 30,
      },
      onEvent: (event) => events.push(event.type),
    })
    const started = await runtime.start(
      {
        goal: 'Keep the dynamic canvas controlled until explicitly stopped',
        termination: { type: 'until-stopped' },
        maxSteps: 1,
        maxActions: 1,
        maxDurationMs: 10_000,
      },
      'continuous-fixture-action',
      new AbortController().signal,
    )
    assert.equal(started.state, 'running')
    assert.equal(started.termination.type, 'until-stopped')
    await waitForSession(
      runtime,
      (session) =>
        session.controlMode === 'reactive' &&
        session.diagnostics.framesProcessed >= 3 &&
        session.diagnostics.heldKeys > 0,
    )
    const beforePause = runtime.snapshot()
    assert(beforePause)
    assert(beforePause.stepCount > beforePause.maxSteps)
    const paused = await runtime.pause()
    assert.equal(paused.state, 'paused')
    assert.equal(paused.diagnostics.heldKeys, 0)
    assert.equal(paused.diagnostics.heldButtons, 0)
    assert((await browser.observe()).content.includes('held=none'))
    const inputAtPause = paused.diagnostics.inputEventsTotal
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.equal(runtime.snapshot()?.diagnostics.inputEventsTotal, inputAtPause)

    await runtime.resume()
    await waitForSession(runtime, (session) => session.diagnostics.inputEventsTotal > inputAtPause)
    await waitForSession(runtime, (session) => session.actionCount >= 2, 12_000)
    const pageContent = (await browser.observe()).content
    assert.match(
      pageContent,
      /retries=[1-9]/u,
      `Continuous fixture did not retry: ${JSON.stringify(runtime.snapshot())}`,
    )
    const stopped = await runtime.stop()
    assert.equal(stopped.state, 'stopped')
    assert.equal(stopped.diagnostics.activeScreencast, false)
    assert.equal(stopped.diagnostics.activeVlmRequests, 0)
    assert.equal(stopped.diagnostics.activeCdpSessions, 0)
    assert.equal(stopped.diagnostics.heldKeys, 0)
    assert.equal(stopped.diagnostics.heldButtons, 0)
    assert.equal(stopped.diagnostics.pendingFrames, 0)
    assert.equal(stopped.diagnostics.maxPendingFrames, 1)
    assert(stopped.diagnostics.framesReceived >= stopped.diagnostics.framesProcessed)
    assert(stopped.diagnostics.framesDropped > 0)
    assert.equal(
      stopped.diagnostics.framesReceived,
      stopped.diagnostics.framesProcessed + stopped.diagnostics.framesDropped,
    )
    assert(stopped.diagnostics.inputEventsTotal > 0)
    assert(visual.planCalls >= 2)
    assert(events.includes('computer-use-started'))
    assert(events.includes('computer-use-notable-observation'))
    assert(events.includes('computer-use-stopped'))
    console.log('Continuous Browser Control repro: pause/resume/retry/stop PASS')

    await browser.open(`${origin}/continuous`)
    const realStartedAt = Date.now()
    const acceleratedNow = (): number => realStartedAt + (Date.now() - realStartedAt) * 25
    const timedRuntime = new BrowserComputerUseRuntime({
      browser,
      visual: new ContinuousVisualAdapter(),
      reactiveTracker: new DeterministicReactiveTracker(),
      now: acceleratedNow,
      continuousBudget: {
        maximumDurationMs: 20_000,
        maxSlowDecisionsPerMinute: 120,
        maxReactiveInputEventsPerSecond: 30,
        maxReactiveInputEventsTotal: 2_000,
        maxPointerHoldMs: 1_000,
        maxKeyHoldMs: 1_500,
        maxFrameRate: 30,
      },
    })
    await timedRuntime.start(
      {
        goal: 'Control for the requested duration',
        termination: { type: 'until-time', durationMs: 10_000 },
        maxSteps: 1,
        maxActions: 1,
        maxDurationMs: 10_000,
      },
      'continuous-timed-action',
      new AbortController().signal,
    )
    const completed = await waitForSession(
      timedRuntime,
      (session) => session.state === 'completed',
      5_000,
    )
    assert.equal(completed.termination.type, 'until-time')
    assert.equal(completed.summary, 'Requested continuous-control duration completed.')
    assert.equal(completed.diagnostics.activeScreencast, false)
    assert.equal(completed.diagnostics.heldKeys, 0)
    console.log('Continuous Browser Control repro: until-time lease PASS')

    await browser.open(`${origin}/continuous`)
    const leaseStartedAt = Date.now()
    const leaseRuntime = new BrowserComputerUseRuntime({
      browser,
      visual: new ScriptedVisualAdapter((context) =>
        scopedDecision(context.observation, { type: 'wait', durationMs: 100 }),
      ),
      now: () => leaseStartedAt + (Date.now() - leaseStartedAt) * 50,
      continuousBudget: {
        maximumDurationMs: 10_000,
        maxSlowDecisionsPerMinute: 120,
        maxReactiveInputEventsPerSecond: 30,
        maxReactiveInputEventsTotal: 2_000,
        maxPointerHoldMs: 1_000,
        maxKeyHoldMs: 1_500,
        maxFrameRate: 30,
      },
    })
    await leaseRuntime.start(
      {
        goal: 'Keep control until explicitly stopped',
        termination: { type: 'until-stopped' },
        maxSteps: 1,
        maxActions: 1,
        maxDurationMs: 10_000,
      },
      'continuous-until-stopped-lease',
      new AbortController().signal,
    )
    const leaseExpired = await waitForSession(
      leaseRuntime,
      (session) => session.state === 'stopped',
      5_000,
    )
    assert.equal(leaseExpired.lastErrorCode, 'COMPUTER_USE_LEASE_EXPIRED')
    assert.notEqual(leaseExpired.state, 'completed')
    console.log('Continuous Browser Control repro: until-stopped lease honesty PASS')

    await browser.open(`${origin}/continuous`)
    const reactiveDegradeVisual = new InvalidReactivePlanAdapter()
    const reactiveDegradeRuntime = new BrowserComputerUseRuntime({
      browser,
      visual: reactiveDegradeVisual,
      continuousBudget: {
        maximumDurationMs: 20_000,
        maxSlowDecisionsPerMinute: 120,
        maxReactiveInputEventsPerSecond: 30,
        maxReactiveInputEventsTotal: 2_000,
        maxPointerHoldMs: 1_000,
        maxKeyHoldMs: 1_500,
        maxFrameRate: 30,
      },
    })
    await reactiveDegradeRuntime.start(
      {
        goal: 'Continue through slow control after an invalid reactive proposal',
        termination: { type: 'until-stopped' },
        maxSteps: 1,
        maxActions: 1,
        maxDurationMs: 10_000,
      },
      'continuous-reactive-degrade',
      new AbortController().signal,
    )
    const degraded = await waitForSession(
      reactiveDegradeRuntime,
      (session) => session.state === 'running' && session.actionCount > 0,
      8_000,
    )
    assert.equal(degraded.controlMode, 'slow')
    assert.equal(reactiveDegradeVisual.rejectedPlans >= 1, true)
    await reactiveDegradeRuntime.stop()
    console.log('Continuous Browser Control repro: invalid reactive plan degradation PASS')

    await browser.open(`${origin}/continuous`)
    const outageRuntime = new BrowserComputerUseRuntime({
      browser,
      visual: new ProviderOutageContinuousVisualAdapter(),
      reactiveTracker: new DeterministicReactiveTracker(),
      continuousBudget: {
        maximumDurationMs: 20_000,
        maxSlowDecisionsPerMinute: 120,
        maxReactiveInputEventsPerSecond: 30,
        maxReactiveInputEventsTotal: 2_000,
        maxPointerHoldMs: 1_000,
        maxKeyHoldMs: 1_500,
        maxFrameRate: 30,
      },
    })
    await outageRuntime.start(
      {
        goal: 'Stop reactive input when the slow provider becomes unavailable',
        termination: { type: 'until-stopped' },
        maxSteps: 1,
        maxActions: 1,
        maxDurationMs: 10_000,
      },
      'continuous-provider-outage',
      new AbortController().signal,
    )
    const failed = await waitForSession(
      outageRuntime,
      (session) => session.state === 'failed',
      8_000,
    )
    assert.equal(failed.lastErrorCode, 'COMPUTER_USE_PROVIDER_NETWORK')
    assert(failed.diagnostics.planExpirations >= 1)
    assert.equal(failed.diagnostics.activeScreencast, false)
    assert.equal(failed.diagnostics.activeCdpSessions, 0)
    assert.equal(failed.diagnostics.heldKeys, 0)
    assert.equal(failed.diagnostics.workerActive, false)
    console.log('Continuous Browser Control repro: provider outage TTL PASS')
  } finally {
    await browser.close()
  }
}

export async function runDeterministicContinuousBrowserControl(): Promise<void> {
  const executablePath = resolveChromeExecutable()
  assert(executablePath, 'Google Chrome is required for Continuous Browser Control tests')
  const profileDirectory = await mkdtemp(join(tmpdir(), 'shio-browser-continuous-control-'))
  const { server, origin } = await startFixture()
  try {
    await continuousRepro(executablePath, profileDirectory, origin)
  } finally {
    await closeServer(server)
    await removeProfile(profileDirectory)
  }
}
