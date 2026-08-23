import { join } from 'node:path'

import { app, type BrowserWindow, Menu, safeStorage } from 'electron'

import { translate } from '../../shared/localization'
import type { AvatarRuntimeHealth } from '../../shared/runtime'
import { getConfig, getOverlayPresentationConfig, getRendererConfig, loadConfig } from '../config'
import { registerIpcHandlers } from '../ipc'
import { IpcAuthorization } from '../ipc/IpcAuthorization'
import { registerOverlayIpc } from '../ipc/registerOverlayIpc'
import { registerRuntimeHealthIpc } from '../ipc/registerRuntimeHealthIpc'
import { LlmCredentialStore, LlmGateway, type LlmProviderId } from '../llm'
import { mainLog } from '../logging/safeLogger'
import { createMemoryStore } from '../memory'
import { Orchestrator } from '../orchestrator'
import { PluginCapabilityRegistry, PluginRegistryStore, PluginRuntime } from '../plugins'
import {
  PROJECT_AWARENESS_MANIFEST,
  ProjectAwarenessConfigStore,
  ProjectAwarenessPlugin,
  ProjectAwarenessRuntime,
  ProjectCredentialStore,
  ProjectKnowledgeStore,
} from '../project-awareness'
import { GitHubProjectAdapter } from '../project-awareness/adapters/GitHubProjectAdapter'
import { observeMainPromise } from '../reliability/observePromise'
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
  let pluginRuntime: PluginRuntime | null = null
  let projectAwareness: ProjectAwarenessPlugin | null = null
  let projectCredentialStore: ProjectCredentialStore | null = null
  let projectKnowledgeStore: ProjectKnowledgeStore | null = null
  let lastAvatarState: unknown = null
  let lastAvatarMouth: unknown = null
  let lastAvatarRuntimeHealth: AvatarRuntimeHealth | null = null
  const screenContextService = new ScreenContextService(new ScreenCaptureAdapter())
  const pluginCapabilities = new PluginCapabilityRegistry()

  const loadRenderer = async (target: BrowserWindow, overlay = false): Promise<void> => {
    if (process.env.NODE_ENV === 'development') {
      await target.loadURL(`http://localhost:5173${overlay ? '?overlay=1' : ''}`)
    } else {
      await target.loadFile(
        join(__dirname, '../renderer/index.html'),
        overlay ? { query: { overlay: '1' } } : undefined,
      )
    }
  }
  const overlayWindows = new OverlayWindowManager((target) => loadRenderer(target, true))
  const mainWindows = new MainWindowManager(
    (target) => loadRenderer(target),
    () => !quitting,
  )
  const ipcAuthorization = new IpcAuthorization({
    main: () => (win && !win.isDestroyed() ? win.webContents.id : null),
    overlay: () => overlayWindows.webContentsId(),
  })

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

  const buildProjectAwareness = (): ProjectAwarenessPlugin => {
    const directory = join(app.getPath('userData'), 'plugins', PROJECT_AWARENESS_MANIFEST.id)
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
    const knowledgeStore = projectKnowledgeStore
    const credentialStore = projectCredentialStore
    const configStore = new ProjectAwarenessConfigStore(join(directory, 'config.json'))
    return new ProjectAwarenessPlugin({
      config: configStore,
      credentials: credentialStore,
      createRuntime: (config) =>
        new ProjectAwarenessRuntime(
          { ...config, enabled: false },
          knowledgeStore,
          (owner, name, token) =>
            new GitHubProjectAdapter(owner, name, token, (key, params) =>
              translate(getConfig().uiLocale, key, params),
            ),
          (key, params) => translate(getConfig().uiLocale, key, params),
        ),
      closeStore: () => {
        projectKnowledgeStore?.close()
        projectKnowledgeStore = null
      },
    })
  }

  const getProjectAwareness = (): ProjectAwarenessPlugin => {
    projectAwareness ??= buildProjectAwareness()
    return projectAwareness
  }

  const getPluginRuntime = (): PluginRuntime => {
    pluginRuntime ??= new PluginRuntime(
      [getProjectAwareness()],
      new PluginRegistryStore(join(app.getPath('userData'), 'plugins', 'registry.json'), [
        PROJECT_AWARENESS_MANIFEST,
      ]),
      pluginCapabilities,
    )
    return pluginRuntime
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
    observeMainPromise(speechClient.warnIfEmotionContractDrift(), 'check speech emotion contract')
    return new Orchestrator(llmGateway, createMemoryStore(), speechClient, getRendererConfig, () =>
      pluginCapabilities.getProjectContextProvider(),
    )
  }

  const prepareForQuit = (): void => {
    quitting = true
    overlayWindows.setQuitting()
    overlayWindows.destroy()
    screenContextService.dispose()
    if (pluginRuntime) {
      observeMainPromise(pluginRuntime.dispose(), 'dispose Plugin Runtime')
    } else {
      projectKnowledgeStore?.close()
      projectKnowledgeStore = null
    }
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

    lastAvatarRuntimeHealth = null
    win = mainWindows.create()
    win.on('closed', () => {
      win = null
      if (!quitting) shutdown()
    })
    const rendererId = win.webContents.id
    win.webContents.once('destroyed', () => {
      screenContextService.disposeRenderer(rendererId)
    })

    projectAwareness = getProjectAwareness()
    try {
      await getPluginRuntime().initialize()
    } catch (error) {
      mainLog.warn('[PluginRuntime] initialization failed; Core remains available', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
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
      getPluginRuntime,
      getProjectAwareness,
      () => {
        speechClient ??= new SpeechClient(getConfig().pythonSpeechUrl)
        return speechClient
      },
      screenContextService,
      win,
      ipcAuthorization,
    )
    registerReleaseSupportHandlers(
      {
        llmCredentials: getLlmCredentialStore,
        projectAwareness: getProjectAwareness,
        speech: () => {
          speechClient ??= new SpeechClient(getConfig().pythonSpeechUrl)
          return speechClient
        },
        isOverlayVisible: () => overlayWindows.isVisible(),
        avatarRuntimeHealth: () => lastAvatarRuntimeHealth,
        mainRendererHealth: () => mainWindows.getHealth(),
        overlayRendererHealth: () => overlayWindows.getHealth(),
      },
      ipcAuthorization,
    )
    win.webContents.on('did-finish-load', () => {
      orchestrator = buildOrchestrator()
    })
    mainWindows.load(win)
    if (process.env.NODE_ENV === 'development') win.webContents.openDevTools()
  }

  const initialize = async (): Promise<void> => {
    registerRuntimeHealthIpc((health) => {
      lastAvatarRuntimeHealth = health
    }, ipcAuthorization)
    registerOverlayIpc(
      {
        toggle: () => overlayWindows.toggle(),
        isVisible: () => overlayWindows.isVisible(),
        applySettings: () => overlayWindows.applySettings(),
        reloadAvatar: () => overlayWindows.reloadAvatar(),
        getPresentationConfig: getOverlayPresentationConfig,
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
      },
      ipcAuthorization,
    )
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
