import { join } from 'node:path'

import { BrowserWindow } from 'electron'

export class MainWindowManager {
  constructor(private readonly loadRenderer: (window: BrowserWindow) => void) {}

  create(): BrowserWindow {
    const window = new BrowserWindow({
      width: 1200,
      height: 800,
      title: 'Shio Runtime',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: false,
      },
    })
    window.setMenu(null)
    return window
  }

  load(window: BrowserWindow): void {
    this.loadRenderer(window)
  }
}
