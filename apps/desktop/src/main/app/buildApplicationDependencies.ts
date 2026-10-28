import { isAbsolute, join } from 'node:path'

import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import { app, type BrowserWindow, Menu, powerMonitor, safeStorage } from 'electron'

import type { DesktopWorkflowRequest } from '../../shared/actions'
import type {
  BrowserComputerUseControlAction,
  BrowserComputerUseSession,
  BrowserComputerUseStartRequest,
} from '../../shared/browser-computer-use'
import { translate } from '../../shared/localization'
import type { BodyPresentationProjection } from '../../shared/motion'
import type { AvatarRuntimeHealth } from '../../shared/runtime'
import {
  type ActionRuntime,
  type DesktopWorkflowAdapterResult,
  toDesktopWorkflowActionResult,
} from '../action'
import { AliveRuntime, AliveStore, WindowsSystemContextAdapter } from '../alive'
import {
  BROWSER_CONTROL_MANIFEST,
  BrowserComputerUseRuntime,
  type BrowserControlPlugin,
  LlmBrowserVisualActionAdapter,
  PlaywrightBrowserAdapter,
  resolveChromeExecutable,
} from '../browser-control'
import {
  BrowserWorkflowCoordinator,
  BrowserWorkflowScopeRegistry,
} from '../browser-control/workflow'
import { CapabilityCatalog } from '../capabilities'
import { getConfig, getOverlayPresentationConfig, getRendererConfig, loadConfig } from '../config'
import { ConversationThreadRuntime } from '../conversation-threads'
import {
  DESKTOP_CONTROL_MANIFEST,
  type DesktopControlPlugin,
  DshHarnessAdapter,
} from '../desktop-control'
import { RendererNetworkObserver } from '../diagnostics/RendererNetworkObserver'
import { resolveEnvironmentConfig } from '../environmentConfig'
import { registerIpcHandlers } from '../ipc'
import { IpcAuthorization } from '../ipc/IpcAuthorization'
import { registerAliveIpc } from '../ipc/registerAliveIpc'
import { registerLatencyIpc } from '../ipc/registerLatencyIpc'
import { registerMotionIpc } from '../ipc/registerMotionIpc'
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
import { ArdyMotionService } from '../motion/ArdyMotionService'
import { Orchestrator } from '../orchestrator'
import { PluginCapabilityRegistry, PluginRegistryStore, PluginRuntime } from '../plugins'
import {
  PROJECT_AWARENESS_MANIFEST,
  ProjectAwarenessConfigStore,
  type ProjectAwarenessPlugin,
  ProjectAwarenessRuntime,
  ProjectCredentialStore,
  ProjectKnowledgeStore,
} from '../project-awareness'
import { GitHubProjectAdapter } from '../project-awareness/adapters/GitHubProjectAdapter'
import { observeMainPromise } from '../reliability/observePromise'
import { ScreenCaptureAdapter, ScreenContextService } from '../screen-context'
import { SpeechClientManager } from '../speech/SpeechClientManager'
import { registerReleaseSupportHandlers } from '../system/releaseSupport'
import { WEB_SEARCH_MANIFEST, type WebSearchPlugin } from '../web-search'
import { MainWindowManager } from '../windows/MainWindowManager'
import { OverlayWindowManager } from '../windows/OverlayWindowManager'
import { actionExperienceEvent } from './ActionExperienceBridge'
import { createActionRuntime } from './createActionRuntime'
import { MainConversationTurnService } from './MainConversationTurnService'
import {
  buildBrowserControlPlugin,
  buildBundledPlugins,
  buildDesktopControlPlugin,
  buildProjectAwarenessPlugin,
  buildWebSearchPlugin,
} from './plugins'
import { SpeechApplicationService } from './SpeechApplicationService'

export interface ApplicationDependencies {
  createWindow(): Promise<void>
  initialize(): Promise<void>
  isQuitting(): boolean
  prepareForQuit(): Promise<void>
  shutdown(): void
}

