import type { DesktopAuthorityMode, DesktopWorkflowRequest } from '../../shared/actions'
import type {
  DesktopControlCapabilityProjection,
  DesktopControlStatus,
} from '../../shared/desktop-control'
import { AGENT_BROWSER_VERSION } from '../../shared/desktop-control'
import type { PluginHealth, PluginManifest } from '../../shared/plugins'
import { DESKTOP_CONTROL_PLUGIN_ID } from '../../shared/plugins'
import { ActionError } from '../action'
import type { BundledPlugin, PluginInitializationContext } from '../plugins/PluginRuntime'
import { DshAdapterError, type DshHarnessAdapter } from './DshHarnessAdapter'

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
    await this.dependencies.adapter.close()
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
    if (!this.packagedRuntimeAvailable) {
      return {
        state: 'needs-setup',
        detailKey: 'plugins.desktopControl.runtimeMissing',
        checkedAt: Date.now(),
      }
    }
    if (runtime.state === 'error') {
      return { state: 'error', detail: runtime.lastError, checkedAt: Date.now() }
    }
    if (this.active && !model.configured) {
      return {
        state: 'needs-setup',
        detailKey: 'plugins.desktopControl.modelNeedsSetup',
        checkedAt: Date.now(),
      }
    }
    const browserReady =
      this.browserAvailability.packagedBinaryAvailable &&
      this.browserAvailability.executableAvailable
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
      this.packagedRuntimeAvailable &&
      this.browserAvailability.packagedBinaryAvailable &&
      this.browserAvailability.executableAvailable &&
      model.configured
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

  async stopRuntime(): Promise<DesktopControlStatus> {
    await this.dependencies.adapter.close()
    return this.getStatus()
  }

  async executeWorkflow(
    request: DesktopWorkflowRequest,
    signal: AbortSignal,
  ): Promise<import('../../shared/actions').DesktopWorkflowExecution> {
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
        'Browser Control requires the bundled browser bridge, Chrome, and an active model in Settings',
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
      return await this.dependencies.adapter.execute(
        request.goal,
        signal,
        capability,
        request.shellCommand,
        request.browserUrl ?? (capability === 'browser' ? singleHttpUrl(request.goal) : undefined),
      )
    } catch (error) {
      throw mapDshAdapterError(error)
    }
  }

  emergencyStop(): Promise<void> {
    return this.dependencies.adapter.close()
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

export function mapDshAdapterError(error: unknown): ActionError {
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
  )
}
