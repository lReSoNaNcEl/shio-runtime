import type { DesktopAuthorityMode, DesktopWorkflowRequest } from '../../shared/actions'
import type {
  BrowserComputerUseProvider,
  BrowserComputerUseSession,
  BrowserComputerUseStartRequest,
} from '../../shared/browser-computer-use'
import {
  type BrowserContextProvider,
  type BrowserControlStatus,
  PLAYWRIGHT_CORE_VERSION,
} from '../../shared/browser-control'
import type { PluginCapabilityProviders, PluginHealth, PluginManifest } from '../../shared/plugins'
import { BROWSER_CONTROL_PLUGIN_ID } from '../../shared/plugins'
import {
  ActionError,
  type DesktopWorkflowAdapterResult,
  type EffectiveDesktopWorkflowRequest,
} from '../action'
import { mainLog } from '../logging/safeLogger'
import type { BundledPlugin, PluginInitializationContext } from '../plugins/PluginRuntime'
import type { BrowserComputerUseRuntime } from './computer-use/BrowserComputerUseRuntime'
import { BrowserAutomationError } from './errors'
import type {
  BrowserInteractionResult,
  PlaywrightBrowserAdapter,
} from './playwright/PlaywrightBrowserAdapter'
import {
  classifyBrowserOperationRisk,
  requiresExplicitBrowserConfirmation,
} from './workflow/BrowserRiskPolicy'

export const BROWSER_CONTROL_MANIFEST: PluginManifest = {
  id: BROWSER_CONTROL_PLUGIN_ID,
  version: '1.0.0',
  nameKey: 'plugins.browserControl.name',
  descriptionKey: 'plugins.browserControl.description',
  defaultEnabled: true,
  capabilities: ['browser-control', 'browser-computer-use'],
}

export interface BrowserControlPluginDependencies {
  browser: PlaywrightBrowserAdapter
  computerUse: BrowserComputerUseRuntime
  authorityMode(): DesktopAuthorityMode
  refreshVisualModel?(): Promise<void>
}

export class BrowserControlPlugin implements BundledPlugin {
  readonly manifest = BROWSER_CONTROL_MANIFEST
  private initialized = false
  private active = false
  private disposed = false
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribeComputerUse: () => void
  private readonly browserContextProvider: BrowserContextProvider = {
    currentObservation: () => this.dependencies.browser.observationSnapshot(),
    observe: async ({ signal }) => {
      this.assertActive()
      return this.dependencies.browser.observe(signal)
    },
  }
  private readonly computerUseProvider: BrowserComputerUseProvider = {
    browserContext: this.browserContextProvider,
    status: () => this.computerUseStatus(),
    start: (request, authorityScopeId, signal) => {
      this.assertActive()
      return this.dependencies.computerUse.start(request, authorityScopeId, signal)
    },
    pause: () => this.dependencies.computerUse.pause(),
    resume: (signal) => this.dependencies.computerUse.resume(signal),
    stop: () => this.dependencies.computerUse.stop(),
  }

