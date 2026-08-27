import type { Page } from 'playwright-core'

import type { BrowserComputerUseObservation } from '../../../shared/browser-computer-use'
import type { BrowserObservation } from '../../../shared/browser-control'
import { detectPlaywrightBlocker } from './PlaywrightBlockerPolicy'
import type { PlaywrightRefBinding } from './PlaywrightRefRegistry'
import {
  combinedSemanticSnapshot,
  type PlaywrightSemanticSnapshot,
  playwrightSensitiveValues,
} from './PlaywrightSemanticObserver'
import { redactSensitiveValues, SENSITIVE_ELEMENT_SELECTOR } from './PlaywrightSensitiveElements'
import { createVisualFingerprint } from './PlaywrightVisualFingerprint'

export async function capturePlaywrightComputerUseObservation(
  page: Page,
  semantic: Pick<PlaywrightSemanticSnapshot, 'observation' | 'refBindings'>,
  options: {
    includeVisual: boolean
    pageId: string
    now: () => number
    createId: () => string
  },
): Promise<{
  observation: BrowserComputerUseObservation
  refBindings: readonly Omit<PlaywrightRefBinding, 'observationId' | 'pageId'>[]
}> {
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const sensitiveValues = await playwrightSensitiveValues(page)
  const ariaSnapshot = redactSensitiveValues(
    await page
      .locator('body')
      .ariaSnapshot({ timeout: 10_000 })
      .catch(() => ''),
    sensitiveValues,
  )
  const blocker = await detectPlaywrightBlocker(page)
  const visualFingerprint = await createVisualFingerprint(await captureFingerprintImage(page))
  const visual = options.includeVisual
    ? {
        mimeType: 'image/jpeg' as const,
        bytes: new Uint8Array(
          await page.screenshot({
            type: 'jpeg',
            quality: 70,
            scale: 'css',
            animations: 'disabled',
            caret: 'hide',
            mask: [page.locator(SENSITIVE_ELEMENT_SELECTOR)],
            timeout: 15_000,
          }),
        ),
      }
    : undefined
  const observation: BrowserComputerUseObservation = {
    id: `browser-use-observation-${options.createId()}`,
    page: {
      id: options.pageId,
      url: semantic.observation.url,
      title: semantic.observation.title ?? '',
    },
    viewport,
    semantic:
      ariaSnapshot || semantic.observation.interactiveElements.length > 0
        ? {
            ariaSnapshot: combinedSemanticSnapshot(
              ariaSnapshot,
              semantic.observation.interactiveElements,
            ),
            interactiveCount: semantic.observation.interactiveElements.length,
          }
        : undefined,
    visual,
    visualFingerprint,
    blocker,
    capturedAt: options.now(),
  }
  return { observation, refBindings: semantic.refBindings }
}

export async function captureFingerprintImage(page: Page): Promise<Uint8Array> {
  return new Uint8Array(
    await page.screenshot({
      type: 'jpeg',
      quality: 35,
      scale: 'css',
      animations: 'disabled',
      caret: 'hide',
      mask: [page.locator(SENSITIVE_ELEMENT_SELECTOR)],
      timeout: 10_000,
    }),
  )
}

export type ComputerUseSemanticObservation = Pick<
  BrowserObservation,
  'url' | 'title' | 'interactiveElements'
>
