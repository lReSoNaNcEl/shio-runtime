import { join } from 'node:path'

import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import { app, type BrowserWindow, Menu, powerMonitor, safeStorage } from 'electron'

import type { DesktopWorkflowRequest } from '../../shared/actions'
import { translate } from '../../shared/localization'
import type { AvatarRuntimeHealth } from '../../shared/runtime'
import { type ActionRuntime, toDesktopWorkflowActionResult } from '../action'
import { AliveRuntime, AliveStore, WindowsSystemContextAdapter } from '../alive'
import { CapabilityCatalog } from '../capabilities'
import { getConfig, getOverlayPresentationConfig, getRendererConfig, loadConfig } from '../config'
import {
  AgentBrowserAdapter,
  DESKTOP_CONTROL_MANIFEST,
  DesktopControlPlugin,
  type DesktopWorkflowAdapterResult,
  DshHarnessAdapter,
  resolveAgentBrowserCommand,
  resolveChromeExecutable,
} from '../desktop-control'
import {
  BrowserAgentCoordinator,
  BrowserWorkflowScopeRegistry,
} from '../desktop-control/browser-agent'
import { RendererNetworkObserver } from '../diagnostics/RendererNetworkObserver'
import { resolveEnvironmentConfig } from '../environmentConfig'
import { registerIpcHandlers } from '../ipc'
import { IpcAuthorization } from '../ipc/IpcAuthorization'
import { registerAliveIpc } from '../ipc/registerAliveIpc'
import { registerLatencyIpc } from '../ipc/registerLatencyIpc'
import { registerOverlayIpc } from '../ipc/registerOverlayIpc'
import { registerRuntimeHealthIpc } from '../ipc/registerRuntimeHealthIpc'
import {
  getProviderDefinition,
  LlmCredentialStore,
  LlmGateway,
  type LlmProviderId,
  LlmTurnCancelledError,
  resolveLlmProviderAccountId,
  resolveLlmReadiness,
  resolveProviderChatBaseUrl,
} from '../llm'
import { mainLog } from '../logging/safeLogger'
import { createMemoryStore, createSemanticMemoryRuntime, MemoryToolBroker } from '../memory'
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
import { SpeechClientManager } from '../speech/SpeechClientManager'
import { registerReleaseSupportHandlers } from '../system/releaseSupport'
import { MainWindowManager } from '../windows/MainWindowManager'
import { OverlayWindowManager } from '../windows/OverlayWindowManager'
import { createActionRuntime } from './createActionRuntime'
import { MainConversationTurnService } from './MainConversationTurnService'
import { SpeechApplicationService } from './SpeechApplicationService'

export interface ApplicationDependencies {
  createWindow(): Promise<void>
  initialize(): Promise<void>
  isQuitting(): boolean
  prepareForQuit(): Promise<void>
  shutdown(): void
}

