import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BrowserAutomationError,
  type BrowserComputerUseDecisionContext,
  BrowserComputerUseRuntime,
  type BrowserVisualActionAdapter,
  type BrowserVisualActionStatus,
  PlaywrightBrowserAdapter,
  resolveChromeExecutable,
} from '../../src/main/browser-control'
import type {
  BrowserComputerUseDecision,
  BrowserComputerUseObservation,
  BrowserComputerUseSession,
} from '../../src/shared/browser-computer-use'
import type {
  BrowserInteractiveRole,
  BrowserObservation,
  BrowserTarget,
} from '../../src/shared/browser-control'

const QUALIFICATION_DURATION_MS = Number(
  process.env.SHIO_BROWSER_CONTROL_QUALIFICATION_MS ?? 15 * 60 * 1_000,
)

class ScriptedVisualAdapter implements BrowserVisualActionAdapter {
  calls = 0

  constructor(
    private readonly decideNext: (
      context: BrowserComputerUseDecisionContext,
      signal: AbortSignal,
      call: number,
    ) => Promise<BrowserComputerUseDecision> | BrowserComputerUseDecision,
    private readonly vision = true,
  ) {}

  status(): BrowserVisualActionStatus {
    return { state: 'ready', model: 'deterministic-fixture', supportsVision: this.vision }
  }

  decide(
    context: BrowserComputerUseDecisionContext,
    signal: AbortSignal,
  ): Promise<BrowserComputerUseDecision> {
    const call = this.calls++
    return Promise.resolve(this.decideNext(context, signal, call))
  }
}

