import { randomUUID } from 'node:crypto'

import {
  type BrowserComputerUseDecision,
  type BrowserComputerUseSession,
  type BrowserComputerUseStartRequest,
  browserComputerUseStartRequestSchema,
  type ComputerUseNotableObservation,
} from '../../../shared/browser-computer-use'
import { mainLog } from '../../logging/safeLogger'
import { BrowserAutomationError } from '../errors'
import type { PlaywrightBrowserAdapter } from '../playwright/PlaywrightBrowserAdapter'
import type {
  BrowserVisualActionAdapter,
  BrowserVisualActionStatus,
} from './BrowserVisualActionAdapter'

export interface BrowserComputerUseRuntimeOptions {
  browser: PlaywrightBrowserAdapter
  visual: BrowserVisualActionAdapter
  maximumSteps?: () => number
  now?: () => number
  createId?: () => string
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

export class BrowserComputerUseRuntime {
  private session: BrowserComputerUseSession | null = null
  private sessionController: AbortController | null = null
  private decisionController: AbortController | null = null
  private loopTask: Promise<void> | null = null
  private recentAction:
    | { type: BrowserComputerUseDecision['type']; outcome: 'executed' | 'stale' | 'failed' }
    | undefined
  private readonly listeners = new Set<() => void>()

  constructor(private readonly options: BrowserComputerUseRuntimeOptions) {}

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): BrowserComputerUseSession | null {
    return this.session ? { ...this.session } : null
  }

