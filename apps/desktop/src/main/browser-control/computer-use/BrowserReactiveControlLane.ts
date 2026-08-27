import type {
  BrowserReactiveControlPlan,
  ContinuousControlBudget,
} from '../../../shared/browser-computer-use'
import type { PlaywrightBrowserAdapter } from '../playwright/PlaywrightBrowserAdapter'
import {
  type BrowserCdpFrame,
  PlaywrightCdpFrameStream,
} from '../playwright/PlaywrightCdpFrameStream'
import {
  type BrowserReactiveInputIntent,
  PlaywrightCdpInputController,
  type ReactiveKey,
} from '../playwright/PlaywrightCdpInputController'
import { BrowserReactiveTracker, type BrowserReactiveTrackerPort } from './BrowserReactiveTracker'
import type { ReactiveTrackerResult } from './BrowserReactiveTrackerProtocol'
import type { ComputerUseDiagnosticsCollector } from './ComputerUseDiagnosticsCollector'

export interface BrowserReactiveControlLaneOptions {
  browser: PlaywrightBrowserAdapter
  tracker?: BrowserReactiveTrackerPort
  diagnostics: ComputerUseDiagnosticsCollector
  now?: () => number
}

interface ActiveLane {
  plan: BrowserReactiveControlPlan
  budget: ContinuousControlBudget
  controller: AbortController
  invalidated: Promise<string>
  resolveInvalidated(reason: string): void
  pageId: string
  viewport: { width: number; height: number }
  lastInputAt: number
}

export class BrowserReactiveControlLane {
  private readonly tracker: BrowserReactiveTrackerPort
  private readonly frameStream: PlaywrightCdpFrameStream
  private readonly input: PlaywrightCdpInputController
  private activeLane: ActiveLane | null = null
  private activation: Promise<void> | null = null

  constructor(private readonly options: BrowserReactiveControlLaneOptions) {
    this.tracker = options.tracker ?? new BrowserReactiveTracker()
    this.frameStream = new PlaywrightCdpFrameStream({
      createSession: (page) => page.context().newCDPSession(page),
      now: options.now,
      onMetrics: (metrics) => options.diagnostics.recordFrameStream(metrics),
    })
    this.input = new PlaywrightCdpInputController({
      heldInputs: options.browser.heldInputRegistry(),
      createSession: (page) => page.context().newCDPSession(page),
      now: options.now,
    })
  }

  active(): boolean {
    return this.activeLane !== null
  }

  plan(): BrowserReactiveControlPlan | undefined {
    return this.activeLane?.plan
  }

  reset(): void {
    if (!this.activeLane) this.frameStream.resetMetrics()
  }

  async activate(
    plan: BrowserReactiveControlPlan,
    budget: ContinuousControlBudget,
    parentSignal: AbortSignal,
  ): Promise<void> {
    const task = this.activateInternal(plan, budget, parentSignal)
    this.activation = task
    try {
      await task
    } finally {
      if (this.activation === task) this.activation = null
    }
  }

