import { createHash } from 'node:crypto'

import type { Page } from 'playwright-core'

import {
  BROWSER_OBSERVATION_CONTENT_MAX_CHARS,
  BROWSER_OBSERVATION_MAX_INTERACTIVE_ELEMENTS,
  type BrowserInteractiveElement,
  type BrowserInteractiveRole,
  type BrowserObservation,
  type BrowserSessionState,
} from '../../../shared/browser-control'
import type { PlaywrightRefBinding } from './PlaywrightRefRegistry'
import {
  isSensitiveElement,
  redactSensitiveValues,
  SENSITIVE_ELEMENT_SELECTOR,
  safeSensitivePlaceholder,
} from './PlaywrightSensitiveElements'

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

export function sanitizeBrowserText(
  value: string,
  maximum = BROWSER_OBSERVATION_CONTENT_MAX_CHARS,
): string {
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

export function combinedSemanticSnapshot(
  ariaSnapshot: string,
  elements: readonly BrowserInteractiveElement[],
): string {
  return sanitizeBrowserText(
    [
      ariaSnapshot,
      'Semantic refs:',
      ...elements.map(
        (element) =>
          `${element.ref} ${element.role}${element.name ? ` ${element.name}` : ''}${element.placeholder ? ` placeholder=${element.placeholder}` : ''}${element.disabled ? ' disabled' : ''}${element.sensitive ? ' sensitive=true value=[REDACTED]' : ''}`,
      ),
    ].join('\n'),
    16_000,
  )
}

export function normalizedSemanticName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
}

export async function playwrightSensitiveValues(page: Page): Promise<readonly string[]> {
  return page.locator(SENSITIVE_ELEMENT_SELECTOR).evaluateAll((elements) =>
    elements
      .map((element) => {
        const input = element as HTMLInputElement | HTMLTextAreaElement
        return typeof input.value === 'string' ? input.value : ''
      })
      .filter(Boolean),
  )
}

export interface PlaywrightSemanticSnapshot {
  observation: BrowserObservation
  refBindings: readonly Omit<PlaywrightRefBinding, 'observationId' | 'pageId'>[]
  session: BrowserSessionState
}

export async function capturePlaywrightSemanticSnapshot(
  page: Page,
  options: {
    previous: BrowserObservation | null
    preserveIdWhenUnchanged: boolean
    session: BrowserSessionState | null
    pageId: string
    now: () => number
    createId: () => string
    signal?: AbortSignal
  },
): Promise<PlaywrightSemanticSnapshot> {
  if (options.signal?.aborted) throw options.signal.reason
  const previous = options.previous
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
        ) {
          return null
        }
        const tagName = html.tagName.toLowerCase()
        const inputType = input.type?.toLowerCase?.() ?? ''
        const autocomplete = (html.getAttribute('autocomplete') ?? '').trim().toLowerCase()
        const nameAttribute = html.getAttribute('name') ?? ''
        const idAttribute = html.id ?? ''
        const rawRole = html.getAttribute('role')
        const label = html.getAttribute('aria-label') || html.getAttribute('title')
        const placeholder = input.placeholder || undefined
        const text = (html.innerText || html.textContent || '').trim()
        return {
          index,
          tagName,
          inputType,
          autocomplete,
          nameAttribute,
          idAttribute,
          rawRole,
          label: label || text || undefined,
          placeholder,
          disabled: input.disabled || html.getAttribute('aria-disabled') === 'true',
        }
      })
      .filter(Boolean),
  )
  const elements: BrowserInteractiveElement[] = []
  const refBindings: Array<Omit<PlaywrightRefBinding, 'observationId' | 'pageId'>> = []
  for (const candidate of inspected as Array<{
    index: number
    tagName: string
    inputType: string
    autocomplete: string
    nameAttribute: string
    idAttribute: string
    rawRole: string | null
    label?: string
    placeholder?: string
    disabled?: boolean
  }>) {
    if (elements.length >= BROWSER_OBSERVATION_MAX_INTERACTIVE_ELEMENTS) break
    const ref = `e${elements.length + 1}`
    const sensitive = isSensitiveElement(candidate)
    const placeholder = sensitive
      ? safeSensitivePlaceholder(candidate.placeholder)
      : candidate.placeholder
    const elementName = candidate.label || placeholder
    const element: BrowserInteractiveElement = {
      ref,
      role: normalizeRole(candidate.rawRole, candidate.tagName, candidate.inputType),
      ...(elementName ? { name: sanitizeBrowserText(elementName, 500) } : {}),
      ...(placeholder ? { placeholder: sanitizeBrowserText(placeholder, 500) } : {}),
      ...(candidate.disabled ? { disabled: true } : {}),
      ...(sensitive ? { sensitive: true as const } : {}),
    }
    elements.push(element)
    refBindings.push({ locator: base.nth(candidate.index), element })
  }
  const sensitiveValues = await playwrightSensitiveValues(page)
  const bodyText = sanitizeBrowserText(
    redactSensitiveValues(
      await page
        .locator('body')
        .innerText({ timeout: 10_000 })
        .catch(() => ''),
      sensitiveValues,
    ),
  )
  const capturedAt = options.now()
  let observation: BrowserObservation = {
    observationId: `browser-observation-${options.createId()}`,
    sessionId: options.session?.sessionId ?? `browser-session-${options.createId()}`,
    url: page.url(),
    title: sanitizeBrowserText(await page.title().catch(() => ''), 1_000) || undefined,
    capturedAt,
    content: bodyText,
    interactiveElements: elements,
    truncated:
      bodyText.length >= BROWSER_OBSERVATION_CONTENT_MAX_CHARS ||
      (inspected as unknown[]).length > elements.length,
  }
  if (
    options.preserveIdWhenUnchanged &&
    previous &&
    semanticFingerprint(previous) === semanticFingerprint(observation)
  ) {
    observation = { ...observation, observationId: previous.observationId }
  }
  const session: BrowserSessionState = {
    ...(options.session ?? { sessionId: observation.sessionId, openedAt: capturedAt }),
    status: 'ready',
    currentUrl: observation.url,
    currentTitle: observation.title,
    activeTabId: options.pageId,
    updatedAt: capturedAt,
  }
  return { observation, refBindings, session }
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

function semanticFingerprint(observation: BrowserObservation): string {
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
