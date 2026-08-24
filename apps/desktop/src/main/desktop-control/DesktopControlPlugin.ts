import type { DesktopAuthorityMode, DesktopWorkflowRequest } from '../../shared/actions'
import type {
  BrowserContextProvider,
  BrowserContextRequirement,
  DesktopControlCapabilityProjection,
  DesktopControlStatus,
} from '../../shared/desktop-control'
import { AGENT_BROWSER_VERSION } from '../../shared/desktop-control'
import type { PluginHealth, PluginManifest } from '../../shared/plugins'
import { DESKTOP_CONTROL_PLUGIN_ID } from '../../shared/plugins'
import { ActionError } from '../action'
import type { BundledPlugin, PluginInitializationContext } from '../plugins/PluginRuntime'
import {
  type AgentBrowserAdapter,
  BrowserAutomationError,
  type BrowserInteractionResult,
} from './AgentBrowserAdapter'
import { DshAdapterError, type DshHarnessAdapter } from './DshHarnessAdapter'
import type { BrowserExecutionEvidence, DesktopWorkflowAdapterResult } from './executionEvidence'

export const DESKTOP_CONTROL_MANIFEST: PluginManifest = {
  id: DESKTOP_CONTROL_PLUGIN_ID,
  version: '1.0.0',
  nameKey: 'plugins.desktopControl.name',
  descriptionKey: 'plugins.desktopControl.description',
  defaultEnabled: false,
  capabilities: ['automation-engine', 'browser-control', 'computer-control'],
}

export interface DesktopControlPluginDependencies {
  adapter: DshHarnessAdapter
  browser: AgentBrowserAdapter
  authorityMode(): DesktopAuthorityMode
}

export class DesktopControlPlugin implements BundledPlugin {
  readonly manifest = DESKTOP_CONTROL_MANIFEST
  private active = false
  private initialized = false
  private disposed = false
  private packagedRuntimeAvailable = false
  private browserAvailability = {
    packagedBinaryAvailable: false,
    executableAvailable: false,
  }
  private shellAvailability = {
    executableAvailable: false,
  }
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribeAdapter: () => void
  private readonly browserContextProvider: BrowserContextProvider = {
    resolveRequirement: ({ userText }) => this.resolveBrowserContextRequirement(userText),
    buildContext: async () => {
      this.assertActive()
      return this.dependencies.browser.observe()
    },
  }

