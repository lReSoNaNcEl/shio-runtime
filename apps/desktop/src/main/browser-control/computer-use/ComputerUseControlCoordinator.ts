import {
  type BrowserComputerUseDecision,
  type BrowserComputerUseSession,
  type BrowserReactiveControlPlan,
  browserReactiveControlPlanSchema,
  type ComputerUseNotableObservation,
  type ContinuousControlBudget,
} from '../../../shared/browser-computer-use'
import { BrowserAutomationError } from '../errors'
import type { PlaywrightBrowserAdapter } from '../playwright/PlaywrightBrowserAdapter'
import { BrowserReactiveControlLane } from './BrowserReactiveControlLane'
import type { BrowserReactiveTrackerPort } from './BrowserReactiveTracker'
import type {
  BrowserVisualActionAdapter,
  BrowserVisualActionStatus,
} from './BrowserVisualActionAdapter'
import { ComputerUseDiagnosticsCollector } from './ComputerUseDiagnosticsCollector'

export type ComputerUseCoordinatorEventType =
  | 'computer-use-progress'
  | 'computer-use-notable-observation'
  | 'computer-use-blocked'
  | 'computer-use-completed'

export interface ComputerUseCoordinatorHooks {
  session(): BrowserComputerUseSession
  update(patch: Partial<BrowserComputerUseSession>): BrowserComputerUseSession
  emit(
    type: ComputerUseCoordinatorEventType,
    observation?: ComputerUseNotableObservation,
    errorCode?: string,
  ): void
}

export interface ComputerUseControlCoordinatorOptions {
  browser: PlaywrightBrowserAdapter
  visual: BrowserVisualActionAdapter
  continuousBudget: ContinuousControlBudget
  reactiveTracker?: BrowserReactiveTrackerPort
  now?: () => number
  completionRetryLimit?: number
}

/** Coordinates the existing slow VLM control frequency with one optional fast reactive lane. */
export class ComputerUseControlCoordinator {
  private readonly diagnosticsCollector = new ComputerUseDiagnosticsCollector()
  private readonly reactive: BrowserReactiveControlLane
  private activeVlm: AbortController | null = null
  private pauseRequested = false
  private recentAction:
    | { type: BrowserComputerUseDecision['type']; outcome: 'executed' | 'stale' | 'failed' }
    | undefined
  private lastSlowDecisionAt = 0
  private slowDecisionTimes: number[] = []

  constructor(private readonly options: ComputerUseControlCoordinatorOptions) {
    this.reactive = new BrowserReactiveControlLane({
      browser: options.browser,
      tracker: options.reactiveTracker,
      diagnostics: this.diagnosticsCollector,
      now: options.now,
    })
  }

  visualStatus(): BrowserVisualActionStatus {
    return this.options.visual.status()
  }

  diagnostics() {
    return this.diagnosticsCollector.snapshot(this.now())
  }

  reset(): void {
    this.pauseRequested = false
    this.recentAction = undefined
    this.lastSlowDecisionAt = 0
    this.slowDecisionTimes = []
    this.diagnosticsCollector.reset()
    this.reactive.reset()
  }

