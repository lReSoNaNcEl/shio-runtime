import { createHash, randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'

import { type BrowserContext, chromium, type Locator, type Page } from 'playwright-core'

import type {
  BrowserComputerUseDecision,
  BrowserComputerUseObservation,
} from '../../../shared/browser-computer-use'
import {
  BROWSER_OBSERVATION_CONTENT_MAX_CHARS,
  BROWSER_OBSERVATION_MAX_INTERACTIVE_ELEMENTS,
  type BrowserInteractiveElement,
  type BrowserInteractiveRole,
  type BrowserObservation,
  type BrowserSessionState,
  type BrowserTab,
  type BrowserTarget,
} from '../../../shared/browser-control'
import type { BrowserExecutionEvidence } from '../../action/executionEvidence'
import { mainLog } from '../../logging/safeLogger'
import { BrowserAutomationError, type BrowserAutomationErrorCode } from '../errors'

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

interface RefBinding {
  observationId: string
  pageId: string
  locator: Locator
  element: BrowserInteractiveElement
}

const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="combobox"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[contenteditable="true"]',
].join(',')

const SENSITIVE_SELECTOR = [
  'input[type="password"]',
  'input[autocomplete="current-password"]',
  'input[autocomplete="new-password"]',
  'input[autocomplete="one-time-code"]',
  'input[autocomplete="cc-number"]',
  'input[autocomplete="cc-csc"]',
  'input[name*="token" i]',
  'textarea[name*="token" i]',
].join(',')

function sanitizeText(value: string, maximum = BROWSER_OBSERVATION_CONTENT_MAX_CHARS): string {
  let sanitized = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint === 9 || codePoint === 10 || codePoint === 13 || codePoint >= 32) {
      if (codePoint !== 127) sanitized += character
    }
  }
  return sanitized
    .replace(/\r\n?/gu, '\n')
    .replace(/\n{4,}/gu, '\n\n\n')
    .trim()
    .slice(0, maximum)
}

function combinedSemanticSnapshot(
  ariaSnapshot: string,
  elements: readonly BrowserInteractiveElement[],
): string {
  return sanitizeText(
    [
      ariaSnapshot,
      'Semantic refs:',
      ...elements.map(
        (element) =>
          `${element.ref} ${element.role}${element.name ? ` ${element.name}` : ''}${element.disabled ? ' disabled' : ''}`,
      ),
    ].join('\n'),
    16_000,
  )
}

function normalizeRole(
  rawRole: string | null,
  tagName: string,
  inputType: string,
): BrowserInteractiveRole {
  const role = rawRole?.trim().toLowerCase()
  if (
    role &&
    ['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'tab', 'menuitem'].includes(role)
  ) {
    return role as BrowserInteractiveRole
  }
  if (tagName === 'button') return 'button'
  if (tagName === 'a') return 'link'
  if (tagName === 'select') return 'combobox'
  if (tagName === 'textarea') return 'textbox'
  if (tagName === 'input') {
    if (inputType === 'checkbox') return 'checkbox'
    if (inputType === 'radio') return 'radio'
    return 'textbox'
  }
  return 'other'
}

function normalizedName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
}

