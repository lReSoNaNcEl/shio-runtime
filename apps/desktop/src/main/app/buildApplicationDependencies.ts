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
import { watchBlockReason } from '../../shared/watchTogether'
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
import { registerWatchTogetherIpc } from '../ipc/registerWatchTogetherIpc'
import {
  getProviderProfile,
  LlmCredentialStore,
  LlmGateway,
  type LlmProviderId,
  type LlmRoleId,
  type LlmRoleSources,
  LlmTurnCancelledError,
  type ResolvedLlmRoleSettings,
  resolveLlmReadiness,
  resolveLlmRoleFallbacks,
  resolveLlmRoleSettings,
} from '../llm'
import { stopCodexRequests } from '../llm/CodexCliProvider'
import { mainLog } from '../logging/safeLogger'
import {
  createLlmSessionSummarizer,
  createMemoryStore,
  createSemanticMemoryRuntime,
  MemoryToolBroker,
  type SessionSummarizer,
} from '../memory'
import { FlashMotionSpeech } from '../motion/FlashMotionSpeech'
import { GeneratedMotionService } from '../motion/GeneratedMotionService'
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
import { WatchTogetherService } from '../watch-together/WatchTogetherService'
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
  const flashSpeech = new FlashMotionSpeech()
  const motionRoot = app.isPackaged
    ? join(process.resourcesPath, 'motion-runtime')
    : app.getAppPath()
  const localRoot =
    process.env.SHIO_LOCAL_ROOT ||
    join(process.env.LOCALAPPDATA || app.getPath('appData'), 'Shio Runtime')
  const motionAssets = app.isPackaged ? join(localRoot, 'Data', 'FlashMotion') : undefined
  if (motionAssets && !isAbsolute(motionAssets)) throw new Error('SHIO_LOCAL_ROOT must be absolute')
  const motion = new GeneratedMotionService(
    join(motionRoot, 'flashmotion'),
    () => getRendererConfig().vrmAssetHandle,
    process.env.SHIO_MOTION_ENABLED !== '0',
    flashSpeech,
    motionAssets,
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
  let disposeWatch: (() => void) | undefined
  let unsubscribeAliveIpc: (() => void) | null = null
  let unsubscribeAliveCapabilities: (() => void) | null = null
  let unsubscribeLatencyIpc: (() => void) | null = null
  let prepareForQuitTask: Promise<void> | null = null
  let sessionSummarizer: SessionSummarizer | undefined
  // In-process only: the summarizer role reuses the Character selection and credentials.
  const conversationMemory = createMemoryStore({
    summarizer: () =>
      (sessionSummarizer ??= createLlmSessionSummarizer(
        () => new LlmGateway(() => gatewaySettings(resolveRoleSettings('sessionSummarizer'))),
      )),
  })
  const semanticMemory = createSemanticMemoryRuntime(
    join(app.getPath('userData'), 'memory', 'semantic-memory.sqlite'),
  )
  const conversationThreads = new ConversationThreadRuntime(
    join(app.getPath('userData'), 'conversation', 'threads.sqlite'),
  )
  const aliveStore = new AliveStore(join(app.getPath('userData'), 'alive', 'alive.sqlite'))
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
  const screenContextService = new ScreenContextService(
    new ScreenCaptureAdapter((sourceId) => !overlayWindows.isCaptureSource(sourceId)),
  )
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
      'codex-cli': [],
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

  /** The single composition point that resolves provider, model, key and account for a role. */
  const roleSources: LlmRoleSources = {
    config: () => getConfig().llm,
    credential: (provider) => getLlmCredentialStore().resolve(provider),
  }
  const resolveRoleSettings = (role: LlmRoleId): ResolvedLlmRoleSettings =>
    resolveLlmRoleSettings(role, roleSources)
  const roleFallbacks = (role: LlmRoleId): ResolvedLlmRoleSettings[] =>
    resolveLlmRoleFallbacks(role, roleSources)
  const gatewaySettings = ({
    provider,
    apiKey,
    model,
    accountId,
    reasoningEffort,
  }: ResolvedLlmRoleSettings) => ({
    provider,
    apiKey,
    model,
    accountId,
    reasoningEffort,
  })

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
        characterModel: () => {
          const character = resolveRoleSettings('character')
          const profile = getProviderProfile(character.provider)
          return {
            provider: character.provider,
            providerDisplayName: profile.displayName,
            model: character.model,
            configured:
              Boolean(character.model.trim()) &&
              (!profile.requiresApiKey || character.credential.configured) &&
              (!profile.requiresAccountId || Boolean(character.accountId?.trim())),
            lastError: character.credential.lastError,
          }
        },
        adapter: new DshHarnessAdapter({
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
        const {
          automatic,
          provider,
          apiKey,
          model,
          accountId = '',
          reasoningEffort,
        } = resolveRoleSettings('computerUseVision')
        return { automatic, provider, apiKey, model, accountId, reasoningEffort }
      }
      const visualGateway = new LlmGateway(resolveVisualModel)
      const visualProvider = (): LlmGateway | undefined => {
        const selection = resolveVisualModel()
        const profile = getProviderProfile(selection.provider)
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
    llmGateway = new LlmGateway(
      () => gatewaySettings(resolveRoleSettings('character')),
      () => roleFallbacks('character').map(gatewaySettings),
      {
        // Non-secret telemetry: which candidate served after a pre-byte failure.
        onFailover: (event) => mainLog.warn('[LlmGateway] character_failover', event),
        onServed: (event) => {
          if (event.attempt > 0) mainLog.info('[LlmGateway] character_fallback_served', event)
        },
      },
    )
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
      () => {
        const alive = aliveRuntime?.snapshot()
        return {
          mood: alive?.mood,
          experience: alive?.lastExperience,
          world: alive?.world,
          relationship: semanticMemory.relationshipContext(),
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
      conversationMemory.dispose()

      disposeWatch?.()
      disposeWatch = undefined
      const cleanupOwners = [
        'codex-cli',
        'conversation-turn-service',
        'speech-application-service',
        'action-runtime',
        'plugin-runtime',
        'alive-runtime',
        'conversation-threads',
      ] as const
      const cleanupResults = await Promise.allSettled([
        stopCodexRequests(),
        conversationTurnService?.dispose() ?? Promise.resolve(),
        speechApplicationService?.dispose() ?? Promise.resolve(),
        motion.dispose(),
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
      observeMainPromise(
        motion.releaseOwner(rendererId),
        'release generated motion before renderer navigation',
      )
    })
    win.webContents.once('destroyed', () => {
      lastAvatarBody = null
      overlayWindows.send('avatar-body:updated', null)
      observeMainPromise(motion.releaseOwner(rendererId), 'release generated motion renderer owner')
      networkObserver.dispose()
      if (rendererNetworkObserver === networkObserver) rendererNetworkObserver = null
      screenContextService.disposeRenderer(rendererId)
    })
    win.webContents.on('render-process-gone', () => {
      lastAvatarBody = null
      overlayWindows.send('avatar-body:updated', null)
      observeMainPromise(
        motion.releaseOwner(rendererId),
        'release generated motion after renderer failure',
      )
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
    conversationTurnService = new MainConversationTurnService(
      resolveOrchestrator,
      resolveLlmGateway,
      screenContextService,
      () => getRendererConfig().llm,
      (turnId, appraisal) => aliveRuntime?.recordTurnAppraisal(turnId, appraisal),
      (turnId) => watch.takeReply(turnId),
      (turnId, userText) => watch.takeUserTurn(turnId, userText),
    )
    speechApplicationService = new SpeechApplicationService(getSpeechClientManager, flashSpeech)
    registerIpcHandlers(
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
    aliveRuntime = new AliveRuntime(aliveStore, {
      experienceContext: () => semanticMemory.relationshipContext(),
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
    unsubscribeAliveCapabilities = aliveRuntime.onChanged(() => capabilityCatalog.invalidate())
    unsubscribeAliveIpc = registerAliveIpc(aliveRuntime, win, ipcAuthorization)
    const watchWindow = win
    const watchAlive = aliveRuntime
    const referenceAvailable = () => {
      if (!pluginCapabilities.get('browser-control')) return false
      const status = browserControl?.getStatus()
      return (
        status?.semanticControl === 'ready' &&
        (!status.session || ['completed', 'failed', 'stopped'].includes(status.session.state))
      )
    }
    const watch = new WatchTogetherService({
      reference: {
        available: referenceAvailable,
        open: async (url, signal) => {
          if (!referenceAvailable()) return
          const action = await actionComposition.actions.execute<
            DesktopWorkflowRequest,
            DesktopWorkflowAdapterResult
          >({
            name: 'desktop.workflow',
            payload: {
              type: 'desktop.workflow',
              requestedCapabilities: ['browser'],
              risk: 'normal',
              goal:
                getRendererConfig().uiLocale === 'en'
                  ? 'Check the reference page for this live share'
                  : 'Свериться со страницей этой трансляции',
              browserOperation: { operation: 'open', url },
            },
            signal,
          })
          const evidence = action.result?.evidence
          if (
            action.status === 'success' &&
            action.verification?.status === 'verified' &&
            evidence?.kind === 'browser' &&
            evidence.navigationStatus !== undefined &&
            evidence.navigationStatus >= 200 &&
            evidence.navigationStatus < 300 &&
            evidence.after?.url === url
          )
            return evidence.after.observationId
        },
        read: (id) => {
          const observation = pluginCapabilities.get('browser-control')?.currentObservation()
          if (observation?.observationId === id)
            return {
              title: observation.title?.slice(0, 160),
              excerpt: observation.content.slice(0, 700),
            }
        },
      },
      language: () => getRendererConfig().uiLocale ?? 'ru',
      captureBlock: () => watchBlockReason(aliveStore.settings()),
      canComment: () => watchAlive.canCommentOnPlayback(),
      model: resolveLlmGateway,
      admit: (expiresAt, current) => watchAlive.admitWatchMoment(expiresAt, current),
      react: (sessionId, reaction, expiresAt) =>
        watchAlive.reportExperience({
          type: 'watch-screen-moment',
          at: Date.now(),
          sessionId,
          reaction,
          expiresAt,
        }),
      ended: (event) => {
        overlayWindows.setCaptureExcluded(false)
        if (!watchWindow.isDestroyed() && !watchWindow.webContents.isDestroyed())
          watchWindow.webContents.send('watch:stopped', event)
      },
    })
    const removeWatch = registerWatchTogetherIpc(
      watchWindow,
      watch,
      ipcAuthorization,
      overlayWindows,
    )
    const unsubscribeWatch = watchAlive.onChanged(({ settings }) => {
      const reason = watchBlockReason(settings)
      if (reason) watch.stop(undefined, reason)
    })
    disposeWatch = () => {
      unsubscribeWatch()
      removeWatch()
    }
    aliveRuntime.start()
    unsubscribeLatencyIpc = registerLatencyIpc(win, ipcAuthorization)
    registerReleaseSupportHandlers(
      {
        llmCredentials: getLlmCredentialStore,
        plugins: getPluginRuntime,
        speech: getSpeechClientManager,
        isOverlayVisible: () => overlayWindows.isVisible(),
        avatarRuntimeHealth: () => lastAvatarRuntimeHealth,
        motionWorker: () => {
          const { provider, weightsRevision, state, error } = motion.status()
          return { provider, weightsRevision, state, error }
        },
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
    registerMotionIpc(motion, ipcAuthorization)
    if (process.env.SHIO_MOTION_ENABLED !== '0')
      observeMainPromise(motion.warmup(), 'warm up generated motion')
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
          if (value?.lease && !motion.owns(owner, value.lease)) return false
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