  async run(hooks: ComputerUseCoordinatorHooks, signal: AbortSignal): Promise<void> {
    let completionProposalCount = 0
    while (!signal.aborted && !this.pauseRequested) {
      const session = hooks.session()
      if (session.state !== 'running') return
      if (await this.completeAtDeadline(session, hooks)) return
      if (
        session.termination.type === 'goal-completed' &&
        (session.stepCount >= session.maxSteps || session.actionCount >= session.maxActions)
      ) {
        throw new BrowserAutomationError('COMPUTER_USE_LIMIT_REACHED')
      }

      hooks.update({
        activity: this.reactive.active() ? 'reanchoring' : 'observing',
        controlMode: this.reactive.active() ? 'reactive' : 'slow',
      })
      const visualStatus = this.options.visual.status()
      const observation = await this.options.browser.captureComputerUseObservation(
        visualStatus.supportsVision,
        signal,
      )
      if (observation.blocker) {
        await this.reactive.deactivate('blocker')
        await this.options.browser.releaseInputs()
        hooks.update({
          state: 'waiting-user',
          activity: 'waiting-user',
          controlMode: 'slow',
          lastErrorCode: observation.blocker,
        })
        hooks.emit('computer-use-blocked', undefined, observation.blocker)
        return
      }
      hooks.update({
        pageId: observation.page.id,
        mode: observation.visual ? 'visual' : 'semantic',
        activity: 'deciding',
        stepCount: hooks.session().stepCount + 1,
      })

      if (session.termination.type !== 'goal-completed' && observation.visual) {
        const plan = await this.planReactive(hooks.session(), observation, signal)
        if (signal.aborted || this.pauseRequested) return
        if (plan) {
          validatePlanScope(plan, hooks.session(), observation, this.options.continuousBudget)
          const previousPlanId = this.reactive.plan()?.id
          await this.reactive.activate(plan, this.options.continuousBudget, signal)
          hooks.update({ controlMode: 'reactive', activity: 'tracking' })
          if (plan.notableObservation) {
            hooks.emit('computer-use-notable-observation', plan.notableObservation)
          }
          if (previousPlanId && previousPlanId !== plan.id) {
            this.diagnosticsCollector.recordReanchor()
          }
          const invalidation = await raceReactiveReanchor(
            this.reactive.waitForInvalidation(),
            Math.min(plan.reanchorAfterMs, Math.max(0, hooks.session().expiresAt - this.now())),
            signal,
          )
          if (signal.aborted || this.pauseRequested) return
          this.diagnosticsCollector.recordReanchor()
          hooks.update({ activity: 'reanchoring' })
          if (invalidation.type === 'invalidated') {
            hooks.update({ controlMode: 'slow' })
          }
          continue
        }
        await this.reactive.deactivate('slow-control')
        hooks.update({ controlMode: 'slow', activity: 'deciding' })
      }

      const decision = await this.decide(hooks.session(), observation, signal)
      if (signal.aborted || this.pauseRequested) return
      if (decision.type === 'request-user') {
        await this.reactive.deactivate('request-user')
        await this.options.browser.releaseInputs()
        hooks.update({
          state: 'waiting-user',
          activity: 'waiting-user',
          controlMode: 'slow',
          lastErrorCode: decision.reasonCode,
        })
        hooks.emit('computer-use-blocked', undefined, decision.reasonCode)
        return
      }
      if (decision.type === 'done') {
        if (hooks.session().termination.type !== 'goal-completed') {
          this.recentAction = { type: 'done', outcome: 'executed' }
          hooks.update({ activity: 'observing' })
          await waitAbortable(500, signal)
          continue
        }
        completionProposalCount += 1
        hooks.update({ activity: 'verifying' })
        const freshObservation = await this.options.browser.captureComputerUseObservation(
          visualStatus.supportsVision,
          signal,
        )
        const assessment = await this.callVlm(signal, (childSignal) =>
          this.options.visual.verifyCompletion(
            { goal: hooks.session().goal, observation: freshObservation },
            childSignal,
          ),
        )
        if (assessment.status === 'satisfied') {
          await this.reactive.deactivate('completed')
          await this.options.browser.releaseInputs()
          const summary =
            assessment.evidenceSummary ?? 'Completion verified against a fresh observation.'
          hooks.update({ state: 'completed', activity: 'idle', controlMode: 'slow', summary })
          hooks.emit('computer-use-completed', {
            kind: 'success',
            summary,
            confidence: assessment.confidence,
          })
          return
        }
        if (assessment.status === 'uncertain') {
          throw new BrowserAutomationError('COMPUTER_USE_COMPLETION_UNVERIFIED')
        }
        this.recentAction = { type: 'done', outcome: 'failed' }
        if (completionProposalCount > (this.options.completionRetryLimit ?? 2)) {
          throw new BrowserAutomationError('COMPUTER_USE_COMPLETION_UNVERIFIED')
        }
        continue
      }

      hooks.update({ activity: 'acting' })
      try {
        await this.options.browser.executeComputerUseDecision(decision, signal)
        this.recentAction = { type: decision.type, outcome: 'executed' }
        hooks.update({
          actionCount: hooks.session().actionCount + 1,
          activity: 'verifying',
        })
        hooks.emit('computer-use-progress')
      } catch (error) {
        if (error instanceof BrowserAutomationError && error.code === 'TARGET_STALE') {
          this.recentAction = { type: decision.type, outcome: 'stale' }
          continue
        }
        this.recentAction = { type: decision.type, outcome: 'failed' }
        throw error
      }
    }
  }

  async pause(): Promise<void> {
    this.pauseRequested = true
    this.activeVlm?.abort(new Error('BROWSER_COMPUTER_USE_PAUSED'))
    await this.reactive.deactivate('pause')
    await this.options.browser.releaseInputs()
  }

  resume(): void {
    this.pauseRequested = false
  }

  async shutdown(): Promise<void> {
    this.pauseRequested = false
    this.activeVlm?.abort(new Error('BROWSER_COMPUTER_USE_STOPPED'))
    await this.reactive.shutdown()
    await this.options.browser.releaseInputs()
  }

  private async planReactive(
    session: BrowserComputerUseSession,
    observation: Parameters<BrowserVisualActionAdapter['planReactive']>[0]['observation'],
    signal: AbortSignal,
  ): Promise<BrowserReactiveControlPlan | null> {
    await this.waitForSlowDecisionSlot(signal)
    try {
      return await this.callVlm(signal, (childSignal) =>
        this.options.visual.planReactive(
          {
            goal: session.goal,
            sessionId: session.id,
            termination: session.termination,
            observation,
            previousPlan: this.reactive.plan(),
          },
          childSignal,
        ),
      )
    } catch (error) {
      const plan = this.reactive.plan()
      if (!plan || !isProviderAvailabilityFailure(error)) throw error
      const remaining = Math.max(0, plan.expiresAt - this.now())
      if (remaining > 0) await waitAbortable(remaining, signal)
      await this.reactive.deactivate('plan-expired')
      throw error
    }
  }