  private async activateInternal(
    plan: BrowserReactiveControlPlan,
    budget: ContinuousControlBudget,
    parentSignal: AbortSignal,
  ): Promise<void> {
    const replacing = Boolean(this.activeLane)
    await this.deactivate('plan-replaced')
    if (parentSignal.aborted) throw parentSignal.reason ?? new Error('REACTIVE_CONTROL_ABORTED')
    const target = await this.options.browser.reactiveControlTarget(parentSignal)
    if (target.pageId !== plan.pageId) throw new Error('REACTIVE_PLAN_PAGE_STALE')
    let resolveInvalidated: (reason: string) => void = () => undefined
    const invalidated = new Promise<string>((resolve) => {
      resolveInvalidated = resolve
    })
    const controller = new AbortController()
    const abort = (): void => this.invalidate('session-aborted')
    parentSignal.addEventListener('abort', abort, { once: true })
    controller.signal.addEventListener(
      'abort',
      () => parentSignal.removeEventListener('abort', abort),
      { once: true },
    )
    const lane: ActiveLane = {
      plan,
      budget,
      controller,
      invalidated,
      resolveInvalidated,
      pageId: target.pageId,
      viewport: target.viewport,
      lastInputAt: 0,
    }
    this.activeLane = lane
    try {
      await this.input.bind({
        sessionId: plan.sessionId,
        pageId: plan.pageId,
        planId: plan.id,
        page: target.page,
      })
      this.assertActivationCurrent(lane, parentSignal)
      await this.frameStream.start({
        page: target.page,
        pageId: target.pageId,
        viewport: target.viewport,
        maxFrameRate: budget.maxFrameRate,
        sensitiveRegions: target.sensitiveRegions,
        processFrame: (frame) => this.processFrame(lane, frame),
        invalidate: (reason) => this.invalidate(reason),
      })
      this.assertActivationCurrent(lane, parentSignal)
      this.options.diagnostics.setActiveCdpSessions(2)
    } catch (error) {
      if (this.activeLane === lane) {
        this.activeLane = null
        lane.controller.abort(new Error('REACTIVE_CONTROL_ACTIVATION_FAILED'))
        lane.resolveInvalidated('activation-failed')
      }
      await Promise.allSettled([this.frameStream.stop(), this.input.stop()])
      await this.options.browser.releaseInputs()
      this.options.diagnostics.setActiveCdpSessions(0)
      this.options.diagnostics.setHeldInputs(this.options.browser.heldInputSnapshot())
      throw error
    }
    this.options.diagnostics.activatePlan(plan.createdAt, replacing)
    this.options.diagnostics.recordModeTransition()
    this.options.diagnostics.setWorkerActive(this.tracker.active())
  }

  waitForInvalidation(): Promise<string> {
    return this.activeLane?.invalidated ?? Promise.resolve('inactive')
  }

  async deactivate(reason: string): Promise<void> {
    const lane = this.activeLane
    const activation = this.activation
    if (lane) {
      this.activeLane = null
      lane.controller.abort(new Error(`REACTIVE_CONTROL_${reason.toUpperCase()}`))
    }
    await activation?.catch(() => undefined)
    await Promise.allSettled([this.frameStream.stop(), this.input.stop()])
    this.options.diagnostics.setActiveCdpSessions(0)
    await this.options.browser.releaseInputs()
    this.options.diagnostics.setHeldInputs(this.options.browser.heldInputSnapshot())
    if (lane) {
      this.options.diagnostics.deactivatePlan(reason === 'plan-expired')
      this.options.diagnostics.recordModeTransition()
      lane.resolveInvalidated(reason)
    }
  }

  async shutdown(): Promise<void> {
    await this.deactivate('shutdown')
    await this.tracker.stop()
    this.options.diagnostics.setWorkerActive(false)
  }

  private invalidate(reason: string): void {
    if (!this.activeLane) return
    void this.deactivate(reason).catch(() => undefined)
  }