export function buildApplicationDependencies(): ApplicationDependencies {
  const environmentConfig = resolveEnvironmentConfig()
  let win: BrowserWindow | null = null
  let quitting = false
  let orchestrator: Orchestrator | null = null
  let llmGateway: LlmGateway | null = null
  let llmCredentialStore: LlmCredentialStore | null = null
  let speechClientManager: SpeechClientManager | null = null
  let pluginRuntime: PluginRuntime | null = null
  let projectAwareness: ProjectAwarenessPlugin | null = null
  let desktopControl: DesktopControlPlugin | null = null
  let projectCredentialStore: ProjectCredentialStore | null = null
  let projectKnowledgeStore: ProjectKnowledgeStore | null = null
  let rendererNetworkObserver: RendererNetworkObserver | null = null
  let actionRuntime: ActionRuntime | null = null
  let conversationTurnService: MainConversationTurnService | null = null
  let speechApplicationService: SpeechApplicationService | null = null
  let aliveRuntime: AliveRuntime | null = null
  let unsubscribeAliveIpc: (() => void) | null = null
  let unsubscribeAliveCapabilities: (() => void) | null = null
  let unsubscribeLatencyIpc: (() => void) | null = null
  let prepareForQuitTask: Promise<void> | null = null
  const conversationMemory = createMemoryStore()
  const semanticMemory = createSemanticMemoryRuntime(
    join(app.getPath('userData'), 'memory', 'semantic-memory.sqlite'),
  )
  const aliveStore = new AliveStore(join(app.getPath('userData'), 'alive', 'alive.sqlite'))
  const memoryToolBroker = new MemoryToolBroker(semanticMemory)
  let unsubscribePluginCapabilities: (() => void) | null = null
  let unsubscribeProjectCapabilities: (() => void) | null = null
  let unsubscribeDesktopCapabilities: (() => void) | null = null
  let unsubscribeMemoryCapabilities: (() => void) | null = null
  let lastAvatarState: unknown = null
  let lastAvatarMouth: unknown = null
  let lastAvatarRuntimeHealth: AvatarRuntimeHealth | null = null
  const screenContextService = new ScreenContextService(new ScreenCaptureAdapter())
  const pluginCapabilities = new PluginCapabilityRegistry()
  const browserWorkflowScopes = new BrowserWorkflowScopeRegistry()

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
      cloudflare: ['CLOUDFLARE_API_TOKEN'],
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
    if (!projectAwareness) {
      projectAwareness = buildProjectAwareness()
      unsubscribeProjectCapabilities = projectAwareness.onChanged(() =>
        capabilityCatalog.invalidate(),
      )
    }
    return projectAwareness
  }

  const getDesktopControl = (): DesktopControlPlugin => {
    if (!desktopControl) {
      const directory = join(app.getPath('userData'), 'plugins', DESKTOP_CONTROL_MANIFEST.id)
      const profileDirectory = app.isPackaged
        ? join(process.resourcesPath, 'app.asar.unpacked', 'desktop-control')
        : join(app.getAppPath(), 'resources', 'desktop-control')
      const modulesDirectory = app.isPackaged
        ? join(process.resourcesPath, 'app.asar.unpacked', 'node_modules')
        : join(app.getAppPath(), 'node_modules')
      const browserResources = {
        command: resolveAgentBrowserCommand(modulesDirectory),
        executablePath: resolveChromeExecutable(),
        namespace: 'shio-desktop-control',
        profileDirectory: join(directory, 'browser-profile'),
        socketDirectory: join(directory, 'browser-runtime'),
      }
      const browser = new AgentBrowserAdapter({ resources: () => browserResources })
      desktopControl = new DesktopControlPlugin({
        adapter: new DshHarnessAdapter({
          model: () => {
            const { activeProvider, providers } = getConfig().llm
            const definition = getProviderDefinition(activeProvider)
            const credential = getLlmCredentialStore().resolve(activeProvider)
            const chatPathPrefix = definition.chat.path.replace(/\/chat\/completions\/?$/, '')
            const accountId = resolveLlmProviderAccountId(
              activeProvider,
              providers[activeProvider].accountId,
            )
            return {
              provider: activeProvider,
              providerDisplayName: definition.profile.displayName,
              model: providers[activeProvider].model.trim(),
              baseURL: `${resolveProviderChatBaseUrl(activeProvider, { accountId }).replace(/\/$/, '')}${chatPathPrefix}`,
              apiKey: credential.apiKey,
              credentialConfigured:
                credential.status.configured &&
                (!definition.profile.requiresAccountId || Boolean(accountId)),
              lastError: credential.status.lastError,
            }
          },
          resources: () => ({
            command: process.execPath,
            runtimeScript: join(profileDirectory, 'dsh-runtime.mjs'),
            profileDirectory,
            workspaceDirectory: join(directory, 'workspace'),
            sessionDirectory: join(directory, 'sessions'),
            homeDirectory: join(directory, 'runtime'),
            shell: {
              command: resolvePwshPath(undefined, process.env, process.platform),
            },
            browser: browserResources,
          }),
        }),
        browser,
        authorityMode: () => getConfig().desktopAuthorityMode,
      })
      unsubscribeDesktopCapabilities = desktopControl.onChanged(() =>
        capabilityCatalog.invalidate(),
      )
    }
    return desktopControl
  }

  const getPluginRuntime = (): PluginRuntime => {
    if (!pluginRuntime) {
      pluginRuntime = new PluginRuntime(
        [getProjectAwareness(), getDesktopControl()],
        new PluginRegistryStore(join(app.getPath('userData'), 'plugins', 'registry.json'), [
          PROJECT_AWARENESS_MANIFEST,
          DESKTOP_CONTROL_MANIFEST,
        ]),
        pluginCapabilities,
      )
      unsubscribePluginCapabilities = pluginRuntime.onChanged(() => capabilityCatalog.invalidate())
    }
    return pluginRuntime
  }

  const capabilityCatalog = new CapabilityCatalog({
    settings: getRendererConfig,
    llmReadiness: () => resolveLlmReadiness(getRendererConfig().llm),
    llmCapabilities: () =>
      llmGateway?.getActiveCapabilities() ?? {
        supportsReasoning: false,
        supportsStreaming: false,
        supportsTemperature: false,
        supportsSystemPrompt: true,
        supportsToolCalling: false,
        supportsVision: false,
        recommendedMaxTokens: 1_024,
      },
    memoryStatus: () => semanticMemory.status(),
    plugins: () => getPluginRuntime().list(),
    desktopControl: () => getDesktopControl().getCapabilityProjection(),
    avatarRuntimeHealth: () => lastAvatarRuntimeHealth,
    aliveStatus: () => {
      const snapshot = aliveRuntime?.snapshot()
      return snapshot ? { settings: snapshot.settings, health: snapshot.health } : null
    },
  })

  const getSpeechClientManager = (): SpeechClientManager => {
    speechClientManager ??= new SpeechClientManager(environmentConfig.speechApiUrl)
    return speechClientManager
  }

  const buildOrchestrator = (): Orchestrator => {
    llmGateway = new LlmGateway(() => {
      const { activeProvider, providers } = getConfig().llm
      const credential = getLlmCredentialStore().resolve(activeProvider)
      const accountId = resolveLlmProviderAccountId(
        activeProvider,
        providers[activeProvider].accountId,
      )
      return {
        provider: activeProvider,
        apiKey: credential.apiKey,
        model: providers[activeProvider].model,
        accountId,
      }
    })
    const speech = getSpeechClientManager()
    observeMainPromise(speech.warnIfEmotionContractDrift(), 'check speech emotion contract')
    return new Orchestrator(
      llmGateway,
      conversationMemory,
      speech,
      getRendererConfig,
      () => pluginCapabilities.getProjectContextProvider(),
      capabilityCatalog,
      async (request, signal, authorizationScopeId) => {
        const runtime = actionRuntime
        if (!runtime || signal.aborted) throw new LlmTurnCancelledError()
        const action = await runtime.execute<DesktopWorkflowRequest, DesktopWorkflowAdapterResult>({
          name: 'desktop.workflow',
          payload: request,
          authorizationScopeId,
          signal,
        })
        return toDesktopWorkflowActionResult(action)
      },
      () => pluginCapabilities.getBrowserContextProvider(),
      new BrowserAgentCoordinator(browserWorkflowScopes),
      memoryToolBroker,
      () => aliveRuntime?.snapshot().goals ?? [],
      (input) => {
        const runtime = aliveRuntime
        if (!runtime) throw new Error('ALIVE_RUNTIME_UNAVAILABLE')
        return runtime.createGoalFromCharacter(input)
      },
      (input) => {
        const runtime = aliveRuntime
        if (!runtime) throw new Error('ALIVE_RUNTIME_UNAVAILABLE')
        return runtime.reviseGoalFromCharacter(input)
      },
    )
  }

  const prepareForQuit = (): Promise<void> => {
    if (prepareForQuitTask) return prepareForQuitTask
    quitting = true
    prepareForQuitTask = (async () => {
      overlayWindows.setQuitting()
      overlayWindows.destroy()
      rendererNetworkObserver?.dispose()
      rendererNetworkObserver = null
      unsubscribePluginCapabilities?.()
      unsubscribePluginCapabilities = null
      unsubscribeProjectCapabilities?.()
      unsubscribeProjectCapabilities = null
      unsubscribeDesktopCapabilities?.()
      unsubscribeDesktopCapabilities = null
      unsubscribeMemoryCapabilities?.()
      unsubscribeMemoryCapabilities = null
      capabilityCatalog.dispose()

      const cleanupOwners = [
        'conversation-turn-service',
        'speech-application-service',
        'action-runtime',
        'plugin-runtime',
        'alive-runtime',
      ] as const
      const cleanupResults = await Promise.allSettled([
        conversationTurnService?.dispose() ?? Promise.resolve(),
        speechApplicationService?.dispose() ?? Promise.resolve(),
        actionRuntime?.emergencyStop() ?? Promise.resolve(),
        pluginRuntime?.dispose() ?? Promise.resolve(),
        Promise.resolve().then(() => aliveRuntime?.dispose()),
      ])
      for (const [index, result] of cleanupResults.entries()) {
        if (result.status === 'rejected') {
          mainLog.warn('[Application] shutdown cleanup failed', {
            owner: cleanupOwners[index],
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          })
        }
      }
      conversationTurnService = null
      speechApplicationService = null
      aliveRuntime = null
      unsubscribeAliveIpc?.()
      unsubscribeAliveIpc = null
      unsubscribeAliveCapabilities?.()
      unsubscribeAliveCapabilities = null
      unsubscribeLatencyIpc?.()
      unsubscribeLatencyIpc = null
      screenContextService.dispose()
      speechClientManager?.dispose()
      if (!pluginRuntime) {
        projectKnowledgeStore?.close()
        projectKnowledgeStore = null
      }
      semanticMemory.close()
    })()
    return prepareForQuitTask
  }

  const shutdown = (): void => {
    if (quitting) return
    app.quit()
  }

  const createWindow = async (): Promise<void> => {
    await loadConfig(getLlmCredentialStore())
    unsubscribeMemoryCapabilities ??= semanticMemory.onChanged(() => capabilityCatalog.invalidate())
    Menu.setApplicationMenu(null)

    lastAvatarRuntimeHealth = null
    win = mainWindows.create()
    rendererNetworkObserver?.dispose()
    const networkObserver = new RendererNetworkObserver(win.webContents.session, win.webContents.id)
    rendererNetworkObserver = networkObserver
    win.on('closed', () => {
      win = null
      if (!quitting) shutdown()
    })
    const rendererId = win.webContents.id
    win.webContents.once('destroyed', () => {
      networkObserver.dispose()
      if (rendererNetworkObserver === networkObserver) rendererNetworkObserver = null
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
    const actionComposition = createActionRuntime({
      window: win,
      capabilityCatalog,
      browserWorkflowScopes,
      desktopControl: getDesktopControl,
    })
    actionRuntime = actionComposition.actions
    orchestrator = buildOrchestrator()
    const resolveOrchestrator = (): Orchestrator => {
      if (!orchestrator) orchestrator = buildOrchestrator()
      return orchestrator
    }
    const resolveLlmGateway = (): LlmGateway => {
      if (!llmGateway) orchestrator = buildOrchestrator()
      if (!llmGateway) throw new Error('LLM gateway is unavailable')
      return llmGateway
    }
    const buildFastBrainGateway = (selection: {
      providerId?: LlmProviderId
      model?: string
    }): LlmGateway =>
      new LlmGateway(() => {
        const config = getConfig().llm
        const provider = selection.providerId ?? config.activeProvider
        const providerSettings = config.providers[provider]
        const credential = getLlmCredentialStore().resolve(provider)
        return {
          provider,
          apiKey: credential.apiKey,
          model: selection.model?.trim() || providerSettings.model,
          accountId: resolveLlmProviderAccountId(provider, providerSettings.accountId),
        }
      })
    conversationTurnService = new MainConversationTurnService(
      resolveOrchestrator,
      resolveLlmGateway,
      screenContextService,
      () => getRendererConfig().llm,
    )
    speechApplicationService = new SpeechApplicationService(
      getSpeechClientManager,
      resolveOrchestrator,
    )
    registerIpcHandlers(
      resolveOrchestrator,
      resolveLlmGateway,
      getLlmCredentialStore,
      getPluginRuntime,
      getProjectAwareness,
      getDesktopControl,
      screenContextService,
      semanticMemory,
      capabilityCatalog,
      conversationTurnService,
      speechApplicationService,
      actionRuntime,
      actionComposition.confirmations,
      win,
      ipcAuthorization,
    )
    aliveRuntime = new AliveRuntime(aliveStore, buildFastBrainGateway, {
      systemContextAdapter:
        process.platform === 'win32'
          ? new WindowsSystemContextAdapter({
              getGlobalIdleSeconds: () => powerMonitor.getSystemIdleTime(),
              pwshPath: resolvePwshPath(undefined, process.env, process.platform),
            })
          : undefined,
      worldContext: {
        browser: () => desktopControl?.getBrowserContextProvider().currentObservation() ?? null,
        project: () => {
          try {
            const status = projectAwareness?.getStatus()
            return status?.enabled
              ? { name: status.repository || undefined, branch: status.branch || undefined }
              : null
          } catch {
            return null
          }
        },
      },
    })
    actionRuntime.onEmergencyStop(() => {
      aliveRuntime?.emergencyStop()
    })
    unsubscribeAliveCapabilities = aliveRuntime.onChanged(() => capabilityCatalog.invalidate())
    unsubscribeAliveIpc = registerAliveIpc(aliveRuntime, win, ipcAuthorization)
    aliveRuntime.start()
    unsubscribeLatencyIpc = registerLatencyIpc(win, ipcAuthorization)
    registerReleaseSupportHandlers(
      {
        llmCredentials: getLlmCredentialStore,
        plugins: getPluginRuntime,
        speech: getSpeechClientManager,
        isOverlayVisible: () => overlayWindows.isVisible(),
        avatarRuntimeHealth: () => lastAvatarRuntimeHealth,
        aliveRuntime: () => {
          const snapshot = aliveRuntime?.snapshot()
          if (!snapshot) throw new Error('ALIVE_RUNTIME_NOT_INITIALIZED')
          return {
            mode: snapshot.settings.mode,
            globallySuspended: snapshot.settings.globallySuspended,
            health: snapshot.health,
          }
        },
        mainRendererHealth: () => mainWindows.getHealth(),
        overlayRendererHealth: () => overlayWindows.getHealth(),
      },
      ipcAuthorization,
      actionRuntime,
    )
    win.webContents.on('did-start-loading', () => {
      lastAvatarRuntimeHealth = null
      capabilityCatalog.invalidate()
    })
    win.webContents.on('did-finish-load', () => {
      orchestrator = buildOrchestrator()
    })
    mainWindows.load(win)
    if (process.env.NODE_ENV === 'development') win.webContents.openDevTools()
  }

  const initialize = async (): Promise<void> => {
    registerRuntimeHealthIpc((health) => {
      lastAvatarRuntimeHealth = health
      capabilityCatalog.invalidate()
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
