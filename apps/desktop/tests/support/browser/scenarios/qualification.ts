import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'

import {
  BrowserComputerUseRuntime,
  type BrowserVisualActionAdapter,
  PlaywrightBrowserAdapter,
  resolveChromeExecutable,
} from '../../../../src/main/browser-control'
import { BrowserReactiveTracker } from '../../../../src/main/browser-control/computer-use/BrowserReactiveTracker'
import type { BrowserComputerUseDecision } from '../../../../src/shared/browser-computer-use'
import {
  ContinuousVisualAdapter,
  closeServer,
  PublicContinuousVisualAdapter,
  QUALIFICATION_DURATION_MS,
  removeProfile,
  ScriptedVisualAdapter,
  scopedDecision,
  startFixture,
  waitAbortable,
  waitForSession,
} from '../BrowserControlSupport'
import { deterministicRepro } from './deterministic'

async function liveQualification(executablePath: string, profileDirectory: string): Promise<void> {
  const browser = new PlaywrightBrowserAdapter({ executablePath, profileDirectory })
  try {
    const publicPage = (await browser.open('https://example.com/')).observation
    assert(publicPage?.content.includes('Example Domain'))
    await browser.open('https://play2048.co/')
    const startedAt = Date.now()
    let lastProgress = startedAt
    const keys = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'] as const
    const visual = new ScriptedVisualAdapter(async (context, signal, call) => {
      const elapsed = Date.now() - startedAt
      if (elapsed >= QUALIFICATION_DURATION_MS) {
        return scopedDecision(context.observation, {
          type: 'done',
          summary: 'Public browser control qualification completed',
        } as Omit<BrowserComputerUseDecision, 'observationId' | 'pageId'>)
      }
      if (Date.now() - lastProgress >= 60_000) {
        lastProgress = Date.now()
        console.log(`Browser Control qualification: ${Math.floor(elapsed / 60_000)} min`)
      }
      await waitAbortable(Math.max(3_100, Math.ceil(QUALIFICATION_DURATION_MS / 295)), signal)
      return scopedDecision(context.observation, {
        type: 'key',
        key: keys[call % keys.length],
      } as Omit<BrowserComputerUseDecision, 'observationId' | 'pageId'>)
    })
    const runtime = new BrowserComputerUseRuntime({
      browser,
      visual,
      maximumSteps: () => 300,
    })
    await runtime.start(
      {
        goal: 'Safely exercise the public 2048 page for qualification',
        maxSteps: 300,
        maxActions: 300,
        maxDurationMs: Math.min(30 * 60 * 1_000, QUALIFICATION_DURATION_MS + 120_000),
      },
      'live-qualification',
      new AbortController().signal,
    )
    const completed = await waitForSession(
      runtime,
      (session) => ['completed', 'failed', 'waiting-user'].includes(session.state),
      QUALIFICATION_DURATION_MS + 150_000,
    )
    assert.equal(completed.state, 'completed', JSON.stringify(completed))
    assert(Date.now() - startedAt >= QUALIFICATION_DURATION_MS)
    console.log(`Browser Control live qualification: PASS (${completed.actionCount} actions)`)
  } finally {
    await browser.close()
  }
}

interface ContinuousQualificationMetrics {
  label: string
  durationMs: number
  captureFpsP50: number
  captureFpsP95: number
  frameToInputP50Ms: number
  frameToInputP95Ms: number
  trackingLatencyP50Ms: number
  trackingLatencyP95Ms: number
  vlmLatencyP50Ms: number
  vlmLatencyP95Ms: number
  vlmRequestsTotal: number
  framesReceived: number
  framesProcessed: number
  framesDropped: number
  maxPendingFrames: number
  inputHzP50: number
  inputHzP95: number
  inputEventsTotal: number
  planReplacements: number
  planExpirations: number
  reanchors: number
  modeTransitions: number
  notableObservations: number
  completedEvents: number
  commentsEmitted: number
  commentsCompleted: number
  mainHeapDeltaBytes: number
  workerMemoryPeakBytes: number
  workerMemoryTeardownBytes: number
  chromeMemoryDeltaBytes: number
  eventLoopDelayP95Ms: number
  pauseLatencyMs: number
  stopLatencyMs: number
  teardown: {
    heldKeys: number
    heldButtons: number
    activeScreencast: boolean
    activeVlmRequests: number
    activeCdpSessions: number
    workerActive: boolean
    pendingFrames: number
  }
}

