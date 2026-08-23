import type { BrowserWindow, WebContents } from 'electron'

interface NavigationEvent {
  preventDefault(): void
}

interface GuardedWebContents {
  on(event: 'will-navigate', listener: (event: NavigationEvent, url: string) => void): unknown
  setWindowOpenHandler(handler: () => { action: 'deny' }): void
}

export function installRendererNavigationGuards(
  target: Pick<BrowserWindow, 'webContents'> | { webContents: GuardedWebContents },
): void {
  const webContents = target.webContents as WebContents & GuardedWebContents
  webContents.on('will-navigate', (event) => event.preventDefault())
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
}
