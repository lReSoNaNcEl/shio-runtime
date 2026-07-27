import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { app, type BrowserWindow, Menu, protocol, safeStorage } from 'electron'

import { translate } from '../../shared/localization'
import { getConfig, getRendererConfig, loadConfig } from '../config'
import { registerIpcHandlers } from '../ipc'
import { registerOverlayIpc } from '../ipc/registerOverlayIpc'
import { LlmCredentialStore, LlmGateway, type LlmProviderId } from '../llm'
import { mainLog } from '../logging/safeLogger'
import { createMemoryStore } from '../memory'
import { Orchestrator } from '../orchestrator'
import {
  ProjectAwarenessRuntime,
  ProjectCredentialStore,
  ProjectKnowledgeStore,
} from '../project-awareness'
import { GitHubProjectAdapter } from '../project-awareness/adapters/GitHubProjectAdapter'
import { ScreenCaptureAdapter, ScreenContextService } from '../screen-context'
import { SpeechClient } from '../speech/speechClient'
import { registerReleaseSupportHandlers } from '../system/releaseSupport'
import { MainWindowManager } from '../windows/MainWindowManager'
import { OverlayWindowManager } from '../windows/OverlayWindowManager'

export interface ApplicationDependencies {
  createWindow(): Promise<void>
  initialize(): Promise<void>
  isQuitting(): boolean
  prepareForQuit(): void
  shutdown(): void
}

