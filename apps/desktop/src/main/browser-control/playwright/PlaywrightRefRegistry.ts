import type { Locator } from 'playwright-core'

import type { BrowserInteractiveElement } from '../../../shared/browser-control'

export interface PlaywrightRefBinding {
  observationId: string
  pageId: string
  locator: Locator
  element: BrowserInteractiveElement
}

/** Holds only the exact ref set for one latest observation. */
export class PlaywrightRefRegistry {
  private observationId: string | null = null
  private bindings = new Map<string, PlaywrightRefBinding>()

  replace(
    observationId: string,
    pageId: string,
    entries: readonly Omit<PlaywrightRefBinding, 'observationId' | 'pageId'>[],
  ): void {
    this.observationId = observationId
    this.bindings = new Map(
      entries.map((entry) => [entry.element.ref, { ...entry, observationId, pageId }]),
    )
  }

  clear(): void {
    this.observationId = null
    this.bindings.clear()
  }

  get(ref: string, observationId: string, pageId?: string): PlaywrightRefBinding | undefined {
    if (this.observationId !== observationId) return undefined
    const binding = this.bindings.get(ref)
    if (!binding || (pageId && binding.pageId !== pageId)) return undefined
    return binding
  }

  values(observationId: string): readonly PlaywrightRefBinding[] {
    return this.observationId === observationId ? [...this.bindings.values()] : []
  }
}
