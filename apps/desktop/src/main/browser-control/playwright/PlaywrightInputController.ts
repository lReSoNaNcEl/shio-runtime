import type { Page } from 'playwright-core'

import type {
  BrowserComputerUseDecision,
  BrowserComputerUseObservation,
} from '../../../shared/browser-computer-use'
import { BrowserAutomationError } from '../errors'

type DirectInputDecision = Extract<
  BrowserComputerUseDecision,
  {
    type:
      | 'click'
      | 'move'
      | 'drag'
      | 'mouse-down'
      | 'mouse-up'
      | 'scroll'
      | 'key'
      | 'key-down'
      | 'key-up'
      | 'type'
  }
>

export class PlaywrightInputController {
  private readonly heldKeys = new Set<string>()
  private readonly heldButtons = new Set<'left' | 'right'>()

  isDirectInput(decision: BrowserComputerUseDecision): decision is DirectInputDecision {
    return [
      'click',
      'move',
      'drag',
      'mouse-down',
      'mouse-up',
      'scroll',
      'key',
      'key-down',
      'key-up',
      'type',
    ].includes(decision.type)
  }

  async execute(page: Page, decision: DirectInputDecision): Promise<void> {
    switch (decision.type) {
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
    }
  }

  assertCoordinates(
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

  async release(page: Page | null): Promise<void> {
    if (!page || page.isClosed()) {
      this.reset()
      return
    }
    await Promise.allSettled([
      ...[...this.heldKeys].map((key) => page.keyboard.up(key)),
      ...[...this.heldButtons].map((button) => page.mouse.up({ button })),
    ])
    this.reset()
  }

  reset(): void {
    this.heldButtons.clear()
    this.heldKeys.clear()
  }
}
