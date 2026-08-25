import type {
  BrowserGameControlAction,
  BrowserGameControlProvider,
  BrowserGameStatus,
  CharacterGameStartRequest,
  GameSemanticEvent,
  GameStartPreparation,
  GameStrategy,
} from '../../shared/browser-game'
import type { BrowserRealtimeControlProvider } from '../../shared/desktop-control'
import type { PluginHealth, PluginManifest } from '../../shared/plugins'
import { BROWSER_GAME_CONTROL_PLUGIN_ID } from '../../shared/plugins'
import type { BundledPlugin, PluginInitializationContext } from '../plugins/PluginRuntime'
import type { GameEventExtractor } from './GameEventExtractor'
import type { GameReflexAdapter } from './GameReflexAdapter'
import { ObservingGameReflexAdapter } from './GameReflexAdapter'
import type { GameReflexPolicy } from './GameReflexPolicy'
import { AdapterBackedGameReflexPolicy } from './GameReflexPolicy'
import { GameSessionController } from './GameSessionController'

export const BROWSER_GAME_CONTROL_MANIFEST: PluginManifest = {
  id: BROWSER_GAME_CONTROL_PLUGIN_ID,
  version: '1.0.0',
  nameKey: 'plugins.browserGame.name',
  descriptionKey: 'plugins.browserGame.description',
  defaultEnabled: false,
  capabilities: ['browser-game-control'],
  requiresCapabilities: ['browser-realtime-control'],
}

interface BrowserGamePluginOptions {
  realtime(): BrowserRealtimeControlProvider | undefined
  reflex?: GameReflexPolicy
  reflexAdapter?: GameReflexAdapter
  reflexReady?: boolean
  eventExtractor?: GameEventExtractor
  onGameEvent?: (event: GameSemanticEvent) => void
}

export class BrowserGamePlugin implements BundledPlugin {
  readonly manifest = BROWSER_GAME_CONTROL_MANIFEST
  private readonly controller: GameSessionController
  private readonly provider: BrowserGameControlProvider
  private initialized = false
  private active = false
  private disposed = false
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribeController: () => void
  private readonly reflexReady: () => boolean

  constructor(private readonly options: BrowserGamePluginOptions) {
    const reflexAdapter = options.reflexAdapter ?? new ObservingGameReflexAdapter()
    this.controller = new GameSessionController({
      realtime: options.realtime,
      reflex: options.reflex ?? new AdapterBackedGameReflexPolicy(reflexAdapter),
      eventExtractor: options.eventExtractor,
      onEvent: options.onGameEvent,
    })
    this.reflexReady = () =>
      options.reflexReady ?? (!options.reflex && reflexAdapter.status().ready)
    this.unsubscribeController = this.controller.onChanged(() => this.publishChanged())
    this.provider = {
      discoverSurfaces: (signal) => this.withActive(() => this.controller.discoverSurfaces(signal)),
      prepareStart: (request: CharacterGameStartRequest, signal: AbortSignal) =>
        this.withActive(() => this.controller.prepareStart(request, signal)),
      start: (preparationId: string, authorizationActionId: string, signal: AbortSignal) =>
        this.withActive(() => this.controller.start(preparationId, authorizationActionId, signal)),
      pause: () => this.withActive(() => this.controller.pause()),
      resume: () => this.withActive(() => this.controller.resume()),
      stop: () => this.withActive(() => this.controller.stop()),
      updateStrategy: (strategy: GameStrategy) =>
        this.withActive(() => this.controller.updateStrategy(strategy)),
      status: () => this.withActive(() => this.controller.status()),
    }
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async initialize(_context: PluginInitializationContext): Promise<void> {
    if (this.disposed) throw new Error('Browser Game Plugin is disposed')
    this.initialized = true
  }

  async start(): Promise<void> {
    if (!this.initialized || this.disposed) throw new Error('Browser Game Plugin is unavailable')
    if (!this.options.realtime()) throw new Error('Browser realtime control is unavailable')
    this.active = true
    this.publishChanged()
  }

  async stop(): Promise<void> {
    this.active = false
    await this.controller.stop()
    this.publishChanged()
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    await this.stop()
    this.disposed = true
    this.unsubscribeController()
    this.listeners.clear()
  }

  getHealth(): PluginHealth {
    if (!this.initialized) {
      return {
        state: 'needs-setup',
        detailKey: 'plugins.health.needsSetup',
        checkedAt: Date.now(),
      }
    }
    if (!this.active) {
      return {
        state: 'healthy',
        detailKey: 'plugins.health.disabledHealthy',
        checkedAt: Date.now(),
      }
    }
    if (!this.options.realtime()) {
      return {
        state: 'needs-setup',
        detailKey: 'plugins.health.dependencyUnavailable',
        checkedAt: Date.now(),
      }
    }
    const status = this.controller.status()
    if (status.state === 'error') {
      return { state: 'degraded', detail: status.lastErrorCode, checkedAt: Date.now() }
    }
    if (this.active && !this.reflexReady()) {
      return {
        state: 'needs-setup',
        detailKey: 'plugins.browserGame.reflexNeedsSetup',
        checkedAt: Date.now(),
      }
    }
    return {
      state: 'healthy',
      detailKey: 'plugins.health.healthy',
      checkedAt: Date.now(),
    }
  }

  getBrowserGameControlProvider(): BrowserGameControlProvider {
    return this.provider
  }

  getStatus(): BrowserGameStatus {
    return this.controller.status()
  }

  getPreparedStart(preparationId: string): GameStartPreparation {
    this.assertActive()
    return this.controller.prepared(preparationId)
  }

  executeControl(
    action: Exclude<BrowserGameControlAction, { operation: 'start' }>,
  ): Promise<BrowserGameStatus> | BrowserGameStatus {
    this.assertActive()
    switch (action.operation) {
      case 'pause':
        return this.controller.pause()
      case 'resume':
        if (action.strategy) this.controller.updateStrategy(action.strategy)
        return this.controller.status().state === 'running'
          ? this.controller.status()
          : this.controller.resume()
      case 'stop':
        return this.controller.stop()
      case 'strategy':
        return this.controller.updateStrategy(action.strategy)
    }
  }

  emergencyStop(): Promise<BrowserGameStatus> {
    return this.controller.stop()
  }

  private withActive<T>(operation: () => T): T {
    this.assertActive()
    return operation()
  }

  private assertActive(): void {
    if (!this.active) throw new Error('Browser Game Plugin is disabled')
  }

  private publishChanged(): void {
    for (const listener of this.listeners) listener()
  }
}
