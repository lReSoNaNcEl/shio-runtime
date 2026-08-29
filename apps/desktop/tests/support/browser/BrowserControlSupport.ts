import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'

import {
  BrowserAutomationError,
  type BrowserComputerUseDecisionContext,
  type BrowserComputerUseRuntime,
  type BrowserVisualActionAdapter,
  type BrowserVisualActionStatus,
} from '../../../src/main/browser-control'
import type { BrowserReactiveTrackerPort } from '../../../src/main/browser-control/computer-use/BrowserReactiveTracker'
import type { ReactiveTrackerResult } from '../../../src/main/browser-control/computer-use/BrowserReactiveTrackerProtocol'
import type { BrowserCdpFrame } from '../../../src/main/browser-control/playwright/PlaywrightCdpFrameStream'
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

export const SENSITIVE_SECRETS = [
  'correct-horse-password',
  '604992',
  '4111111111111111',
  '08/31',
  'sk-fixture-api-key-value',
  'fixture-token-textarea-secret',
] as const

export const QUALIFICATION_DURATION_MS = Number(
  process.env.SHIO_BROWSER_CONTROL_QUALIFICATION_MS ?? 15 * 60 * 1_000,
)

export class ScriptedVisualAdapter implements BrowserVisualActionAdapter {
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

export class DeterministicReactiveTracker implements BrowserReactiveTrackerPort {
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

export class ContinuousVisualAdapter implements BrowserVisualActionAdapter {
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

export class PublicContinuousVisualAdapter implements BrowserVisualActionAdapter {
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

export class ProviderOutageContinuousVisualAdapter extends ContinuousVisualAdapter {
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

export class InvalidReactivePlanAdapter extends ContinuousVisualAdapter {
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

export async function startFixture(): Promise<{ server: Server; origin: string }> {
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

export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}

export function target(
  observation: BrowserObservation,
  role: BrowserInteractiveRole,
  name: string,
): BrowserTarget {
  return { kind: 'accessible-name', observationId: observation.observationId, role, name }
}

export async function waitForSession(
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

export function scopedDecision(
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

export function refFor(observation: BrowserComputerUseObservation, name: string): string {
  const line = observation.semantic?.ariaSnapshot
    .split('\n')
    .find((candidate) => candidate.includes(name) && /^e\d+\s/u.test(candidate))
  const ref = line?.match(/^(e\d+)\s/u)?.[1]
  assert(ref, `Missing semantic ref for ${name}`)
  return ref
}

export function waitAbortable(durationMs: number, signal: AbortSignal): Promise<void> {
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

export async function removeProfile(path: string): Promise<void> {
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
