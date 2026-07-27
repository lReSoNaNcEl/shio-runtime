import { join } from 'node:path'

import { BrowserWindow, screen } from 'electron'

import { getConfig, getRendererConfig } from '../config'
import { mainLog } from '../logging/safeLogger'
import { numericWindowSetting, resolveOverlayBounds } from './windowSettings'

export class OverlayWindowManager {
  private window: BrowserWindow | null = null
  private creating = false
  private quitting = false

  constructor(private readonly loadRenderer: (window: BrowserWindow) => void) {}

  setQuitting(): void {
    this.quitting = true
  }

  isVisible(): boolean {
    return Boolean(this.window && !this.window.isDestroyed())
  }

  destroy(): void {
    const target = this.window
    this.window = null
    if (target && !target.isDestroyed()) target.destroy()
  }

  send(channel: string, payload: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload)
    }
  }

  applySettings(): { ok: boolean; visible: boolean } {
    if (!this.window || this.window.isDestroyed()) return { ok: true, visible: false }
    const config = getConfig()
    this.window.setBounds(resolveOverlayBounds(config, screen.getPrimaryDisplay()))
    this.window.setOpacity(numericWindowSetting(config.overlayOpacity, 1, 0.2, 1))
    this.window.setIgnoreMouseEvents(config.overlayClickThrough !== 'false', { forward: true })
    this.window.setAlwaysOnTop(true, 'screen-saver')
    this.window.webContents.send('overlay-settings:updated', getRendererConfig())
    return { ok: true, visible: true }
  }

  reloadAvatar(): { ok: boolean; visible: boolean } {
    if (!this.window || this.window.isDestroyed()) return { ok: true, visible: false }
    mainLog.log('MirrorOverlay: reload avatar in existing window')
    this.window.webContents.reload()
    return { ok: true, visible: true }
  }

  toggle(): { visible: boolean } {
    if (this.window && !this.window.isDestroyed()) {
      mainLog.log('MirrorOverlay: close on toggle')
      this.window.close()
      this.window = null
      return { visible: false }
    }
    this.ensure()
    return { visible: true }
  }

  ensure(): BrowserWindow {
    if (this.quitting) throw new Error('Cannot create Mirror Overlay during application shutdown')
    if (this.window && !this.window.isDestroyed()) {
      mainLog.log('MirrorOverlay: reuse existing')
      return this.window
    }
    if (this.creating) return this.window as BrowserWindow
    this.creating = true
    try {
      const bounds = resolveOverlayBounds(getConfig(), screen.getPrimaryDisplay())
      const created = new BrowserWindow({
        ...bounds,
        title: 'Shio - Оверлей',
        frame: false,
        transparent: true,
        resizable: false,
        movable: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          webSecurity: false,
        },
      })
      this.window = created
      this.applySettings()
      created.on('closed', () => {
        if (this.window === created) this.window = null
      })
      this.loadRenderer(created)
      return created
    } finally {
      this.creating = false
    }
  }
}
