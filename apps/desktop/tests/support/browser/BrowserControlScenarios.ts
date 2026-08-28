import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'

import {
  BrowserAutomationError,
  type BrowserComputerUseDecisionContext,
  BrowserComputerUseRuntime,
  type BrowserVisualActionAdapter,
  type BrowserVisualActionStatus,
  LlmBrowserVisualActionAdapter,
  PlaywrightBrowserAdapter,
  resolveChromeExecutable,
} from '../../../src/main/browser-control'
import {
  BrowserReactiveTracker,
  type BrowserReactiveTrackerPort,
} from '../../../src/main/browser-control/computer-use/BrowserReactiveTracker'
import type { ReactiveTrackerResult } from '../../../src/main/browser-control/computer-use/BrowserReactiveTrackerProtocol'
import type { BrowserCdpFrame } from '../../../src/main/browser-control/playwright/PlaywrightCdpFrameStream'
import { LlmResponseError } from '../../../src/main/llm'
import type {
  BrowserCompletionAssessment,
  BrowserComputerUseDecision,
  BrowserComputerUseObservation,
  BrowserComputerUseSession,
  BrowserReactiveControlPlan,
  BrowserReactivePlanningContext,
} from '../../../src/shared/browser-computer-use'
import type {
  BrowserInteractiveRole,
  BrowserObservation,
  BrowserTarget,
} from '../../../src/shared/browser-control'

const SENSITIVE_SECRETS = [
  'correct-horse-password',
  '604992',
  '4111111111111111',
  '08/31',
  'sk-fixture-api-key-value',
  'fixture-token-textarea-secret',
] as const

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
    private readonly verifyNext: (
      context: { goal: string; observation: BrowserComputerUseObservation },
      signal: AbortSignal,
    ) => Promise<BrowserCompletionAssessment> | BrowserCompletionAssessment = () => ({
      status: 'satisfied',
      confidence: 1,
      evidenceSummary: 'Deterministic fixture verified completion.',
    }),
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

  planReactive(): Promise<null> {
    return Promise.resolve(null)
  }

  verifyCompletion(
    context: { goal: string; observation: BrowserComputerUseObservation },
    signal: AbortSignal,
  ): Promise<BrowserCompletionAssessment> {
    return Promise.resolve(this.verifyNext(context, signal))
  }
}

class DeterministicReactiveTracker implements BrowserReactiveTrackerPort {
  private running = false

  active(): boolean {
    return this.running
  }

  memoryBytes(): number {
    return this.running ? 256 * 1_024 : 0
  }

  async track(
    frame: BrowserCdpFrame,
    plan: BrowserReactiveControlPlan,
    _viewport: { width: number; height: number },
    signal: AbortSignal,
  ): Promise<ReactiveTrackerResult> {
    this.running = true
    await waitAbortable(65, signal)
    const pointsRight = Math.floor(frame.id / 30) % 2 === 0
    return {
      requestId: frame.id,
      planId: plan.id,
      pageId: frame.pageId,
      frameId: frame.id,
      receivedAt: frame.receivedAt,
      width: 480,
      height: 280,
      trackingConfidence: 0.98,
      sceneDifference: 0.08,
      motionIntensity: 0.5,
      anchors: [
        {
          id: 'player',
          bounds: { x: pointsRight ? 80 : 380, y: 125, width: 24, height: 24 },
          confidence: 0.98,
        },
        {
          id: 'target',
          bounds: { x: pointsRight ? 380 : 80, y: 125, width: 24, height: 24 },
          confidence: 0.98,
        },
      ],
      latencyMs: 65,
      workerMemoryBytes: this.memoryBytes(),
    }
  }

  stop(): Promise<void> {
    this.running = false
    return Promise.resolve()
  }
}

class ContinuousVisualAdapter implements BrowserVisualActionAdapter {
  planCalls = 0
  decisionCalls = 0

  status(): BrowserVisualActionStatus {
    return { state: 'ready', model: 'deterministic-continuous', supportsVision: true }
  }

  decide(context: BrowserComputerUseDecisionContext): Promise<BrowserComputerUseDecision> {
    this.decisionCalls += 1
    const retry = context.observation.semantic?.ariaSnapshot.includes('Retry')
    return Promise.resolve(
      scopedDecision(context.observation, {
        type: 'click-ref',
        ref: refFor(context.observation, retry ? 'Retry' : 'Start continuous fixture'),
      }),
    )
  }