export function buildApplicationDependencies(): ApplicationDependencies {
  const motionProvider = process.env.SHIO_EXPERIMENT_MOTION_PROVIDER?.trim() || 'ardy'
  if (!['ardy', 'motionbricks'].includes(motionProvider))
    throw new Error('Invalid SHIO_EXPERIMENT_MOTION_PROVIDER')
  if (app.isPackaged && motionProvider !== 'ardy')
    throw new Error('Experimental MotionBricks requires a development checkout')
  const motionRoot =
    process.env.SHIO_MOTION_ROOT?.trim() ||
    (app.isPackaged
      ? join(app.getPath('userData'), 'motion')
      : join(app.getAppPath(), motionProvider === 'motionbricks' ? 'motionbricks' : 'motion'))
  if (!isAbsolute(motionRoot)) throw new Error('SHIO_MOTION_ROOT must be absolute')
  const ardy = new ArdyMotionService(
    motionRoot,
    () => getRendererConfig().vrmAssetHandle,
    motionProvider as 'ardy' | 'motionbricks',
    motionProvider === 'motionbricks' && process.env.SHIO_EXPERIMENT_SOMA_HAND === '1',
  )
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
  let browserControl: BrowserControlPlugin | null = null
  let webSearch: WebSearchPlugin | null = null
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
  const conversationThreads = new ConversationThreadRuntime(
    join(app.getPath('userData'), 'conversation', 'threads.sqlite'),
  )
  const aliveStore = new AliveStore(join(app.getPath('userData'), 'alive', 'alive.sqlite'))
  const legacyHabits = aliveStore.legacyHabitRecords()
  if (semanticMemory.status().operational) {
    if (legacyHabits.length > 0) semanticMemory.importLegacyHabits(legacyHabits)
    aliveStore.completeLegacyHabitMigration()
  }
  const memoryToolBroker = new MemoryToolBroker(semanticMemory)
  let unsubscribePluginCapabilities: (() => void) | null = null
  let unsubscribeProjectCapabilities: (() => void) | null = null
  let unsubscribeDesktopCapabilities: (() => void) | null = null
  let unsubscribeBrowserCapabilities: (() => void) | null = null
  let unsubscribeMemoryCapabilities: (() => void) | null = null
  let lastAvatarState: unknown = null
  let lastAvatarMouth: unknown = null
  let lastAvatarBody: BodyPresentationProjection | null = null
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
    return buildProjectAwarenessPlugin({
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
      desktopControl = buildDesktopControlPlugin({
        adapter: new DshHarnessAdapter({
          model: () => {
            const { activeProvider, providers } = getConfig().llm
            const definition = getProviderDefinition(activeProvider)
            const credential = getLlmCredentialStore().resolve(activeProvider)
            const accountId = resolveLlmProviderAccountId(
              activeProvider,
              providers[activeProvider].accountId,
            )
            return {
              provider: activeProvider,
              providerDisplayName: definition.profile.displayName,
              model: providers[activeProvider].model.trim(),
              baseURL: resolveProviderChatBaseUrl(activeProvider, { accountId }).replace(/\/$/, ''),
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
          }),
        }),
        authorityMode: () => getConfig().desktopAuthorityMode,
      })
      unsubscribeDesktopCapabilities = desktopControl.onChanged(() =>
        capabilityCatalog.invalidate(),
      )
    }
    return desktopControl
  }

  const getWebSearch = (): WebSearchPlugin => {
    webSearch ??= buildWebSearchPlugin()
    return webSearch
  }

  const getBrowserControl = (): BrowserControlPlugin => {
    if (!browserControl) {
      const browser = new PlaywrightBrowserAdapter({
        executablePath: resolveChromeExecutable(),
        profileDirectory: join(
          app.getPath('userData'),
          'plugins',
          BROWSER_CONTROL_MANIFEST.id,
          'profile',
        ),
      })
      const resolveVisualModel = () => {
        const config = getConfig().llm
        const role = config.roles.computerUseVision
        const automatic = !role.providerId
        const provider = role.providerId || config.activeProvider
        const providerSettings = config.providers[provider]
        const credential = getLlmCredentialStore().resolve(provider)
        const accountId = resolveLlmProviderAccountId(provider, providerSettings.accountId)
        return {
          automatic,
          provider,
          apiKey: credential.apiKey,
          model: automatic ? providerSettings.model.trim() : role.model.trim(),
          accountId,
        }
      }
      const visualGateway = new LlmGateway(resolveVisualModel)
      const visualProvider = (): LlmGateway | undefined => {
        const selection = resolveVisualModel()
        const profile = getProviderDefinition(selection.provider).profile
        if (
          !selection.model ||
          (profile.requiresApiKey && !selection.apiKey.trim()) ||
          (profile.requiresAccountId && !selection.accountId.trim())
        ) {
          return undefined
        }
        return visualGateway
      }
      const visual = new LlmBrowserVisualActionAdapter({
        provider: visualProvider,
        modelLabel: () => {
          const selection = resolveVisualModel()
          const label = `${selection.provider}/${selection.model || 'not configured'}`
          return selection.automatic ? `Auto · ${label}` : label
        },
        timeoutMs: () => getConfig().llm.roles.computerUseVision.timeoutMs,
      })
      browserControl = buildBrowserControlPlugin({
        browser,
        computerUse: new BrowserComputerUseRuntime({
          browser,
          visual,
          maximumSteps: () => getConfig().llm.roles.computerUseVision.maxSteps,
          onEvent: (event) => {
            const phase = event.type.replace('computer-use-', '') as
              | 'started'
              | 'progress'
              | 'notable-observation'
              | 'blocked'
              | 'completed'
              | 'failed'
              | 'stopped'
            aliveRuntime?.reportExperience({
              type: 'browser-computer-use-event',
              at: event.at,
              sessionId: event.sessionId,
              phase,
              ...(event.observation ? { observation: event.observation } : {}),
              ...(event.errorCode ? { errorCode: event.errorCode } : {}),
            })
          },
        }),
        authorityMode: () => getConfig().desktopAuthorityMode,
        refreshVisualModel: async () => {
          if (visualProvider()) await visualGateway.refreshActiveCapabilities()
        },
      })
      unsubscribeBrowserCapabilities = browserControl.onChanged(() =>
        capabilityCatalog.invalidate(),
      )
    }
    return browserControl
  }

  const getPluginRuntime = (): PluginRuntime => {
    if (!pluginRuntime) {
      pluginRuntime = new PluginRuntime(
        buildBundledPlugins(
          getProjectAwareness(),
          getDesktopControl(),
          getWebSearch(),
          getBrowserControl(),
        ),
        new PluginRegistryStore(join(app.getPath('userData'), 'plugins', 'registry.json'), [
          PROJECT_AWARENESS_MANIFEST,
          DESKTOP_CONTROL_MANIFEST,
          WEB_SEARCH_MANIFEST,
          BROWSER_CONTROL_MANIFEST,
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
    browserControl: () => getBrowserControl().getStatus(),
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
      () => pluginCapabilities.get('project-context'),
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
      () => pluginCapabilities.get('browser-control'),
      new BrowserWorkflowCoordinator(browserWorkflowScopes),
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
      () => {
        const alive = aliveRuntime?.snapshot()
        return {
          mood: alive?.mood,
          experience: alive?.lastExperience,
          world: alive?.world,
          relationship: semanticMemory.relationshipContext(),
          habits: semanticMemory.relevantHabitMotifs(),
        }
      },
      () => pluginCapabilities.get('web-search'),
      () => pluginCapabilities.get('browser-computer-use'),
      async (
        request: BrowserComputerUseStartRequest | BrowserComputerUseControlAction,
        signal: AbortSignal,
      ) => {
        const runtime = actionRuntime
        if (!runtime || signal.aborted) throw new LlmTurnCancelledError()
        const control = 'operation' in request
        const action = await runtime.execute<
          BrowserComputerUseStartRequest | BrowserComputerUseControlAction,
          BrowserComputerUseSession
        >({
          name: control ? 'browser.use-control' : 'browser.use',
          payload: request,
          signal,
        })
        return {
          outcome: action.status,
          ...(action.authorization ? { authorization: action.authorization } : {}),
          ...(action.result ? { session: action.result } : {}),
          ...(action.errorCode ? { errorCode: action.errorCode } : {}),
        }
      },
      conversationThreads,
      { enforceRequirements: true },
      () => lastAvatarRuntimeHealth,
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
      unsubscribeBrowserCapabilities?.()
      unsubscribeBrowserCapabilities = null
      unsubscribeMemoryCapabilities?.()
      unsubscribeMemoryCapabilities = null
      capabilityCatalog.dispose()

      const cleanupOwners = [
        'conversation-turn-service',
        'speech-application-service',
        'action-runtime',
        'plugin-runtime',
        'alive-runtime',
        'conversation-threads',
      ] as const
      const cleanupResults = await Promise.allSettled([
        conversationTurnService?.dispose() ?? Promise.resolve(),
        speechApplicationService?.dispose() ?? Promise.resolve(),
        ardy.dispose(),
        actionRuntime?.emergencyStop() ?? Promise.resolve(),
        pluginRuntime?.dispose() ?? Promise.resolve(),
        Promise.resolve().then(() => aliveRuntime?.dispose()),
        Promise.resolve().then(() => conversationThreads.close()),
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
    win.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
      if (!isMainFrame) return
      lastAvatarBody = null
      overlayWindows.send('avatar-body:updated', null)
      observeMainPromise(ardy.releaseOwner(rendererId), 'release ARDY before renderer navigation')
    })
    win.webContents.once('destroyed', () => {
      lastAvatarBody = null
      overlayWindows.send('avatar-body:updated', null)
      observeMainPromise(ardy.releaseOwner(rendererId), 'release ARDY renderer owner')
      networkObserver.dispose()
      if (rendererNetworkObserver === networkObserver) rendererNetworkObserver = null
      screenContextService.disposeRenderer(rendererId)
    })
    win.webContents.on('render-process-gone', () => {
      lastAvatarBody = null
      overlayWindows.send('avatar-body:updated', null)
      observeMainPromise(ardy.releaseOwner(rendererId), 'release ARDY after renderer failure')
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
      browserControl: getBrowserControl,
      onEvent: (event) => {
        const experience = actionExperienceEvent(event)
        if (experience) aliveRuntime?.reportExperience(experience)
      },
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
    speechApplicationService = new SpeechApplicationService(getSpeechClientManager)
    registerIpcHandlers(
      resolveOrchestrator,
      resolveLlmGateway,
      getLlmCredentialStore,
      getPluginRuntime,
      getProjectAwareness,
      getDesktopControl,
      getBrowserControl,
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
      experienceContext: () => semanticMemory.relationshipContext(),
      proceduralMemory: {
        observeCompletedFact: (fact) => {
          semanticMemory.observeCompletedFact(fact)
        },
        habitSuggestions: () =>
          semanticMemory.habitSuggestions().map((habit) => ({
            id: habit.id,
            key: habit.key,
            title: habit.summary,
            evidenceCount: habit.evidenceCount,
            status:
              habit.status === 'candidate'
                ? 'pending'
                : habit.status === 'disabled'
                  ? 'rejected'
                  : habit.status,
            createdAt: habit.firstObservedAt,
            updatedAt: habit.lastObservedAt,
          })),
        decideHabit: (id, status) => {
          semanticMemory.decideHabit(id, status)
        },
      },
      systemContextAdapter:
        process.platform === 'win32'
          ? new WindowsSystemContextAdapter({
              getGlobalIdleSeconds: () => powerMonitor.getSystemIdleTime(),
              pwshPath: resolvePwshPath(undefined, process.env, process.platform),
            })
          : undefined,
      worldContext: {
        browser: () => browserControl?.getBrowserContextProvider().currentObservation() ?? null,
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
        recentIncidents: () => conversationTurnService?.recentIncidents() ?? [],
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
    registerMotionIpc(ardy, ipcAuthorization)
    observeMainPromise(ardy.warmup(), 'warm up ARDY')
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
        getAvatarBody: () => lastAvatarBody,
        publishAvatarBody: (owner, value) => {
          if (value?.lease && !ardy.owns(owner, value.lease)) return false
          if (
            value &&
            lastAvatarBody &&
            lastAvatarBody.modelAssetHandle === getRendererConfig().vrmAssetHandle
          ) {
            const previous =
              lastAvatarBody.lease?.avatarGeneration ?? lastAvatarBody.localGeneration ?? 0
            const current = value.lease?.avatarGeneration ?? value.localGeneration ?? 0
            if (current < previous) return false
          }
          lastAvatarBody = value
            ? { ...value, modelAssetHandle: getRendererConfig().vrmAssetHandle }
            : null
          overlayWindows.send('avatar-body:updated', lastAvatarBody)
          return true
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
