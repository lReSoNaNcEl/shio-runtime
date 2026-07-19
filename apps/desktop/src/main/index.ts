import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as dotenv from 'dotenv'
import { app, BrowserWindow, ipcMain, Menu, protocol, safeStorage, screen } from 'electron'

import { translate } from '../shared/localization'
import { getConfig, getRendererConfig, loadConfig } from './config'
import { registerIpcHandlers } from './ipc'
import { LlmCredentialStore, LlmGateway, type LlmProviderId } from './llm'
import { initializeSafeLogging, mainLog } from './logging/safeLogger'
import { createMemoryStore } from './memory'
import { Orchestrator } from './orchestrator'
import {
  ProjectAwarenessRuntime,
  ProjectCredentialStore,
  ProjectKnowledgeStore,
} from './project-awareness'
import { GitHubProjectAdapter } from './project-awareness/adapters/GitHubProjectAdapter'
import { ScreenCaptureAdapter, ScreenContextService } from './screen-context'
import { SpeechClient } from './speech/speechClient'

initializeSafeLogging()
dotenv.config()

let win: BrowserWindow | null = null
let overlayWin: BrowserWindow | null = null
let isQuitting = false
let orchestrator: Orchestrator | null = null
let llmGateway: LlmGateway | null = null
let llmCredentialStore: LlmCredentialStore | null = null
let speechClient: SpeechClient | null = null
let projectAwareness: ProjectAwarenessRuntime | null = null
let projectCredentialStore: ProjectCredentialStore | null = null
let projectKnowledgeStore: ProjectKnowledgeStore | null = null
let lastAvatarState: unknown = null
let lastAvatarMouth: unknown = null
const screenCaptureAdapter = new ScreenCaptureAdapter()
const screenContextService = new ScreenContextService(screenCaptureAdapter)

function destroyOverlayWindow(): void {
  const target = overlayWin
  overlayWin = null

  if (!target || target.isDestroyed()) return

  target.destroy()
}

function shutdownApplication(): void {
  if (isQuitting) return
  isQuitting = true

  destroyOverlayWindow()

  if (win && !win.isDestroyed()) {
    win.destroy()
  }
  win = null

  app.quit()
}

function buildOrchestrator(): Orchestrator {
  const cfg = getConfig()
  // LlmGateway re-reads main-owned settings and credentials on every chat()
  // call, so provider, model, and credential changes apply to the next request
  // without rebuilding the Orchestrator or restarting the app.
  llmGateway = new LlmGateway(() => {
    const { activeProvider, providers } = getConfig().llm
    const credential = getLlmCredentialStore().resolve(activeProvider)
    return {
      provider: activeProvider,
      apiKey: credential.apiKey,
      model: providers[activeProvider].model,
    }
  })
  const memory = createMemoryStore()
  speechClient = new SpeechClient(cfg.pythonSpeechUrl)
  void speechClient.warnIfEmotionContractDrift()
  return new Orchestrator(
    llmGateway,
    memory,
    speechClient,
    getRendererConfig,
    projectAwareness ?? undefined,
  )
}

function environmentCredential(provider: LlmProviderId): string | undefined {
  const variables: Record<LlmProviderId, string[]> = {
    groq: ['GROQ_API_KEY'],
    cerebras: ['CEREBRAS_API_KEY'],
    github: ['GITHUB_MODELS_API_KEY', 'GITHUB_TOKEN'],
    openrouter: ['OPENROUTER_API_KEY'],
    mistral: ['MISTRAL_API_KEY'],
  }
  return variables[provider].map((name) => process.env[name]).find(Boolean)
}

function getLlmCredentialStore(): LlmCredentialStore {
  llmCredentialStore ??= new LlmCredentialStore(
    join(app.getPath('userData'), 'credentials', 'llm-credentials.bin'),
    {
      isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptStringAsync(value),
      decrypt: (value) => safeStorage.decryptStringAsync(value),
    },
    environmentCredential,
  )
  return llmCredentialStore
}

function buildProjectAwareness(): ProjectAwarenessRuntime {
  const config = getConfig().projectAwareness
  const projectAwarenessDirectory = join(app.getPath('userData'), 'project-awareness')
  projectKnowledgeStore ??= new ProjectKnowledgeStore(
    join(projectAwarenessDirectory, 'project-index.sqlite'),
    (key, params) => translate(getConfig().uiLocale, key, params),
  )
  projectCredentialStore ??= new ProjectCredentialStore(
    join(projectAwarenessDirectory, 'github-credential.bin'),
    {
      isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptStringAsync(value),
      decrypt: (value) => safeStorage.decryptStringAsync(value),
    },
    (key, params) => translate(getConfig().uiLocale, key, params),
  )
  return new ProjectAwarenessRuntime(
    config,
    projectKnowledgeStore,
    (owner, name, token) =>
      new GitHubProjectAdapter(owner, name, token, (key, params) =>
        translate(getConfig().uiLocale, key, params),
      ),
    (key, params) => translate(getConfig().uiLocale, key, params),
  )
}

