import type { Page } from 'playwright-core'

export class PlaywrightPageRegistry {
  private active: Page | null = null
  private readonly ids = new WeakMap<Page, string>()
  private readonly bound = new WeakSet<Page>()

  constructor(
    private readonly createId: () => string,
    private readonly invalidate: () => void,
  ) {}

  activePage(): Page | null {
    return this.active && !this.active.isClosed() ? this.active : null
  }

  setActive(page: Page | null): void {
    this.active = page
  }

  id(page: Page): string {
    let id = this.ids.get(page)
    if (!id) {
      id = `browser-page-${this.createId()}`
      this.ids.set(page, id)
    }
    return id
  }

  bind(page: Page): void {
    if (this.bound.has(page)) return
    this.bound.add(page)
    this.id(page)
    page.on('close', () => {
      if (this.active === page) this.active = null
      this.invalidate()
    })
    page.on('domcontentloaded', this.invalidate)
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) this.invalidate()
    })
  }

  reset(): void {
    this.active = null
  }
}
