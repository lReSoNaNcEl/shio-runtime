import { join } from 'node:path'

import { BrowserWindow } from 'electron'

import type { RendererProcessHealth } from '../../shared/system'
import { mainLog } from '../logging/safeLogger'
import { observeMainPromise } from '../reliability/observePromise'
import { RendererProcessHealthTracker } from './RendererProcessHealthTracker'
import { installRendererNavigationGuards } from './windowSecurity'

export class MainWindowManager {
  private readonly health = new RendererProcessHealthTracker()
  private loadAttempt = 0

  constructor(
    private readonly loadRenderer: (window: BrowserWindow) => Promise<void>,
    private readonly shouldRecover: () => boolean = () => true,
  ) {}

  create(): BrowserWindow {
    const window = new BrowserWindow({
      width: 1200,
      height: 800,
      title: 'Shio Runtime',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })
    this.health.reset()
    this.loadAttempt = 0
    installRendererNavigationGuards(window)
    this.installReliabilityHandlers(window)
    window.setMenu(null)
    return window
  }

  load(window: BrowserWindow): void {
    if (window.isDestroyed()) return
    const attempt = ++this.loadAttempt
    this.health.markLoading()
    observeMainPromise(this.loadRenderer(window), 'load main renderer', (error) => {
      if (attempt !== this.loadAttempt) return
      this.health.markLoadFailure(-1, error instanceof Error ? error.message : String(error))
      this.recover(window, 'load-promise-rejection')
    })
  }

  getHealth(): RendererProcessHealth {
    return this.health.getSnapshot()
  }

  private installReliabilityHandlers(window: BrowserWindow): void {
    window.webContents.on('did-finish-load', () => this.health.markReady())
    window.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return
        this.health.markLoadFailure(errorCode, errorDescription)
        mainLog.error('[MainWindow] renderer load failed', {
          errorCode,
          errorDescription,
          validatedUrl,
        })
        this.recover(window, 'did-fail-load')
      },
    )
    window.webContents.on('render-process-gone', (_event, details) => {
      this.health.markProcessGone(details.reason, details.exitCode)
      mainLog.error('[MainWindow] renderer process gone', details)
      if (details.reason !== 'clean-exit') this.recover(window, 'render-process-gone')
    })
    window.on('closed', () => this.health.markClosed())
  }

  private recover(window: BrowserWindow, source: string): void {
    if (!this.shouldRecover() || window.isDestroyed() || !this.health.claimRecovery()) return
    mainLog.warn('[MainWindow] attempting one renderer recovery', { source })
    this.load(window)
  }
}