async function initializeProjectAwareness(runtime: ProjectAwarenessRuntime): Promise<void> {
  if (!projectCredentialStore)
    throw new Error(translate(getConfig().uiLocale, 'main.error.project.storeUnavailable'))
  const credential = await projectCredentialStore.load()
  runtime.setCredential(credential.token, credential)
  await runtime.initialize()
}

function loadRenderer(target: BrowserWindow, overlay = false): void {
  if (process.env.NODE_ENV === 'development') {
    target.loadURL(`http://localhost:5173${overlay ? '?overlay=1' : ''}`)
  } else {
    target.loadFile(
      join(__dirname, '../renderer/index.html'),
      overlay ? { query: { overlay: '1' } } : undefined,
    )
  }
}

function numericSetting(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function overlayBounds(): { width: number; height: number; x: number; y: number } {
  const cfg = getConfig()
  const display = screen.getPrimaryDisplay()
  const width = numericSetting(cfg.overlayWidth, 360, 160, 1200)
  const height = numericSetting(cfg.overlayHeight, 560, 220, 1200)
  const margin = numericSetting(cfg.overlayMargin, 24, 0, 200)
  const corner = cfg.overlayCorner ?? 'bottom-right'
  const x = corner.endsWith('left')
    ? Math.round(display.workArea.x + margin)
    : Math.round(display.workArea.x + display.workArea.width - width - margin)
  const y = corner.startsWith('top')
    ? Math.round(display.workArea.y + margin)
    : Math.round(display.workArea.y + display.workArea.height - height - margin)
  return { width, height, x, y }
}

function applyOverlaySettings(): { ok: boolean; visible: boolean } {
  if (!overlayWin || overlayWin.isDestroyed()) return { ok: true, visible: false }
  const cfg = getConfig()
  const bounds = overlayBounds()
  const opacity = numericSetting(cfg.overlayOpacity, 1, 0.2, 1)
  const clickThrough = cfg.overlayClickThrough !== 'false'

  overlayWin.setBounds(bounds)
  overlayWin.setOpacity(opacity)
  overlayWin.setIgnoreMouseEvents(clickThrough, { forward: true })
  overlayWin.setAlwaysOnTop(true, 'screen-saver')
  overlayWin.webContents.send('overlay-settings:updated', getRendererConfig())
  return { ok: true, visible: true }
}

async function createWindow(): Promise<void> {
  await loadConfig(getLlmCredentialStore())
  Menu.setApplicationMenu(null)

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Shio Runtime',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  })
  win.setMenu(null)
  win.on('closed', () => {
    win = null

    if (!isQuitting) {
      shutdownApplication()
    }
  })
  const rendererId = win.webContents.id
  win.webContents.once('destroyed', () => {
    screenContextService.disposeRenderer(rendererId)
  })

  projectAwareness = buildProjectAwareness()
  orchestrator = buildOrchestrator()

  registerIpcHandlers(
    () => {
      if (!orchestrator) orchestrator = buildOrchestrator()
      return orchestrator
    },
    () => {
      if (!llmGateway) orchestrator = buildOrchestrator()
      if (!llmGateway) throw new Error('LLM gateway is unavailable')
      return llmGateway
    },
    getLlmCredentialStore,
    () => {
      projectAwareness ??= buildProjectAwareness()
      return projectAwareness
    },
    () => {
      if (!projectCredentialStore) buildProjectAwareness()
      if (!projectCredentialStore)
        throw new Error(translate(getConfig().uiLocale, 'main.error.project.storeUnavailable'))
      return projectCredentialStore
    },
    () => {
      if (!speechClient) speechClient = new SpeechClient(getConfig().pythonSpeechUrl)
      return speechClient
    },
    screenContextService,
    win,
  )
  void initializeProjectAwareness(projectAwareness).catch((error) => {
    mainLog.warn('[ProjectAwareness] initialization failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  })

  win.webContents.on('did-finish-load', () => {
    orchestrator = buildOrchestrator()
  })

  // TEMP DIAGNOSTIC: forward renderer animation lifecycle logs to main stdout.
  win.webContents.on('console-message', (details) => {
    const { message } = details

    if (message.includes('[ANIMDBG]') || message.includes('[ANIMLIFE]')) {
      mainLog.log(message)
    }
  })

  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname)
    try {
      const data = readFileSync(filePath)
      return new Response(data, {
        headers: { 'Content-Type': 'model/gltf-binary' },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  loadRenderer(win)
  if (process.env.NODE_ENV === 'development') win.webContents.openDevTools()
}

// Single-instance guard for the mirror overlay window. `createOverlayWindow`
// used to overwrite `overlayWin` unconditionally, so any caller that (re)created
// the overlay — e.g. refreshing it after a VRM change — orphaned the previous
// live window instead of closing it, leaving two overlays on screen. All overlay
// creation now goes through `ensureOverlayWindow`, and a creation lock protects
// against a concurrent toggle + VRM-change race producing a duplicate.
let isCreatingOverlay = false

function ensureOverlayWindow(): BrowserWindow {
  if (isQuitting) {
    throw new Error('Cannot create Mirror Overlay during application shutdown')
  }
  if (overlayWin && !overlayWin.isDestroyed()) {
    mainLog.log('MirrorOverlay: reuse existing')
    return overlayWin
  }
  return createOverlayWindow()
}

function refreshOverlayAvatar(): { ok: boolean; visible: boolean } {
  if (!overlayWin || overlayWin.isDestroyed()) return { ok: true, visible: false }
  // Reuse the single existing overlay window and reload its renderer in place.
  // On boot the overlay reads `cfg.vrmPath` (already persisted before this call),
  // so an in-place reload adopts the new model without ever creating a second
  // window.
  mainLog.log('MirrorOverlay: reload avatar in existing window')
  overlayWin.webContents.reload()
  return { ok: true, visible: true }
}

function createOverlayWindow(): BrowserWindow {
  if (isQuitting) {
    throw new Error('Cannot create Mirror Overlay during application shutdown')
  }
  if (overlayWin && !overlayWin.isDestroyed()) {
    mainLog.log('MirrorOverlay: reuse existing')
    return overlayWin
  }
  if (isCreatingOverlay) {
    mainLog.log('MirrorOverlay: creation already in progress')
    return overlayWin as BrowserWindow
  }
  isCreatingOverlay = true
  try {
    mainLog.log('MirrorOverlay: create')

    const { width, height, x, y } = overlayBounds()

    overlayWin = new BrowserWindow({
      width,
      height,
      x,
      y,
      title: 'Shio - \u041e\u0432\u0435\u0440\u043b\u0435\u0439',
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: false,
      },
    })

    const createdWindow = overlayWin
    applyOverlaySettings()
    createdWindow.on('closed', () => {
      mainLog.log('MirrorOverlay: destroyed')
      if (overlayWin === createdWindow) {
        overlayWin = null
      }
    })
    loadRenderer(createdWindow, true)
    return createdWindow
  } finally {
    isCreatingOverlay = false
  }
}

function toggleOverlayWindow(): { visible: boolean } {
  if (overlayWin && !overlayWin.isDestroyed()) {
    mainLog.log('MirrorOverlay: close on toggle')
    overlayWin.close()
    overlayWin = null
    return { visible: false }
  }

  ensureOverlayWindow()
  return { visible: true }
}

app.whenReady().then(async () => {
  ipcMain.handle('overlay:toggle', () => toggleOverlayWindow())
  ipcMain.handle('overlay:is-visible', () => ({
    visible: Boolean(overlayWin && !overlayWin.isDestroyed()),
  }))
  ipcMain.handle('overlay:apply-settings', () => applyOverlaySettings())
  ipcMain.handle('overlay:reload-avatar', () => refreshOverlayAvatar())
  ipcMain.handle('avatar-state:get', () => lastAvatarState)
  ipcMain.handle('avatar-state:publish', (_event, state: unknown) => {
    lastAvatarState = state
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.webContents.send('avatar-state:updated', state)
    }
    return { ok: true }
  })
  ipcMain.handle('avatar-mouth:get', () => lastAvatarMouth)
  ipcMain.handle('avatar-mouth:publish', (_event, weights: unknown) => {
    lastAvatarMouth = weights
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.webContents.send('avatar-mouth:updated', weights)
    }
    return { ok: true }
  })

  await createWindow()
  app.on('activate', () => {
    if (isQuitting) return
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  destroyOverlayWindow()
  screenContextService.dispose()
  projectKnowledgeStore?.close()
  projectKnowledgeStore = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !isQuitting) {
    shutdownApplication()
  }
})