  private async processFrame(lane: ActiveLane, frame: BrowserCdpFrame): Promise<void> {
    if (this.activeLane !== lane || lane.controller.signal.aborted) return
    const now = this.now()
    if (now >= lane.plan.expiresAt) {
      this.invalidate('plan-expired')
      return
    }
    if (!this.options.browser.isReactiveControlTargetCurrent(lane.pageId)) {
      this.invalidate('active-page-changed')
      return
    }
    const result = await this.tracker.track(frame, lane.plan, lane.viewport, lane.controller.signal)
    if (this.activeLane !== lane || lane.controller.signal.aborted) return
    this.options.diagnostics.recordTracking(result)
    this.options.diagnostics.setWorkerActive(this.tracker.active())
    if (result.trackingConfidence < 0.35) {
      this.invalidate('tracking-confidence-low')
      return
    }
    if (result.sceneDifference > 0.45) {
      this.invalidate('strong-scene-change')
      return
    }
    const intents = reactiveIntents(lane.plan, result, this.options.browser)
    if (intents.length === 0) return
    const maximumHz = Math.min(
      lane.plan.maximumInputHz,
      lane.budget.maxReactiveInputEventsPerSecond,
    )
    const minimumIntervalMs = 1_000 / maximumHz
    if (now - lane.lastInputAt < minimumIntervalMs * intents.length) return
    const projectedTotal = this.options.diagnostics.snapshot(now).inputEventsTotal + intents.length
    if (projectedTotal > lane.budget.maxReactiveInputEventsTotal) {
      this.invalidate('reactive-input-budget-reached')
      return
    }
    const dispatched = await this.input.execute(
      {
        sessionId: lane.plan.sessionId,
        pageId: lane.pageId,
        planId: lane.plan.id,
        frameId: frame.id,
        receivedAt: frame.receivedAt,
      },
      intents,
      {
        maxPointerHoldMs:
          lane.plan.primitive.type === 'pointer-hold'
            ? Math.min(lane.budget.maxPointerHoldMs, lane.plan.primitive.holdMs)
            : lane.budget.maxPointerHoldMs,
        maxKeyHoldMs: lane.budget.maxKeyHoldMs,
      },
    )
    lane.lastInputAt = now
    this.options.diagnostics.recordInput(dispatched, frame.receivedAt, this.now())
    this.options.diagnostics.setHeldInputs(this.options.browser.heldInputSnapshot())
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  private assertActivationCurrent(lane: ActiveLane, parentSignal: AbortSignal): void {
    if (this.activeLane !== lane || lane.controller.signal.aborted || parentSignal.aborted) {
      throw parentSignal.reason ?? new Error('REACTIVE_CONTROL_ACTIVATION_STALE')
    }
  }
}

function reactiveIntents(
  plan: BrowserReactiveControlPlan,
  tracking: ReactiveTrackerResult,
  browser: PlaywrightBrowserAdapter,
): BrowserReactiveInputIntent[] {
  const anchors = new Map(tracking.anchors.map((anchor) => [anchor.id, anchor]))
  const center = (id: string): { x: number; y: number } | undefined => {
    const anchor = anchors.get(id)
    return anchor
      ? {
          x: anchor.bounds.x + anchor.bounds.width / 2,
          y: anchor.bounds.y + anchor.bounds.height / 2,
        }
      : undefined
  }
  const primitive = plan.primitive
  if (primitive.type === 'pointer-follow' || primitive.type === 'tap-target') {
    const target = center(primitive.targetAnchorId)
    if (!target) return []
    return primitive.type === 'pointer-follow'
      ? [{ type: 'move', ...target }]
      : [{ type: 'click', ...target, button: primitive.button }]
  }
  if (primitive.type === 'pointer-hold') {
    const target = center(primitive.targetAnchorId)
    if (!target) return []
    return browser.heldInputRegistry().isButtonHeld('cdp', primitive.button)
      ? [{ type: 'move', ...target }]
      : [
          { type: 'move', ...target },
          { type: 'mouse-down', ...target, button: primitive.button },
        ]
  }
  if (primitive.type === 'pointer-steer') {
    const controlled = center(primitive.controlledAnchorId)
    const target = center(primitive.targetAnchorId)
    if (!controlled || !target) return []
    return [
      {
        type: 'move',
        x: controlled.x + (target.x - controlled.x) * primitive.sensitivity,
        y: controlled.y + (target.y - controlled.y) * primitive.sensitivity,
      },
    ]
  }
  const controlled = center(primitive.controlledAnchorId)
  const target = center(primitive.targetAnchorId)
  if (!controlled || !target) return []
  const desired = new Set<ReactiveKey>()
  if (target.x - controlled.x > primitive.deadZonePx) desired.add(primitive.keys.right)
  if (controlled.x - target.x > primitive.deadZonePx) desired.add(primitive.keys.left)
  if (target.y - controlled.y > primitive.deadZonePx) desired.add(primitive.keys.down)
  if (controlled.y - target.y > primitive.deadZonePx) desired.add(primitive.keys.up)
  const all = new Set<ReactiveKey>(Object.values(primitive.keys))
  const intents: BrowserReactiveInputIntent[] = []
  for (const key of all) {
    const held = browser.heldInputRegistry().isKeyHeld('cdp', key)
    if (desired.has(key) && !held) intents.push({ type: 'key-down', key })
    if (!desired.has(key) && held) intents.push({ type: 'key-up', key })
  }
  return intents
}
