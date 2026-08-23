import { join } from 'node:path'

import { BrowserWindow, screen } from 'electron'

import type { RendererProcessHealth } from '../../shared/system'
import { getConfig, getOverlayPresentationConfig } from '../config'
import { mainLog } from '../logging/safeLogger'
import { observeMainPromise } from '../reliability/observePromise'
import { RendererProcessHealthTracker } from './RendererProcessHealthTracker'
import { installRendererNavigationGuards } from './windowSecurity'
import { numericWindowSetting, resolveOverlayBounds } from './windowSettings'

export class OverlayWindowManager {
  private window: BrowserWindow | null = null
  private creating = false
  private quitting = false
  private readonly health = new RendererProcessHealthTracker()
  private loadAttempt = 0

  constructor(private readonly loadRenderer: (window: BrowserWindow) => Promise<void>) {}

  setQuitting(): void {
    this.quitting = true
  }

  isVisible(): boolean {
    return Boolean(this.window && !this.window.isDestroyed())
  }

  webContentsId(): number | null {
    return this.window && !this.window.isDestroyed() ? this.window.webContents.id : null
  }

  getHealth(): RendererProcessHealth {
    return this.health.getSnapshot()
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
    this.window.webContents.send('overlay-settings:updated', getOverlayPresentationConfig())
    return { ok: true, visible: true }
  }

  reloadAvatar(): { ok: boolean; visible: boolean } {
    if (!this.window || this.window.isDestroyed()) return { ok: true, visible: false }
    mainLog.log('MirrorOverlay: reload avatar in existing window')
    this.health.markLoading()
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
          preload: join(__dirname, '../preload/overlay.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      })
      this.health.reset()
      this.loadAttempt = 0
      installRendererNavigationGuards(created)
      this.installReliabilityHandlers(created)
      this.window = created
      this.applySettings()
      created.on('closed', () => {
        if (this.window === created) this.window = null
      })
      this.load(created)
      return created
    } finally {
      this.creating = false
    }
  }

  private load(window: BrowserWindow): void {
    if (window.isDestroyed()) return
    const attempt = ++this.loadAttempt
    this.health.markLoading()
    observeMainPromise(this.loadRenderer(window), 'load overlay renderer', (error) => {
      if (attempt !== this.loadAttempt) return
      this.health.markLoadFailure(-1, error instanceof Error ? error.message : String(error))
      this.recover(window, 'load-promise-rejection')
    })
  }

  private installReliabilityHandlers(window: BrowserWindow): void {
    window.webContents.on('did-finish-load', () => this.health.markReady())
    window.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return
        this.health.markLoadFailure(errorCode, errorDescription)
        mainLog.error('[OverlayWindow] renderer load failed', {
          errorCode,
          errorDescription,
          validatedUrl,
        })
        this.recover(window, 'did-fail-load')
      },
    )
    window.webContents.on('render-process-gone', (_event, details) => {
      this.health.markProcessGone(details.reason, details.exitCode)
      mainLog.error('[OverlayWindow] renderer process gone', details)
      if (details.reason !== 'clean-exit') this.recover(window, 'render-process-gone')
    })
    window.on('closed', () => this.health.markClosed())
  }

  private recover(window: BrowserWindow, source: string): void {
    if (this.quitting || window.isDestroyed() || !this.health.claimRecovery()) return
    mainLog.warn('[OverlayWindow] attempting one renderer recovery', { source })
    this.load(window)
  }
}
