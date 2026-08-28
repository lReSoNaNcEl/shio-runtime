import { randomUUID } from 'node:crypto'

import {
  type BrowserComputerUseSession,
  type BrowserComputerUseStartRequest,
  browserComputerUseStartRequestSchema,
  type ComputerUseNotableObservation,
  type ContinuousControlBudget,
  continuousControlBudgetSchema,
  DEFAULT_CONTINUOUS_CONTROL_BUDGET,
  EMPTY_BROWSER_COMPUTER_USE_DIAGNOSTICS,
} from '../../../shared/browser-computer-use'
import { mainLog } from '../../logging/safeLogger'
import { BrowserAutomationError } from '../errors'
import type { PlaywrightBrowserAdapter } from '../playwright/PlaywrightBrowserAdapter'
import type { BrowserReactiveTrackerPort } from './BrowserReactiveTracker'
import type {
  BrowserVisualActionAdapter,
  BrowserVisualActionStatus,
} from './BrowserVisualActionAdapter'
import {
  ComputerUseControlCoordinator,
  type ComputerUseCoordinatorEventType,
} from './ComputerUseControlCoordinator'

export interface BrowserComputerUseRuntimeOptions {
  browser: PlaywrightBrowserAdapter
  visual: BrowserVisualActionAdapter
  maximumSteps?: () => number
  continuousBudget?: Partial<ContinuousControlBudget>
  reactiveTracker?: BrowserReactiveTrackerPort
  now?: () => number
  createId?: () => string
  stopTimeoutMs?: number
  completionRetryLimit?: number
  onEvent?: (event: {
    type:
      | 'computer-use-started'
      | 'computer-use-progress'
      | 'computer-use-notable-observation'
      | 'computer-use-blocked'
      | 'computer-use-completed'
      | 'computer-use-failed'
      | 'computer-use-stopped'
    at: number
    sessionId: string
    observation?: ComputerUseNotableObservation
    errorCode?: string
  }) => void
}

/** Session façade. Control-frequency mechanics belong to ComputerUseControlCoordinator. */
export class BrowserComputerUseRuntime {
  private session: BrowserComputerUseSession | null = null
  private sessionController: AbortController | null = null
  private loopTask: Promise<void> | null = null
  private pauseRequested = false
  private readonly listeners = new Set<() => void>()
  private readonly continuousBudget: ContinuousControlBudget
  private readonly coordinator: ComputerUseControlCoordinator

  constructor(private readonly options: BrowserComputerUseRuntimeOptions) {
    this.continuousBudget = continuousControlBudgetSchema.parse({
      ...DEFAULT_CONTINUOUS_CONTROL_BUDGET,
      ...options.continuousBudget,
    })
    this.coordinator = new ComputerUseControlCoordinator({
      browser: options.browser,
      visual: options.visual,
      continuousBudget: this.continuousBudget,
      reactiveTracker: options.reactiveTracker,
      now: options.now,
      completionRetryLimit: options.completionRetryLimit,
    })
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): BrowserComputerUseSession | null {
    return this.session ? { ...this.session, diagnostics: this.coordinator.diagnostics() } : null
  }

  visualStatus(): BrowserVisualActionStatus {
    return this.coordinator.visualStatus()
  }