  visualStatus(): BrowserVisualActionStatus {
    return this.options.visual.status()
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
      ['starting', 'running', 'paused', 'waiting-user'].includes(this.session.state)
    ) {
      throw new BrowserAutomationError(
        'COMPUTER_USE_UNAVAILABLE',
        'A browser control session is already active',
      )
    }
    if (signal.aborted)
      throw signal.reason ?? new BrowserAutomationError('COMPUTER_USE_UNAVAILABLE')
    const observation = await this.options.browser.captureComputerUseObservation(
      visualStatus.supportsVision,
      signal,
    )
    const now = this.now()
    const session: BrowserComputerUseSession = {
      id: `browser-use-session-${this.createId()}`,
      goal: request.goal,
      browserContextId:
        this.options.browser.sessionSnapshot()?.sessionId ?? 'browser-context-unavailable',
      pageId: observation.page.id,
      state: 'running',
      startedAt: now,
      expiresAt: now + request.maxDurationMs,
      maxSteps: Math.min(
        request.maxSteps,
        Math.max(1, Math.min(300, Math.round(this.options.maximumSteps?.() ?? 30))),
      ),
      maxActions: request.maxActions,
      stepCount: 0,
      actionCount: 0,
      authorityScopeId,
      mode: observation.visual ? 'visual' : 'semantic',
      activity: 'observing',
    }
    this.session = session
    this.sessionController = new AbortController()
    this.recentAction = undefined
    this.emit('computer-use-started')
    this.launchLoop(this.sessionController.signal)
    return { ...session }
  }

  async pause(): Promise<BrowserComputerUseSession> {
    const session = this.requireSession()
    if (session.state !== 'running') return { ...session }
    this.session = { ...session, state: 'paused', activity: 'idle' }
    this.decisionController?.abort(new Error('BROWSER_COMPUTER_USE_PAUSED'))
    await this.options.browser.releaseInputs()
    this.publishChanged()
    return { ...this.session }
  }

  async resume(signal?: AbortSignal): Promise<BrowserComputerUseSession> {
    const session = this.requireSession()
    if (!['paused', 'waiting-user'].includes(session.state)) return { ...session }
    if (signal?.aborted)
      throw signal.reason ?? new BrowserAutomationError('COMPUTER_USE_UNAVAILABLE')
    const controller = this.sessionController
    if (!controller || controller.signal.aborted)
      throw new BrowserAutomationError('COMPUTER_USE_UNAVAILABLE')
    this.session = { ...session, state: 'running', activity: 'observing' }
    this.launchLoop(controller.signal)
    this.publishChanged()
    return { ...this.session }
  }

  async stop(): Promise<BrowserComputerUseSession> {
    const session = this.requireSession()
    this.sessionController?.abort(new Error('BROWSER_COMPUTER_USE_STOPPED'))
    this.decisionController?.abort(new Error('BROWSER_COMPUTER_USE_STOPPED'))
    await this.options.browser.releaseInputs()
    this.session = { ...session, state: 'stopped', activity: 'idle' }
    this.emit('computer-use-stopped')
    return { ...this.session }
  }

  async dispose(): Promise<void> {
    if (
      this.session &&
      ['starting', 'running', 'paused', 'waiting-user'].includes(this.session.state)
    ) {
      await this.stop()
    }
    await this.options.browser.releaseInputs()
  }

  private async runLoop(signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted) {
        const session = this.session
        if (session?.state !== 'running') return
        if (
          this.now() >= session.expiresAt ||
          session.stepCount >= session.maxSteps ||
          session.actionCount >= session.maxActions
        ) {
          throw new BrowserAutomationError('COMPUTER_USE_LIMIT_REACHED')
        }
        this.session = { ...session, activity: 'observing' }
        const visualStatus = this.options.visual.status()
        const observation = await this.options.browser.captureComputerUseObservation(
          visualStatus.supportsVision,
          signal,
        )
        if (observation.blocker) {
          await this.options.browser.releaseInputs()
          this.session = {
            ...this.requireSession(),
            state: 'waiting-user',
            activity: 'waiting-user',
            lastErrorCode: observation.blocker,
          }
          this.emit('computer-use-blocked', undefined, observation.blocker)
          return
        }
        this.session = {
          ...this.requireSession(),
          pageId: observation.page.id,
          mode: observation.visual ? 'visual' : 'semantic',
          activity: 'deciding',
          stepCount: this.requireSession().stepCount + 1,
        }
        const decisionController = new AbortController()
        this.decisionController = decisionController
        const unlink = linkAbort(signal, decisionController)
        let decision: BrowserComputerUseDecision
        try {
          decision = await this.options.visual.decide(
            {
              goal: this.requireSession().goal,
              observation,
              recentAction: this.recentAction,
            },
            decisionController.signal,
          )
        } finally {
          unlink()
          if (this.decisionController === decisionController) this.decisionController = null
        }
        if (decision.type === 'request-user') {
          await this.options.browser.releaseInputs()
          this.session = {
            ...this.requireSession(),
            state: 'waiting-user',
            activity: 'waiting-user',
            lastErrorCode: decision.reasonCode,
          }
          this.emit('computer-use-blocked', undefined, decision.reasonCode)
          return
        }
        if (decision.type === 'done') {
          await this.options.browser.releaseInputs()
          this.session = {
            ...this.requireSession(),
            state: 'completed',
            activity: 'idle',
            summary: decision.summary,
          }
          this.emit('computer-use-completed', {
            kind: 'success',
            summary: decision.summary,
            confidence: 1,
          })
          return
        }
        this.session = { ...this.requireSession(), activity: 'acting' }
        try {
          await this.options.browser.executeComputerUseDecision(decision, signal)
          this.recentAction = { type: decision.type, outcome: 'executed' }
          this.session = {
            ...this.requireSession(),
            actionCount: this.requireSession().actionCount + 1,
            activity: 'verifying',
          }
          this.emit('computer-use-progress')
        } catch (error) {
          if (error instanceof BrowserAutomationError && error.code === 'TARGET_STALE') {
            this.recentAction = { type: decision.type, outcome: 'stale' }
            continue
          }
          this.recentAction = { type: decision.type, outcome: 'failed' }
          throw error
        }
      }
    } catch (error) {
      if (signal.aborted) return
      if (this.session?.state === 'paused' || this.session?.state === 'waiting-user') return
      await this.options.browser.releaseInputs()
      const errorCode = error instanceof BrowserAutomationError ? error.code : 'COMPUTER_USE_FAILED'
      const current = this.session
      if (current) {
        this.session = { ...current, state: 'failed', activity: 'idle', lastErrorCode: errorCode }
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
      if (!signal.aborted && this.session?.state === 'running') this.launchLoop(signal)
    })
  }

  private requireSession(): BrowserComputerUseSession {
    if (!this.session) throw new BrowserAutomationError('NO_ACTIVE_SESSION')
    return this.session
  }

  private emit(
    type: Parameters<NonNullable<BrowserComputerUseRuntimeOptions['onEvent']>>[0]['type'],
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

function linkAbort(parent: AbortSignal, child: AbortController): () => void {
  const abort = (): void => child.abort(parent.reason)
  parent.addEventListener('abort', abort, { once: true })
  if (parent.aborted) abort()
  return () => parent.removeEventListener('abort', abort)
}