function fixtureHtml(blocker?: string): string {
  const blockerMarkup =
    blocker === 'captcha'
      ? '<div class="g-recaptcha">Manual CAPTCHA</div>'
      : blocker === 'two-factor'
        ? '<input aria-label="One-time code" autocomplete="one-time-code">'
        : blocker === 'payment-confirmation'
          ? '<input aria-label="Card number" autocomplete="cc-number">'
          : blocker === 'authentication'
            ? '<input aria-label="Password" type="password" autocomplete="current-password">'
            : blocker === 'password-manager'
              ? '<div data-password-manager-dialog>Unlock password manager</div>'
              : blocker === 'secure-desktop'
                ? '<div data-shio-secure-desktop-blocker>Secure desktop active</div>'
                : ''
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Browser Control Fixture</title>
    <style>
      body { font-family: sans-serif; margin: 32px; }
      canvas { border: 2px solid #345; display: block; margin-top: 24px; }
    </style>
  </head>
  <body>
    <h1>Browser Control Fixture</h1>
    <label>Player <input aria-label="Player name" id="player"></label>
    <label>Difficulty
      <select aria-label="Difficulty" id="difficulty">
        <option value="easy">Easy</option>
        <option value="hard">Hard</option>
      </select>
    </label>
    <button aria-label="Save profile" id="save">Save</button>
    <button aria-label="Check notifications" id="check-notifications">Check notifications</button>
    <p id="persisted"></p>
    <p id="status" aria-live="polite">Ready</p>
    <p id="notification">Notification permission: pending</p>
    <canvas aria-label="Canvas target" role="button" tabindex="0" width="320" height="180"></canvas>
    ${blockerMarkup}
    <script>
      const player = document.querySelector('#player')
      const difficulty = document.querySelector('#difficulty')
      const status = document.querySelector('#status')
      const persisted = document.querySelector('#persisted')
      const canvas = document.querySelector('canvas')
      const saved = localStorage.getItem('fixture-player')
      if (saved) persisted.textContent = 'Persisted player: ' + saved
      document.querySelector('#save').addEventListener('click', () => {
        localStorage.setItem('fixture-player', player.value)
        status.textContent = 'Saved ' + player.value + ' on ' + difficulty.value
      })
      document.querySelector('#check-notifications').addEventListener('click', async () => {
        const permission = await Notification.requestPermission()
        document.querySelector('#notification').textContent =
          'Notification permission: ' + permission
      })
      canvas.addEventListener('click', () => {
        canvas.focus()
        status.textContent = 'Canvas clicked'
      })
      canvas.addEventListener('keydown', (event) => {
        status.textContent = 'Key down ' + event.key
      })
      canvas.addEventListener('keyup', (event) => {
        status.textContent = 'Key released ' + event.key
      })
      const context = canvas.getContext('2d')
      context.fillStyle = '#68a0cf'
      context.fillRect(20, 20, 100, 80)
      document.querySelector('#notification').textContent =
        'Notification permission: ' + Notification.permission
    </script>
  </body>
</html>`
}

async function startFixture(): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    })
    response.end(fixtureHtml(url.searchParams.get('blocker') ?? undefined))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  assert(address && typeof address === 'object')
  return { server, origin: `http://127.0.0.1:${address.port}` }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}

function target(
  observation: BrowserObservation,
  role: BrowserInteractiveRole,
  name: string,
): BrowserTarget {
  return { kind: 'accessible-name', observationId: observation.observationId, role, name }
}

async function waitForSession(
  runtime: BrowserComputerUseRuntime,
  predicate: (session: BrowserComputerUseSession) => boolean,
  timeoutMs = 15_000,
): Promise<BrowserComputerUseSession> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const session = runtime.snapshot()
    if (session && predicate(session)) return session
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for browser session: ${JSON.stringify(runtime.snapshot())}`)
}

function scopedDecision(
  observation: BrowserComputerUseObservation,
  decision: Omit<BrowserComputerUseDecision, 'observationId' | 'pageId'>,
): BrowserComputerUseDecision {
  return {
    ...decision,
    observationId: observation.id,
    pageId: observation.page.id,
  } as BrowserComputerUseDecision
}

function refFor(observation: BrowserComputerUseObservation, name: string): string {
  const line = observation.semantic?.ariaSnapshot
    .split('\n')
    .find((candidate) => candidate.includes(name) && /^e\d+\s/u.test(candidate))
  const ref = line?.match(/^(e\d+)\s/u)?.[1]
  assert(ref, `Missing semantic ref for ${name}`)
  return ref
}

function waitAbortable(durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer)
      reject(signal.reason ?? new Error('aborted'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, durationMs)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

async function removeProfile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EBUSY') throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  await rm(path, { recursive: true, force: true })
}

async function deterministicRepro(
  executablePath: string,
  profileDirectory: string,
  origin: string,
): Promise<void> {
  const browser = new PlaywrightBrowserAdapter({ executablePath, profileDirectory })
  let reopened: PlaywrightBrowserAdapter | undefined
  try {
    const initial = (await browser.open(origin)).observation
    assert(initial)
    assert.equal(initial.title, 'Browser Control Fixture')
    assert(initial.interactiveElements.some((element) => element.name === 'Canvas target'))

    const filled = (await browser.fill(target(initial, 'textbox', 'Player name'), 'Ada'))
      .observation
    assert(filled)
    const selected = (await browser.select(target(filled, 'combobox', 'Difficulty'), ['hard']))
      .observation
    assert(selected)
    const saved = (await browser.click(target(selected, 'button', 'Save profile'))).observation
    assert(saved?.content.includes('Saved Ada on hard'))
    assert(saved)
    await browser.click(target(saved, 'button', 'Check notifications'))
    await new Promise((resolve) => setTimeout(resolve, 100))
    const notifications = await browser.observe()
    assert(notifications.content.includes('Notification permission: denied'), notifications.content)

    await assert.rejects(
      () => browser.click(target(initial, 'button', 'Save profile')),
      (error) => error instanceof BrowserAutomationError && error.code === 'TARGET_STALE',
    )

    const unavailableVisual: BrowserVisualActionAdapter = {
      status: () => ({
        state: 'needs-setup',
        model: 'Auto · text-only-model',
        supportsVision: false,
      }),
      decide: async () => {
        throw new Error('An unavailable visual model must never receive a decision request')
      },
    }
    const unavailableRuntime = new BrowserComputerUseRuntime({
      browser,
      visual: unavailableVisual,
    })
    await assert.rejects(
      () =>
        unavailableRuntime.start(
          {
            goal: 'Must require a vision model',
            maxSteps: 30,
            maxActions: 100,
            maxDurationMs: 30_000,
          },
          'unavailable-visual-action',
          new AbortController().signal,
        ),
      (error) =>
        error instanceof BrowserAutomationError && error.code === 'COMPUTER_USE_UNAVAILABLE',
    )

    const boundedVisual = new ScriptedVisualAdapter((context) =>
      scopedDecision(context.observation, {
        type: 'done',
        summary: 'Configured step cap verified',
      } as Omit<BrowserComputerUseDecision, 'observationId' | 'pageId'>),
    )
    const boundedRuntime = new BrowserComputerUseRuntime({
      browser,
      visual: boundedVisual,
      maximumSteps: () => 5,
    })
    const boundedSession = await boundedRuntime.start(
      {
        goal: 'Respect the configured step cap',
        maxSteps: 100,
        maxActions: 100,
        maxDurationMs: 30_000,
      },
      'bounded-visual-action',
      new AbortController().signal,
    )
    assert.equal(boundedSession.maxSteps, 5)
    await waitForSession(boundedRuntime, (session) => session.state === 'completed')

    let fixtureDecision = 0
    const fixtureEvents: string[] = []
    const fixtureVisual = new ScriptedVisualAdapter((context) => {
      assert(context.observation.visual?.bytes.length)
      fixtureDecision += 1
      if (fixtureDecision === 1) {
        return scopedDecision(context.observation, {
          type: 'click-ref',
          ref: refFor(context.observation, 'Canvas target'),
        } as Omit<BrowserComputerUseDecision, 'observationId' | 'pageId'>)
      }
      if (fixtureDecision === 2) {
        return scopedDecision(context.observation, {
          type: 'key',
          key: 'ArrowRight',
        } as Omit<BrowserComputerUseDecision, 'observationId' | 'pageId'>)
      }
      return scopedDecision(context.observation, {
        type: 'done',
        summary: 'Canvas and keyboard controls verified',
      } as Omit<BrowserComputerUseDecision, 'observationId' | 'pageId'>)
    })
    const fixtureRuntime = new BrowserComputerUseRuntime({
      browser,
      visual: fixtureVisual,
      onEvent: (event) => fixtureEvents.push(event.type),
    })
    await fixtureRuntime.start(
      {
        goal: 'Verify canvas and keyboard control',
        maxSteps: 10,
        maxActions: 10,
        maxDurationMs: 30_000,
      },
      'fixture-action',
      new AbortController().signal,
    )
    const fixtureCompleted = await waitForSession(
      fixtureRuntime,
      (session) => session.state === 'completed',
    )
    assert.equal(fixtureCompleted.actionCount, 2)
    assert(fixtureEvents.includes('computer-use-started'))
    assert(fixtureEvents.includes('computer-use-progress'))
    assert(fixtureEvents.includes('computer-use-completed'))

    let pauseDecision = 0
    const pauseVisual = new ScriptedVisualAdapter(async (context, signal) => {
      pauseDecision += 1
      if (pauseDecision === 1) {
        return scopedDecision(context.observation, {
          type: 'key-down',
          key: 'ArrowLeft',
        } as Omit<BrowserComputerUseDecision, 'observationId' | 'pageId'>)
      }
      if (pauseDecision === 2) {
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      }
      return scopedDecision(context.observation, {
        type: 'done',
        summary: 'Pause and resume verified',
      } as Omit<BrowserComputerUseDecision, 'observationId' | 'pageId'>)
    })
    const pauseRuntime = new BrowserComputerUseRuntime({ browser, visual: pauseVisual })
    await pauseRuntime.start(
      {
        goal: 'Verify pause and input release',
        maxSteps: 10,
        maxActions: 10,
        maxDurationMs: 30_000,
      },
      'pause-action',
      new AbortController().signal,
    )
    await waitForSession(
      pauseRuntime,
      (session) => session.actionCount === 1 && session.activity === 'deciding',
    )
    assert.equal((await pauseRuntime.pause()).state, 'paused')
    assert((await browser.observe()).content.includes('Key released ArrowLeft'))
    await pauseRuntime.resume()
    await waitForSession(pauseRuntime, (session) => session.state === 'completed')

    for (const blocker of [
      'captcha',
      'two-factor',
      'authentication',
      'password-manager',
      'payment-confirmation',
      'secure-desktop',
    ] as const) {
      await browser.open(`${origin}/?blocker=${blocker}`)
      const blockerVisual = new ScriptedVisualAdapter(() => {
        throw new Error('A blocked page reached the action model')
      })
      const blockerRuntime = new BrowserComputerUseRuntime({ browser, visual: blockerVisual })
      await blockerRuntime.start(
        {
          goal: `Verify ${blocker} handoff`,
          maxSteps: 5,
          maxActions: 5,
          maxDurationMs: 30_000,
        },
        `blocker-${blocker}`,
        new AbortController().signal,
      )
      const waiting = await waitForSession(
        blockerRuntime,
        (session) => session.state === 'waiting-user',
      )
      assert.equal(waiting.lastErrorCode, blocker)
      assert.equal(blockerVisual.calls, 0)
      await blockerRuntime.stop()
    }

    await browser.open(origin)
    const staleObservation = await browser.captureComputerUseObservation(true)
    await browser.open(`${origin}/changed`)
    await assert.rejects(
      () =>
        browser.executeComputerUseDecision(
          scopedDecision(staleObservation, {
            type: 'click',
            x: 40,
            y: 40,
            button: 'left',
          } as Omit<BrowserComputerUseDecision, 'observationId' | 'pageId'>),
          new AbortController().signal,
        ),
      (error) => error instanceof BrowserAutomationError && error.code === 'TARGET_STALE',
    )

    await browser.close()
    reopened = new PlaywrightBrowserAdapter({ executablePath, profileDirectory })
    const persisted = (await reopened.open(origin)).observation
    assert(persisted?.content.includes('Persisted player: Ada'))
    await reopened.close()
    console.log('Browser Control deterministic repro: PASS')
  } finally {
    await Promise.allSettled([browser.close(), reopened?.close() ?? Promise.resolve()])
  }
}

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

async function main(): Promise<void> {
  const executablePath = resolveChromeExecutable()
  assert(executablePath, 'Google Chrome is required for Browser Control repro')
  const profileDirectory = await mkdtemp(join(tmpdir(), 'shio-browser-control-'))
  const { server, origin } = await startFixture()
  try {
    await deterministicRepro(executablePath, profileDirectory, origin)
    if (process.argv.includes('--qualification')) {
      await liveQualification(executablePath, profileDirectory)
    }
  } finally {
    await closeServer(server)
    await removeProfile(profileDirectory)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