  async start(
    input: BrowserComputerUseStartRequest,
    authorityScopeId: string,
    signal: AbortSignal,
  ): Promise<BrowserComputerUseSession> {
    const request = browserComputerUseStartRequestSchema.parse(input)
    const visualStatus = this.options.visual.status()
    if (visualStatus.state !== 'ready') {
      throw new BrowserAutomationError(
        'COMPUTER_USE_UNAVAILABLE',
        'Browser visual control requires a configured vision model',
      )
    }
    if (
      this.session &&
      ['running', 'stopping', 'paused', 'waiting-user'].includes(this.session.state)
    ) {
      throw new BrowserAutomationError(
        'COMPUTER_USE_UNAVAILABLE',
        'A browser control session is already active',
      )
    }
    if (signal.aborted) {
      throw signal.reason ?? new BrowserAutomationError('COMPUTER_USE_UNAVAILABLE')
    }
    if (this.loopTask) await this.loopTask
    await this.options.browser.prepareForDelegation(signal)
    const browserSession = this.options.browser.sessionSnapshot()
    const now = this.now()
    const termination = request.termination ?? { type: 'goal-completed' as const }
    const durationMs =
      termination.type === 'goal-completed'
        ? request.maxDurationMs
        : termination.type === 'until-time'
          ? termination.durationMs
          : this.continuousBudget.maximumDurationMs
    this.coordinator.reset()
    const session: BrowserComputerUseSession = {
      id: `browser-use-session-${this.createId()}`,
      goal: request.goal,
      browserContextId: browserSession?.sessionId ?? 'browser-context-unavailable',
      pageId: browserSession?.activeTabId ?? 'browser-page-pending',
      state: 'running',
      startedAt: now,
      expiresAt: now + durationMs,
      maxSteps: Math.min(
        request.maxSteps,
        Math.max(1, Math.min(300, Math.round(this.options.maximumSteps?.() ?? 30))),
      ),
      maxActions: request.maxActions,
      stepCount: 0,
      actionCount: 0,
      authorityScopeId,
      termination,
      ...(termination.type === 'goal-completed' ? {} : { continuousBudget: this.continuousBudget }),
      mode: 'semantic',
      controlMode: 'slow',
      activity: 'starting',
      diagnostics: { ...EMPTY_BROWSER_COMPUTER_USE_DIAGNOSTICS },
    }
    this.session = session
    this.sessionController = new AbortController()
    this.pauseRequested = false
    this.emit('computer-use-started')
    this.launchLoop(this.sessionController.signal)
    return this.requireSnapshot()
  }

  async pause(): Promise<BrowserComputerUseSession> {
    const session = this.requireSession()
    if (session.state !== 'running') return this.requireSnapshot()
    this.pauseRequested = true
    await this.coordinator.pause()
    const loopTask = this.loopTask
    if (loopTask) await loopTask
    await this.options.browser.releaseInputs()
    const current = this.requireSession()
    if (current.state !== 'running') return this.requireSnapshot()
    this.session = { ...current, state: 'paused', activity: 'idle', controlMode: 'slow' }
    this.publishChanged()
    return this.requireSnapshot()
  }

  async resume(signal?: AbortSignal): Promise<BrowserComputerUseSession> {
    const session = this.requireSession()
    if (!['paused', 'waiting-user'].includes(session.state)) return this.requireSnapshot()
    if (signal?.aborted) {
      throw signal.reason ?? new BrowserAutomationError('COMPUTER_USE_UNAVAILABLE')
    }
    const controller = this.sessionController
    if (!controller || controller.signal.aborted) {
      throw new BrowserAutomationError('COMPUTER_USE_UNAVAILABLE')
    }
    this.pauseRequested = false
    this.coordinator.resume()
    this.session = {
      ...session,
      state: 'running',
      activity: 'observing',
      controlMode: 'slow',
      lastErrorCode: undefined,
    }
    this.launchLoop(controller.signal)
    this.publishChanged()
    return this.requireSnapshot()
  }

  async stop(): Promise<BrowserComputerUseSession> {
    const session = this.requireSession()
    if (!['running', 'paused', 'waiting-user', 'stopping'].includes(session.state)) {
      return this.requireSnapshot()
    }
    this.pauseRequested = false
    this.session = { ...session, state: 'stopping', activity: 'idle', controlMode: 'slow' }
    this.publishChanged()
    this.sessionController?.abort(new Error('BROWSER_COMPUTER_USE_STOPPED'))
    await this.coordinator.shutdown()
    const settled = await settleWithin(this.loopTask, this.options.stopTimeoutMs ?? 2_000)
    if (!settled) {
      await this.options.browser.forceAbort()
      await settleWithin(this.loopTask, this.options.stopTimeoutMs ?? 2_000)
    }
    await this.options.browser.releaseInputs()
    this.session = {
      ...this.requireSession(),
      state: 'stopped',
      activity: 'idle',
      controlMode: 'slow',
    }
    this.emit('computer-use-stopped')
    return this.requireSnapshot()
  }