  planReactive(
    context: BrowserReactivePlanningContext,
  ): Promise<BrowserReactiveControlPlan | null> {
    const semantic = context.observation.semantic?.ariaSnapshot ?? ''
    if (!semantic.includes('Continuous fixture running') || semantic.includes('Round complete')) {
      return Promise.resolve(null)
    }
    this.planCalls += 1
    const createdAt = Math.max(Date.now(), context.observation.capturedAt)
    return Promise.resolve({
      id: `fixture-reactive-plan-${this.planCalls}`,
      sessionId: context.sessionId,
      pageId: context.observation.page.id,
      sourceObservationId: context.observation.id,
      sourceVisualFingerprint: context.observation.visualFingerprint,
      confidence: 0.99,
      createdAt,
      expiresAt: createdAt + 2_000,
      reanchorAfterMs: 800,
      maximumInputHz: 20,
      anchors: [
        { id: 'player', role: 'controlled', bounds: { x: 80, y: 125, width: 24, height: 24 } },
        { id: 'target', role: 'target', bounds: { x: 380, y: 125, width: 24, height: 24 } },
      ],
      primitive: {
        type: 'directional-keys',
        controlledAnchorId: 'player',
        targetAnchorId: 'target',
        keys: {
          up: 'ArrowUp',
          down: 'ArrowDown',
          left: 'ArrowLeft',
          right: 'ArrowRight',
        },
        deadZonePx: 10,
      },
      ...(this.planCalls % 3 === 0
        ? {
            notableObservation: {
              kind: 'progress' as const,
              summary: 'Deterministic continuous fixture remains active.',
              confidence: 0.99,
            },
          }
        : {}),
    })
  }

  verifyCompletion(): Promise<BrowserCompletionAssessment> {
    throw new Error('Continuous termination must not invoke goal completion verification')
  }
}

class PublicContinuousVisualAdapter implements BrowserVisualActionAdapter {
  planCalls = 0

  status(): BrowserVisualActionStatus {
    return { state: 'ready', model: 'qualification-public-generic', supportsVision: true }
  }

  decide(context: BrowserComputerUseDecisionContext): Promise<BrowserComputerUseDecision> {
    return Promise.resolve(scopedDecision(context.observation, { type: 'wait', durationMs: 500 }))
  }

  planReactive(context: BrowserReactivePlanningContext): Promise<BrowserReactiveControlPlan> {
    this.planCalls += 1
    const createdAt = Math.max(Date.now(), context.observation.capturedAt)
    const pointsRight = this.planCalls % 2 === 1
    return Promise.resolve({
      id: `public-reactive-plan-${this.planCalls}`,
      sessionId: context.sessionId,
      pageId: context.observation.page.id,
      sourceObservationId: context.observation.id,
      sourceVisualFingerprint: context.observation.visualFingerprint,
      confidence: 0.9,
      createdAt,
      expiresAt: createdAt + 2_000,
      reanchorAfterMs: 800,
      maximumInputHz: 12,
      anchors: [
        {
          id: 'controlled',
          role: 'controlled',
          bounds: { x: pointsRight ? 220 : 420, y: 240, width: 32, height: 32 },
        },
        {
          id: 'target',
          role: 'target',
          bounds: { x: pointsRight ? 420 : 220, y: 240, width: 32, height: 32 },
        },
      ],
      primitive: {
        type: 'directional-keys',
        controlledAnchorId: 'controlled',
        targetAnchorId: 'target',
        keys: {
          up: 'ArrowUp',
          down: 'ArrowDown',
          left: 'ArrowLeft',
          right: 'ArrowRight',
        },
        deadZonePx: 12,
      },
    })
  }

  verifyCompletion(): Promise<BrowserCompletionAssessment> {
    throw new Error('Public continuous qualification does not claim goal completion')
  }
}

