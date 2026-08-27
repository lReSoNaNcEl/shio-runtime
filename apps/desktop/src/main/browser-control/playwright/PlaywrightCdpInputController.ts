import type { CDPSession, Page } from 'playwright-core'

import type { BrowserHeldInputRegistry } from './BrowserHeldInputRegistry'

export interface BrowserReactiveInputScope {
  sessionId: string
  pageId: string
  planId: string
  frameId: number
  receivedAt: number
}

export type BrowserReactiveInputIntent =
  | { type: 'move'; x: number; y: number }
  | { type: 'click'; x: number; y: number; button: 'left' | 'right' }
  | { type: 'mouse-down'; x: number; y: number; button: 'left' | 'right' }
  | { type: 'mouse-up'; x: number; y: number; button: 'left' | 'right' }
  | { type: 'key-down'; key: ReactiveKey }
  | { type: 'key-up'; key: ReactiveKey }

export type ReactiveKey =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'w'
  | 'a'
  | 's'
  | 'd'

interface InputBinding {
  sessionId: string
  pageId: string
  planId: string
  page: Page
  session: CDPSession
  lastFrameId: number
}

export interface PlaywrightCdpInputControllerOptions {
  heldInputs: BrowserHeldInputRegistry
  createSession(page: Page): Promise<CDPSession>
  now?: () => number
  maximumInputAgeMs?: number
}

/** Allowlisted, frame-scoped CDP input for one active reactive plan. */
export class PlaywrightCdpInputController {
  private binding: InputBinding | null = null

  constructor(private readonly options: PlaywrightCdpInputControllerOptions) {}

  async bind(input: {
    sessionId: string
    pageId: string
    planId: string
    page: Page
  }): Promise<void> {
    await this.stop()
    this.binding = {
      ...input,
      session: await this.options.createSession(input.page),
      lastFrameId: 0,
    }
  }

  async execute(
    scope: BrowserReactiveInputScope,
    intents: readonly BrowserReactiveInputIntent[],
    limits: { maxPointerHoldMs: number; maxKeyHoldMs: number },
  ): Promise<number> {
    const binding = this.binding
    if (
      !binding ||
      binding.sessionId !== scope.sessionId ||
      binding.pageId !== scope.pageId ||
      binding.planId !== scope.planId ||
      binding.page.isClosed() ||
      scope.frameId <= binding.lastFrameId ||
      this.now() - scope.receivedAt > (this.options.maximumInputAgeMs ?? 500)
    ) {
      throw new Error('REACTIVE_INPUT_STALE')
    }
    binding.lastFrameId = scope.frameId
    let dispatched = 0
    for (const intent of intents) {
      await this.dispatch(binding.session, intent, limits)
      dispatched += 1
    }
    return dispatched
  }

  async release(): Promise<void> {
    await this.options.heldInputs.releaseOwner('cdp')
  }

  async stop(): Promise<void> {
    const binding = this.binding
    this.binding = null
    await this.release()
    await binding?.session.detach().catch(() => undefined)
  }

  private async dispatch(
    session: CDPSession,
    intent: BrowserReactiveInputIntent,
    limits: { maxPointerHoldMs: number; maxKeyHoldMs: number },
  ): Promise<void> {
    switch (intent.type) {
      case 'move':
        await session.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: intent.x,
          y: intent.y,
          buttons: buttonMask(this.options.heldInputs.snapshot().buttons),
        })
        return
      case 'click':
        await session.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: intent.x,
          y: intent.y,
          button: intent.button,
          buttons: buttonBit(intent.button),
          clickCount: 1,
        })
        await session.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: intent.x,
          y: intent.y,
          button: intent.button,
          buttons: 0,
          clickCount: 1,
        })
        return
      case 'mouse-down':
        if (this.options.heldInputs.isButtonHeld('cdp', intent.button)) return
        await session.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: intent.x,
          y: intent.y,
          button: intent.button,
          buttons: buttonBit(intent.button),
          clickCount: 1,
        })
        this.options.heldInputs.holdButton(
          'cdp',
          intent.button,
          async () => {
            await session.send('Input.dispatchMouseEvent', {
              type: 'mouseReleased',
              x: intent.x,
              y: intent.y,
              button: intent.button,
              buttons: 0,
              clickCount: 1,
            })
          },
          limits.maxPointerHoldMs,
        )
        return
      case 'mouse-up':
        if (!(await this.options.heldInputs.releaseButton('cdp', intent.button))) {
          await session.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: intent.x,
            y: intent.y,
            button: intent.button,
            buttons: 0,
            clickCount: 1,
          })
        }
        return
      case 'key-down': {
        if (this.options.heldInputs.isKeyHeld('cdp', intent.key)) return
        const key = keyDefinition(intent.key)
        await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key })
        this.options.heldInputs.holdKey(
          'cdp',
          intent.key,
          async () => {
            await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
          },
          limits.maxKeyHoldMs,
        )
        return
      }
      case 'key-up':
        if (!(await this.options.heldInputs.releaseKey('cdp', intent.key))) {
          await session.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            ...keyDefinition(intent.key),
          })
        }
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}

function buttonBit(button: 'left' | 'right'): number {
  return button === 'left' ? 1 : 2
}

function buttonMask(buttons: readonly ('left' | 'right')[]): number {
  return buttons.reduce((mask, button) => mask | buttonBit(button), 0)
}

function keyDefinition(key: ReactiveKey) {
  const upper = key.toUpperCase()
  const virtualKey =
    key === 'ArrowLeft'
      ? 37
      : key === 'ArrowUp'
        ? 38
        : key === 'ArrowRight'
          ? 39
          : key === 'ArrowDown'
            ? 40
            : upper.charCodeAt(0)
  return {
    key,
    code: key.startsWith('Arrow') ? key : `Key${upper}`,
    windowsVirtualKeyCode: virtualKey,
    nativeVirtualKeyCode: virtualKey,
  }
}
