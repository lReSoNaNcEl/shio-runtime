import { randomUUID } from 'node:crypto'

import type { BrowserContext, chromium, Page } from 'playwright-core'

import type {
  BrowserComputerUseDecision,
  BrowserComputerUseObservation,
} from '../../../shared/browser-computer-use'
import type {
  BrowserObservation,
  BrowserSessionState,
  BrowserTab,
  BrowserTarget,
} from '../../../shared/browser-control'
import type { BrowserExecutionEvidence } from '../../action/executionEvidence'
import { mainLog } from '../../logging/safeLogger'
import { BrowserAutomationError, type BrowserAutomationErrorCode } from '../errors'
import { BrowserHeldInputRegistry, type BrowserHeldInputSnapshot } from './BrowserHeldInputRegistry'
import { launchOwnedBrowserContext } from './PlaywrightBrowserLifecycle'
import type { BrowserSensitiveRegion } from './PlaywrightCdpFrameStream'
import {
  captureFingerprintImage,
  capturePlaywrightComputerUseObservation,
} from './PlaywrightComputerUseObserver'
import { PlaywrightInputController } from './PlaywrightInputController'
import { PlaywrightPageRegistry } from './PlaywrightPageRegistry'
import { type PlaywrightRefBinding, PlaywrightRefRegistry } from './PlaywrightRefRegistry'
import {
  capturePlaywrightSemanticSnapshot,
  combinedSemanticSnapshot,
  normalizedSemanticName,
  playwrightSensitiveValues,
  sanitizeBrowserText,
} from './PlaywrightSemanticObserver'
import { redactSensitiveValues, SENSITIVE_ELEMENT_SELECTOR } from './PlaywrightSensitiveElements'
import { createVisualFingerprint, visualFingerprintChanged } from './PlaywrightVisualFingerprint'

export interface BrowserInteractionResult {
  evidence: BrowserExecutionEvidence
  observation?: BrowserObservation
}

export interface PlaywrightBrowserAdapterOptions {
  profileDirectory: string
  executablePath?: string
  now?: () => number
  createId?: () => string
  launchPersistentContext?: typeof chromium.launchPersistentContext
}

export interface PlaywrightReactiveControlTarget {
  page: Page
  pageId: string
  viewport: { width: number; height: number }
  sensitiveRegions: readonly BrowserSensitiveRegion[]
}

function validHttpUrl(value: string): string {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error()
    return url.href
  } catch {
    throw new BrowserAutomationError('NAVIGATION_FAILED')
  }
}