class ProviderOutageContinuousVisualAdapter extends ContinuousVisualAdapter {
  override async planReactive(
    context: BrowserReactivePlanningContext,
  ): Promise<BrowserReactiveControlPlan | null> {
    const plan = await super.planReactive(context)
    if (!plan) return null
    if (this.planCalls > 1) {
      throw new BrowserAutomationError('COMPUTER_USE_PROVIDER_NETWORK')
    }
    return {
      ...plan,
      expiresAt: plan.createdAt + 800,
      reanchorAfterMs: 250,
    }
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
  const sensitiveMarkup =
    blocker === 'sensitive'
      ? `<input aria-label="Password" type="password" value="${SENSITIVE_SECRETS[0]}">
         <input aria-label="OTP" autocomplete="one-time-code" value="${SENSITIVE_SECRETS[1]}">
         <input aria-label="Card number" autocomplete="cc-number" value="${SENSITIVE_SECRETS[2]}">
         <input aria-label="Card expiry" autocomplete="cc-exp" value="${SENSITIVE_SECRETS[3]}">
         <input aria-label="API key" id="api-key" value="${SENSITIVE_SECRETS[4]}">
         <textarea aria-label="Token" name="token">${SENSITIVE_SECRETS[5]}</textarea>`
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
    ${sensitiveMarkup}
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
      if (new URLSearchParams(location.search).get('blocker') === 'canvas-change') {
        setTimeout(() => {
          context.fillStyle = '#d43f70'
          context.fillRect(0, 0, canvas.width, canvas.height)
        }, 1000)
      }
      document.querySelector('#notification').textContent =
        'Notification permission: ' + Notification.permission
    </script>
  </body>
</html>`
}

class InvalidReactivePlanAdapter extends ContinuousVisualAdapter {
  rejectedPlans = 0

  override planReactive(): Promise<BrowserReactiveControlPlan | null> {
    this.rejectedPlans += 1
    if (this.rejectedPlans === 1) {
      throw new BrowserAutomationError('COMPUTER_USE_MODEL_SCHEMA_MISMATCH')
    }
    return Promise.resolve(null)
  }
}

function delayedCookieFixtureHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Delayed Cookie Fixture</title></head>
  <body>
    <h1>Delayed Cookie Fixture</h1>
    <p id="status" aria-live="polite">Waiting for consent UI</p>
    <script>
      setTimeout(() => {
        const dialog = document.createElement('div')
        dialog.setAttribute('role', 'dialog')
        dialog.setAttribute('aria-label', 'Cookie settings')
        dialog.innerHTML = '<p>Cookie settings</p><button aria-label="Close cookie banner">Close</button>'
        dialog.querySelector('button').addEventListener('click', () => {
          dialog.remove()
          document.querySelector('#status').textContent = 'Cookie banner closed'
        })
        document.body.append(dialog)
      }, 700)
    </script>
  </body>
</html>`
}

function crossFrameFixtureHtml(port: number): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Cross-frame Modal Fixture</title></head>
  <body style="margin:0">
    <iframe title="Cross-origin modal" src="http://localhost:${port}/frame-modal" style="position:fixed;left:0;top:0;width:400px;height:250px;border:0"></iframe>
    <p id="frame-status" aria-live="polite" style="margin-top:300px">Cross-frame modal open</p>
    <script>
      window.addEventListener('message', (event) => {
        if (event.data === 'frame-modal-closed') {
          document.querySelector('#frame-status').textContent = 'Cross-frame modal closed'
        }
      })
    </script>
  </body>
</html>`
}

function frameModalFixtureHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Frame Modal</title></head>
  <body style="margin:0">
    <div role="dialog" aria-label="Embedded modal" style="position:fixed;inset:0;background:white">
      <button aria-label="Close embedded modal" style="position:absolute;left:40px;top:40px;width:160px;height:60px">Close embedded modal</button>
    </div>
    <script>
      document.querySelector('button').addEventListener('click', () => {
        document.querySelector('[role=dialog]').remove()
        parent.postMessage('frame-modal-closed', '*')
      })
    </script>
  </body>
</html>`
}

function continuousFixtureHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Continuous Browser Control Fixture</title>
    <style>
      body { font-family: sans-serif; margin: 24px; }
      canvas { border: 2px solid #345; display: block; margin-top: 16px; }
      #result[hidden] { display: none; }
    </style>
  </head>
  <body>
    <h1>Continuous Browser Control Fixture</h1>
    <button aria-label="Start continuous fixture" id="start">Start continuous fixture</button>
    <p id="state" aria-live="polite">Waiting to start</p>
    <p id="metrics">cycles=0 inputs=0 retries=0 held=none</p>
    <div id="result" role="dialog" aria-label="Round complete" hidden>
      <p>Round complete</p>
      <button aria-label="Retry" id="retry">Retry</button>
    </div>
    <canvas aria-label="Continuous dynamic canvas" width="480" height="280"></canvas>
    <script>
      const canvas = document.querySelector('canvas')
      const context = canvas.getContext('2d')
      const state = document.querySelector('#state')
      const metrics = document.querySelector('#metrics')
      const result = document.querySelector('#result')
      const held = new Set()
      let running = false
      let cycles = 0
      let inputs = 0
      let retries = 0
      let roundInputs = 0
      let playerX = 80
      let targetX = 400
      function report() {
        metrics.textContent =
          'cycles=' + cycles + ' inputs=' + inputs + ' retries=' + retries +
          ' held=' + ([...held].join(',') || 'none')
      }
      function begin() {
        running = true
        roundInputs = 0
        playerX = 80
        targetX = 400
        result.hidden = true
        state.textContent = 'Continuous fixture running'
        report()
      }
      document.querySelector('#start').addEventListener('click', begin)
      document.querySelector('#retry').addEventListener('click', () => {
        retries += 1
        begin()
      })
      window.addEventListener('keydown', (event) => {
        if (!event.key.startsWith('Arrow')) return
        if (!held.has(event.key)) {
          inputs += 1
          roundInputs += 1
        }
        held.add(event.key)
        if (running && roundInputs >= 4) {
          cycles += 1
          running = false
          held.clear()
          result.hidden = false
          state.textContent = 'Round complete'
        }
        report()
      })
      window.addEventListener('keyup', (event) => {
        held.delete(event.key)
        report()
      })
      function draw() {
        context.fillStyle = '#f2f5f8'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.fillStyle = '#e35f79'
        context.fillRect(220, 30, 40, 70)
        context.fillStyle = '#356aa0'
        context.fillRect(playerX, 125, 24, 24)
        context.fillStyle = '#3a9d62'
        context.fillRect(targetX, 125, 24, 24)
        if (running) {
          if (held.has('ArrowRight')) playerX += 5
          if (held.has('ArrowLeft')) playerX -= 5
          playerX = Math.max(10, Math.min(446, playerX))
          if (Math.abs(playerX - targetX) < 18) {
            targetX = targetX > 240 ? 60 : 400
            report()
          }
        }
        requestAnimationFrame(draw)
      }
      draw()
      report()
    </script>
  </body>
</html>`
}

async function startFixture(): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const send = (): void => {
      const address = server.address()
      assert(address && typeof address === 'object')
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end(
        url.pathname === '/continuous'
          ? continuousFixtureHtml()
          : url.pathname === '/delayed-cookie'
            ? delayedCookieFixtureHtml()
            : url.pathname === '/cross-frame'
              ? crossFrameFixtureHtml(address.port)
              : url.pathname === '/frame-modal'
                ? frameModalFixtureHtml()
                : fixtureHtml(url.searchParams.get('blocker') ?? undefined),
      )
    }
    if (url.pathname === '/slow') setTimeout(send, 2_000)
    else send()
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

type UnscopedBrowserDecision = BrowserComputerUseDecision extends infer Decision
  ? Decision extends BrowserComputerUseDecision
    ? Omit<Decision, 'observationId' | 'pageId' | 'visualFingerprint'>
    : never
  : never

function scopedDecision(
  observation: BrowserComputerUseObservation,
  decision: UnscopedBrowserDecision | Omit<BrowserComputerUseDecision, 'observationId' | 'pageId'>,
): BrowserComputerUseDecision {
  return {
    ...decision,
    observationId: observation.id,
    pageId: observation.page.id,
    ...(['click', 'move', 'drag', 'mouse-down', 'mouse-up'].includes(decision.type)
      ? { visualFingerprint: observation.visualFingerprint }
      : {}),
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
    console.log('Browser Control repro: semantic operations PASS')

    const delayedCookie = (await browser.open(`${origin}/delayed-cookie`)).observation
    assert(delayedCookie)
    assert(
      delayedCookie.interactiveElements.some((element) => element.name === 'Close cookie banner'),
      'The bounded navigation stabilization returned before the delayed cookie UI appeared',
    )
    const closedCookie = (
      await browser.click(target(delayedCookie, 'button', 'Close cookie banner'))
    ).observation
    assert(closedCookie?.content.includes('Cookie banner closed'))
    console.log('Browser Control repro: delayed cookie stabilization PASS')

    await browser.open(`${origin}/cross-frame`)
    let frameDecision = 0
    const frameRuntime = new BrowserComputerUseRuntime({
      browser,
      visual: new ScriptedVisualAdapter((context) => {
        assert(context.observation.visual?.bytes.length)
        frameDecision += 1
        if (frameDecision === 1) {
          return scopedDecision(context.observation, {
            type: 'click',
            x: 100,
            y: 70,
            button: 'left',
          })
        }
        assert(context.observation.semantic?.ariaSnapshot.includes('Cross-frame modal closed'))
        return scopedDecision(context.observation, {
          type: 'done',
          summary: 'Cross-frame modal closed with visual control',
        })
      }),
    })
    const frameStarted = await frameRuntime.start(
      {
        goal: 'Close the visible cross-frame modal',
        maxSteps: 5,
        maxActions: 5,
        maxDurationMs: 30_000,
      },
      'cross-frame-visual-action',
      new AbortController().signal,
    )
    assert.equal(frameStarted.activity, 'starting')
    assert.equal(frameStarted.actionCount, 0)
    const frameCompleted = await waitForSession(
      frameRuntime,
      (session) => session.state === 'completed',
    )
    assert.equal(frameCompleted.actionCount, 1)
    assert((await browser.observe()).content.includes('Cross-frame modal closed'))
    console.log('Browser Control repro: cross-frame visual fallback PASS')

    await browser.open(`${origin}/?blocker=sensitive`)
    const sensitiveSemantic = await browser.observe()
    const sensitiveComputerUse = await browser.captureComputerUseObservation(true)
    const semanticEvidence = JSON.stringify(sensitiveSemantic)
    const computerUseEvidence = JSON.stringify({
      ...sensitiveComputerUse,
      visual: sensitiveComputerUse.visual
        ? { mimeType: sensitiveComputerUse.visual.mimeType }
        : null,
    })
    for (const secret of SENSITIVE_SECRETS) {
      assert(!semanticEvidence.includes(secret), `Sensitive semantic leak: ${secret}`)
      assert(!computerUseEvidence.includes(secret), `Sensitive computer-use leak: ${secret}`)
    }
    assert(
      sensitiveSemantic.interactiveElements
        .filter((element) => element.sensitive)
        .every((element) => element.name && !SENSITIVE_SECRETS.includes(element.name as never)),
    )
    assert(sensitiveComputerUse.visual?.bytes.length)
    await browser.open(origin)
    console.log('Browser Control repro: sensitive evidence redaction PASS')

    const refObservation = await browser.captureComputerUseObservation(true)
    const saveRef = refFor(refObservation, 'Save profile')
    await browser.observe()
    await assert.rejects(
      () =>
        browser.executeComputerUseDecision(
          scopedDecision(refObservation, { type: 'click-ref', ref: saveRef }),
          new AbortController().signal,
        ),
      (error) => error instanceof BrowserAutomationError && error.code === 'TARGET_STALE',
    )
    console.log('Browser Control repro: exact observation ref ownership PASS')

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
      planReactive: async () => {
        throw new Error('An unavailable visual model must never receive a reactive plan request')
      },
      verifyCompletion: async () => {
        throw new Error('An unavailable visual model must never verify completion')
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
    console.log('Browser Control repro: completion verification PASS')

    let incompleteDecisions = 0
    const incompleteVisual = new ScriptedVisualAdapter(
      (context) => {
        incompleteDecisions += 1
        return incompleteDecisions === 1
          ? scopedDecision(context.observation, {
              type: 'done',
              summary: 'Model proposed completion too early',
            })
          : scopedDecision(context.observation, {
              type: 'request-user',
              reasonCode: 'fixture-remains-incomplete',
            })
      },
      true,
      () => ({
        status: 'not-satisfied',
        confidence: 0.99,
        evidenceSummary: 'The fixture still shows an incomplete state.',
      }),
    )
    const incompleteRuntime = new BrowserComputerUseRuntime({ browser, visual: incompleteVisual })
    await incompleteRuntime.start(
      {
        goal: 'Complete a state that is still incomplete',
        maxSteps: 5,
        maxActions: 5,
        maxDurationMs: 30_000,
      },
      'incomplete-action',
      new AbortController().signal,
    )
    const incomplete = await waitForSession(
      incompleteRuntime,
      (session) => session.state === 'waiting-user',
    )
    assert.notEqual(incomplete.state, 'completed')
    await incompleteRuntime.stop()

    const uncertainRuntime = new BrowserComputerUseRuntime({
      browser,
      visual: new ScriptedVisualAdapter(
        (context) =>
          scopedDecision(context.observation, {
            type: 'done',
            summary: 'Unverifiable proposal',
          }),
        true,
        () => ({ status: 'uncertain', confidence: 0.4 }),
      ),
    })
    await uncertainRuntime.start(
      {
        goal: 'Require honest completion evidence',
        maxSteps: 5,
        maxActions: 5,
        maxDurationMs: 30_000,
      },
      'uncertain-action',
      new AbortController().signal,
    )
    const uncertain = await waitForSession(
      uncertainRuntime,
      (session) => session.state === 'failed',
    )
    assert.equal(uncertain.lastErrorCode, 'COMPUTER_USE_COMPLETION_UNVERIFIED')
    console.log('Browser Control repro: completion honesty PASS')

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
    console.log('Browser Control repro: delegated input PASS')

    const recoveryObservationIds: string[] = []
    const recoveryRuntime = new BrowserComputerUseRuntime({
      browser,
      visual: new ScriptedVisualAdapter((context, _signal, call) => {
        recoveryObservationIds.push(context.observation.id)
        if (call === 0) {
          throw new BrowserAutomationError('COMPUTER_USE_MODEL_SCHEMA_MISMATCH')
        }
        return scopedDecision(context.observation, {
          type: 'done',
          summary: 'Fresh observation recovery verified',
        })
      }),
    })
    await recoveryRuntime.start(
      {
        goal: 'Recover a malformed visual decision without browser input',
        maxSteps: 5,
        maxActions: 5,
        maxDurationMs: 30_000,
      },
      'fresh-observation-recovery-action',
      new AbortController().signal,
    )
    const recoveredSession = await waitForSession(
      recoveryRuntime,
      (session) => session.state === 'completed',
    )
    assert.equal(recoveredSession.actionCount, 0)
    assert.equal(recoveryObservationIds.length, 2)
    assert.notEqual(recoveryObservationIds[0], recoveryObservationIds[1])
    console.log('Browser Control repro: malformed decision re-observation PASS')

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
    console.log('Browser Control repro: pausing active decision')
    const pausedSession = await Promise.race([
      pauseRuntime.pause(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () =>
            reject(new Error(`Pause did not settle: ${JSON.stringify(pauseRuntime.snapshot())}`)),
          5_000,
        ),
      ),
    ])
    assert.equal(pausedSession.state, 'paused')
    console.log('Browser Control repro: paused')
    assert((await browser.observe()).content.includes('Key released ArrowLeft'))
    console.log('Browser Control repro: input released')
    await pauseRuntime.resume()
    console.log('Browser Control repro: resumed')
    await waitForSession(pauseRuntime, (session) => session.state === 'completed')
    console.log('Browser Control repro: pause/resume PASS')

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
    console.log('Browser Control repro: blocker handoff PASS')

    await browser.open(`${origin}/?blocker=canvas-change`)
    const canvasObservation = await browser.captureComputerUseObservation(true)
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    await assert.rejects(
      () =>
        browser.executeComputerUseDecision(
          scopedDecision(canvasObservation, {
            type: 'click',
            x: 80,
            y: 240,
            button: 'left',
          }),
          new AbortController().signal,
        ),
      (error) => error instanceof BrowserAutomationError && error.code === 'TARGET_STALE',
    )
    assert((await browser.observe()).content.includes('Ready'))
    console.log('Browser Control repro: canvas visual stale detection PASS')

    await browser.open(origin)
    const slowRuntime = new BrowserComputerUseRuntime({
      browser,
      stopTimeoutMs: 100,
      visual: new ScriptedVisualAdapter((context) =>
        scopedDecision(context.observation, { type: 'navigate', url: `${origin}/slow` }),
      ),
    })
    await slowRuntime.start(
      {
        goal: 'Stop a slow navigation without a delayed mutation',
        maxSteps: 5,
        maxActions: 5,
        maxDurationMs: 30_000,
      },
      'slow-stop-action',
      new AbortController().signal,
    )
    await waitForSession(slowRuntime, (session) => session.activity === 'acting')
    assert.equal((await slowRuntime.stop()).state, 'stopped')
    assert.equal(browser.sessionSnapshot()?.status, 'closed')
    await new Promise((resolve) => setTimeout(resolve, 2_200))
    assert.equal(browser.sessionSnapshot()?.status, 'closed')
    assert(!browser.sessionSnapshot()?.currentUrl?.includes('/slow'))
    console.log('Browser Control repro: no delayed mutation after Stop PASS')

    await browser.open(origin)
    const providerObservation = await browser.captureComputerUseObservation(true)
    const providerContext = { goal: 'Classify provider errors', observation: providerObservation }
    const capabilities = () => ({
      supportsReasoning: false,
      supportsStreaming: false,
      supportsTemperature: true,
      supportsSystemPrompt: true,
      supportsToolCalling: false,
      supportsVision: true,
      recommendedMaxTokens: 1_000,
    })
    const providerCases = [
      {
        expected: 'COMPUTER_USE_RATE_LIMITED',
        error: new LlmResponseError({
          provider: 'groq',
          code: 'RATE_LIMITED',
          message: 'rate limited',
        }),
      },
      {
        expected: 'COMPUTER_USE_MODEL_TIMEOUT',
        error: new LlmResponseError({ provider: 'groq', code: 'TIMEOUT', message: 'timeout' }),
      },
      { expected: 'COMPUTER_USE_PROVIDER_NETWORK', error: { code: 'ECONNRESET' } },
    ] as const
    for (const providerCase of providerCases) {
      const adapter = new LlmBrowserVisualActionAdapter({
        provider: () => ({
          capabilities,
          chat: async () => {
            throw providerCase.error
          },
        }),
        modelLabel: () => 'fixture-vision',
      })
      await assert.rejects(
        () => adapter.decide(providerContext, new AbortController().signal),
        (error) => error instanceof BrowserAutomationError && error.code === providerCase.expected,
      )
      if (providerCase.expected === 'COMPUTER_USE_RATE_LIMITED') {
        assert.equal(adapter.status().state, 'rate-limited')
      }
    }
    const unavailableProvider = new LlmBrowserVisualActionAdapter({
      provider: () => ({
        capabilities: () => ({ ...capabilities(), supportsVision: false }),
        chat: async () => '{}',
      }),
      modelLabel: () => 'text-only',
    })
    await assert.rejects(
      () => unavailableProvider.decide(providerContext, new AbortController().signal),
      (error) =>
        error instanceof BrowserAutomationError && error.code === 'COMPUTER_USE_MODEL_UNAVAILABLE',
    )
    const invalidProvider = new LlmBrowserVisualActionAdapter({
      provider: () => ({ capabilities, chat: async () => 'not-json' }),
      modelLabel: () => 'invalid-json',
    })
    await assert.rejects(
      () => invalidProvider.decide(providerContext, new AbortController().signal),
      (error) =>
        error instanceof BrowserAutomationError &&
        error.code === 'COMPUTER_USE_MODEL_INVALID_RESPONSE',
    )
    assert.equal((await browser.observe()).url, origin.endsWith('/') ? origin : `${origin}/`)
    console.log('Browser Control repro: typed provider failures PASS')

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

export async function runDeterministicBrowserControl(): Promise<void> {
  const executablePath = resolveChromeExecutable()
  assert(executablePath, 'Google Chrome is required for Browser Control tests')
  const profileDirectory = await mkdtemp(join(tmpdir(), 'shio-browser-control-'))
  const { server, origin } = await startFixture()
  try {
    await deterministicRepro(executablePath, profileDirectory, origin)
  } finally {
    await closeServer(server)
    await removeProfile(profileDirectory)
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
