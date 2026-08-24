import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'

import {
  BROWSER_OBSERVATION_CONTENT_MAX_CHARS,
  BROWSER_OBSERVATION_MAX_INTERACTIVE_ELEMENTS,
  type BrowserActionExecution,
  type BrowserInteractiveElement,
  type BrowserInteractiveRole,
  type BrowserObservation,
  type BrowserSessionState,
  type BrowserTab,
  type BrowserTarget,
} from '../../shared/desktop-control'
import { mainLog } from '../logging/safeLogger'
import {
  AGENT_BROWSER_SESSION_IDLE_TIMEOUT_ARGUMENT,
  type AgentBrowserRuntimeResources,
  buildAgentBrowserChildEnvironment,
} from './AgentBrowserResources'

export type BrowserAutomationErrorCode =
  | 'NO_ACTIVE_SESSION'
  | 'SESSION_CLOSED'
  | 'OBSERVATION_FAILED'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_AMBIGUOUS'
  | 'TARGET_STALE'
  | 'CLICK_FAILED'
  | 'INPUT_FAILED'
  | 'NAVIGATION_FAILED'
  | 'VERIFICATION_FAILED'
  | 'BROWSER_UNAVAILABLE'

export class BrowserAutomationError extends Error {
  constructor(
    readonly code: BrowserAutomationErrorCode,
    message: string,
    readonly recoverable = true,
  ) {
    super(message)
    this.name = 'BrowserAutomationError'
  }
}

export interface BrowserInteractionResult {
  execution: Omit<BrowserActionExecution, 'riskClass'>
  observation?: BrowserObservation
}

interface AgentBrowserCommandRequest {
  operation: string
  args: readonly string[]
  timeoutMs: number
  signal?: AbortSignal
}

export interface AgentBrowserAdapterOptions {
  resources: () => AgentBrowserRuntimeResources | undefined
  environment?: NodeJS.ProcessEnv
  runCommand?: (request: AgentBrowserCommandRequest) => Promise<string>
  now?: () => number
  createId?: () => string
  settleAfterMutation?: (signal?: AbortSignal) => Promise<void>
}

interface JsonEnvelope {
  success?: unknown
  data?: unknown
  error?: unknown
}

const INTERACTIVE_ROLES = new Set<BrowserInteractiveRole>([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'tab',
  'menuitem',
  'other',
])

function publicMessage(code: BrowserAutomationErrorCode): string {
  switch (code) {
    case 'NO_ACTIVE_SESSION':
      return 'There is no active browser session'
    case 'SESSION_CLOSED':
      return 'The browser session is closed'
    case 'OBSERVATION_FAILED':
      return 'The current browser page could not be read'
    case 'TARGET_NOT_FOUND':
      return 'The requested element is not visible on the current page'
    case 'TARGET_AMBIGUOUS':
      return 'More than one matching element is visible on the current page'
    case 'TARGET_STALE':
      return 'The page changed before the requested element could be used'
    case 'CLICK_FAILED':
      return 'The browser element could not be clicked'
    case 'INPUT_FAILED':
      return 'The browser field could not be changed'
    case 'NAVIGATION_FAILED':
      return 'The browser could not open the requested page'
    case 'VERIFICATION_FAILED':
      return 'The browser action could not be verified'
    case 'BROWSER_UNAVAILABLE':
      return 'Browser Control is unavailable'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parseEnvelope(output: string): JsonEnvelope {
  try {
    const parsed = JSON.parse(output) as unknown
    if (!isRecord(parsed)) throw new Error('not an object')
    if (parsed.success === false) throw new Error('reported failure')
    return parsed
  } catch {
    throw new BrowserAutomationError('OBSERVATION_FAILED', publicMessage('OBSERVATION_FAILED'))
  }
}

function findString(value: unknown, keys: readonly string[]): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findString(item, keys)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (!isRecord(value)) return undefined
  for (const key of keys) {
    if (typeof value[key] === 'string') return value[key]
  }
  for (const item of Object.values(value)) {
    const found = findString(item, keys)
    if (found !== undefined) return found
  }
  return undefined
}

function findHttpUrl(value: unknown): string | undefined {
  const candidate = findString(value, ['url', 'href', 'value'])
  if (!candidate) return undefined
  try {
    const parsed = new URL(candidate)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : undefined
  } catch {
    return undefined
  }
}

function sanitizeText(value: string): string {
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
}

function normalizeRole(value: unknown): BrowserInteractiveRole {
  const role = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return INTERACTIVE_ROLES.has(role as BrowserInteractiveRole)
    ? (role as BrowserInteractiveRole)
    : 'other'
}

function findRefs(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRefs(item)
      if (found) return found
    }
    return undefined
  }
  if (!isRecord(value)) return undefined
  if (isRecord(value.refs)) return value.refs
  for (const item of Object.values(value)) {
    const found = findRefs(item)
    if (found) return found
  }
  return undefined
}