async function runContinuousQualificationSession(input: {
  label: string
  executablePath: string
  profileDirectory: string
  url: string
  durationMs: number
  workerPath: string
  visual: BrowserVisualActionAdapter
  pauseDuringRun: boolean
}): Promise<ContinuousQualificationMetrics> {
  const browser = new PlaywrightBrowserAdapter({
    executablePath: input.executablePath,
    profileDirectory: input.profileDirectory,
  })
  const captureSamples: number[] = []
  const inputSamples: number[] = []
  const eventTypes: string[] = []
  const eventLoop = monitorEventLoopDelay({ resolution: 20 })
  let workerMemoryPeakBytes = 0
  let pauseLatencyMs = 0
  const mainHeapBaseline = process.memoryUsage().heapUsed
  eventLoop.enable()
  try {
    await browser.open(input.url)
    const chromeMemoryBaseline = await chromeWorkingSetBytes(input.profileDirectory)
    const runtime = new BrowserComputerUseRuntime({
      browser,
      visual: input.visual,
      reactiveTracker: new BrowserReactiveTracker({ workerPath: input.workerPath }),
      continuousBudget: {
        maximumDurationMs: Math.min(2 * 60 * 60 * 1_000, input.durationMs + 60_000),
        maxSlowDecisionsPerMinute: 120,
        maxReactiveInputEventsPerSecond: 30,
        maxReactiveInputEventsTotal: 500_000,
        maxPointerHoldMs: 2_000,
        maxKeyHoldMs: 2_000,
        maxFrameRate: 30,
      },
      onEvent: (event) => eventTypes.push(event.type),
    })
    await runtime.start(
      {
        goal: `${input.label}: continuously control the current browser page until stopped`,
        termination: { type: 'until-stopped' },
        maxSteps: 1,
        maxActions: 1,
        maxDurationMs: 10_000,
      },
      `qualification-${input.label}`,
      new AbortController().signal,
    )
    await waitForSession(
      runtime,
      (session) => session.controlMode === 'reactive' && session.diagnostics.framesProcessed > 0,
      30_000,
    )
    const startedAt = Date.now()
    let paused = false
    let lastMinute = -1
    while (Date.now() - startedAt < input.durationMs) {
      const snapshot = runtime.snapshot()
      assert(snapshot, `${input.label}: missing active session`)
      assert.equal(snapshot.state, 'running', JSON.stringify(snapshot))
      captureSamples.push(snapshot.diagnostics.captureFps)
      inputSamples.push(snapshot.diagnostics.fastInputHz)
      workerMemoryPeakBytes = Math.max(
        workerMemoryPeakBytes,
        snapshot.diagnostics.workerMemoryBytes,
      )
      const elapsed = Date.now() - startedAt
      const minute = Math.floor(elapsed / 60_000)
      if (minute !== lastMinute) {
        lastMinute = minute
        console.log(`${input.label}: ${minute} min, frames=${snapshot.diagnostics.framesReceived}`)
      }
      if (input.pauseDuringRun && !paused && elapsed >= Math.min(60_000, input.durationMs / 3)) {
        const pauseStartedAt = performance.now()
        const pausedSession = await runtime.pause()
        pauseLatencyMs = performance.now() - pauseStartedAt
        assert.equal(pausedSession.state, 'paused')
        assert.equal(pausedSession.diagnostics.heldKeys, 0)
        assert.equal(pausedSession.diagnostics.heldButtons, 0)
        await new Promise((resolve) => setTimeout(resolve, 250))
        await runtime.resume()
        paused = true
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    const stopStartedAt = performance.now()
    const stopped = await runtime.stop()
    const stopLatencyMs = performance.now() - stopStartedAt
    const chromeMemoryFinal = await chromeWorkingSetBytes(input.profileDirectory)
    const mainHeapFinal = process.memoryUsage().heapUsed
    eventLoop.disable()
    const diagnostics = stopped.diagnostics
    assert.equal(stopped.state, 'stopped')
    assert.equal(diagnostics.heldKeys, 0)
    assert.equal(diagnostics.heldButtons, 0)
    assert.equal(diagnostics.activeScreencast, false, JSON.stringify(diagnostics))
    assert.equal(diagnostics.activeVlmRequests, 0)
    assert.equal(diagnostics.activeCdpSessions, 0)
    assert.equal(diagnostics.workerActive, false)
    assert.equal(diagnostics.pendingFrames, 0)
    assert(diagnostics.maxPendingFrames <= 1)
    assert(diagnostics.framesReceived > 0)
    assert(diagnostics.framesProcessed > 0)
    assert.equal(
      diagnostics.framesReceived,
      diagnostics.framesProcessed + diagnostics.framesDropped,
    )
    assert(diagnostics.inputEventsTotal > 0)
    return {
      label: input.label,
      durationMs: Date.now() - startedAt,
      captureFpsP50: samplePercentile(captureSamples, 0.5),
      captureFpsP95: samplePercentile(captureSamples, 0.95),
      frameToInputP50Ms: diagnostics.frameToInputP50Ms,
      frameToInputP95Ms: diagnostics.frameToInputP95Ms,
      trackingLatencyP50Ms: diagnostics.trackingLatencyP50Ms,
      trackingLatencyP95Ms: diagnostics.trackingLatencyP95Ms,
      vlmLatencyP50Ms: diagnostics.vlmLatencyP50Ms,
      vlmLatencyP95Ms: diagnostics.vlmLatencyP95Ms,
      vlmRequestsTotal: diagnostics.vlmRequestsTotal,
      framesReceived: diagnostics.framesReceived,
      framesProcessed: diagnostics.framesProcessed,
      framesDropped: diagnostics.framesDropped,
      maxPendingFrames: diagnostics.maxPendingFrames,
      inputHzP50: samplePercentile(inputSamples, 0.5),
      inputHzP95: samplePercentile(inputSamples, 0.95),
      inputEventsTotal: diagnostics.inputEventsTotal,
      planReplacements: diagnostics.planReplacements,
      planExpirations: diagnostics.planExpirations,
      reanchors: diagnostics.reanchors,
      modeTransitions: diagnostics.modeTransitions,
      notableObservations: eventTypes.filter((type) => type === 'computer-use-notable-observation')
        .length,
      completedEvents: eventTypes.filter((type) => type === 'computer-use-completed').length,
      commentsEmitted: 0,
      commentsCompleted: 0,
      mainHeapDeltaBytes: mainHeapFinal - mainHeapBaseline,
      workerMemoryPeakBytes,
      workerMemoryTeardownBytes: diagnostics.workerMemoryBytes,
      chromeMemoryDeltaBytes: chromeMemoryFinal - chromeMemoryBaseline,
      eventLoopDelayP95Ms: eventLoop.percentile(95) / 1_000_000,
      pauseLatencyMs,
      stopLatencyMs,
      teardown: {
        heldKeys: diagnostics.heldKeys,
        heldButtons: diagnostics.heldButtons,
        activeScreencast: diagnostics.activeScreencast,
        activeVlmRequests: diagnostics.activeVlmRequests,
        activeCdpSessions: diagnostics.activeCdpSessions,
        workerActive: diagnostics.workerActive,
        pendingFrames: diagnostics.pendingFrames,
      },
    }
  } finally {
    eventLoop.disable()
    await browser.close()
  }
}

function samplePercentile(samples: readonly number[], quantile: number): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))]
}