  private async decide(
    session: BrowserComputerUseSession,
    observation: Parameters<BrowserVisualActionAdapter['decide']>[0]['observation'],
    signal: AbortSignal,
  ): Promise<BrowserComputerUseDecision> {
    if (session.termination.type !== 'goal-completed') {
      await this.waitForSlowDecisionSlot(signal)
    }
    return this.callVlm(signal, (childSignal) =>
      this.options.visual.decide(
        { goal: session.goal, observation, recentAction: this.recentAction },
        childSignal,
      ),
    )
  }

  private async callVlm<T>(
    signal: AbortSignal,
    call: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController()
    this.activeVlm = controller
    const unlink = linkAbort(signal, controller)
    const startedAt = this.now()
    this.diagnosticsCollector.setVlmActive(true)
    try {
      return await call(controller.signal)
    } finally {
      this.diagnosticsCollector.recordVlm(this.now() - startedAt)
      this.diagnosticsCollector.setVlmActive(false)
      unlink()
      if (this.activeVlm === controller) this.activeVlm = null
    }
  }

  private async waitForSlowDecisionSlot(signal: AbortSignal): Promise<void> {
    const now = this.now()
    this.slowDecisionTimes = this.slowDecisionTimes.filter((value) => now - value < 60_000)
    const firstAvailableAt =
      this.slowDecisionTimes.length >= this.options.continuousBudget.maxSlowDecisionsPerMinute
        ? this.slowDecisionTimes[0] + 60_000
        : now
    const target = Math.max(firstAvailableAt, this.lastSlowDecisionAt + 500)
    if (target > now) await waitAbortable(target - now, signal)
    const recordedAt = this.now()
    this.lastSlowDecisionAt = recordedAt
    this.slowDecisionTimes.push(recordedAt)
  }

  private async completeAtDeadline(
    session: BrowserComputerUseSession,
    hooks: ComputerUseCoordinatorHooks,
  ): Promise<boolean> {
    if (this.now() < session.expiresAt) return false
    if (session.termination.type === 'goal-completed') {
      throw new BrowserAutomationError('COMPUTER_USE_LIMIT_REACHED')
    }
    await this.reactive.deactivate('lease-completed')
    await this.options.browser.releaseInputs()
    const summary =
      session.termination.type === 'until-time'
        ? 'Requested continuous-control duration completed.'
        : 'Continuous-control safety lease completed.'
    hooks.update({ state: 'completed', activity: 'idle', controlMode: 'slow', summary })
    hooks.emit('computer-use-completed', { kind: 'success', summary, confidence: 1 })
    return true
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}

function validatePlanScope(
  candidate: BrowserReactiveControlPlan,
  session: BrowserComputerUseSession,
  observation: Parameters<BrowserVisualActionAdapter['planReactive']>[0]['observation'],
  budget: ContinuousControlBudget,
): void {
  const plan = browserReactiveControlPlanSchema.parse(candidate)
  if (
    plan.sessionId !== session.id ||
    plan.pageId !== observation.page.id ||
    plan.sourceObservationId !== observation.id ||
    plan.sourceVisualFingerprint !== observation.visualFingerprint ||
    plan.maximumInputHz > budget.maxReactiveInputEventsPerSecond ||
    plan.createdAt < observation.capturedAt
  ) {
    throw new BrowserAutomationError('TARGET_STALE')
  }
  for (const anchor of plan.anchors) {
    if (
      anchor.bounds.x + anchor.bounds.width > observation.viewport.width ||
      anchor.bounds.y + anchor.bounds.height > observation.viewport.height
    ) {
      throw new BrowserAutomationError('INPUT_FAILED')
    }
  }
}

function isProviderAvailabilityFailure(error: unknown): boolean {
  return (
    error instanceof BrowserAutomationError &&
    [
      'COMPUTER_USE_RATE_LIMITED',
      'COMPUTER_USE_MODEL_TIMEOUT',
      'COMPUTER_USE_MODEL_UNAVAILABLE',
      'COMPUTER_USE_PROVIDER_NETWORK',
    ].includes(error.code)
  )
}

function linkAbort(parent: AbortSignal, child: AbortController): () => void {
  const abort = (): void => child.abort(parent.reason)
  parent.addEventListener('abort', abort, { once: true })
  if (parent.aborted) abort()
  return () => parent.removeEventListener('abort', abort)
}

function waitAbortable(durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer)
      reject(signal.reason ?? new Error('BROWSER_COMPUTER_USE_ABORTED'))
    }
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', abort)
        resolve()
      },
      Math.max(0, durationMs),
    )
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

async function raceReactiveReanchor(
  invalidated: Promise<string>,
  durationMs: number,
  signal: AbortSignal,
): Promise<{ type: 'invalidated'; reason: string } | { type: 'reanchor' }> {
  const timerController = new AbortController()
  const unlink = linkAbort(signal, timerController)
  try {
    const result = await Promise.race([
      invalidated.then((reason) => ({ type: 'invalidated' as const, reason })),
      waitAbortable(durationMs, timerController.signal).then(() => ({ type: 'reanchor' as const })),
    ])
    timerController.abort(new Error('REACTIVE_REANCHOR_RACE_SETTLED'))
    return result
  } finally {
    unlink()
  }
}