export function buildApplicationDependencies(): ApplicationDependencies {
  let win: BrowserWindow | null = null
  let quitting = false
  let orchestrator: Orchestrator | null = null
  let llmGateway: LlmGateway | null = null
  let llmCredentialStore: LlmCredentialStore | null = null
  let speechClient: SpeechClient | null = null
  let projectAwareness: ProjectAwarenessRuntime | null = null
  let projectCredentialStore: ProjectCredentialStore | null = null
  let projectKnowledgeStore: ProjectKnowledgeStore | null = null
  let lastAvatarState: unknown = null
  let lastAvatarMouth: unknown = null
  const screenContextService = new ScreenContextService(new ScreenCaptureAdapter())

  const loadRenderer = (target: BrowserWindow, overlay = false): void => {
    if (process.env.NODE_ENV === 'development') {
      target.loadURL(`http://localhost:5173${overlay ? '?overlay=1' : ''}`)
    } else {
      target.loadFile(
        join(__dirname, '../renderer/index.html'),
        overlay ? { query: { overlay: '1' } } : undefined,
      )
    }
  }
  const overlayWindows = new OverlayWindowManager((target) => loadRenderer(target, true))
  const mainWindows = new MainWindowManager((target) => loadRenderer(target))

  const environmentCredential = (provider: LlmProviderId): string | undefined => {
    const variables: Record<LlmProviderId, string[]> = {
      groq: ['GROQ_API_KEY'],
      cerebras: ['CEREBRAS_API_KEY'],
      github: ['GITHUB_MODELS_API_KEY', 'GITHUB_TOKEN'],
      openrouter: ['OPENROUTER_API_KEY'],
      mistral: ['MISTRAL_API_KEY'],
    }
    return variables[provider].map((name) => process.env[name]).find(Boolean)
  }

  const getLlmCredentialStore = (): LlmCredentialStore => {
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

  const buildProjectAwareness = (): ProjectAwarenessRuntime => {
    const config = getConfig().projectAwareness
    const directory = join(app.getPath('userData'), 'project-awareness')
    projectKnowledgeStore ??= new ProjectKnowledgeStore(
      join(directory, 'project-index.sqlite'),
      (key, params) => translate(getConfig().uiLocale, key, params),
    )
    projectCredentialStore ??= new ProjectCredentialStore(
      join(directory, 'github-credential.bin'),
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

  const initializeProjectAwareness = async (runtime: ProjectAwarenessRuntime): Promise<void> => {
    if (!projectCredentialStore) {
      throw new Error(translate(getConfig().uiLocale, 'main.error.project.storeUnavailable'))
    }
    const credential = await projectCredentialStore.load()
    runtime.setCredential(credential.token, credential)
    await runtime.initialize()
  }

  const buildOrchestrator = (): Orchestrator => {
    const cfg = getConfig()
    llmGateway = new LlmGateway(() => {
      const { activeProvider, providers } = getConfig().llm
      const credential = getLlmCredentialStore().resolve(activeProvider)
      return {
        provider: activeProvider,
        apiKey: credential.apiKey,
        model: providers[activeProvider].model,
      }
    })
    speechClient = new SpeechClient(cfg.pythonSpeechUrl)
    void speechClient.warnIfEmotionContractDrift()
    return new Orchestrator(
      llmGateway,
      createMemoryStore(),
      speechClient,
      getRendererConfig,
      projectAwareness ?? undefined,
    )
  }

  const prepareForQuit = (): void => {
    quitting = true
    overlayWindows.setQuitting()
    overlayWindows.destroy()
    screenContextService.dispose()
    projectKnowledgeStore?.close()
    projectKnowledgeStore = null
  }

  const shutdown = (): void => {
    if (quitting) return
    prepareForQuit()
    if (win && !win.isDestroyed()) win.destroy()
    win = null
    app.quit()
  }

  const createWindow = async (): Promise<void> => {
    await loadConfig(getLlmCredentialStore())
    Menu.setApplicationMenu(null)

    win = mainWindows.create()
    win.on('closed', () => {
      win = null
      if (!quitting) shutdown()
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
        if (!projectCredentialStore) {
          throw new Error(translate(getConfig().uiLocale, 'main.error.project.storeUnavailable'))
        }
        return projectCredentialStore
      },
      () => {
        speechClient ??= new SpeechClient(getConfig().pythonSpeechUrl)
        return speechClient
      },
      screenContextService,
      win,
    )
    registerReleaseSupportHandlers({
      llmCredentials: getLlmCredentialStore,
      projectAwareness: () => {
        projectAwareness ??= buildProjectAwareness()
        return projectAwareness
      },
      speech: () => {
        speechClient ??= new SpeechClient(getConfig().pythonSpeechUrl)
        return speechClient
      },
      isOverlayVisible: () => overlayWindows.isVisible(),
      isVrmLoaded: () => Boolean(lastAvatarState && getConfig().vrmPath),
    })
    void initializeProjectAwareness(projectAwareness).catch((error) => {
      mainLog.warn('[ProjectAwareness] initialization failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
    win.webContents.on('did-finish-load', () => {
      orchestrator = buildOrchestrator()
    })
    mainWindows.load(win)
    if (process.env.NODE_ENV === 'development') win.webContents.openDevTools()
  }

  const initialize = async (): Promise<void> => {
    registerOverlayIpc({
      toggle: () => overlayWindows.toggle(),
      isVisible: () => overlayWindows.isVisible(),
      applySettings: () => overlayWindows.applySettings(),
      reloadAvatar: () => overlayWindows.reloadAvatar(),
      getAvatarState: () => lastAvatarState,
      publishAvatarState: (state) => {
        lastAvatarState = state
        overlayWindows.send('avatar-state:updated', state)
      },
      getAvatarMouth: () => lastAvatarMouth,
      publishAvatarMouth: (weights) => {
        lastAvatarMouth = weights
        overlayWindows.send('avatar-mouth:updated', weights)
      },
    })
    protocol.handle('app', (request) => {
      const filePath = decodeURIComponent(new URL(request.url).pathname)
      try {
        const data = readFileSync(filePath)
        return new Response(data, { headers: { 'Content-Type': 'model/gltf-binary' } })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    })
    await createWindow()
  }

  return {
    createWindow,
    initialize,
    isQuitting: () => quitting,
    prepareForQuit,
    shutdown,
  }
}