interface ParsedInteractiveElements {
  elements: BrowserInteractiveElement[]
  truncated: boolean
}

function parseInteractiveElements(output: string): ParsedInteractiveElements {
  const envelope = parseEnvelope(output)
  const refs = findRefs(envelope.data)
  if (!refs) return { elements: [], truncated: false }
  const elements = Object.entries(refs).flatMap(([rawRef, value]): BrowserInteractiveElement[] => {
    const ref = rawRef.replace(/^@/u, '')
    if (!/^e\d+$/u.test(ref) || !isRecord(value)) return []
    const name = typeof value.name === 'string' ? sanitizeText(value.name).slice(0, 500) : undefined
    return [
      {
        ref,
        role: normalizeRole(value.role),
        ...(name ? { name } : {}),
        ...(typeof value.disabled === 'boolean' ? { disabled: value.disabled } : {}),
      },
    ]
  })
  return {
    elements: elements.slice(0, BROWSER_OBSERVATION_MAX_INTERACTIVE_ELEMENTS),
    truncated: elements.length > BROWSER_OBSERVATION_MAX_INTERACTIVE_ELEMENTS,
  }
}

function findTabs(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (!isRecord(value)) return undefined
  if (Array.isArray(value.tabs)) return value.tabs
  for (const item of Object.values(value)) {
    const found = findTabs(item)
    if (found) return found
  }
  return undefined
}

function parseTabs(output: string): BrowserTab[] {
  const tabs = findTabs(parseEnvelope(output).data) ?? []
  return tabs.flatMap((item): BrowserTab[] => {
    if (!isRecord(item)) return []
    const tabId = [item.id, item.tabId, item.ref, item.targetId].find(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
    )
    if (!tabId) return []
    const rawUrl = typeof item.url === 'string' ? item.url : undefined
    const url = rawUrl ? findHttpUrl(rawUrl) : undefined
    const title =
      typeof item.title === 'string' ? sanitizeText(item.title).slice(0, 1_000) : undefined
    return [
      {
        tabId: tabId.slice(0, 200),
        ...(url ? { url } : {}),
        ...(title ? { title } : {}),
        active: item.active === true || item.isActive === true || item.selected === true,
      },
    ]
  })
}

function observationFingerprint(observation: BrowserObservation): string {
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

function normalizeAccessibleName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
}