function fingerprint(observation: BrowserObservation): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        url: observation.url,
        title: observation.title,
        content: observation.content,
        interactiveElements: observation.interactiveElements,
      }),
    )
    .digest('hex')
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
  private activePage: Page | null = null
  private session: BrowserSessionState | null = null
  private observation: BrowserObservation | null = null
  private computerUseObservation: BrowserComputerUseObservation | null = null
  private readonly pageIds = new WeakMap<Page, string>()
  private readonly boundPages = new WeakSet<Page>()
  private readonly refs = new Map<string, RefBinding>()
  private readonly heldKeys = new Set<string>()
  private readonly heldButtons = new Set<'left' | 'right'>()
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
      this.activePage = page
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
      const semantic = await this.captureSemanticObservation(page, false, signal)
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      const ariaSnapshot = await page
        .locator('body')
        .ariaSnapshot({ timeout: 10_000 })
        .catch(() => '')
      const blocker = await this.detectBlocker(page)
      const visual = includeVisual
        ? {
            mimeType: 'image/jpeg' as const,
            bytes: new Uint8Array(
              await page.screenshot({
                type: 'jpeg',
                quality: 70,
                scale: 'css',
                animations: 'disabled',
                caret: 'hide',
                mask: [page.locator(SENSITIVE_SELECTOR)],
                timeout: 15_000,
              }),
            ),
          }
        : undefined
      const observation: BrowserComputerUseObservation = {
        id: `browser-use-observation-${this.createId()}`,
        page: {
          id: this.pageId(page),
          url: semantic.url,
          title: semantic.title ?? '',
        },
        viewport,
        semantic:
          ariaSnapshot || semantic.interactiveElements.length > 0
            ? {
                ariaSnapshot: combinedSemanticSnapshot(ariaSnapshot, semantic.interactiveElements),
                interactiveCount: semantic.interactiveElements.length,
              }
            : undefined,
        visual,
        blocker,
        capturedAt: this.now(),
      }
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
          combinedSemanticSnapshot(currentAria, this.observation?.interactiveElements ?? []) !==
            current.semantic.ariaSnapshot)
      ) {
        this.invalidateObservation()
        throw new BrowserAutomationError('TARGET_STALE')
      }
      this.assertCoordinates(decision, current)
      switch (decision.type) {
        case 'click-ref':
          await this.refForComputerUse(decision.ref, current).locator.click({ timeout: 15_000 })
          break
        case 'fill-ref':
          await this.refForComputerUse(decision.ref, current).locator.fill(decision.text, {
            timeout: 15_000,
          })
          break
        case 'click':
          await page.mouse.click(decision.x, decision.y, { button: decision.button })
          break
        case 'move':
          await page.mouse.move(decision.x, decision.y)
          break
        case 'drag':
          await page.mouse.move(decision.from.x, decision.from.y)
          await page.mouse.down()
          this.heldButtons.add('left')
          try {
            await page.mouse.move(decision.to.x, decision.to.y, { steps: 10 })
          } finally {
            await page.mouse.up().catch(() => undefined)
            this.heldButtons.delete('left')
          }
          break
        case 'mouse-down':
          await page.mouse.move(decision.x, decision.y)
          await page.mouse.down({ button: decision.button })
          this.heldButtons.add(decision.button)
          break
        case 'mouse-up':
          await page.mouse.move(decision.x, decision.y)
          await page.mouse.up({ button: decision.button })
          this.heldButtons.delete(decision.button)
          break
        case 'scroll':
          await page.mouse.wheel(decision.dx, decision.dy)
          break
        case 'key':
          await page.keyboard.press(decision.key)
          break
        case 'key-down':
          await page.keyboard.down(decision.key)
          this.heldKeys.add(decision.key)
          break
        case 'key-up':
          await page.keyboard.up(decision.key)
          this.heldKeys.delete(decision.key)
          break
        case 'type':
          await page.keyboard.type(decision.text)
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
          this.activePage = target
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
      await this.denyNotifications(this.activePage ?? page)
    })
  }

  async releaseInputs(): Promise<void> {
    const page = this.activePage
    if (!page || page.isClosed()) {
      this.heldButtons.clear()
      this.heldKeys.clear()
      return
    }
    await Promise.allSettled([
      ...[...this.heldKeys].map((key) => page.keyboard.up(key)),
      ...[...this.heldButtons].map((button) => page.mouse.up({ button })),
    ])
    this.heldButtons.clear()
    this.heldKeys.clear()
  }

  close(): Promise<void> {
    return this.enqueue(async () => {
      await this.releaseInputs()
      const context = this.context
      this.context = null
      this.activePage = null
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
    await mkdir(this.options.profileDirectory, { recursive: true })
    const launch =
      this.options.launchPersistentContext ?? chromium.launchPersistentContext.bind(chromium)
    try {
      const context = await launch(this.options.profileDirectory, {
        executablePath: this.options.executablePath,
        headless: false,
        acceptDownloads: false,
        viewport: null,
        args: ['--deny-permission-prompts'],
      })
      context.setDefaultTimeout(15_000)
      context.setDefaultNavigationTimeout(30_000)
      context.on('page', (page) => {
        this.bindPage(page)
        this.activePage = page
      })
      context.on('close', () => {
        if (this.context === context) this.context = null
        this.activePage = null
        this.invalidateObservation()
      })
      this.context = context
      for (const page of context.pages()) this.bindPage(page)
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
    let page =
      this.activePage && !this.activePage.isClosed()
        ? this.activePage
        : context.pages().find((candidate) => !candidate.isClosed())
    if (!page) page = await context.newPage()
    this.activePage = page
    this.bindPage(page)
    await page.bringToFront()
    await this.denyNotifications(page)
    return page
  }

  private async captureSemanticObservation(
    page: Page,
    preserveIdWhenUnchanged: boolean,
    signal?: AbortSignal,
  ): Promise<BrowserObservation> {
    this.throwIfAborted(signal)
    const previous = this.observation
    const base = page.locator(INTERACTIVE_SELECTOR)
    const inspected = await base.evaluateAll((elements) =>
      elements
        .slice(0, 400)
        .map((element, index) => {
          const html = element as HTMLElement
          const input = element as HTMLInputElement
          const rect = html.getBoundingClientRect()
          const style = getComputedStyle(html)
          if (
            rect.width <= 0 ||
            rect.height <= 0 ||
            style.visibility === 'hidden' ||
            style.display === 'none'
          )
            return null
          const tagName = html.tagName.toLowerCase()
          const inputType = input.type?.toLowerCase?.() ?? ''
          const rawRole = html.getAttribute('role')
          const ariaLabel =
            html.getAttribute('aria-label') ||
            html.getAttribute('title') ||
            input.placeholder ||
            input.value
          const text = (html.innerText || html.textContent || '').trim()
          return {
            index,
            tagName,
            inputType,
            rawRole,
            name: ariaLabel || text || undefined,
            disabled: input.disabled || html.getAttribute('aria-disabled') === 'true',
          }
        })
        .filter(Boolean),
    )
    const elements: BrowserInteractiveElement[] = []
    this.refs.clear()
    for (const candidate of inspected as Array<{
      index: number
      tagName: string
      inputType: string
      rawRole: string | null
      name?: string
      disabled?: boolean
    }>) {
      if (elements.length >= BROWSER_OBSERVATION_MAX_INTERACTIVE_ELEMENTS) break
      const ref = `e${elements.length + 1}`
      const element: BrowserInteractiveElement = {
        ref,
        role: normalizeRole(candidate.rawRole, candidate.tagName, candidate.inputType),
        ...(candidate.name ? { name: sanitizeText(candidate.name, 500) } : {}),
        ...(candidate.disabled ? { disabled: true } : {}),
      }
      elements.push(element)
      this.refs.set(ref, {
        observationId: '',
        pageId: this.pageId(page),
        locator: base.nth(candidate.index),
        element,
      })
    }
    const bodyText = sanitizeText(
      await page
        .locator('body')
        .innerText({ timeout: 10_000 })
        .catch(() => ''),
    )
    const capturedAt = this.now()
    let observation: BrowserObservation = {
      observationId: `browser-observation-${this.createId()}`,
      sessionId: this.session?.sessionId ?? `browser-session-${this.createId()}`,
      url: page.url(),
      title: sanitizeText(await page.title().catch(() => ''), 1_000) || undefined,
      capturedAt,
      content: bodyText,
      interactiveElements: elements,
      truncated:
        bodyText.length >= BROWSER_OBSERVATION_CONTENT_MAX_CHARS ||
        (inspected as unknown[]).length > elements.length,
    }
    if (preserveIdWhenUnchanged && previous && fingerprint(previous) === fingerprint(observation)) {
      observation = { ...observation, observationId: previous.observationId }
    }
    for (const binding of this.refs.values()) binding.observationId = observation.observationId
    this.observation = observation
    const tabs = await this.listTabs(signal)
    this.session = {
      ...(this.session ?? { sessionId: observation.sessionId, openedAt: capturedAt }),
      status: 'ready',
      currentUrl: observation.url,
      currentTitle: observation.title,
      activeTabId: this.pageId(page),
      updatedAt: capturedAt,
    }
    if (!tabs.some((tab) => tab.active)) this.session.activeTabId = this.pageId(page)
    return observation
  }

  private mutateTarget(
    operation: 'click' | 'fill' | 'select',
    target: BrowserTarget,
    mutate: (binding: RefBinding) => Promise<unknown>,
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

  private resolveTarget(target: BrowserTarget, observation: BrowserObservation): RefBinding {
    if (target.kind === 'semantic-ref') {
      const binding = this.refs.get(target.ref)
      if (!binding || binding.observationId !== observation.observationId)
        throw new BrowserAutomationError('TARGET_NOT_FOUND')
      return binding
    }
    const matches = [...this.refs.values()].filter(
      (binding) =>
        binding.element.role === target.role &&
        binding.element.name &&
        normalizedName(binding.element.name) === normalizedName(target.name),
    )
    if (matches.length === 0) throw new BrowserAutomationError('TARGET_NOT_FOUND')
    if (matches.length > 1) throw new BrowserAutomationError('TARGET_AMBIGUOUS')
    return matches[0]
  }

  private refForComputerUse(ref: string, observation: BrowserComputerUseObservation): RefBinding {
    const binding = this.refs.get(ref)
    if (!binding || binding.pageId !== observation.page.id)
      throw new BrowserAutomationError('TARGET_NOT_FOUND')
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
          title: sanitizeText(await page.title().catch(() => ''), 1_000) || undefined,
          active: page === this.activePage,
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

  private async detectBlocker(page: Page) {
    const visible = async (selector: string): Promise<boolean> => {
      const locator = page.locator(selector)
      return (
        (await locator.count()) > 0 &&
        (await locator
          .first()
          .isVisible()
          .catch(() => false))
      )
    }
    if (
      await visible(
        'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],.g-recaptcha,.h-captcha,.cf-turnstile',
      )
    )
      return 'captcha' as const
    if (await visible('input[autocomplete="one-time-code"]')) return 'two-factor' as const
    if (await visible('input[autocomplete="cc-number"],input[autocomplete="cc-csc"]'))
      return 'payment-confirmation' as const
    if (
      await visible(
        '[data-password-manager-dialog],[aria-label*="password manager" i],[aria-label*="менеджер паролей" i]',
      )
    )
      return 'password-manager' as const
    if (await visible('[data-shio-secure-desktop-blocker]')) return 'secure-desktop' as const
    if (
      await visible(
        'input[type="password"],input[autocomplete="current-password"],input[autocomplete="new-password"]',
      )
    )
      return 'authentication' as const
    return undefined
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

  private assertCoordinates(
    decision: BrowserComputerUseDecision,
    observation: BrowserComputerUseObservation,
  ): void {
    const points: Array<{ x: number; y: number }> = []
    if ('x' in decision && 'y' in decision) points.push({ x: decision.x, y: decision.y })
    if (decision.type === 'drag') points.push(decision.from, decision.to)
    for (const point of points) {
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.y < 0 ||
        point.x > observation.viewport.width ||
        point.y > observation.viewport.height
      ) {
        throw new BrowserAutomationError('INPUT_FAILED')
      }
    }
  }

  private pageId(page: Page): string {
    let id = this.pageIds.get(page)
    if (!id) {
      id = `browser-page-${this.createId()}`
      this.pageIds.set(page, id)
    }
    return id
  }

  private bindPage(page: Page): void {
    if (this.boundPages.has(page)) return
    this.boundPages.add(page)
    this.pageId(page)
    page.on('close', () => {
      if (this.activePage === page) this.activePage = null
      this.invalidateObservation()
    })
    page.on('domcontentloaded', () => this.invalidateObservation())
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) this.invalidateObservation()
    })
  }

  private invalidateObservation(): void {
    this.observation = null
    this.computerUseObservation = null
    this.refs.clear()
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