  constructor(private readonly dependencies: BrowserControlPluginDependencies) {
    this.unsubscribeComputerUse = dependencies.computerUse.onChanged(() => this.publishChanged())
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async initialize(_context: PluginInitializationContext): Promise<void> {
    if (this.initialized) return
    try {
      await this.dependencies.refreshVisualModel?.()
    } catch (error) {
      mainLog.warn('[BrowserControlPlugin] visual model catalog refresh failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    this.initialized = true
    this.publishChanged()
  }

  async start(): Promise<void> {
    this.assertInitialized()
    this.active = true
    this.publishChanged()
  }

  async stop(): Promise<void> {
    this.active = false
    await this.dependencies.computerUse.dispose()
    await this.dependencies.browser.close()
    this.publishChanged()
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.stop()
    this.unsubscribeComputerUse()
    this.listeners.clear()
  }

  async getHealth(): Promise<PluginHealth> {
    if (!this.initialized || !this.dependencies.browser.executableAvailable()) {
      return {
        state: 'needs-setup',
        detailKey: 'plugins.browserControl.chromeMissing',
        checkedAt: Date.now(),
      }
    }
    return {
      state: 'healthy',
      detailKey: this.active ? 'plugins.health.healthy' : 'plugins.health.disabledHealthy',
      checkedAt: Date.now(),
    }
  }

  getStatus(): BrowserControlStatus {
    const visual = this.computerUseStatus()
    return {
      enabled: this.active,
      browserName: 'Google Chrome',
      backend: 'playwright',
      backendVersion: PLAYWRIGHT_CORE_VERSION,
      executableAvailable: this.dependencies.browser.executableAvailable(),
      isolatedProfile: true,
      semanticControl:
        this.active && this.dependencies.browser.executableAvailable() ? 'ready' : 'unavailable',
      visualControl: visual.visualControl,
      visualModel: visual.visualModel,
      session: visual.currentSession,
    }
  }

  getCapabilityProviders(): PluginCapabilityProviders {
    return {
      'browser-control': this.browserContextProvider,
      'browser-computer-use': this.computerUseProvider,
    }
  }

  getBrowserContextProvider(): BrowserContextProvider {
    return this.browserContextProvider
  }

  getBrowserComputerUseProvider(): BrowserComputerUseProvider {
    return this.computerUseProvider
  }

  validateWorkflowRequest(
    request: EffectiveDesktopWorkflowRequest,
  ): EffectiveDesktopWorkflowRequest {
    const operation =
      request.browserOperation ??
      (request.browserUrl ? { operation: 'open' as const, url: request.browserUrl } : undefined)
    const browserRiskClass = classifyBrowserOperationRisk(
      operation,
      this.dependencies.browser.observationSnapshot(),
    )
    return {
      ...request,
      risk: requiresExplicitBrowserConfirmation(browserRiskClass) ? 'destructive' : 'normal',
      browserRiskClass,
    }
  }

  async executeWorkflow(
    request: EffectiveDesktopWorkflowRequest,
    signal: AbortSignal,
  ): Promise<DesktopWorkflowAdapterResult> {
    this.assertActive()
    if (
      request.requestedCapabilities.length !== 1 ||
      request.requestedCapabilities[0] !== 'browser'
    ) {
      throw new ActionError(
        'BROWSER_CAPABILITY_UNAVAILABLE',
        'Browser Control accepts only the browser capability',
        'failure',
        true,
        'browser-control',
      )
    }
    const operation =
      request.browserOperation ??
      (request.browserUrl ? { operation: 'open' as const, url: request.browserUrl } : undefined)
    if (!operation) {
      throw new ActionError(
        'BROWSER_USE_REQUIRED',
        'Ambiguous browser goals require browser.use',
        'failure',
        true,
        'browser-control',
      )
    }
    try {
      const result = await this.executeOperation(operation, signal)
      return {
        runtimeCompleted: true,
        evidence: {
          ...result.evidence,
          riskClass:
            request.browserRiskClass ??
            classifyBrowserOperationRisk(
              operation,
              result.observation ?? this.dependencies.browser.observationSnapshot(),
            ),
        },
      }
    } catch (error) {
      if (error instanceof ActionError) throw error
      if (error instanceof BrowserAutomationError) {
        throw new ActionError(
          error.code,
          error.message,
          signal.aborted ? 'cancelled' : 'failure',
          error.recoverable,
          'browser-control',
        )
      }
      throw error
    }
  }

  observeForVerification(signal: AbortSignal) {
    this.assertActive()
    return this.dependencies.browser.observe(signal)
  }

  async startComputerUse(
    request: BrowserComputerUseStartRequest,
    actionId: string,
    signal: AbortSignal,
  ): Promise<BrowserComputerUseSession> {
    this.assertActive()
    return this.dependencies.computerUse.start(request, actionId, signal)
  }

  executeComputerUseControl(
    operation: 'pause' | 'resume' | 'stop',
    signal: AbortSignal,
  ): Promise<BrowserComputerUseSession> {
    this.assertActive()
    if (operation === 'pause') return this.dependencies.computerUse.pause()
    if (operation === 'resume') return this.dependencies.computerUse.resume(signal)
    return this.dependencies.computerUse.stop()
  }

  async emergencyStop(): Promise<void> {
    await this.dependencies.computerUse.emergencyStop()
    this.publishChanged()
  }

  private computerUseStatus() {
    const status = this.dependencies.computerUse.snapshot()
    const visual = this.dependencies.computerUse.visualStatus()
    return {
      enabled: this.active,
      browser: 'Google Chrome' as const,
      isolatedProfile: true as const,
      semanticControl:
        this.active && this.dependencies.browser.executableAvailable()
          ? ('ready' as const)
          : ('unavailable' as const),
      visualControl: visual.state,
      visualModel: visual.model,
      currentSession: status,
    }
  }

  private executeOperation(
    operation: NonNullable<DesktopWorkflowRequest['browserOperation']>,
    signal: AbortSignal,
  ): Promise<BrowserInteractionResult> {
    switch (operation.operation) {
      case 'observe':
        return this.dependencies.browser.observePage(signal)
      case 'open':
        return this.dependencies.browser.open(operation.url, signal)
      case 'click':
        return this.dependencies.browser.click(operation.target, signal)
      case 'fill':
        return this.dependencies.browser.fill(operation.target, operation.value, signal)
      case 'select':
        return this.dependencies.browser.select(operation.target, operation.values, signal)
      case 'scroll':
        return this.dependencies.browser.scroll(operation.direction, operation.amount, signal)
      case 'back':
        return this.dependencies.browser.back(signal)
      case 'forward':
        return this.dependencies.browser.forward(signal)
      case 'tabs':
        return this.dependencies.browser.inspectTabs(signal)
      case 'switch-tab':
        return this.dependencies.browser.switchTab(operation.tabId, signal)
    }
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('Browser Control plugin is not initialized')
  }

  private assertActive(): void {
    this.assertInitialized()
    if (!this.active) {
      throw new ActionError(
        'BROWSER_CONTROL_DISABLED',
        'Browser Control plugin is disabled',
        'failure',
        true,
        'browser-control',
      )
    }
  }

  private publishChanged(): void {
    for (const listener of this.listeners) listener()
  }
}