function defaultSettleAfterMutation(signal?: AbortSignal): Promise<void> {
  return new Promise((resolveWait, reject) => {
    if (signal?.aborted) {
      reject(new BrowserAutomationError('CLICK_FAILED', publicMessage('CLICK_FAILED')))
      return
    }
    const abort = (): void => {
      clearTimeout(timer)
      reject(new BrowserAutomationError('CLICK_FAILED', publicMessage('CLICK_FAILED')))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolveWait()
    }, 250)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export class AgentBrowserAdapter {
  private session: BrowserSessionState | null = null
  private observation: BrowserObservation | null = null
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly options: AgentBrowserAdapterOptions) {}

  sessionSnapshot(): BrowserSessionState | null {
    return this.session ? { ...this.session } : null
  }

  observationSnapshot(): BrowserObservation | null {
    return this.observation
      ? { ...this.observation, interactiveElements: [...this.observation.interactiveElements] }
      : null
  }

  prepareForDelegation(signal?: AbortSignal): Promise<void> {
    return this.enqueue(async () => {
      this.ensureSession('starting')
      try {
        await this.ensureDirectories()
        await this.command('get-url', ['get', 'url'], 15_000, signal)
        this.updateSession({ status: 'ready' })
      } catch (error) {
        this.markError()
        throw this.normalizeError(error, 'BROWSER_UNAVAILABLE')
      }
    })
  }

  open(url: string, signal?: AbortSignal): Promise<BrowserInteractionResult> {
    return this.enqueue(async () => {
      let parsedUrl: URL
      try {
        parsedUrl = new URL(url)
      } catch {
        throw new BrowserAutomationError('NAVIGATION_FAILED', publicMessage('NAVIGATION_FAILED'))
      }
      if (
        !['http:', 'https:'].includes(parsedUrl.protocol) ||
        parsedUrl.username ||
        parsedUrl.password
      ) {
        throw new BrowserAutomationError('NAVIGATION_FAILED', publicMessage('NAVIGATION_FAILED'))
      }
      this.ensureSession('starting')
      this.observation = null
      try {
        await this.ensureDirectories()
        await this.command('open', ['open', parsedUrl.href], 30_000, signal)
        const observation = await this.captureObservation(false, signal)
        const verified = new URL(observation.url).origin === parsedUrl.origin
        return {
          execution: {
            kind: 'browser',
            operation: 'open',
            status: 'success',
            verification: verified ? 'verified' : 'unverified',
            resultingUrl: observation.url,
            ...(observation.title ? { resultingTitle: observation.title } : {}),
          },
          observation,
        }
      } catch (error) {
        if (error instanceof BrowserAutomationError && error.code === 'OBSERVATION_FAILED') {
          this.markError()
          return {
            execution: {
              kind: 'browser',
              operation: 'open',
              status: 'success',
              verification: 'unverified',
            },
          }
        }
        this.markError()
        throw this.normalizeError(error, 'NAVIGATION_FAILED')
      }
    })
  }

  observe(signal?: AbortSignal): Promise<BrowserObservation> {
    return this.enqueue(async () => {
      this.assertActiveSession()
      try {
        return await this.captureObservation(true, signal)
      } catch (error) {
        this.markError()
        throw this.normalizeError(error, 'OBSERVATION_FAILED')
      }
    })
  }

  getCurrentUrl(signal?: AbortSignal): Promise<string> {
    return this.enqueue(async () => {
      this.assertActiveSession()
      try {
        const url = this.parseCurrentUrl(
          await this.command('get-url', ['get', 'url'], 15_000, signal),
        )
        this.updateSession({ status: 'ready', currentUrl: url })
        return url
      } catch (error) {
        this.markError()
        throw this.normalizeError(error, 'OBSERVATION_FAILED')
      }
    })
  }

  listTabs(signal?: AbortSignal): Promise<readonly BrowserTab[]> {
    return this.enqueue(async () => {
      this.assertActiveSession()
      try {
        return await this.captureTabs(signal)
      } catch (error) {
        this.markError()
        throw this.normalizeError(error, 'OBSERVATION_FAILED')
      }
    })
  }

  async observePage(signal?: AbortSignal): Promise<BrowserInteractionResult> {
    const observation = await this.observe(signal)
    return {
      execution: {
        kind: 'browser',
        operation: 'observe',
        status: 'success',
        verification: 'verified',
        resultingUrl: observation.url,
        ...(observation.title ? { resultingTitle: observation.title } : {}),
      },
      observation,
    }
  }

  async inspectTabs(signal?: AbortSignal): Promise<BrowserInteractionResult> {
    const tabs = [...(await this.listTabs(signal))]
    const active = tabs.find((tab) => tab.active)
    return {
      execution: {
        kind: 'browser',
        operation: 'tabs',
        status: 'success',
        verification: 'verified',
        ...(active?.url ? { resultingUrl: active.url } : {}),
        ...(active?.title ? { resultingTitle: active.title } : {}),
        tabs: tabs.slice(0, 20),
      },
    }
  }

  switchTab(tabId: string, signal?: AbortSignal): Promise<BrowserInteractionResult> {
    return this.enqueue(async () => {
      this.assertActiveSession()
      const normalizedTabId = tabId.trim()
      const before = this.observation
      this.observation = null
      try {
        await this.command('switch-tab', ['tab', normalizedTabId], 15_000, signal)
        const observation = await this.captureObservation(false, signal)
        const verified = this.session?.activeTabId === normalizedTabId
        return {
          execution: {
            kind: 'browser',
            operation: 'switch-tab',
            status: 'success',
            verification:
              verified || (before && observation.url !== before.url) ? 'verified' : 'unverified',
            resultingUrl: observation.url,
            ...(observation.title ? { resultingTitle: observation.title } : {}),
          },
          observation,
        }
      } catch (error) {
        if (error instanceof BrowserAutomationError && error.code === 'OBSERVATION_FAILED') {
          this.markError()
          return {
            execution: {
              kind: 'browser',
              operation: 'switch-tab',
              status: 'success',
              verification: 'unverified',
            },
          }
        }
        throw this.normalizeError(error, 'NAVIGATION_FAILED')
      }
    })
  }

  click(target: BrowserTarget, signal?: AbortSignal): Promise<BrowserInteractionResult> {
    return this.enqueue(async () => {
      this.assertActiveSession()
      const current = this.observation
      if (!current || current.observationId !== target.observationId) {
        throw new BrowserAutomationError('TARGET_STALE', publicMessage('TARGET_STALE'))
      }

      let preflight: BrowserObservation
      try {
        preflight = await this.captureObservation(true, signal)
      } catch (error) {
        this.markError()
        throw this.normalizeError(error, 'OBSERVATION_FAILED')
      }
      if (preflight.observationId !== target.observationId) {
        throw new BrowserAutomationError('TARGET_STALE', publicMessage('TARGET_STALE'))
      }
      const element = this.resolveTarget(target, preflight)
      if (element.disabled) {
        throw new BrowserAutomationError('CLICK_FAILED', publicMessage('CLICK_FAILED'))
      }

      this.observation = null
      try {
        await this.command('click', ['click', `@${element.ref}`], 30_000, signal)
        await (this.options.settleAfterMutation ?? defaultSettleAfterMutation)(signal)
      } catch (error) {
        throw this.normalizeError(error, 'CLICK_FAILED')
      }

      try {
        const observation = await this.captureObservation(false, signal)
        const changed = observationFingerprint(preflight) !== observationFingerprint(observation)
        return {
          execution: {
            kind: 'browser',
            operation: 'click',
            status: 'success',
            verification: changed ? 'verified' : 'unverified',
            resultingUrl: observation.url,
            ...(observation.title ? { resultingTitle: observation.title } : {}),
            ...(element.name ? { targetName: element.name } : {}),
          },
          observation,
        }
      } catch (error) {
        this.markError()
        mainLog.warn('[BrowserControl] post-click observation failed', {
          code: error instanceof BrowserAutomationError ? error.code : 'OBSERVATION_FAILED',
        })
        return {
          execution: {
            kind: 'browser',
            operation: 'click',
            status: 'success',
            verification: 'unverified',
            ...(element.name ? { targetName: element.name } : {}),
          },
        }
      }
    })
  }

  fill(
    target: BrowserTarget,
    value: string,
    signal?: AbortSignal,
  ): Promise<BrowserInteractionResult> {
    return this.mutateTarget('fill', target, ['textbox'], ['fill'], [value], signal)
  }

  select(
    target: BrowserTarget,
    values: readonly string[],
    signal?: AbortSignal,
  ): Promise<BrowserInteractionResult> {
    return this.mutateTarget('select', target, ['combobox'], ['select'], values, signal)
  }

  scroll(
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number,
    signal?: AbortSignal,
  ): Promise<BrowserInteractionResult> {
    return this.enqueue(async () => {
      this.assertActiveSession()
      this.observation = null
      try {
        await this.command('scroll', ['scroll', direction, String(amount)], 15_000, signal)
        await (this.options.settleAfterMutation ?? defaultSettleAfterMutation)(signal)
        const observation = await this.captureObservation(false, signal)
        return {
          execution: {
            kind: 'browser',
            operation: 'scroll',
            status: 'success',
            verification: 'verified',
            resultingUrl: observation.url,
            ...(observation.title ? { resultingTitle: observation.title } : {}),
          },
          observation,
        }
      } catch (error) {
        this.markError()
        throw this.normalizeError(error, 'NAVIGATION_FAILED')
      }
    })
  }

  back(signal?: AbortSignal): Promise<BrowserInteractionResult> {
    return this.navigateHistory('back', signal)
  }

  forward(signal?: AbortSignal): Promise<BrowserInteractionResult> {
    return this.navigateHistory('forward', signal)
  }

  close(): Promise<void> {
    return this.enqueue(async () => {
      const resources = this.options.resources()
      try {
        if (resources) {
          await this.command('close', ['close'], 5_000)
          await new Promise((resolveWait) => setTimeout(resolveWait, 500))
        }
      } catch (error) {
        mainLog.warn('[BrowserControl] browser shutdown failed', {
          code: error instanceof BrowserAutomationError ? error.code : 'BROWSER_UNAVAILABLE',
        })
      } finally {
        const now = this.now()
        if (this.session) this.session = { ...this.session, status: 'closed', updatedAt: now }
        this.observation = null
      }
    })
  }

  private async captureObservation(
    preserveIdWhenUnchanged: boolean,
    signal?: AbortSignal,
  ): Promise<BrowserObservation> {
    const session = this.assertActiveSession()
    const previous = this.observation
    const urlOutput = await this.command('get-url', ['get', 'url'], 15_000, signal)
    const titleOutput = await this.command('get-title', ['get', 'title'], 15_000, signal)
    const contentOutput = await this.command('get-text', ['get', 'text', 'body'], 20_000, signal)
    const snapshotOutput = await this.command('snapshot', ['snapshot', '-i'], 20_000, signal)
    const url = this.parseCurrentUrl(urlOutput)
    const title = this.parseTitle(titleOutput)
    const rawContent = this.parseContent(contentOutput)
    const contentTruncated = rawContent.length > BROWSER_OBSERVATION_CONTENT_MAX_CHARS
    const content = rawContent.slice(0, BROWSER_OBSERVATION_CONTENT_MAX_CHARS)
    const interactive = parseInteractiveElements(snapshotOutput)
    const capturedAt = this.now()
    let observation: BrowserObservation = {
      observationId: `browser-observation-${this.createId()}`,
      sessionId: session.sessionId,
      url,
      ...(title ? { title } : {}),
      capturedAt,
      content,
      interactiveElements: interactive.elements,
      truncated: contentTruncated || interactive.truncated,
    }
    if (
      preserveIdWhenUnchanged &&
      previous &&
      observationFingerprint(previous) === observationFingerprint(observation)
    ) {
      observation = { ...observation, observationId: previous.observationId }
    }
    this.observation = observation
    const tabs = await this.captureTabs(signal).catch(() => [])
    const activeTabId = tabs.find((tab) => tab.active)?.tabId
    this.updateSession({
      status: 'ready',
      currentUrl: url,
      ...(title ? { currentTitle: title } : {}),
      ...(activeTabId ? { activeTabId } : {}),
    })
    return observation
  }

  private mutateTarget(
    operation: 'fill' | 'select',
    target: BrowserTarget,
    allowedRoles: readonly BrowserInteractiveRole[],
    command: readonly string[],
    values: readonly string[],
    signal?: AbortSignal,
  ): Promise<BrowserInteractionResult> {
    return this.enqueue(async () => {
      this.assertActiveSession()
      const current = this.observation
      if (!current || current.observationId !== target.observationId) {
        throw new BrowserAutomationError('TARGET_STALE', publicMessage('TARGET_STALE'))
      }

      let preflight: BrowserObservation
      try {
        preflight = await this.captureObservation(true, signal)
      } catch (error) {
        this.markError()
        throw this.normalizeError(error, 'OBSERVATION_FAILED')
      }
      if (preflight.observationId !== target.observationId) {
        throw new BrowserAutomationError('TARGET_STALE', publicMessage('TARGET_STALE'))
      }
      const element = this.resolveTarget(target, preflight)
      if (element.disabled || !allowedRoles.includes(element.role)) {
        throw new BrowserAutomationError('INPUT_FAILED', publicMessage('INPUT_FAILED'))
      }

      this.observation = null
      try {
        await this.command(operation, [...command, `@${element.ref}`, ...values], 30_000, signal)
        await (this.options.settleAfterMutation ?? defaultSettleAfterMutation)(signal)
        const observation = await this.captureObservation(false, signal)
        return {
          execution: {
            kind: 'browser',
            operation,
            status: 'success',
            verification: 'verified',
            resultingUrl: observation.url,
            ...(observation.title ? { resultingTitle: observation.title } : {}),
            ...(element.name ? { targetName: element.name } : {}),
          },
          observation,
        }
      } catch (error) {
        this.markError()
        throw this.normalizeError(error, 'INPUT_FAILED')
      }
    })
  }

  private navigateHistory(
    operation: 'back' | 'forward',
    signal?: AbortSignal,
  ): Promise<BrowserInteractionResult> {
    return this.enqueue(async () => {
      this.assertActiveSession()
      const previousUrl = this.observation?.url
      this.observation = null
      try {
        await this.command(operation, [operation], 30_000, signal)
        await (this.options.settleAfterMutation ?? defaultSettleAfterMutation)(signal)
        const observation = await this.captureObservation(false, signal)
        return {
          execution: {
            kind: 'browser',
            operation,
            status: 'success',
            verification:
              previousUrl && previousUrl !== observation.url ? 'verified' : 'unverified',
            resultingUrl: observation.url,
            ...(observation.title ? { resultingTitle: observation.title } : {}),
          },
          observation,
        }
      } catch (error) {
        this.markError()
        throw this.normalizeError(error, 'NAVIGATION_FAILED')
      }
    })
  }

  private async captureTabs(signal?: AbortSignal): Promise<BrowserTab[]> {
    return parseTabs(await this.command('list-tabs', ['tab', 'list'], 15_000, signal))
  }

  private parseCurrentUrl(output: string): string {
    const url = findHttpUrl(parseEnvelope(output).data)
    if (!url) {
      throw new BrowserAutomationError('OBSERVATION_FAILED', publicMessage('OBSERVATION_FAILED'))
    }
    return url
  }

  private parseTitle(output: string): string | undefined {
    const title = findString(parseEnvelope(output).data, ['title', 'value'])
    return title ? sanitizeText(title).slice(0, 1_000) : undefined
  }

  private parseContent(output: string): string {
    const content = findString(parseEnvelope(output).data, ['text', 'value'])
    if (content === undefined) {
      throw new BrowserAutomationError('OBSERVATION_FAILED', publicMessage('OBSERVATION_FAILED'))
    }
    return sanitizeText(content)
  }

  private resolveTarget(
    target: BrowserTarget,
    observation: BrowserObservation,
  ): BrowserInteractiveElement {
    if (target.kind === 'semantic-ref') {
      const element = observation.interactiveElements.find(
        (candidate) => candidate.ref === target.ref,
      )
      if (!element) {
        throw new BrowserAutomationError('TARGET_NOT_FOUND', publicMessage('TARGET_NOT_FOUND'))
      }
      return element
    }
    const targetName = normalizeAccessibleName(target.name)
    const matches = observation.interactiveElements.filter(
      (candidate) =>
        candidate.role === target.role &&
        candidate.name !== undefined &&
        normalizeAccessibleName(candidate.name) === targetName,
    )
    if (matches.length === 0) {
      throw new BrowserAutomationError('TARGET_NOT_FOUND', publicMessage('TARGET_NOT_FOUND'))
    }
    if (matches.length > 1) {
      throw new BrowserAutomationError('TARGET_AMBIGUOUS', publicMessage('TARGET_AMBIGUOUS'))
    }
    return matches[0]
  }

  private ensureSession(status: BrowserSessionState['status']): BrowserSessionState {
    if (!this.session || ['closed', 'error'].includes(this.session.status)) {
      const now = this.now()
      this.session = {
        sessionId: `browser-session-${this.createId()}`,
        status,
        openedAt: now,
        updatedAt: now,
      }
    } else {
      this.updateSession({ status })
    }
    return this.session
  }

  private assertActiveSession(): BrowserSessionState {
    if (!this.session) {
      throw new BrowserAutomationError('NO_ACTIVE_SESSION', publicMessage('NO_ACTIVE_SESSION'))
    }
    if (this.session.status === 'closed') {
      throw new BrowserAutomationError('SESSION_CLOSED', publicMessage('SESSION_CLOSED'))
    }
    if (this.session.status === 'error') {
      throw new BrowserAutomationError('BROWSER_UNAVAILABLE', publicMessage('BROWSER_UNAVAILABLE'))
    }
    return this.session
  }

  private updateSession(update: Partial<BrowserSessionState>): void {
    if (!this.session) return
    this.session = { ...this.session, ...update, updatedAt: this.now() }
  }

  private markError(): void {
    this.observation = null
    this.updateSession({ status: 'error' })
  }

  private normalizeError(
    error: unknown,
    fallback: BrowserAutomationErrorCode,
  ): BrowserAutomationError {
    if (error instanceof BrowserAutomationError) return error
    mainLog.warn('[BrowserControl] agent-browser operation failed', { code: fallback })
    return new BrowserAutomationError(fallback, publicMessage(fallback))
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  private createId(): string {
    return (this.options.createId ?? randomUUID)()
  }

  private async ensureDirectories(): Promise<void> {
    const resources = this.options.resources()
    if (!resources) {
      throw new BrowserAutomationError('BROWSER_UNAVAILABLE', publicMessage('BROWSER_UNAVAILABLE'))
    }
    await Promise.all([
      mkdir(resources.profileDirectory, { recursive: true }),
      mkdir(resources.socketDirectory, { recursive: true }),
    ])
  }

  private command(
    operation: string,
    args: readonly string[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<string> {
    const resources = this.options.resources()
    if (!resources) {
      return Promise.reject(
        new BrowserAutomationError('BROWSER_UNAVAILABLE', publicMessage('BROWSER_UNAVAILABLE')),
      )
    }
    const request: AgentBrowserCommandRequest = {
      operation,
      args: [
        '--json',
        '--session',
        resources.namespace,
        '--idle-timeout',
        AGENT_BROWSER_SESSION_IDLE_TIMEOUT_ARGUMENT,
        ...args,
      ],
      timeoutMs,
      ...(signal ? { signal } : {}),
    }
    if (this.options.runCommand) return this.options.runCommand(request)
    return this.runProcess(resources, request)
  }

  private runProcess(
    resources: AgentBrowserRuntimeResources,
    request: AgentBrowserCommandRequest,
  ): Promise<string> {
    return new Promise((resolveRun, reject) => {
      const child = spawn(resources.command, [...request.args], {
        cwd: resources.socketDirectory,
        env: buildAgentBrowserChildEnvironment(this.options.environment ?? process.env, resources),
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      })
      let stdout = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        if (stdout.length < 64_000) stdout += chunk.slice(0, 64_000 - stdout.length)
      })
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        request.signal?.removeEventListener('abort', abort)
        if (error) reject(error)
        else resolveRun(stdout)
      }
      const abort = (): void => {
        child.kill()
        finish(
          new BrowserAutomationError('BROWSER_UNAVAILABLE', publicMessage('BROWSER_UNAVAILABLE')),
        )
      }
      const timer = setTimeout(() => {
        child.kill()
        finish(
          new BrowserAutomationError('BROWSER_UNAVAILABLE', publicMessage('BROWSER_UNAVAILABLE')),
        )
      }, request.timeoutMs)
      request.signal?.addEventListener('abort', abort, { once: true })
      if (request.signal?.aborted) abort()
      child.once('error', () =>
        finish(
          new BrowserAutomationError('BROWSER_UNAVAILABLE', publicMessage('BROWSER_UNAVAILABLE')),
        ),
      )
      child.once('exit', (code) => {
        if (code === 0) finish()
        else {
          const codeByOperation: Partial<Record<string, BrowserAutomationErrorCode>> = {
            open: 'NAVIGATION_FAILED',
            click: 'CLICK_FAILED',
            fill: 'INPUT_FAILED',
            select: 'INPUT_FAILED',
            scroll: 'NAVIGATION_FAILED',
            back: 'NAVIGATION_FAILED',
            forward: 'NAVIGATION_FAILED',
            'switch-tab': 'NAVIGATION_FAILED',
            'get-url': 'OBSERVATION_FAILED',
            'get-title': 'OBSERVATION_FAILED',
            'get-text': 'OBSERVATION_FAILED',
            snapshot: 'OBSERVATION_FAILED',
            'list-tabs': 'OBSERVATION_FAILED',
          }
          const errorCode = codeByOperation[request.operation] ?? 'BROWSER_UNAVAILABLE'
          finish(new BrowserAutomationError(errorCode, publicMessage(errorCode)))
        }
      })
    })
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