function chromeWorkingSetBytes(profileDirectory: string): Promise<number> {
  if (process.platform !== 'win32') return Promise.resolve(0)
  const script = [
    '$needle = [Environment]::GetEnvironmentVariable("SHIO_QUALIFICATION_PROFILE")',
    '$sum = (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like ("*" + $needle + "*") } | Measure-Object -Property WorkingSetSize -Sum).Sum',
    'if ($null -eq $sum) { "0" } else { [string]$sum }',
  ].join('; ')
  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        env: { ...process.env, SHIO_QUALIFICATION_PROFILE: profileDirectory },
        windowsHide: true,
      },
      (error, stdout) => resolve(error ? 0 : Number.parseInt(stdout.trim(), 10) || 0),
    )
  })
}

export async function runContinuousBrowserControlQualification(workerPath: string): Promise<void> {
  const executablePath = resolveChromeExecutable()
  assert(executablePath, 'Google Chrome is required for Continuous Browser Control qualification')
  const profileDirectory = await mkdtemp(join(tmpdir(), 'shio-browser-continuous-qualification-'))
  const localDurationMs = Number(process.env.SHIO_CONTINUOUS_BROWSER_LOCAL_MS ?? 10 * 60 * 1_000)
  const publicDurationMs = Number(process.env.SHIO_CONTINUOUS_BROWSER_PUBLIC_MS ?? 60_000)
  const soakDurationMs = Number(process.env.SHIO_CONTINUOUS_BROWSER_SOAK_MS ?? 30 * 60 * 1_000)
  assert(localDurationMs >= 10_000 && Number.isFinite(localDurationMs))
  assert(publicDurationMs >= 10_000 && Number.isFinite(publicDurationMs))
  assert(soakDurationMs >= 10_000 && Number.isFinite(soakDurationMs))
  const { server, origin } = await startFixture()
  try {
    const local = await runContinuousQualificationSession({
      label: 'local-dynamic',
      executablePath,
      profileDirectory: join(profileDirectory, 'local-dynamic'),
      url: `${origin}/continuous`,
      durationMs: localDurationMs,
      workerPath,
      visual: new ContinuousVisualAdapter(),
      pauseDuringRun: true,
    })
    const publicSmoke = await runContinuousQualificationSession({
      label: 'public-browser',
      executablePath,
      profileDirectory: join(profileDirectory, 'public-browser'),
      url: process.env.SHIO_CONTINUOUS_BROWSER_PUBLIC_URL ?? 'https://play2048.co/',
      durationMs: publicDurationMs,
      workerPath,
      visual: new PublicContinuousVisualAdapter(),
      pauseDuringRun: false,
    })
    const soak = await runContinuousQualificationSession({
      label: 'thirty-minute-soak',
      executablePath,
      profileDirectory: join(profileDirectory, 'thirty-minute-soak'),
      url: `${origin}/continuous`,
      durationMs: soakDurationMs,
      workerPath,
      visual: new ContinuousVisualAdapter(),
      pauseDuringRun: true,
    })
    for (const result of [local, soak]) {
      assert(result.captureFpsP50 >= 15, `${result.label}: capture FPS below minimum`)
      assert(result.frameToInputP50Ms < 120, `${result.label}: frame-to-input p50 missed target`)
      assert(result.frameToInputP95Ms < 200, `${result.label}: frame-to-input p95 missed target`)
    }
    console.log(
      `Continuous Browser Control qualification: PASS\n${JSON.stringify(
        { local, publicSmoke, soak },
        null,
        2,
      )}`,
    )
  } finally {
    await closeServer(server)
    await removeProfile(profileDirectory)
  }
}

export async function runBrowserControlQualification(): Promise<void> {
  const executablePath = resolveChromeExecutable()
  assert(executablePath, 'Google Chrome is required for Browser Control qualification')
  const profileDirectory = await mkdtemp(join(tmpdir(), 'shio-browser-control-qualification-'))
  const { server, origin } = await startFixture()
  try {
    await deterministicRepro(executablePath, profileDirectory, origin)
    await liveQualification(executablePath, profileDirectory)
  } finally {
    await closeServer(server)
    await removeProfile(profileDirectory)
  }
}