  async emergencyStop(): Promise<BrowserComputerUseSession | null> {
    const session = this.session
    this.pauseRequested = false
    this.sessionController?.abort(new Error('BROWSER_COMPUTER_USE_EMERGENCY_STOPPED'))
    if (session) {
      this.session = { ...session, state: 'stopping', activity: 'idle', controlMode: 'slow' }
      this.publishChanged()
    }
    await Promise.allSettled([this.coordinator.shutdown(), this.options.browser.forceAbort()])
    if (!this.session) return null
    this.session = {
      ...this.session,
      state: 'stopped',
      activity: 'idle',
      controlMode: 'slow',
    }
    this.emit('computer-use-stopped')
    return this.requireSnapshot()
  }

  async dispose(): Promise<void> {
    if (
      this.session &&
      ['running', 'stopping', 'paused', 'waiting-user'].includes(this.session.state)
    ) {
      await this.stop()
    } else {
      await this.coordinator.shutdown()
    }
    await this.options.browser.releaseInputs()
  }

  private async runLoop(signal: AbortSignal): Promise<void> {
    try {
      await this.coordinator.run(
        {
          session: () => this.requireSession(),
          update: (patch) => this.updateSession(patch),
          emit: (type, observation, errorCode) => this.emit(type, observation, errorCode),
        },
        signal,
      )
      if (
        this.session &&
        ['completed', 'failed', 'waiting-user', 'stopped'].includes(this.session.state)
      ) {
        await this.coordinator.shutdown()
      }
    } catch (error) {
      if (signal.aborted || this.pauseRequested) return
      if (this.session?.state === 'paused' || this.session?.state === 'waiting-user') return
      await this.coordinator.shutdown()
      await this.options.browser.releaseInputs()
      const errorCode = error instanceof BrowserAutomationError ? error.code : 'COMPUTER_USE_FAILED'
      const current = this.session
      if (current) {
        this.session = {
          ...current,
          state: 'failed',
          activity: 'idle',
          controlMode: 'slow',
          lastErrorCode: errorCode,
        }
        this.emit('computer-use-failed', undefined, errorCode)
      }
      mainLog.warn('[BrowserComputerUse] session failed', { errorCode })
    }
  }

  private launchLoop(signal: AbortSignal): void {
    if (this.loopTask || signal.aborted || this.session?.state !== 'running') return
    const task = this.runLoop(signal)
    this.loopTask = task
    void task.finally(() => {
      if (this.loopTask !== task) return
      this.loopTask = null
      if (!signal.aborted && !this.pauseRequested && this.session?.state === 'running') {
        this.launchLoop(signal)
      }
    })
  }

  private updateSession(patch: Partial<BrowserComputerUseSession>): BrowserComputerUseSession {
    this.session = {
      ...this.requireSession(),
      ...patch,
      diagnostics: this.coordinator.diagnostics(),
    }
    this.publishChanged()
    return this.session
  }

  private requireSession(): BrowserComputerUseSession {
    if (!this.session) throw new BrowserAutomationError('NO_ACTIVE_SESSION')
    return this.session
  }

  private requireSnapshot(): BrowserComputerUseSession {
    const snapshot = this.snapshot()
    if (!snapshot) throw new BrowserAutomationError('NO_ACTIVE_SESSION')
    return snapshot
  }

  private emit(
    type:
      | Parameters<NonNullable<BrowserComputerUseRuntimeOptions['onEvent']>>[0]['type']
      | ComputerUseCoordinatorEventType,
    observation?: ComputerUseNotableObservation,
    errorCode?: string,
  ): void {
    const session = this.session
    if (!session) return
    this.options.onEvent?.({
      type,
      at: this.now(),
      sessionId: session.id,
      observation,
      errorCode,
    })
    this.publishChanged()
  }

  private publishChanged(): void {
    for (const listener of this.listeners) listener()
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  private createId(): string {
    return (this.options.createId ?? randomUUID)()
  }
}

async function settleWithin(task: Promise<void> | null, timeoutMs: number): Promise<boolean> {
  if (!task) return true
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task.then(() => true),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