export class PlaywrightBrowserAdapter {
  private context: BrowserContext | null = null
  private session: BrowserSessionState | null = null
  private observation: BrowserObservation | null = null
  private computerUseObservation: BrowserComputerUseObservation | null = null
  private readonly normalRefs = new PlaywrightRefRegistry()
  private readonly computerUseRefs = new PlaywrightRefRegistry()
  private readonly heldInputs = new BrowserHeldInputRegistry()
  private readonly input = new PlaywrightInputController(this.heldInputs)
  private readonly pages = new PlaywrightPageRegistry(
    () => this.createId(),
    () => {
      this.invalidateObservation()
      void this.releaseInputs().catch((error: unknown) => {
        mainLog.warn('[BrowserControl] input release after page invalidation failed', {
          code: error instanceof Error ? error.name : 'Error',
        })
      })
    },
  )
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly options: PlaywrightBrowserAdapterOptions) {}

  executableAvailable(): boolean {
    return Boolean(this.options.executablePath)
  }

  sessionSnapshot(): BrowserSessionState | null {
    return this.session ? { ...this.session } : null
  }

  observationSnapshot(): BrowserObservation | null {
    return this.observation
      ? { ...this.observation, interactiveElements: [...this.observation.interactiveElements] }
      : null
  }

  computerUseObservationSnapshot(): BrowserComputerUseObservation | null {
    return this.computerUseObservation
      ? {
          ...this.computerUseObservation,
          visual: this.computerUseObservation.visual
            ? { ...this.computerUseObservation.visual }
            : undefined,
        }
      : null
  }

  prepareForDelegation(signal?: AbortSignal): Promise<void> {
    return this.enqueue(async () => {
      await this.ensurePage(signal)
    })
  }

  open(url: string, signal?: AbortSignal): Promise<BrowserInteractionResult> {
    return this.enqueue(async () => {
      const requestedUrl = validHttpUrl(url)
      const before = this.observationSnapshot() ?? undefined
      const page = await this.ensurePage(signal)
      this.invalidateObservation()
      try {
        await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await this.denyNotifications(page)
        const observation = await this.captureSemanticObservation(page, false, signal)
        return this.result('open', observation, { requestedUrl, before })
      } catch (error) {
        throw this.normalizeError(error, 'NAVIGATION_FAILED')
      }
    })
  }

  observe(signal?: AbortSignal): Promise<BrowserObservation> {
    return this.enqueue(async () => {
      const page = await this.ensurePage(signal)
      return this.captureSemanticObservation(page, true, signal)
    })
  }

  async observePage(signal?: AbortSignal): Promise<BrowserInteractionResult> {
    const observation = await this.observe(signal)
    return this.result('observe', observation)
  }

  async inspectTabs(signal?: AbortSignal): Promise<BrowserInteractionResult> {
    const tabs = await this.listTabs(signal)
    return {
      evidence: {
        kind: 'browser',
        operation: 'tabs',
        tabs,
        ...(this.observation ? { after: this.observation } : {}),
        ...(this.session ? { afterSession: this.session } : {}),
      },
    }
  }

  switchTab(pageId: string, signal?: AbortSignal): Promise<BrowserInteractionResult> {
    return this.enqueue(async () => {
      this.throwIfAborted(signal)
      const context = await this.ensureContext()
      const page = context.pages().find((candidate) => this.pageId(candidate) === pageId)
      if (!page) throw new BrowserAutomationError('TARGET_NOT_FOUND')
      const before = this.observationSnapshot() ?? undefined
      this.pages.setActive(page)
      await page.bringToFront()
      this.invalidateObservation()
      const observation = await this.captureSemanticObservation(page, false, signal)
      return this.result('switch-tab', observation, { requestedTabId: pageId, before })
    })
  }

  click(target: BrowserTarget, signal?: AbortSignal): Promise<BrowserInteractionResult> {
    return this.mutateTarget(
      'click',
      target,
      async (binding) => binding.locator.click({ timeout: 15_000 }),
      signal,
    )
  }

  fill(
    target: BrowserTarget,
    value: string,
    signal?: AbortSignal,
  ): Promise<BrowserInteractionResult> {
    return this.mutateTarget(
      'fill',
      target,
      async (binding) => binding.locator.fill(value, { timeout: 15_000 }),
      signal,
    )
  }

  select(
    target: BrowserTarget,
    values: readonly string[],
    signal?: AbortSignal,
  ): Promise<BrowserInteractionResult> {
    return this.mutateTarget(
      'select',
      target,
      async (binding) => binding.locator.selectOption([...values], { timeout: 15_000 }),
      signal,
    )
  }

  scroll(
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number,
    signal?: AbortSignal,
  ): Promise<BrowserInteractionResult> {
    return this.enqueue(async () => {
      const page = await this.ensurePage(signal)
      const before = this.observationSnapshot() ?? undefined
      const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0
      const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0
      this.invalidateObservation()
      await page.mouse.wheel(dx, dy)
      const observation = await this.captureSemanticObservation(page, false, signal)
      return this.result('scroll', observation, { before })
    })
  }

  back(signal?: AbortSignal): Promise<BrowserInteractionResult> {
    return this.navigateHistory('back', signal)
  }

  forward(signal?: AbortSignal): Promise<BrowserInteractionResult> {
    return this.navigateHistory('forward', signal)
  }

  captureComputerUseObservation(
    includeVisual: boolean,
    signal?: AbortSignal,
  ): Promise<BrowserComputerUseObservation> {
    return this.enqueue(async () => {
      const page = await this.ensurePage(signal)
      this.invalidateNormalObservation()
      const semantic = await this.captureSemanticSnapshot(page, false, signal)
      const captured = await capturePlaywrightComputerUseObservation(page, semantic, {
        includeVisual,
        pageId: this.pageId(page),
        now: () => this.now(),
        createId: () => this.createId(),
      })
      const { observation } = captured
      this.computerUseRefs.replace(observation.id, observation.page.id, captured.refBindings)
      this.computerUseObservation = observation
      return observation
    })
  }

  executeComputerUseDecision(
    decision: BrowserComputerUseDecision,
    signal: AbortSignal,
  ): Promise<void> {
    return this.enqueue(async () => {
      this.throwIfAborted(signal)
      const current = this.computerUseObservation
      const page = await this.ensurePage(signal)
      if (
        !current ||
        current.id !== decision.observationId ||
        this.pageId(page) !== decision.pageId
      ) {
        throw new BrowserAutomationError('TARGET_STALE')
      }
      const [currentAria, currentViewport] = await Promise.all([
        page
          .locator('body')
          .ariaSnapshot({ timeout: 10_000 })
          .catch(() => ''),
        page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
      ])
      if (
        page.url() !== current.page.url ||
        currentViewport.width !== current.viewport.width ||
        currentViewport.height !== current.viewport.height ||
        (current.semantic &&
          combinedSemanticSnapshot(
            redactSensitiveValues(currentAria, await playwrightSensitiveValues(page)),
            this.computerUseRefs.values(current.id).map((binding) => binding.element),
          ) !== current.semantic.ariaSnapshot)
      ) {
        this.invalidateObservation()
        throw new BrowserAutomationError('TARGET_STALE')
      }
      if (isCoordinateDecision(decision)) {
        if (decision.visualFingerprint !== current.visualFingerprint) {
          this.invalidateObservation()
          throw new BrowserAutomationError('TARGET_STALE')
        }
        const currentVisualFingerprint = await createVisualFingerprint(
          await captureFingerprintImage(page),
        )
        if (visualFingerprintChanged(current.visualFingerprint, currentVisualFingerprint)) {
          this.invalidateObservation()
          throw new BrowserAutomationError('TARGET_STALE')
        }
      }
      this.input.assertCoordinates(decision, current)
      if (this.input.isDirectInput(decision)) {
        await this.input.execute(page, decision)
      } else
        switch (decision.type) {
          case 'click-ref':
            await this.refForComputerUse(decision.ref, current).locator.click({ timeout: 15_000 })
            break
          case 'fill-ref':
            await this.refForComputerUse(decision.ref, current).locator.fill(decision.text, {
              timeout: 15_000,
            })
            break
          case 'navigate':
            await page.goto(validHttpUrl(decision.url), {
              waitUntil: 'domcontentloaded',
              timeout: 30_000,
            })
            break
          case 'back':
            await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 })
            break
          case 'forward':
            await page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 })
            break
          case 'switch-tab': {
            const target = this.context
              ?.pages()
              .find((candidate) => this.pageId(candidate) === decision.targetPageId)
            if (!target) throw new BrowserAutomationError('TARGET_NOT_FOUND')
            this.pages.setActive(target)
            await target.bringToFront()
            break
          }
          case 'wait':
            await this.wait(decision.durationMs, signal)
            break
          case 'request-user':
          case 'done':
            return
        }
      this.invalidateObservation()
      await this.denyNotifications(this.pages.activePage() ?? page)
    })
  }

  async releaseInputs(): Promise<void> {
    await this.heldInputs.releaseAll()
  }

  heldInputSnapshot(): BrowserHeldInputSnapshot {
    return this.heldInputs.snapshot()
  }

  heldInputRegistry(): BrowserHeldInputRegistry {
    return this.heldInputs
  }

  reactiveControlTarget(signal?: AbortSignal): Promise<PlaywrightReactiveControlTarget> {
    return this.enqueue(async () => {
      const page = await this.ensurePage(signal)
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      const locator = page.locator(SENSITIVE_ELEMENT_SELECTOR)
      const count = Math.min(await locator.count(), 50)
      const sensitiveRegions: BrowserSensitiveRegion[] = []
      for (let index = 0; index < count; index += 1) {
        const bounds = await locator
          .nth(index)
          .boundingBox()
          .catch(() => null)
        if (bounds) sensitiveRegions.push(bounds)
      }
      return {
        page,
        pageId: this.pageId(page),
        viewport,
        sensitiveRegions: Object.freeze(sensitiveRegions),
      }
    })
  }

  isReactiveControlTargetCurrent(pageId: string): boolean {
    const page = this.pages.activePage()
    return Boolean(page && this.pageId(page) === pageId)
  }

  close(): Promise<void> {
    return this.enqueue(async () => {
      await this.releaseInputs()
      const context = this.context
      this.context = null
      this.pages.reset()
      this.invalidateObservation()
      if (context)
        await context.close().catch((error) =>
          mainLog.warn('[BrowserControl] Playwright shutdown failed', {
            code: error instanceof Error ? error.name : 'Error',
          }),
        )
      if (this.session) this.session = { ...this.session, status: 'closed', updatedAt: this.now() }
    })
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context
    if (!this.options.executablePath) throw new BrowserAutomationError('BROWSER_UNAVAILABLE')
    try {
      const context = await launchOwnedBrowserContext(this.options)
      context.on('page', (page) => {
        this.pages.bind(page)
        this.pages.setActive(page)
      })
      context.on('close', () => {
        if (this.context === context) this.context = null
        this.pages.reset()
        this.invalidateObservation()
      })
      this.context = context
      for (const page of context.pages()) this.pages.bind(page)
      const now = this.now()
      this.session = {
        sessionId: `browser-session-${this.createId()}`,
        status: 'starting',
        openedAt: now,
        updatedAt: now,
      }
      return context
    } catch (error) {
      throw this.normalizeError(error, 'BROWSER_UNAVAILABLE')
    }
  }

  private async ensurePage(signal?: AbortSignal): Promise<Page> {
    this.throwIfAborted(signal)
    const context = await this.ensureContext()
    let page = this.pages.activePage() ?? context.pages().find((candidate) => !candidate.isClosed())
    if (!page) page = await context.newPage()
    this.pages.setActive(page)
    this.pages.bind(page)
    await page.bringToFront()
    await this.denyNotifications(page)
    return page
  }

  private async captureSemanticObservation(
    page: Page,
    preserveIdWhenUnchanged: boolean,
    signal?: AbortSignal,
  ): Promise<BrowserObservation> {
    this.invalidateComputerUseObservation()
    const snapshot = await this.captureSemanticSnapshot(page, preserveIdWhenUnchanged, signal)
    this.normalRefs.replace(
      snapshot.observation.observationId,
      this.pageId(page),
      snapshot.refBindings,
    )
    this.observation = snapshot.observation
    return snapshot.observation
  }

  /** Immediately tears down the exact owned context without waiting behind the operation queue. */
  async forceAbort(): Promise<void> {
    const context = this.context
    this.context = null
    this.pages.reset()
    this.heldInputs.reset()
    this.invalidateObservation()
    if (context) {
      await context.close().catch((error) =>
        mainLog.warn('[BrowserControl] forced Playwright abort failed', {
          code: error instanceof Error ? error.name : 'Error',
        }),
      )
    }
    if (this.session) this.session = { ...this.session, status: 'closed', updatedAt: this.now() }
  }

  private async captureSemanticSnapshot(
    page: Page,
    preserveIdWhenUnchanged: boolean,
    signal?: AbortSignal,
  ): Promise<{
    observation: BrowserObservation
    refBindings: readonly Omit<PlaywrightRefBinding, 'observationId' | 'pageId'>[]
  }> {
    const snapshot = await capturePlaywrightSemanticSnapshot(page, {
      previous: this.observation,
      preserveIdWhenUnchanged,
      session: this.session,
      pageId: this.pageId(page),
      now: () => this.now(),
      createId: () => this.createId(),
      signal,
    })
    this.session = snapshot.session
    return snapshot
  }

  private mutateTarget(
    operation: 'click' | 'fill' | 'select',
    target: BrowserTarget,
    mutate: (binding: PlaywrightRefBinding) => Promise<unknown>,
    signal?: AbortSignal,
  ): Promise<BrowserInteractionResult> {
    return this.enqueue(async () => {
      const page = await this.ensurePage(signal)
      const current = this.observation
      if (!current || current.observationId !== target.observationId)
        throw new BrowserAutomationError('TARGET_STALE')
      const binding = this.resolveTarget(target, current)
      const before = current
      this.invalidateObservation()
      try {
        await mutate(binding)
        const observation = await this.captureSemanticObservation(page, false, signal)
        return this.result(operation, observation, { before, targetName: binding.element.name })
      } catch (error) {
        throw this.normalizeError(error, operation === 'click' ? 'CLICK_FAILED' : 'INPUT_FAILED')
      }
    })
  }

  private resolveTarget(
    target: BrowserTarget,
    observation: BrowserObservation,
  ): PlaywrightRefBinding {
    if (target.kind === 'semantic-ref') {
      const binding = this.normalRefs.get(target.ref, observation.observationId)
      if (!binding) throw new BrowserAutomationError('TARGET_NOT_FOUND')
      return binding
    }
    const matches = this.normalRefs
      .values(observation.observationId)
      .filter(
        (binding) =>
          binding.element.role === target.role &&
          binding.element.name &&
          normalizedSemanticName(binding.element.name) === normalizedSemanticName(target.name),
      )
    if (matches.length === 0) throw new BrowserAutomationError('TARGET_NOT_FOUND')
    if (matches.length > 1) throw new BrowserAutomationError('TARGET_AMBIGUOUS')
    return matches[0]
  }

  private refForComputerUse(
    ref: string,
    observation: BrowserComputerUseObservation,
  ): PlaywrightRefBinding {
    const binding = this.computerUseRefs.get(ref, observation.id, observation.page.id)
    if (!binding) throw new BrowserAutomationError('TARGET_NOT_FOUND')
    return binding
  }

  private navigateHistory(
    operation: 'back' | 'forward',
    signal?: AbortSignal,
  ): Promise<BrowserInteractionResult> {
    return this.enqueue(async () => {
      const page = await this.ensurePage(signal)
      const before = this.observationSnapshot() ?? undefined
      this.invalidateObservation()
      if (operation === 'back')
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 })
      else await page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 })
      const observation = await this.captureSemanticObservation(page, false, signal)
      return this.result(operation, observation, { before })
    })
  }

  private async listTabs(signal?: AbortSignal): Promise<BrowserTab[]> {
    this.throwIfAborted(signal)
    const context = await this.ensureContext()
    return Promise.all(
      context
        .pages()
        .slice(0, 20)
        .map(async (page) => ({
          tabId: this.pageId(page),
          ...(page.url().startsWith('http') ? { url: page.url() } : {}),
          title: sanitizeBrowserText(await page.title().catch(() => ''), 1_000) || undefined,
          active: page === this.pages.activePage(),
        })),
    )
  }

  private result(
    operation: BrowserExecutionEvidence['operation'],
    observation: BrowserObservation,
    extra: Partial<BrowserExecutionEvidence> = {},
  ): BrowserInteractionResult {
    return {
      evidence: {
        kind: 'browser',
        operation,
        ...extra,
        after: observation,
        ...(this.session ? { afterSession: this.session } : {}),
      },
      observation,
    }
  }

  private async denyNotifications(page: Page): Promise<void> {
    if (!this.context || !page.url().startsWith('http')) return
    try {
      const origin = new URL(page.url()).origin
      const cdp = await this.context.newCDPSession(page)
      await cdp.send('Browser.setPermission', {
        permission: { name: 'notifications' },
        setting: 'denied',
        origin,
      })
      await cdp.detach()
    } catch {
      // The launch-level notification policy remains the fallback for non-Chromium pages.
    }
  }

  private pageId(page: Page): string {
    return this.pages.id(page)
  }

  private invalidateObservation(): void {
    this.invalidateNormalObservation()
    this.invalidateComputerUseObservation()
  }

  private invalidateNormalObservation(): void {
    this.observation = null
    this.normalRefs.clear()
  }

  private invalidateComputerUseObservation(): void {
    this.computerUseObservation = null
    this.computerUseRefs.clear()
  }

  private normalizeError(
    error: unknown,
    fallback: BrowserAutomationErrorCode,
  ): BrowserAutomationError {
    if (error instanceof BrowserAutomationError) return error
    mainLog.warn('[BrowserControl] Playwright operation failed', {
      code: fallback,
      cause: error instanceof Error ? error.name : 'Error',
    })
    return new BrowserAutomationError(fallback)
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw signal.reason ?? new BrowserAutomationError('BROWSER_UNAVAILABLE')
  }

  private wait(durationMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        clearTimeout(timer)
        reject(signal.reason ?? new BrowserAutomationError('BROWSER_UNAVAILABLE'))
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort)
        resolve()
      }, durationMs)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  private createId(): string {
    return (this.options.createId ?? randomUUID)()
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.catch(() => undefined).then(operation)
    this.queue = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }
}

function isCoordinateDecision(
  decision: BrowserComputerUseDecision,
): decision is Extract<
  BrowserComputerUseDecision,
  { type: 'click' | 'move' | 'drag' | 'mouse-down' | 'mouse-up' }
> {
  return ['click', 'move', 'drag', 'mouse-down', 'mouse-up'].includes(decision.type)
}