  constructor(private readonly dependencies: DesktopControlPluginDependencies) {
    this.unsubscribeAdapter = dependencies.adapter.onChanged(() => this.publishChanged())
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async initialize(_context: PluginInitializationContext): Promise<void> {
    if (this.initialized) return
    this.packagedRuntimeAvailable = await this.dependencies.adapter.checkAvailability()
    this.browserAvailability = await this.dependencies.adapter.checkBrowserAvailability()
    this.shellAvailability = await this.dependencies.adapter.checkShellAvailability()
    this.initialized = true
    this.publishChanged()
  }

  async start(): Promise<void> {
    this.assertInitialized()
    this.active = true
    this.packagedRuntimeAvailable = await this.dependencies.adapter.checkAvailability()
    this.browserAvailability = await this.dependencies.adapter.checkBrowserAvailability()
    this.shellAvailability = await this.dependencies.adapter.checkShellAvailability()
    this.publishChanged()
  }

  async stop(): Promise<void> {
    this.active = false
    await Promise.allSettled([this.dependencies.adapter.close(), this.dependencies.browser.close()])
    this.publishChanged()
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.stop()
    this.unsubscribeAdapter()
    this.listeners.clear()
  }

  async getHealth(): Promise<PluginHealth> {
    if (!this.initialized) {
      return { state: 'needs-setup', detailKey: 'plugins.health.needsSetup', checkedAt: Date.now() }
    }
    this.packagedRuntimeAvailable = await this.dependencies.adapter.checkAvailability()
    this.browserAvailability = await this.dependencies.adapter.checkBrowserAvailability()
    this.shellAvailability = await this.dependencies.adapter.checkShellAvailability()
    const runtime = this.dependencies.adapter.snapshot()
    const model = this.dependencies.adapter.modelSnapshot()
    const browserReady =
      this.browserAvailability.packagedBinaryAvailable &&
      this.browserAvailability.executableAvailable
    if (!this.packagedRuntimeAvailable) {
      return {
        state: browserReady ? 'degraded' : 'needs-setup',
        detailKey: 'plugins.desktopControl.runtimeMissing',
        checkedAt: Date.now(),
      }
    }
    if (runtime.state === 'error') {
      return {
        state: browserReady ? 'degraded' : 'error',
        detail: runtime.lastError,
        checkedAt: Date.now(),
      }
    }
    if (this.active && this.dependencies.browser.sessionSnapshot()?.status === 'error') {
      return {
        state: 'degraded',
        detailKey: 'plugins.desktopControl.browserSessionError',
        checkedAt: Date.now(),
      }
    }
    if (this.active && !model.configured) {
      return {
        state: browserReady ? 'degraded' : 'needs-setup',
        detailKey: 'plugins.desktopControl.modelNeedsSetup',
        checkedAt: Date.now(),
      }
    }
    if (this.active && !browserReady && !this.shellAvailability.executableAvailable) {
      return {
        state: 'needs-setup',
        detailKey: 'plugins.desktopControl.controlNeedsSetup',
        checkedAt: Date.now(),
      }
    }
    return {
      state: 'healthy',
      detailKey: this.active ? 'plugins.health.healthy' : 'plugins.health.disabledHealthy',
      checkedAt: Date.now(),
    }
  }

  async getStatus(): Promise<DesktopControlStatus> {
    this.assertInitialized()
    this.packagedRuntimeAvailable = await this.dependencies.adapter.checkAvailability()
    this.browserAvailability = await this.dependencies.adapter.checkBrowserAvailability()
    this.shellAvailability = await this.dependencies.adapter.checkShellAvailability()
    const runtime = this.dependencies.adapter.snapshot()
    const model = this.dependencies.adapter.modelSnapshot()
    const automationEngine =
      this.active && this.packagedRuntimeAvailable && model.configured ? 'ready' : 'needs-setup'
    const browserControl =
      this.active &&
      this.browserAvailability.packagedBinaryAvailable &&
      this.browserAvailability.executableAvailable
        ? 'ready'
        : 'needs-setup'
    const computerControl =
      this.active &&
      this.packagedRuntimeAvailable &&
      this.shellAvailability.executableAvailable &&
      model.configured
        ? 'ready'
        : 'needs-setup'
    return {
      enabled: this.active,
      runtime: {
        ...runtime,
        packagedRuntimeAvailable: this.packagedRuntimeAvailable,
      },
      automationEngine,
      browserControl,
      computerControl,
      browser: {
        version: AGENT_BROWSER_VERSION,
        ...this.browserAvailability,
        isolatedProfile: true,
      },
      shell: this.shellAvailability,
      authorityMode: this.dependencies.authorityMode(),
      model,
    }
  }

  async getCapabilityProjection(): Promise<DesktopControlCapabilityProjection> {
    const status = await this.getStatus()
    return {
      enabled: status.enabled,
      automationEngine: status.automationEngine,
      browserControl: status.browserControl,
      computerControl: status.computerControl,
      authorityMode: status.authorityMode,
    }
  }

  async startRuntime(): Promise<DesktopControlStatus> {
    this.assertActive()
    this.shellAvailability = await this.dependencies.adapter.checkShellAvailability()
    await this.dependencies.adapter.start(
      this.shellAvailability.executableAvailable ? 'shell' : 'browser',
    )
    return this.getStatus()
  }

  getBrowserContextProvider(): BrowserContextProvider {
    return this.browserContextProvider
  }

  async stopRuntime(): Promise<DesktopControlStatus> {
    await this.dependencies.adapter.close()
    return this.getStatus()
  }

  async executeWorkflow(
    request: DesktopWorkflowRequest,
    signal: AbortSignal,
  ): Promise<DesktopWorkflowAdapterResult> {
    this.assertActive()
    if (request.requestedCapabilities.length !== 1) {
      throw new ActionError(
        'DESKTOP_CAPABILITY_UNAVAILABLE',
        `Desktop capability is not connected: ${request.requestedCapabilities.join(', ')}`,
        'failure',
        true,
        'desktop-control',
      )
    }
    const capability = request.requestedCapabilities[0]
    if (capability !== 'browser' && capability !== 'shell') {
      throw new ActionError(
        'DESKTOP_CAPABILITY_UNAVAILABLE',
        `Desktop capability is not connected: ${capability}`,
        'failure',
        true,
        'desktop-control',
      )
    }
    const status = await this.getStatus()
    if (capability === 'browser' && status.browserControl !== 'ready') {
      throw new ActionError(
        'BROWSER_CONTROL_NEEDS_SETUP',
        'Browser Control requires the bundled browser bridge and Chrome',
        'failure',
        true,
        'desktop-control',
      )
    }
    if (capability === 'shell' && status.computerControl !== 'ready') {
      throw new ActionError(
        'SHELL_CONTROL_NEEDS_SETUP',
        'Computer Control requires PowerShell and an active model in Settings',
        'failure',
        true,
        'desktop-control',
      )
    }
    try {
      if (capability === 'browser') {
        const operation =
          request.browserOperation ??
          (request.browserUrl
            ? { operation: 'open' as const, url: request.browserUrl }
            : (() => {
                const url = singleHttpUrl(request.goal)
                return url ? { operation: 'open' as const, url } : undefined
              })())
        if (operation) {
          const result = await this.executeBrowserOperation(operation, signal)
          return {
            runtimeCompleted: true,
            evidence: result.evidence,
          }
        }
        if (status.automationEngine !== 'ready') {
          throw new ActionError(
            'DSH_MODEL_NOT_CONFIGURED',
            'Automatic browser planning is unavailable',
            'failure',
            true,
            'desktop-control',
          )
        }
        await this.dependencies.browser.prepareForDelegation(signal)
        const observationBeforeDelegation = await this.dependencies.browser
          .observe(signal)
          .catch(() => undefined)
        try {
          const delegated = await this.dependencies.adapter.execute(
            request.goal,
            signal,
            capability,
            request.shellCommand,
          )
          const observationAfterDelegation = await this.dependencies.browser
            .observe(signal)
            .catch(() => undefined)
          return {
            ...delegated,
            evidence: mergeBrowserEvidence(
              delegated.evidence,
              observationBeforeDelegation,
              observationAfterDelegation,
            ),
          }
        } catch (error) {
          const observationAfterDelegation = await this.dependencies.browser
            .observe(signal)
            .catch(() => undefined)
          if (error instanceof DshAdapterError) {
            throw mapDshAdapterError(
              error,
              mergeBrowserEvidence(
                error.evidence,
                observationBeforeDelegation,
                observationAfterDelegation,
              ),
            )
          }
          throw error
        }
      }
      return await this.dependencies.adapter.execute(
        request.goal,
        signal,
        capability,
        request.shellCommand,
      )
    } catch (error) {
      if (signal.aborted) {
        throw new ActionError(
          'ACTION_CANCELLED',
          'Browser action was cancelled',
          'cancelled',
          true,
          'desktop-control',
        )
      }
      if (error instanceof ActionError) throw error
      if (error instanceof BrowserAutomationError) {
        throw new ActionError(
          error.code,
          error.message,
          'failure',
          error.recoverable,
          'desktop-control',
        )
      }
      throw mapDshAdapterError(error)
    }
  }

  async emergencyStop(): Promise<void> {
    await Promise.allSettled([this.dependencies.adapter.close(), this.dependencies.browser.close()])
  }

  async observeBrowserForVerification(signal: AbortSignal) {
    this.assertActive()
    return this.dependencies.browser.observe(signal)
  }

  private executeBrowserOperation(
    operation: NonNullable<DesktopWorkflowRequest['browserOperation']>,
    signal: AbortSignal,
  ): Promise<BrowserInteractionResult> {
    switch (operation.operation) {
      case 'open':
        return this.dependencies.browser.open(operation.url, signal)
      case 'click':
        return this.dependencies.browser.click(operation.target, signal)
      case 'switch-tab':
        return this.dependencies.browser.switchTab(operation.tabId, signal)
    }
  }

  private resolveBrowserContextRequirement(userText: string): BrowserContextRequirement {
    const session = this.dependencies.browser.sessionSnapshot()
    if (session?.status !== 'ready') return 'none'
    const normalized = userText.normalize('NFKC').toLocaleLowerCase()
    const browserSemanticCue =
      /(?:брауз|страниц|сайт|вклад|url|заголов|контент|кноп|ссыл|раздел|каталог|меню|наж|клик|перей|подробнее|результат|открыл|вернись|назад|впер[её]д)/u.test(
        normalized,
      ) ||
      /(?:browser|page|site|tab|title|content|button|link|section|catalog|menu|click|press|open|result|back|forward)/u.test(
        normalized,
      ) ||
      /(?:что\s+(?:теперь|здесь|там)|что\s+открылось|what(?:'s| is)\s+(?:here|open|on it)|what\s+now)/u.test(
        normalized,
      )
    return browserSemanticCue ? 'current-page' : 'none'
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('Desktop Control plugin is not initialized')
  }

  private assertActive(): void {
    this.assertInitialized()
    if (!this.active) {
      throw new ActionError(
        'DESKTOP_CONTROL_DISABLED',
        'Desktop Control plugin is disabled',
        'failure',
        true,
        'desktop-control',
      )
    }
  }

  private publishChanged(): void {
    for (const listener of this.listeners) listener()
  }
}

function singleHttpUrl(text: string): string | undefined {
  const candidates = text.match(/https?:\/\/[^\s<>"']+/gi) ?? []
  const urls = new Set<string>()
  for (const candidate of candidates) {
    const trimmed = candidate.replace(/[),.;!?]+$/, '')
    try {
      const parsed = new URL(trimmed)
      if (!parsed.username && !parsed.password) urls.add(parsed.href)
    } catch {
      // Goals without one exact valid URL remain delegated to the bounded planner.
    }
  }
  return urls.size === 1 ? urls.values().next().value : undefined
}

export function mapDshAdapterError(
  error: unknown,
  evidence?: BrowserExecutionEvidence,
): ActionError {
  if (!(error instanceof DshAdapterError)) {
    return new ActionError('DESKTOP_CONTROL_FAILED', 'Desktop Control failed', 'failure', true)
  }
  return new ActionError(
    error.code,
    error.message,
    error.code === 'DSH_REQUEST_TIMEOUT'
      ? 'timeout'
      : error.code === 'DSH_CANCELLED'
        ? 'cancelled'
        : 'failure',
    error.recoverable,
    'desktop-control',
    evidence ?? error.evidence,
  )
}

function mergeBrowserEvidence(
  evidence: unknown,
  before: BrowserExecutionEvidence['before'],
  after: BrowserExecutionEvidence['after'],
): BrowserExecutionEvidence {
  const browserEvidence =
    evidence && typeof evidence === 'object' && 'kind' in evidence && evidence.kind === 'browser'
      ? (evidence as BrowserExecutionEvidence)
      : ({ kind: 'browser', operation: 'workflow' } as const)
  return {
    ...browserEvidence,
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  }
}
